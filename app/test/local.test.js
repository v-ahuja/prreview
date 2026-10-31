import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../bin/pr-walkthrough.js';
import { walkthrough, diff, changedFiles } from '../demo/fixture.js';
import { ensureGhLogin } from '../src/local-auth.js';
import { parsePrUrl, createLocalServer } from '../src/local-server.js';
import { generateVerifiedWalkthrough, runLocalModel, runnerEnvironment } from '../src/local-runner.js';

test('local CLI accepts a PR and runner without accepting other hosts', () => {
  assert.deepEqual(parsePrUrl('https://github.com/example/repo/pull/42?tab=files'), {
    owner: 'example', repo: 'repo', number: 42, canonical: 'https://github.com/example/repo/pull/42'
  });
  assert.throws(() => parsePrUrl('https://example.com/example/repo/pull/42'), /github.com/);
  assert.throws(() => parsePrUrl('https://github.com.evil.test/example/repo/pull/42'), /github.com/);
  assert.equal(parseArgs(['open', 'https://github.com/example/repo/pull/42', '--runner', 'claude']).runner, 'claude');
  assert.throws(() => parseArgs(['open', 'https://github.com/example/repo/pull/42', '--runner', 'shell']), /Runner/);
});

test('local runner includes its bundled walkthrough prompt', async () => {
  const prompt = await readFile(new URL('../prompts/pr-walkthrough.md', import.meta.url), 'utf8');
  assert.match(prompt, /Explain one slice at a time/);
});

test('local startup opens GitHub CLI login when no login exists', async () => {
  let attempts = 0; let logins = 0;
  const token = async () => ++attempts === 1 ? Promise.reject(new Error('signed out')) : 'token';
  assert.equal(await ensureGhLogin({ token, login: async () => { logins++; } }), 'token');
  assert.equal(logins, 1);
});

test('local runner adapters parse structured output and omit GitHub token variables', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'walkthrough-runner-test-'));
  try {
    assert.equal(runnerEnvironment({ GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', PATH: '/bin' }).PATH, '/bin');
    assert.equal(runnerEnvironment({ GH_TOKEN: 'secret' }).GH_TOKEN, undefined);
    assert.deepEqual(runnerEnvironment({ GITHUB_CLIENT_SECRET: 'secret', GITHUB_PRIVATE_KEY_BASE64: 'secret', DATABASE_URL: 'secret', SESSION_ENCRYPTION_KEY: 'secret', PATH: '/bin' }), { PATH: '/bin' });
    const claude = await runLocalModel({ agent: dir, runner: 'claude', execute: async (binary, args, options) => {
      assert.equal(binary, 'claude');
      assert.ok(args.includes('--json-schema'));
      assert.equal(options.env.GH_TOKEN, undefined);
      return JSON.stringify({ subtype: 'success', structured_output: walkthrough });
    } });
    assert.equal(claude.anchor.title, walkthrough.anchor.title);
    const codex = await runLocalModel({ agent: dir, runner: 'codex', execute: async (binary, args) => {
      assert.equal(binary, 'codex');
      assert.ok(args.includes('read-only'));
      assert.ok(args.includes('--ignore-user-config'));
      await writeFile(join(dir, 'walkthrough-result.json'), JSON.stringify(walkthrough));
      return '';
    } });
    assert.equal(codex.slices.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('local generation corrects an invalid model excerpt before saving', async () => {
  const agent = await mkdtemp(join(tmpdir(), 'walkthrough-correction-test-'));
  const invalid = structuredClone(walkthrough);
  invalid.slices[1].excerpt = '+invented line';
  let attempts = 0;
  try {
    const result = await generateVerifiedWalkthrough({ agent, runner: 'claude', diff, changedFiles,
      runModel: async ({ prompt }) => {
        attempts++;
        if (attempts === 2) {
          assert.match(prompt, /slices\[1\] excerpt is not an exact contiguous piece/);
          const previous = JSON.parse(await readFile(join(agent, 'previous-result.json'), 'utf8'));
          assert.equal(previous.slices[1].excerpt, '+invented line');
        }
        return attempts === 1 ? invalid : walkthrough;
      } });
    assert.equal(attempts, 2);
    assert.equal(result.slices[1].excerpt, walkthrough.slices[1].excerpt);
  } finally { await rm(agent, { recursive: true, force: true }); }
});

test('local server saves a generated walkthrough and serves only local routes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'walkthrough-server-test-'));
  const pull = { title: 'Example PR', base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } };
  const calls = [];
  const server = createLocalServer({ dataDir: dir, getToken: async () => 'secret',
    fetchPull: async (token, owner, repo, number) => {
      assert.equal(token, 'secret'); assert.deepEqual([owner, repo, number], ['example', 'repo', 42]);
      return pull;
    },
    generate: async input => { calls.push(input); return walkthrough; }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const query = new URLSearchParams({ pr: 'https://github.com/example/repo/pull/42', runner: 'claude' });
  try {
    const initial = await fetch(`${origin}/?${query}`);
    assert.equal(initial.status, 200);
    const html = await initial.text();
    assert.match(html, /Example PR/);
    assert.doesNotMatch(html, /secret/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
    const form = new URLSearchParams({ pr: 'https://github.com/example/repo/pull/42', runner: 'claude', csrf });
    const missingCsrf = await fetch(`${origin}/generate`, { method: 'POST', headers: { Origin: 'http://evil.test' }, body: new URLSearchParams({ pr: form.get('pr'), runner: 'claude' }), redirect: 'manual' });
    assert.equal(missingCsrf.status, 403);
    const started = await fetch(`${origin}/generate`, { method: 'POST', body: form, redirect: 'manual' });
    assert.equal(started.status, 303);
    const unusualOrigin = await fetch(`${origin}/generate`, { method: 'POST', headers: { Origin: 'null' }, body: form, redirect: 'manual' });
    assert.equal(unusualOrigin.status, 303);
    const sameOrigin = await fetch(`${origin}/generate`, { method: 'POST', headers: { Origin: origin }, body: form, redirect: 'manual' });
    assert.equal(sameOrigin.status, 303);
    let finished;
    for (let i = 0; i < 40; i++) {
      finished = await (await fetch(`${origin}/?${query}`)).text();
      if (finished.includes('checkpoint-button')) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.match(finished, /checkpoint-button/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].runner, 'claude');
    assert.equal(calls[0].token, 'secret');
    const saved = JSON.parse(await readFile(join(dir, (await readdir(dir))[0]), 'utf8'));
    assert.equal(saved.result.slices.length, 3);
    assert.equal(await (await fetch(`${origin}/missing`)).status, 404);
    const badHost = await new Promise((resolve, reject) => {
      const req = request(origin, { headers: { Host: 'evil.test' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(badHost, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
