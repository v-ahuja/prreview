import './env.js';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { database, transaction } from './db.js';
import * as gh from './github.js';
import { pullFields, queueRun, savePull } from './runs.js';
import { encrypt, escapeHtml as h, hashToken, randomToken, verifyWebhook } from './secure.js';
import { layout } from './view.js';
import { renderInbox, renderPull } from './pr-view.js';
import { contentSecurityPolicy, serveAsset } from './assets.js';
import { resolveScope } from './review.js';
import { answerQuestion } from './chat.js';
import { performPullAction } from './github-actions.js';
import { syncRepository, syncWebhookPull } from './sync.js';
import { modelSelection, generationPreferences } from './model-selection.js';
import { parsePrUrl } from './local-server.js';

export function createHostedServer({ cfg = config(), db = database(cfg.databaseUrl), github = gh, answer = answerQuestion } = {}) {
  const chatBusy = new Set();
  const syncBusy = new Set();
  const allowedModes = new Set(['manual', 'on_open', 'on_update']);
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': contentSecurityPolicy, ...headers });
    res.end(body);
  };
  const json = (res, status, data) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
  const redirect = (res, location, cookies = []) => send(res, 303, '', { Location: location, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
  const cookie = (name, value, maxAge = 3600) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.origin.startsWith('https:') ? '; Secure' : ''}`;
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2));
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  async function body(req, max = 100_000) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > max) fail('Request too large', 413); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function session(req) {
    const id = cookies(req).walk_session;
    if (!id) return null;
    return (await db.query('SELECT * FROM sessions WHERE id_hash=$1', [hashToken(id)])).rows[0] || null;
  }
  async function authorized(req, res, url) {
    const user = await session(req);
    if (user && cfg.allowedLogins?.size && !cfg.allowedLogins.has(user.login.toLowerCase())) fail('This workspace is restricted to its configured GitHub users.', 403);
    const token = user && await github.sessionToken(db, cfg, user);
    if (!token) {
      if (url.pathname.endsWith('/chat') || url.pathname.endsWith('/code') || url.pathname.endsWith('/reviewed')) json(res, 401, { error: 'Sign in again to continue.' });
      else redirect(res, `/auth/login?return=${encodeURIComponent(url.pathname + url.search)}`);
      return null;
    }
    return { user, token };
  }
  async function pullContext(auth, owner, repo, number) {
    // Re-check live access on every request, including archived code and chat.
    const pull = await github.getPull(auth.token, owner, repo, number);
    const [installation, repository] = await Promise.all([github.installationForRepo(cfg, owner, repo), github.getRepo(auth.token, owner, repo)]);
    const fields = pullFields(pull, installation.id);
    await savePull(db, fields);
    return { pull, repository, fields };
  }
  async function syncForUser(userId, token) {
    if (syncBusy.has(userId)) fail('A GitHub sync is already running.', 429);
    syncBusy.add(userId);
    try {
      const repos = await github.accessibleRepos(token);
      for (const repo of repos) {
        const appToken = await github.installationToken(cfg, repo.installationId);
        await syncRepository(db, cfg, repo, repo.installationId, appToken);
      }
    } finally { syncBusy.delete(userId); }
  }
  async function webhook(req, res) {
    const raw = await body(req, 5_000_000);
    if (!verifyWebhook(Buffer.from(raw), req.headers['x-hub-signature-256'], cfg.webhookSecret)) return send(res, 401, 'Invalid signature');
    const event = req.headers['x-github-event'];
    const payload = JSON.parse(raw);
    const delivery = req.headers['x-github-delivery'];
    if (!delivery || delivery.length > 100) return send(res, 400, 'Missing delivery ID');
    const added = await db.query('INSERT INTO webhook_deliveries(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [delivery]);
    if (!added.rows.length) return send(res, 202, 'Already accepted');
    try {
      if (event === 'installation' && ['deleted','suspend'].includes(payload.action)) {
        await transaction(db, async client => {
          await client.query('DELETE FROM pulls WHERE installation_id=$1', [payload.installation.id]);
          await client.query('DELETE FROM repository_settings WHERE installation_id=$1', [payload.installation.id]);
          await client.query('DELETE FROM installations WHERE id=$1', [payload.installation.id]);
        });
      } else if (event === 'installation_repositories' && payload.action === 'removed') {
        for (const repository of payload.repositories_removed || []) {
          await db.query('DELETE FROM pulls WHERE repo_id=$1', [repository.id]);
          await db.query('DELETE FROM repository_settings WHERE repo_id=$1', [repository.id]);
        }
      } else if (['pull_request','pull_request_review','pull_request_review_comment','issue_comment','issues'].includes(event)) {
        await syncWebhookPull(db, cfg, payload);
      }
      return send(res, 202, 'Accepted');
    } catch (error) {
      await db.query('DELETE FROM webhook_deliveries WHERE id=$1', [delivery]);
      throw error;
    }
  }
  async function route(req, res) {
    if (cfg.host === '127.0.0.1' && req.headers.host !== new URL(cfg.origin).host) fail('Invalid host', 403);
    const url = new URL(req.url, cfg.origin);
    if (await serveAsset(req, res, url.pathname)) return;
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, 'OK');
    if (req.method === 'POST' && url.pathname === '/webhook') return webhook(req, res);
    if (req.method === 'POST' && req.headers.origin !== cfg.origin) return json(res, 403, { error: 'This request must come from the app.' });
    if (req.method === 'GET' && url.pathname === '/auth/login') {
      const state = randomToken(), returnTo = url.searchParams.get('return');
      const path = returnTo?.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\') ? returnTo : '/';
      const target = new URL('https://github.com/login/oauth/authorize');
      target.searchParams.set('client_id', cfg.clientId); target.searchParams.set('redirect_uri', `${cfg.origin}/auth/callback`); target.searchParams.set('state', state);
      return redirect(res, target.toString(), [cookie('walk_oauth_state', state, 600), cookie('walk_return', path, 600)]);
    }
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const stored = cookies(req);
      if (!stored.walk_oauth_state || stored.walk_oauth_state !== url.searchParams.get('state')) fail('Sign-in state did not match. Please sign in again.');
      const tokens = await github.exchangeCode(cfg, url.searchParams.get('code'));
      const user = await github.getUser(tokens.access_token), sessionId = randomToken();
      if (cfg.allowedLogins?.size && !cfg.allowedLogins.has(user.login.toLowerCase())) fail('This workspace is restricted to its configured GitHub users.', 403);
      await db.query(`INSERT INTO sessions (id_hash,user_id,login,token_cipher,refresh_cipher,token_expires_at,refresh_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        hashToken(sessionId), user.id, user.login, encrypt(tokens.access_token, cfg.encryptionKey), tokens.refresh_token ? encrypt(tokens.refresh_token, cfg.encryptionKey) : null,
        tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null, tokens.refresh_token_expires_in ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000) : null
      ]);
      // Bootstrap selected repositories on sign-in instead of waiting for the next poll.
      void syncForUser(String(user.id), tokens.access_token).catch(error => console.error('Initial GitHub sync failed:', error.message));
      return redirect(res, stored.walk_return?.startsWith('/') && !stored.walk_return.startsWith('//') && !stored.walk_return.includes('\\') ? stored.walk_return : '/', [cookie('walk_session', sessionId, 60 * 60 * 24 * 30), cookie('walk_oauth_state', '', 0), cookie('walk_return', '', 0)]);
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      const id = cookies(req).walk_session;
      if (id) await db.query('DELETE FROM sessions WHERE id_hash=$1', [hashToken(id)]);
      return redirect(res, '/', [cookie('walk_session', '', 0)]);
    }
    if (url.pathname === '/' && req.method === 'GET' && !await session(req)) return send(res, 200, layout('Understand the change', `<section class="home"><div class="eyebrow">A CALMER WAY TO REVIEW</div><h1>Understand the change.<br>Then make the call.</h1><p>Your team's pull requests, ready to review. Inspect the diff, discuss changes, and generate a walkthrough when you want one.</p><a class="button" href="/auth/login">Sign in with GitHub →</a><p class="muted small">Connect a repository once. GitHub stays in sync. Walkthroughs run on request.</p></section>`));
    const auth = await authorized(req, res, url); if (!auth) return;
    if (url.pathname === '/' && req.method === 'GET') {
      const repos = await github.accessibleRepos(auth.token);
      const ids = repos.map(r => r.id);
      const { rows } = await db.query(`SELECT p.*,r.status AS run_status,jsonb_array_length(r.result->'slices') AS slice_count FROM pulls p
        LEFT JOIN LATERAL (SELECT status,result FROM runs WHERE repo_id=p.repo_id AND number=p.number AND base_sha=p.base_sha AND head_sha=p.head_sha AND scope='full' ORDER BY created_at DESC LIMIT 1) r ON true
        WHERE p.repo_id=ANY($1::bigint[]) ORDER BY COALESCE(p.metadata->>'updated_at','') DESC`, [ids]);
      const { rows: settings } = await db.query('SELECT * FROM repository_settings WHERE repo_id=ANY($1::bigint[])', [ids]);
      const errors = settings.filter(s => s.sync_error);
      const syncing = syncBusy.has(String(auth.user.user_id));
      const notice = syncing ? 'Importing your pull requests from GitHub…' : errors.length ? `Sync needs attention in ${errors.length} repository: ${errors[0].sync_error}` : url.searchParams.get('synced') ? (cfg.generationEnabled ? 'GitHub sync complete. Open a PR to review its diff or request a walkthrough.' : 'GitHub sync complete. AI generation is disabled.') : '';
      return send(res, 200, renderInbox({ user: auth.user, rows, repos, query: url.searchParams, appSlug: cfg.appSlug, notice, generationEnabled: cfg.generationEnabled }), syncing ? { Refresh: '3' } : {});
    }
    if (req.method === 'POST' && url.pathname === '/sync') {
      await syncForUser(String(auth.user.user_id), auth.token);
      return redirect(res, '/?synced=1');
    }
    if (req.method === 'GET' && url.pathname === '/open') {
      const pr = parsePrUrl(url.searchParams.get('url'));
      return redirect(res, `/p/${pr.owner}/${pr.repo}/${pr.number}`);
    }
    const match = /^\/p\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/([1-9]\d*)(?:\/v\/([a-f0-9-]{36}))?(?:\/(generate|settings|action|code|chat|reviewed|source))?$/.exec(url.pathname);
    if (!match) return send(res, 404, layout('Not found', '<section class="empty"><h1>Page not found</h1><a href="/">Back to pull requests</a></section>', auth.user));
    const [, owner, repo, rawNumber, version, action] = match, number = Number(rawNumber);
    const path = `/p/${owner}/${repo}/${number}`;
    const { pull, repository, fields } = await pullContext(auth, owner, repo, number);
    const { rows: runs } = await db.query('SELECT * FROM runs WHERE repo_id=$1 AND number=$2 ORDER BY created_at DESC', [fields.repoId, number]);
    const selected = version ? runs.find(r => r.id === version) : runs.find(r => r.base_sha === fields.baseSha && r.head_sha === fields.headSha && r.scope === 'full');
    if (version && !selected) fail('This archived walkthrough does not exist.', 404);
    const { rows: marks } = await db.query('SELECT head_sha FROM review_marks WHERE repo_id=$1 AND number=$2 AND user_id=$3', [fields.repoId, number, auth.user.user_id]);
    const lastReview = marks[0]?.head_sha;
    if (req.method === 'GET' && action === 'source') {
      if (url.searchParams.get('head') !== pull.head.sha || url.searchParams.get('base') !== pull.base.sha) fail('This PR changed. Reload the diff.', 409);
      const file = url.searchParams.get('file');
      const files = await github.listPullFiles(auth.token, owner, repo, number);
      const entry = files.find(f => f.filename === file);
      if (!entry) fail('File is not part of this PR.', 404);
      const side = url.searchParams.get('side') === 'base' ? 'base' : 'head';
      if (side === 'base' && entry.status === 'added' || side === 'head' && entry.status === 'removed') return json(res, 200, {content:''});
      return json(res, 200, await github.readCode(auth.token, owner, repo, side === 'base' ? await github.mergeBase(auth.token,owner,repo,pull.base.sha,pull.head.sha) : pull.head.sha, side === 'base' ? entry.previous_filename || file : file));
    }
    if (req.method === 'GET' && action === 'code') {
      if (selected?.status !== 'ready' || !selected.result.evidence) fail('Regenerate this older walkthrough to enable the full editor.', 409);
      const evidence = selected.result.evidence, file = url.searchParams.get('file');
      if (!evidence.files.includes(file)) fail('This file is not part of the walkthrough.', 404);
      const side = url.searchParams.get('side') === 'base' ? 'base' : 'head';
      const sha = side === 'base' ? evidence.baseSha : evidence.headSha;
      const sourceFile = evidence.sourceFiles ? evidence.sourceFiles[file]?.[side] : file;
      if (!sourceFile) fail(`This file does not exist in the ${side} version. Choose the other version.`, 404);
      return json(res, 200, await github.readCode(auth.token, owner, repo, sha, sourceFile));
    }
    if (req.method === 'POST' && action === 'chat') {
      if (!cfg.generationEnabled) fail('AI generation and chat are disabled for this workspace.', 503);
      if (selected?.status !== 'ready') fail('Open a completed walkthrough first.', 409);

      if (chatBusy.has(auth.user.user_id)) fail('Wait for your current answer to finish.', 429);
      const input = JSON.parse(await body(req, 3_000_000));
      const choice = modelSelection(input,cfg);
      if (fields.private && !cfg.privateAllowedModels.has(choice.modelId)) fail('This harness/model is not enabled for private code. Choose an approved model.',403);
      chatBusy.add(auth.user.user_id);
      try { return json(res, 200, await answer({ result: selected.result, input, model: choice.model, runner: choice.runner })); }
      finally { chatBusy.delete(auth.user.user_id); }
    }
    if (req.method === 'POST' && action === 'reviewed') {
      if (selected?.status !== 'ready') fail('Finish a generated walkthrough first.', 409);
      if (selected.scope !== 'full' || selected.head_sha !== pull.head.sha || selected.base_sha !== pull.base.sha) return json(res, 200, { message: 'Walkthrough complete. Your current full-PR review baseline is unchanged.' });
      await db.query(`INSERT INTO review_marks(repo_id,number,user_id,head_sha) VALUES($1,$2,$3,$4)
        ON CONFLICT(repo_id,number,user_id) DO UPDATE SET head_sha=$4,reviewed_at=now()`, [fields.repoId, number, auth.user.user_id, selected.head_sha]);
      return json(res, 200, { message: 'Walkthrough complete. Your next review can start from this commit.' });
    }
    if (req.method === 'POST' && ['generate','settings','action'].includes(action) && !version) {
      const form = new URLSearchParams(await body(req, action === 'action' ? 3_000_000 : 100_000));
      if (action === 'generate') {
        if (!cfg.generationEnabled) fail('Walkthrough generation is disabled for this workspace.', 503);
        if (!repository.permissions?.push && !repository.permissions?.admin) fail('Write access is required to generate a walkthrough.', 403);
        const commits = form.get('scope') === 'range' ? await github.listPullCommits(auth.token, owner, repo, number) : [];
        const scope = resolveScope(form, pull, commits, lastReview);
        const choice = modelSelection(form,cfg);
        if (fields.private && !cfg.privateAllowedModels.has(choice.modelId)) fail('This harness/model is not enabled for private code. Choose an approved model.',403);
        const queued = await queueRun(db, fields, scope, {...choice,requestedBy:auth.user.user_id});
        if (queued.limited) fail('The repository has reached its daily generation limit or this version has failed three times.', 429);
        return redirect(res, `${path}/v/${queued.id}?tab=walkthrough`);
      }
      if (action === 'settings') {
        if (!repository.permissions?.admin) fail('Repository admin access is required.', 403);
        const mode = form.get('mode');
        if (!allowedModes.has(mode)) fail('Invalid generation mode');
        if ((!cfg.generationEnabled || !cfg.automaticGenerationEnabled) && mode !== 'manual') fail('Automatic generation is disabled for this workspace.', 503);
        await db.query('UPDATE repository_settings SET mode=$2,updated_at=now() WHERE repo_id=$1', [fields.repoId, mode]);
        if (mode !== 'manual' && pull.state === 'open' && !pull.draft) await queueRun(db, fields, undefined, {...cfg,trigger:'automatic'});
        return redirect(res, path);
      }
      await performPullAction({ token: auth.token, pull, repository, user: auth.user, form, request: github.githubFetch });
      const updated = await github.getPull(auth.token, owner, repo, number);
      await savePull(db, pullFields(updated, fields.installationId));
      return redirect(res, `${path}?tab=${form.get('action') === 'review' ? 'files&reviewed=1' : 'conversation'}&saved=1`);
    }
    if (req.method === 'GET' && !action) {
      const tab = ['walkthrough','conversation','commits','files','checks'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'files';
      const [commits, files, activity, people, settings] = await Promise.all([
        github.listPullCommits(auth.token, owner, repo, number),
        tab === 'files' ? github.listPullFiles(auth.token, owner, repo, number) : Promise.resolve([]),
        ['conversation','checks','files'].includes(tab) ? github.pullActivity(auth.token, owner, repo, number, pull.head.sha) : Promise.resolve({}),
        ['conversation','files'].includes(tab) ? github.repoPeople(auth.token, owner, repo) : Promise.resolve({ people: [], teams: [] }),
        db.query('SELECT mode FROM repository_settings WHERE repo_id=$1', [fields.repoId])
      ]);
      return send(res, 200, renderPull({ user: auth.user, pull, repository, runs, selected, commits, files, activity, people, tab, lastReview, mode: settings.rows[0]?.mode, generationEnabled: cfg.generationEnabled, automaticGenerationEnabled: cfg.automaticGenerationEnabled, generationPreferences: generationPreferences(cfg),
        notice: url.searchParams.get('saved') ? 'Saved to GitHub.' : '' }), cfg.generationEnabled && tab === 'walkthrough' && ['queued','running'].includes(selected?.status) ? { Refresh: '5' } : {});
    }
    fail('Not found', 404);
  }
  return http.createServer((req, res) => route(req, res).catch(error => {
    const status = [400,401,403,404,409,413,422,429,503].includes(error.status) ? error.status : 500;
    if (status === 500) console.error(error);
    const message = status === 500 ? 'Something went wrong. Please try again.' : error.message;
    if (/\/(chat|code|source|reviewed)(\?|$)/.test(req.url)) return json(res, status, { error: message });
    send(res, status, layout('Unable to complete this action', `<section class="panel error-page"><h1>Unable to complete this action</h1><p>${h(message)}</p><p><a href="/">Return to pull requests</a></p></section>`));
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = config();
  createHostedServer({ cfg }).listen(cfg.port, cfg.host, () => console.log(`Walkthrough web listening on ${cfg.origin}`));
}
