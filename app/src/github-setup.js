import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { escapeHtml as h } from './secure.js';
import { layout } from './view.js';
import { contentSecurityPolicy, serveAsset } from './assets.js';

export function appManifest({ origin, name = 'PR Walkthrough', callbackOrigin = origin }) {
  return {
    name, url: origin,
    description: 'A PR review workspace with on-demand code walkthroughs.',
    redirect_url: `${callbackOrigin}/setup/callback`,
    callback_urls: [`${origin}/auth/callback`],
    setup_url: `${origin}/auth/login`, setup_on_update: true,
    public: true, request_oauth_on_install: false,
    // Omit hook_attributes entirely: GitHub requires a public URL whenever that
    // object is present, even if active is false. Local sync uses polling.
    default_permissions: { contents: 'write', pull_requests: 'write', issues: 'write', checks: 'read', statuses: 'read', metadata: 'read' },
    default_events: []
  };
}

export async function exchangeManifest(code) {
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`GitHub could not complete app registration (HTTP ${response.status}).`);
  return response.json();
}

export async function saveAppConfiguration(path, app, { origin, databaseUrl, login, runner = 'codex', model = '' }) {
  for (const key of ['id', 'slug', 'client_id', 'client_secret', 'pem']) if (!app[key]) throw new Error(`GitHub did not return ${key}.`);
  if (!/^[a-zA-Z0-9-]+$/.test(login)) throw new Error('A GitHub operator login is required.');
  const values = {
    DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: origin, HOST: '127.0.0.1', PORT: new URL(origin).port || '80',
    GITHUB_APP_ID: String(app.id), GITHUB_APP_SLUG: app.slug, GITHUB_CLIENT_ID: app.client_id,
    GITHUB_CLIENT_SECRET: app.client_secret, GITHUB_PRIVATE_KEY_BASE64: Buffer.from(app.pem).toString('base64'),
    GITHUB_WEBHOOK_SECRET: app.webhook_secret || randomBytes(32).toString('hex'),
    SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    WALKTHROUGH_RUNNER: runner, WALKTHROUGH_MODEL: model, GENERATION_ENABLED: 'true', AUTOMATIC_GENERATION_ENABLED: 'false',
    PRIVATE_ALLOWED_MODELS: `${runner}/${model || 'default'}`,
    ALLOWED_GITHUB_LOGINS: login.toLowerCase(), PUBLISH_WALKTHROUGH_LINKS: 'false'
  };
  for (const value of Object.values(values)) if (/[\r\n"\\]/.test(value)) throw new Error('Invalid configuration value.');
  const text = '# Local GitHub App credentials. Never commit this file.\n' + Object.entries(values).map(([key, value]) => `${key}="${value}"`).join('\n') + '\n';
  await writeFile(path, text, { mode: 0o600, flag: 'wx' });
  return values;
}

export function createGitHubSetupServer({ origin, name, databaseUrl, login, runner = 'codex', model = '', envPath,
  exchange = exchangeManifest, complete = async () => {} }) {
  const states = new Map();
  let finishing = false;
  const send = (res, status, title, html, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': contentSecurityPolicy, ...headers });
    res.end(layout(title, html, null, { local: true }));
  };
  async function route(req, res) {
    if (req.headers.host !== new URL(origin).host) return send(res, 403, 'Invalid host', '<p>Open the local setup address.</p>');
    const url = new URL(req.url, origin);
    if (await serveAsset(req, res, url.pathname)) return;
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed', '<p>Use the setup page.</p>');
    if (url.pathname === '/health') { res.writeHead(200); res.end('SETUP'); return; }
    if (url.pathname === '/') {
      try { await access(envPath); return send(res, 409, 'Already configured', '<p>Configuration exists. Restart the connected app.</p>'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const [state, expires] of states) if (expires < Date.now()) states.delete(state);
      if (states.size > 100) states.clear();
      const state = randomBytes(32).toString('hex');
      states.set(state, Date.now() + 3_600_000);
      const manifest = appManifest({ origin, name });
      return send(res, 200, 'Connect GitHub', `<section class="home"><div class="eyebrow">CONNECT YOUR WORKSPACE</div>
        <h1>Your real PRs.<br>A walkthrough waiting.</h1>
        <p>Connect GitHub, choose repositories, and sign in. Open PRs will appear here. AI generation starts disabled so connecting repositories does not use model credits.</p>
        <div class="panel" style="text-align:left;max-width:680px;margin:28px auto;padding:24px">
          <h2>Ready on this computer</h2><p>PostgreSQL stores your reviews and walkthroughs. If you enable AI generation later, ${h(runner === 'codex' ? 'Codex' : 'Claude')} uses its existing login${model ? ` and ${h(model)}` : ''} to explain PR code, including private code from repositories you select.</p>
          <p>GitHub will let you choose repositories and review permissions for reading code and checks, managing PRs, posting reviews and comments, and merging. Nothing is posted automatically.</p>
          <p class="muted small">Available at ${h(origin)} while this computer is running. GitHub sync runs every five minutes. Sign-in is initially limited to @${h(login)}.</p>
        </div>
        <form action="https://github.com/settings/apps/new?state=${state}" method="post">
          <input type="hidden" name="manifest" value="${h(JSON.stringify(manifest))}">
          <button class="button" type="submit">Connect GitHub →</button>
        </form><p class="muted small">GitHub App credentials are saved locally with access restricted to your OS account.</p></section>`, {
          'Set-Cookie': `walk_setup_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`
        });
    }
    if (url.pathname === '/setup/callback') {
      const state = url.searchParams.get('state');
      const cookieState = /(?:^|;\s*)walk_setup_state=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (!state || state !== cookieState || !states.has(state) || states.get(state) < Date.now() || finishing)
        return send(res, 400, 'Setup expired', '<section class="home"><h1>Restart GitHub setup</h1><p>This setup link expired or did not match this browser.</p><a href="/">Return to setup</a></section>');
      const code = url.searchParams.get('code');
      if (!code || !/^[a-zA-Z0-9_-]{10,200}$/.test(code)) return send(res, 400, 'Invalid callback', '<p>GitHub did not return a valid registration code.</p>');
      finishing = true;
      try {
        const app = await exchange(code);
        const values = await saveAppConfiguration(envPath, app, { origin, databaseUrl, login, runner, model });
        states.clear();
        await complete(values);
        send(res, 200, 'GitHub App connected', `<section class="home"><div class="eyebrow">GITHUB APP REGISTERED</div><h1>Choose your repositories.</h1><p>Install the app on the repositories you want to review. GitHub will then return you here to sign in.</p><a class="button" href="https://github.com/apps/${h(app.slug)}/installations/new">Choose repositories →</a></section>`, {
          'Set-Cookie': 'walk_setup_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
        });
      } catch (error) {
        finishing = false;
        throw error;
      }
      return;
    }
    send(res, 404, 'Not found', '<a href="/">Return to setup</a>');
  }
  return http.createServer((req, res) => route(req, res).catch(() => {
    // GitHub responses and credentials never appear in browser errors or logs.
    send(res, 500, 'Setup needs attention', '<section class="home"><h1>Setup could not finish.</h1><p>Check the local configuration and restart the app. Existing credentials are preserved.</p></section>');
  }));
}
