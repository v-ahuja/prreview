import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { decrypt, encrypt, escapeHtml, verifyWebhook } from '../src/secure.js';
import { parseOpenCodeEvents, validateWalkthrough } from '../src/validate.js';

test('webhook verification checks the raw body and exact signature', () => {
  const body = Buffer.from('{"action":"opened"}');
  const signature = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
  assert.equal(verifyWebhook(body, signature, 'secret'), true);
  assert.equal(verifyWebhook(Buffer.from('{"action":"closed"}'), signature, 'secret'), false);
  assert.equal(verifyWebhook(body, 'sha256=nope', 'secret'), false);
});

test('token encryption is authenticated', () => {
  const key = randomBytes(32);
  const value = encrypt('ghu_secret', key);
  assert.equal(decrypt(value, key), 'ghu_secret');
  assert.throws(() => decrypt(value, randomBytes(32)));
});

test('displayed code is escaped', () => {
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('walkthrough rejects invented excerpts and unaccounted files', () => {
  const diff = 'diff --git a/a.js b/a.js\n@@ -1 +1 @@\n-old\n+new\n';
  const data = {
    anchor: { title: 'Rule', rule: 'New rule', explanation: 'Why', file: 'a.js', excerpt: '+new' },
    slices: [{ title: 'Change', takeaway: 'New rule', explanation: 'How', file: 'a.js', excerpt: '+new', inputsOutputs: 'in/out', handoff: 'next', changed: 'new', unchanged: 'old', next: '' }],
    omittedFiles: []
  };
  assert.equal(validateWalkthrough(data, diff, ['a.js']).anchor.rule, 'New rule');
  assert.throws(() => validateWalkthrough({ ...data, anchor: { ...data.anchor, excerpt: '+fabricated' } }, diff, ['a.js']), /exact contiguous/);
  assert.throws(() => validateWalkthrough(data, diff, ['a.js', 'b.js']), /Unaccounted/);
  const twoFiles = diff + 'diff --git a/b.js b/b.js\n@@ -1 +1 @@\n-x\n+y\n';
  assert.throws(() => validateWalkthrough({ ...data, anchor: { ...data.anchor, file: 'b.js' }, omittedFiles: [{ file: 'a.js', reason: 'covered elsewhere' }] }, twoFiles, ['a.js', 'b.js']), /exact contiguous/);
});

test('OpenCode event parser sums step usage and final text', () => {
  const output = [
    { type: 'step_finish', part: { tokens: { input: 100, output: 20, cache: { read: 30 } } } },
    { type: 'text', part: { text: 'I will inspect the diff.' } },
    { type: 'step_finish', part: { tokens: { input: 80, output: 25, cache: { write: 5 } } } },
    { type: 'text', part: { text: '{"ok":true}' } }
  ].map(JSON.stringify).join('\n');
  assert.deepEqual(parseOpenCodeEvents(output), { text: '{"ok":true}', usage: { input: 180, output: 45, reasoning: 0, cacheRead: 30, cacheWrite: 5 } });
});
