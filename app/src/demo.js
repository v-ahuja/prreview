import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { pull as fixture, walkthrough, diff, changedFiles, sources } from '../demo/fixture.js';
import { renderInbox, renderPull } from './pr-view.js';
import { contentSecurityPolicy, serveAsset } from './assets.js';
import { enrichWalkthrough, resolveScope } from './review.js';
import { performPullAction } from './github-actions.js';

export function createDemoServer() {
  const user = { id: 1, user_id: 1, login: 'alex' };
  const repository = { id: 1, full_name: 'example/reading-list', name: 'reading-list', owner: { login: 'example' }, permissions: { push: true, admin: true } };
  const pull = { number: 42, title: fixture.title, state: 'open', draft: false, merged: false,
    body: '## What changes\nSaved articles now synchronize across devices in the background.\n\n- Keep local saves fast\n- Send queued changes as a batch\n- Resolve duplicate articles by saved time\n\nThe walkthrough follows the data from a local save to the merged list.',
    user: { login: 'maya' }, base: { sha: 'a'.repeat(40), ref: 'main', repo: repository }, head: { sha: fixture.headSha, ref: 'feature/article-sync' },
    labels: [{ name: 'feature' }, { name: 'sync' }], assignees: [{ login: 'maya' }], requested_reviewers: [{ login: 'alex' }, { login: 'sam' }], requested_teams: [],
    additions: 23, deletions: 1, changed_files: 3, created_at: '2026-10-27T15:00:00Z', updated_at: '2026-10-28T10:30:00Z', html_url: 'https://github.com/example/reading-list/pull/42' };
  const commits = changedFiles.map((file, i) => ({ sha: i === 2 ? fixture.headSha : String(i + 1).repeat(40), parents: [{ sha: i === 0 ? pull.base.sha : String(i).repeat(40) }], commit: { message: ['Queue saved articles for background sync', 'Send pending changes as a batch', 'Merge remote articles by saved time'][i], author: { name: 'Maya Chen', date: '2026-10-27T16:00:00Z' } }, author: { login: 'maya' } }));
  const result = enrichWalkthrough(walkthrough, { diff, changedFiles, manifest: { mergeBase: pull.base.sha, headSha: pull.head.sha, commits } });
  const runs = [
    { id: '11111111-1111-4111-8111-111111111111', scope: 'full', status: 'ready', base_sha: pull.base.sha, head_sha: pull.head.sha, created_at: '2026-10-28T10:33:00Z', result },
    { id: '22222222-2222-4222-8222-222222222222', scope: 'full', status: 'ready', base_sha: pull.base.sha, head_sha: commits[1].sha, created_at: '2026-10-27T16:30:00Z', result: { ...structuredClone(result), slices: structuredClone(result.slices.slice(0,2)), evidence: { ...result.evidence, headSha: commits[1].sha } } }
  ];
  const activity = { comments: [{ id: 1, user: { login: 'sam' }, body: 'The local-first flow makes sense. @alex could you look at how conflicts are resolved across devices?', created_at: '2026-10-27T18:00:00Z' }], reviews: [], threads: [],
    checks: [{ name: 'Unit tests', status: 'completed', conclusion: 'success' }, { name: 'Build & lint', status: 'completed', conclusion: 'success' }, { name: 'Integration tests', status: 'completed', conclusion: 'success' }], status: { statuses: [] } };
  const files = changedFiles.map(file => ({ filename: file, status: file === 'src/store.js' ? 'modified' : 'added', additions: file === 'src/store.js' ? 3 : 7, deletions: file === 'src/store.js' ? 1 : 0, patch: diff.split(/(?=^diff --git )/m).find(s=>s.includes(`b/${file}`)).split('\n').slice(4).join('\n') }));
  const people = { people: ['alex','maya','sam','jordan','riley'].map(login=>({ login })), teams: [{ slug: 'platform', name: 'Platform' }, { slug: 'frontend', name: 'Frontend' }] };
  let lastReview = commits[1].sha, mode = 'manual';
  const extraRows = [
    ['Make keyboard navigation consistent in search', 41, 'jordan', 'ready', 4, ['accessibility']],
    ['Handle expired sessions during background refresh', 40, 'riley', 'ready', 5, ['bug']],
    ['Add reading-time estimates to article cards', 39, 'alex', 'running', 0, ['enhancement']],
    ['Simplify the article import pipeline', 38, 'maya', 'ready', 6, ['refactor']],
    ['Update offline storage documentation', 37, 'sam', 'ready', 2, ['docs']]
  ];
  const send = (res, status, body, type = 'text/html; charset=utf-8', headers = {}) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': contentSecurityPolicy, 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(body); };
  const json = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
  const route = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await serveAsset(req, res, url.pathname)) return;
    if (req.method === 'GET' && url.pathname === '/') {
      const rows = [{ repo_id: 1, owner: 'example', repo: 'reading-list', number: 42, metadata: pull, run_status: 'ready', slice_count: 3 }, ...extraRows.map(([title, number, login, status, count, labels]) => ({ repo_id: 1, owner: 'example', repo: 'reading-list', number, metadata: { ...pull, title, number, user: { login }, labels: labels.map(name=>({ name })), requested_reviewers: number === 40 ? [{ login: 'alex' }] : [], updated_at: '2026-10-27T12:00:00Z' }, run_status: status, slice_count: count }))];
      return send(res, 200, renderInbox({ user, rows, repos: [repository], query: url.searchParams, demo: true }));
    }
    if (req.method === 'GET' && url.pathname === '/open') return send(res, 303, '', 'text/html', { Location: '/p/example/reading-list/42' });
    const match = /^\/p\/example\/reading-list\/(\d+)(?:\/v\/([a-f0-9-]{36}))?(?:\/(generate|settings|action|chat|code|source|reviewed))?$/.exec(url.pathname);
    if (!match) return send(res, 404, 'Page not found');
    const [, number, version, action] = match, path = `/p/example/reading-list/${number}`;
    const selected = version ? runs.find(r=>r.id === version) : runs[0];
    if (!selected) return json(res, 404, { error: 'Review version not found.' });
    const extra = extraRows.find(r=>String(r[1]) === number);
    const shownPull = extra ? { ...pull, number: Number(number), title: extra[0], user: { login: extra[2] } } : pull;
    if (req.method === 'GET' && !action) return send(res, 200, renderPull({ user, pull: shownPull, repository, runs, selected, commits, files, activity, people, tab: url.searchParams.get('tab') || 'files', demo: true, lastReview, mode,
      notice: extra ? 'Demo preview: these sample PRs share the article-sync walkthrough to demonstrate the workspace.' : url.searchParams.get('saved') ? 'Demo action saved in this preview. Nothing was sent to GitHub.' : '' }));
    if (req.method === 'GET' && ['code','source'].includes(action)) {
      const file = url.searchParams.get('file');
      if (!Object.hasOwn(sources, file)) return json(res, 404, { error: 'Unknown file' });
      const base = url.searchParams.get('side') === 'base';
      if (base && file !== 'src/store.js') return action === 'source' ? json(res,200,{content:''}) : json(res, 404, { error: 'This file is new in the PR and has no base version.' });
      return json(res, 200, { file, sha: base ? pull.base.sha : selected.head_sha, content: base ? sources[file].split('\n').filter(l=>!l.includes('syncQueue.push') && !l.includes('  scheduleSync();')).join('\n') : sources[file] });
    }
    if (req.method !== 'POST') return send(res, 404, 'Not found');
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 3_000_000) return json(res, 413, { error: 'Request too large' }); }
    if (action === 'chat') {
      const input = JSON.parse(body), part = Number(input.step) === 0 ? selected.result.anchor : selected.result.slices[Number(input.step) - 1];
      if (!part) return json(res, 400, { error: 'Unknown slice' });
      return json(res, 200, { answer: `Demo response — no model is connected in this preview.\n\nThis slice explains: ${part.takeaway || part.rule}\n\n${part.riskReason || part.explanation}\n\n${input.selection ? 'Your selected text was attached to this question. In a connected workspace, the assistant uses this selection, the pinned slice, and your question to answer.' : 'In a connected workspace, the assistant answers your question using this pinned code and conversation.'}` });
    }
    if (action === 'reviewed') { if (selected.scope === 'full' && selected.head_sha === pull.head.sha) lastReview = selected.head_sha; return json(res, 200, { message: 'Demo walkthrough complete. Your next scoped review starts from this commit.' }); }
    const form = new URLSearchParams(body);
    if (action === 'generate') {
      const scope = resolveScope(form, pull, commits, lastReview);
      if (scope.scope === 'full') return send(res, 303, '', 'text/html', { Location: path+'?tab=walkthrough' });
      const from = scope.scope === 'since' ? commits.findIndex(c=>c.sha === scope.startSha) + 1 : commits.findIndex(c=>c.sha === form.get('from'));
      const to = commits.findIndex(c=>c.sha === scope.endSha);
      const scoped = structuredClone(result); scoped.slices = scoped.slices.slice(from,to + 1);
      scoped.anchor = { ...scoped.slices[0], rule: scoped.slices[0].takeaway };
      scoped.evidence = { ...scoped.evidence, baseSha: scope.startSha, headSha: scope.endSha, files: changedFiles.slice(from,to + 1) };
      const run = { id: randomUUID(), scope: scope.scope, start_sha: scope.startSha, end_sha: scope.endSha, base_sha: pull.base.sha, head_sha: pull.head.sha, status: 'ready', result: scoped, created_at: new Date().toISOString() };
      runs.splice(1, 0, run);
      return send(res, 303, '', 'text/html', { Location: `${path}/v/${run.id}?tab=walkthrough` });
    }
    if (action === 'settings') mode = form.get('mode');
    if (action === 'action') {
      const changes = [];
      await performPullAction({ token: 'demo', pull: shownPull, repository, user, form, request: async (path, input) => { changes.push({ path, ...input }); return { merged: true }; } });
      const kind = form.get('action'), payload = changes[0].body;
      if (kind === 'comment') activity.comments.push({ id: Date.now(), user, body: payload.body, created_at: new Date().toISOString() });
      if (kind === 'review') for (const comment of payload.comments || []) activity.threads.push({...comment,id:Date.now()+activity.threads.length,user,created_at:new Date().toISOString()});
      if (kind === 'review') activity.reviews.push({ id: Date.now(), user, body: payload.body, state: payload.event === 'APPROVE' ? 'APPROVED' : payload.event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'COMMENTED', submitted_at: new Date().toISOString() });
      if (kind === 'reviewers') { pull.requested_reviewers = [...new Set([...pull.requested_reviewers.map(r=>r.login), ...payload.reviewers])].map(login=>({ login })); pull.requested_teams = payload.team_reviewers.map(slug=>({ slug })); }
      if (kind === 'assignees') pull.assignees = payload.assignees.map(login=>({ login }));
      if (kind === 'labels') pull.labels = payload.labels.map(name=>({ name }));
      if (kind === 'edit') Object.assign(pull, payload);
      if (kind === 'close' || kind === 'reopen') pull.state = payload.state;
      if (kind === 'merge') { pull.state = 'closed'; pull.merged = true; pull.merged_at = new Date().toISOString(); }
      if (kind === 'inline') activity.threads.push({ ...payload, id: Date.now(), user, created_at: new Date().toISOString() });
      if (kind === 'reply') activity.threads.push({ id: Date.now(), user, body: payload.body, in_reply_to_id: Number(form.get('commentId')), created_at: new Date().toISOString() });
    }
    return send(res, 303, '', 'text/html', { Location: `${path}?tab=${action === 'settings' ? 'walkthrough' : form.get('action') === 'review' ? 'files&reviewed=1' : 'conversation'}&saved=1` });
  };
  return http.createServer((req, res) => route(req, res).catch(error => json(res, error.status || 500, { error: error.message })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT || 3000;
  createDemoServer().listen(port, '127.0.0.1', () => console.log(`Walkthrough demo listening on http://localhost:${port}`));
}
