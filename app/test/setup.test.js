import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { config } from '../src/config.js';
import { appManifest, createGitHubSetupServer, saveAppConfiguration } from '../src/github-setup.js';

const app = { id: 1234, slug: 'walkthrough-example', client_id: 'client-id', client_secret: 'never-display-client-secret', pem: 'private-key-test', webhook_secret: 'never-display-webhook-secret' };
const options = { origin: 'http://127.0.0.1:3100', databaseUrl: 'postgres://localhost/example', login: 'reviewer', runner: 'codex', model: 'test-model' };

test('registration uses local OAuth and omits webhook configuration for polling', () => {
  const manifest = appManifest(options);
  assert.deepEqual(manifest.callback_urls, ['http://127.0.0.1:3100/auth/callback']);
  assert.equal(Object.hasOwn(manifest, 'hook_attributes'), false);
  assert.deepEqual(manifest.default_events, []);
  assert.equal(manifest.default_permissions.administration, undefined);
  assert.equal(manifest.default_permissions.members, undefined);
  assert.equal(manifest.request_oauth_on_install, false);
});

test('setup writes private credentials once and configures a restricted local runner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pr-setup-test-'));
  const path = join(dir, '.env');
  try {
    await saveAppConfiguration(path, app, options);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const cfg = config(parseEnv(await readFile(path, 'utf8')));
    assert.equal(cfg.privateKey, app.pem);
    assert.equal(cfg.host, '127.0.0.1');
    assert.equal(cfg.modelId, 'codex/test-model');
    assert.ok(cfg.privateAllowedModels.has(cfg.modelId));
    assert.ok(cfg.allowedLogins.has('reviewer'));
    assert.equal(cfg.publishWalkthroughLinks, false);
    assert.equal(cfg.generationEnabled, true);
    assert.equal(cfg.automaticGenerationEnabled, false);
    await assert.rejects(saveAppConfiguration(path, { ...app, client_secret: 'overwritten' }, options), { code: 'EEXIST' });
    assert.equal(config(parseEnv(await readFile(path, 'utf8'))).clientSecret, app.client_secret);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('manifest callback needs a matching unexpired browser state and never exposes credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pr-setup-http-test-'));
  const envPath = join(dir, '.env');
  let conversions = 0, completed = 0;
  const setupOptions = { ...options, envPath, exchange: async () => { conversions++; return app; }, complete: async () => { completed++; } };
  // Reserve a loopback port before creating the origin-bound server.
  const { createServer } = await import('node:net');
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  setupOptions.origin = `http://127.0.0.1:${reservation.address().port}`;
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = createGitHubSetupServer(setupOptions);
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  try {
    const response = await fetch(setupOptions.origin);
    const html = await response.text();
    assert.match(html, /Connect GitHub/);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const state = cookie.split('=')[1];
    const callback = `${setupOptions.origin}/setup/callback?code=valid-test-code&state=${state}`;
    assert.equal((await fetch(callback)).status, 400);
    assert.equal((await fetch(callback.replace(state, 'wrong'), { headers: { Cookie: cookie } })).status, 400);
    assert.equal(conversions, 0);
    const saved = await fetch(callback, { headers: { Cookie: cookie } });
    assert.equal(saved.status, 200);
    const body = await saved.text();
    assert.match(body, /Choose repositories/);
    assert.doesNotMatch(body, /never-display|private-key-test/);
    assert.equal(conversions, 1);
    assert.equal(completed, 1);
    assert.equal((await fetch(callback, { headers: { Cookie: cookie } })).status, 400);
    assert.equal((await fetch(setupOptions.origin)).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
