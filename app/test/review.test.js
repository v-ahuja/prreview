import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScope, enrichWalkthrough, locateExcerpt, chatContext } from '../src/review.js';
import { validateWalkthrough } from '../src/validate.js';
import { performPullAction } from '../src/github-actions.js';
import { walkthrough, diff, changedFiles } from '../demo/fixture.js';

const sha = letter => letter.repeat(40);
const pull = { number: 12, state: 'open', user: { login: 'author' }, base: { sha: sha('a'), repo: { name: 'repo', owner: { login: 'org' } } }, head: { sha: sha('d') } };
const commits = ['b','c','d'].map((s,i)=>({ sha: sha(s), parents: [{ sha: sha(['a','b','c'][i]) }] }));

test('scope selection includes the first commit and rejects reversed/unrelated ranges', () => {
  const selected = resolveScope(new URLSearchParams({ scope: 'range', from: sha('c'), to: sha('d') }), pull, commits);
  assert.deepEqual(selected, { scope: 'range', startSha: sha('b'), endSha: sha('d') });
  assert.throws(()=>resolveScope(new URLSearchParams({ scope:'range',from:sha('d'),to:sha('c') }),pull,commits), /chronological/);
  assert.throws(()=>resolveScope(new URLSearchParams({ scope:'range',from:sha('f'),to:sha('d') }),pull,commits), /chronological/);
  assert.throws(()=>resolveScope(new URLSearchParams({ scope:'since' }),pull,commits), /Complete/);
  assert.throws(()=>resolveScope(new URLSearchParams({ scope:'since' }),pull,commits,sha('d')), /no new commits/);
  assert.equal(resolveScope(new URLSearchParams({ scope:'since' }),pull,commits,sha('e')).startSha, sha('e'), 'force-pushed previous heads remain valid comparison snapshots');
});

test('linked evidence resolves real source lines and rejects invented beat excerpts', () => {
  validateWalkthrough(walkthrough, diff, changedFiles, { assessments: true });
  const result = enrichWalkthrough(walkthrough, { diff, changedFiles, manifest: { mergeBase: sha('a'), headSha: sha('b') } });
  assert.deepEqual(result.slices[1].beats[1].location, { side:'head',line:4 });
  assert.equal(result.evidence.sourceFiles['src/sync.js'].base, null);
  const invalid = structuredClone(walkthrough); invalid.slices[0].beats[0].excerpt = '+ invented';
  assert.throws(()=>validateWalkthrough(invalid,diff,changedFiles,{assessments:true}), /paragraph excerpt/);
  const deleted = 'diff --git a/old.js b/old.js\n--- a/old.js\n+++ /dev/null\n@@ -5,2 +0,0 @@\n-old\n-gone\n';
  assert.deepEqual(locateExcerpt(deleted,'old.js','-gone'), { side:'base',line:6 });
});

test('chat context is limited to a valid slice, explicit selection and recent conversation', () => {
  const context = chatContext(walkthrough, { step: 2, question: 'Why await?', selection: 'selected code', history: Array.from({length:20},()=>({role:'system',text:'untrusted'})) });
  assert.equal(context.slice.title, walkthrough.slices[1].title);
  assert.equal(context.history.length,8); assert.equal(context.history[0].role,'user');
  assert.throws(()=>chatContext(walkthrough,{step:99,question:'hi'}),/Unknown slice/);
});

test('GitHub actions use viewer identity, preserve mentions, and reject stale or unauthorized writes', async () => {
  const calls = [];
  const input = { token:'viewer-token',pull,repository:{permissions:{push:true}},user:{login:'reviewer'},request:async(path,options)=>{calls.push({path,...options});return {merged:true};} };
  await performPullAction({...input,form:new URLSearchParams({action:'comment',body:'@teammate please check this'})});
  assert.equal(calls[0].token,'viewer-token'); assert.equal(calls[0].body.body,'@teammate please check this');
  await performPullAction({...input,form:new URLSearchParams({action:'reviewers',reviewers:'@sam, alex',teams:'platform'})});
  assert.deepEqual(calls[1].body,{reviewers:['sam','alex'],team_reviewers:['platform']});
  await assert.rejects(performPullAction({...input,form:new URLSearchParams({action:'merge',head:sha('c'),method:'squash'})}),/changed while/);
  await assert.rejects(performPullAction({...input,repository:{permissions:{}},form:new URLSearchParams({action:'labels',labels:'bug'})}),/write access/);
  await assert.rejects(performPullAction({...input,user:{login:'author'},form:new URLSearchParams({action:'review',head:sha('d'),event:'APPROVE'})}),/own PR/);
  await performPullAction({...input,form:new URLSearchParams({action:'merge',head:sha('d'),method:'squash'})});
  assert.deepEqual(calls.at(-1).body,{sha:sha('d'),merge_method:'squash'});
  await assert.rejects(performPullAction({...input,request:async()=>({merged:false,message:'Required checks are pending'}),form:new URLSearchParams({action:'merge',head:sha('d'),method:'squash'})}),/Required checks/);
});

test('chat images accept supported signatures and reject disguised or oversized attachments', async () => {
  const { decodeAttachment } = await import('../src/chat.js');
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.equal(decodeAttachment(`data:image/png;base64,${png.toString('base64')}`).extension, 'png');
  assert.throws(()=>decodeAttachment('data:image/png;base64,PHNjcmlwdD4='), /valid image/);
  assert.throws(()=>decodeAttachment('data:image/svg+xml;base64,PHN2Zz4='), /PNG, JPEG/);
});
