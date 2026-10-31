import { createSign } from 'node:crypto';
import { decrypt, encrypt } from './secure.js';

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function githubFetch(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pr-walkthrough-app',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000)
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new GitHubError(response.status, data?.message || `GitHub HTTP ${response.status}`);
  return data;
}

export const repoPath = (owner, repo) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

export async function paginate(path, token, key) {
  const items = [];
  for (let page = 1; page <= 50; page++) {
    const result = await githubFetch(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, { token });
    const batch = key ? result[key] : result;
    if (!Array.isArray(batch)) throw new Error('GitHub returned an invalid list');
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error('GitHub list exceeded the supported limit; narrow your selection');
}

export const listPullCommits = (token, owner, repo, number) => paginate(`${repoPath(owner, repo)}/pulls/${number}/commits`, token);
export const listPullFiles = (token, owner, repo, number) => paginate(`${repoPath(owner, repo)}/pulls/${number}/files`, token);
export async function mergeBase(token, owner, repo, base, head) {
  const result=await githubFetch(`${repoPath(owner,repo)}/compare/${base}...${head}?per_page=1`,{token});
  if(!/^[0-9a-f]{40}$/.test(result.merge_base_commit?.sha || '')) throw new GitHubError(422,'Could not resolve the PR merge base.');
  return result.merge_base_commit.sha;
}
export const listPulls = (token, owner, repo, state = 'open') => paginate(`${repoPath(owner, repo)}/pulls?state=${state}&sort=updated&direction=desc`, token);
export const listInstallations = cfg => paginate('/app/installations', appJwt(cfg));
export const installationRepos = token => paginate('/installation/repositories', token, 'repositories');

// User installation repositories are the intersection of app installation and user access.
export async function accessibleRepos(token) {
  const installs = await paginate('/user/installations', token, 'installations');
  const repositories = [];
  for (const install of installs) {
    if (install.suspended_at) continue;
    const rows = await paginate(`/user/installations/${install.id}/repositories`, token, 'repositories');
    repositories.push(...rows.map(repo => ({ ...repo, installationId: install.id })));
  }
  return repositories;
}

export async function readCode(token, owner, repo, sha, file) {
  if (!/^[0-9a-f]{40}$/.test(sha) || !file || file.split('/').some(part => !part || part === '..' || part === '.'))
    throw new GitHubError(400, 'Invalid file reference');
  const path = file.split('/').map(encodeURIComponent).join('/');
  const data = await githubFetch(`${repoPath(owner, repo)}/contents/${path}?ref=${sha}`, { token });
  if (data.type !== 'file' || data.size > 1_000_000 || data.encoding !== 'base64')
    throw new GitHubError(422, 'This file is binary or too large for the editor (1 MB limit).');
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  if (content.includes('\0')) throw new GitHubError(422, 'Binary files cannot be opened as text.');
  return { file, sha, content };
}

export async function pullActivity(token, owner, repo, number, sha) {
  const root = repoPath(owner, repo);
  const [comments, reviews, threads, checks, status] = await Promise.all([
    paginate(`${root}/issues/${number}/comments`, token),
    paginate(`${root}/pulls/${number}/reviews`, token),
    paginate(`${root}/pulls/${number}/comments`, token),
    paginate(`${root}/commits/${sha}/check-runs`, token, 'check_runs').catch(error => ({ error: error.message })),
    githubFetch(`${root}/commits/${sha}/status`, { token }).catch(error => ({ error: error.message }))
  ]);
  return { comments, reviews, threads, checks, status };
}

export async function repoPeople(token, owner, repo) {
  const root = repoPath(owner, repo);
  const [people, teams] = await Promise.allSettled([
    paginate(`${root}/assignees`, token), paginate(`${root}/teams`, token)
  ]);
  return { people: people.status === 'fulfilled' ? people.value.map(p => ({ login: p.login })) : [],
    teams: teams.status === 'fulfilled' ? teams.value.map(t => ({ slug: t.slug, name: t.name })) : [],
    warning: people.status === 'rejected' || teams.status === 'rejected' ? 'Some suggestions are unavailable with your GitHub permissions. You can still enter a GitHub username or team slug.' : '' };
}

export function appJwt(cfg) {
  const now = Math.floor(Date.now() / 1000);
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const content = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: cfg.appId })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(content);
  return `${content}.${signer.sign(cfg.privateKey).toString('base64url')}`;
}

export async function installationForRepo(cfg, owner, repo) {
  return githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`, { token: appJwt(cfg) });
}

export async function installationToken(cfg, id) {
  const data = await githubFetch(`/app/installations/${id}/access_tokens`, { token: appJwt(cfg), method: 'POST', body: {} });
  return data.token;
}

export async function getPull(token, owner, repo, number) {
  return githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`, { token });
}

export async function getRepo(token, owner, repo) {
  return githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { token });
}

export async function getUser(token) { return githubFetch('/user', { token }); }

export async function createComment(token, owner, repo, number, body) {
  return githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`, { token, method: 'POST', body: { body } });
}

export async function listComments(token, owner, repo, number) {
  const comments = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments?per_page=100&page=${page}`, { token });
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
  throw new Error('Cannot verify whether a bot comment already exists');
}

export async function updateComment(token, owner, repo, commentId, body) {
  return githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${commentId}`, { token, method: 'PATCH', body: { body } });
}

export async function exchangeCode(cfg, code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: `${cfg.origin}/auth/callback` }),
    signal: AbortSignal.timeout(20_000)
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`GitHub OAuth exchange failed: ${data.error || response.status}`);
  return data;
}

async function refreshToken(cfg, cipher) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token', refresh_token: decrypt(cipher, cfg.encryptionKey) }),
    signal: AbortSignal.timeout(20_000)
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('GitHub authorization expired; please sign in again');
  return data;
}

export async function sessionToken(db, cfg, session) {
  if (!session) return null;
  if (!session.token_expires_at || new Date(session.token_expires_at).getTime() > Date.now() + 60_000)
    return decrypt(session.token_cipher, cfg.encryptionKey);
  if (!session.refresh_cipher || (session.refresh_expires_at && new Date(session.refresh_expires_at).getTime() < Date.now())) return null;
  const data = await refreshToken(cfg, session.refresh_cipher);
  await db.query(`UPDATE sessions SET token_cipher=$2, refresh_cipher=$3, token_expires_at=$4, refresh_expires_at=$5 WHERE id_hash=$1`, [
    session.id_hash,
    encrypt(data.access_token, cfg.encryptionKey),
    data.refresh_token ? encrypt(data.refresh_token, cfg.encryptionKey) : session.refresh_cipher,
    data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    data.refresh_token_expires_in ? new Date(Date.now() + data.refresh_token_expires_in * 1000) : session.refresh_expires_at
  ]);
  return data.access_token;
}
