import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { database } from '../src/db.js';
import { createHostedServer } from '../src/server.js';
import { pullFields, queueRun, savePull } from '../src/runs.js';
import { syncRepository } from '../src/sync.js';
import { hashToken, encrypt } from '../src/secure.js';
import { walkthrough, diff, changedFiles } from '../demo/fixture.js';
import { enrichWalkthrough } from '../src/review.js';

const enabled = !!process.env.TEST_DATABASE_URL;
test('hosted workspace protects cached code, uses user tokens for actions, and marks current full reviews only', {skip:!enabled}, async () => {
  const db = database(process.env.TEST_DATABASE_URL), repoId = 700_000_000 + randomInt(10_000_000);
  const cfg = { origin:'http://127.0.0.1:0',encryptionKey:randomBytes(32),model:'test/model',privateAllowedModels:new Set(['test/model']),appSlug:'test-bot',webhookSecret:'test-secret', generationEnabled:true };
  const repository = { id:repoId,name:'repo',owner:{login:'team'},full_name:'team/repo',private:true,permissions:{push:true,admin:true} };
  const pull = { number:1,state:'open',title:'Scoped review test',body:'Description',user:{login:'author'},base:{sha:'a'.repeat(40),repo:repository,ref:'main'},head:{sha:'b'.repeat(40),ref:'feature'},requested_reviewers:[],labels:[],assignees:[] };
  const fields = pullFields(pull,repoId);
  const result = enrichWalkthrough(walkthrough,{diff,changedFiles,manifest:{mergeBase:pull.base.sha,headSha:pull.head.sha,commits:[]}});
  const sessionId = randomUUID(); let access = true; const calls = [];
  const checkToken = token => assert.equal(token,'viewer-token');
  const github = {
    sessionToken:async()=> 'viewer-token',
    getPull:async token=>{checkToken(token);if(!access) throw Object.assign(new Error('Not found'),{status:404});return pull;},
    getRepo:async token=>{checkToken(token);return repository;}, installationForRepo:async()=>({id:repoId}),
    accessibleRepos:async()=>[{...repository,installationId:repoId}],listPullCommits:async()=>[],
    listPullFiles:async()=>[{filename:'src/new.js',status:'renamed',previous_filename:'src/old.js',patch:'@@ -1 +1 @@\n-old\n+new',additions:1,deletions:1}],
    mergeBase:async()=> 'e'.repeat(40), pullActivity:async()=>({}),repoPeople:async()=>({people:[],teams:[]}),
    readCode:async(token,owner,repo,sha,file)=>{checkToken(token);calls.push({sha,file});return {file,sha,content:'pinned source'};},
    githubFetch:async(path,options)=>{checkToken(options.token);calls.push({path,...options});return {};}
  };
  let answerCalls = 0;
  const server = createHostedServer({cfg,db,github,answer:async({input,runner})=>{answerCalls++;return {answer:input.question,runner};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  cfg.origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {Cookie:`walk_session=${sessionId}`,Origin:cfg.origin};
  try {
    await savePull(db,fields);
    await db.query('INSERT INTO sessions(id_hash,user_id,login,token_cipher) VALUES($1,$2,$3,$4)',[hashToken(sessionId),repoId,'reviewer',encrypt('viewer-token',cfg.encryptionKey)]);
    const full = await queueRun(db,fields), range = await queueRun(db,fields,{scope:'range',startSha:pull.base.sha,endSha:pull.head.sha});
    assert.notEqual(full.id,range.id);
    assert.equal((await queueRun(db,fields,{scope:'range',startSha:pull.base.sha,endSha:pull.head.sha})).id,range.id);
    await db.query("UPDATE runs SET status='ready',result=$2 WHERE id=ANY($1::uuid[])",[[full.id,range.id],result]);
    const path = '/p/team/repo/1', version = `${path}/v/${full.id}`;
    const code = await fetch(`${cfg.origin}${version}/code?file=src/sync.js`,{headers});
    assert.equal(code.status,200); assert.equal((await code.json()).sha,pull.head.sha);
    cfg.runner = 'codex'; cfg.model = 'test-model'; cfg.modelId = 'codex/test-model'; cfg.privateAllowedModels.add(cfg.modelId);
    const chat = await fetch(`${cfg.origin}${version}/chat`, {method:'POST',headers,body:JSON.stringify({step:1,question:'Explain this change'})});
    assert.equal(chat.status,200); assert.equal((await chat.json()).runner,'codex');
    cfg.generationEnabled = false;
    assert.equal((await fetch(`${cfg.origin}${version}/chat`,{method:'POST',headers,body:JSON.stringify({step:1,question:'Must not call a model'})})).status,503);
    assert.equal(answerCalls,1);
    assert.equal((await fetch(`${cfg.origin}${path}/generate`,{method:'POST',headers,body:new URLSearchParams({scope:'full'}),redirect:'manual'})).status,503);
    assert.equal((await fetch(`${cfg.origin}${path}/settings`,{method:'POST',headers,body:new URLSearchParams({mode:'on_update'}),redirect:'manual'})).status,503);
    assert.equal((await fetch(`${cfg.origin}${version}/code?file=src/sync.js`,{headers})).status,200);
    assert.equal((await db.query('SELECT id FROM runs WHERE repo_id=$1',[repoId])).rows.length,2);
    cfg.generationEnabled = true;
    const defaultPage=await fetch(`${cfg.origin}${path}`,{headers});
    assert.equal(defaultPage.status,200);assert.match(await defaultPage.text(),/class="diff-workspace"/);
    assert.equal((await db.query('SELECT id FROM runs WHERE repo_id=$1',[repoId])).rows.length,2,'Opening the diff does not queue work');
    const sourceUrl=`${cfg.origin}${path}/source?file=src/new.js&side=base&head=${pull.head.sha}&base=${pull.base.sha}`;
    assert.equal((await fetch(sourceUrl,{headers})).status,200);
    assert.deepEqual(calls.at(-1),{sha:'e'.repeat(40),file:'src/old.js'});
    assert.equal((await fetch(sourceUrl.replace(pull.head.sha,'f'.repeat(40)),{headers})).status,409);
    assert.equal((await fetch(sourceUrl.replace('src/new.js','secrets.env'),{headers})).status,404);
    cfg.privateAllowedModels.add('claude/sonnet');
    const generated=await fetch(`${cfg.origin}${path}/generate`,{method:'POST',headers,redirect:'manual',body:new URLSearchParams({scope:'full',harness:'claude',model:'sonnet'})});
    assert.equal(generated.status,303);assert.match(generated.headers.get('location'),/tab=walkthrough/);
    const requested=(await db.query("SELECT * FROM runs WHERE repo_id=$1 AND requested_model='sonnet'",[repoId])).rows[0];
    assert.equal(requested.runner,'claude');assert.equal(requested.trigger,'manual');assert.equal(requested.requested_by,String(repoId));
    assert.equal((await fetch(`${cfg.origin}${path}/generate`,{method:'POST',headers,redirect:'manual',body:new URLSearchParams({scope:'full',harness:'claude',model:'unapproved'})})).status,403);
    const missingBase = await fetch(`${cfg.origin}${version}/code?file=src/sync.js&side=base`,{headers}); assert.equal(missingBase.status,404);
    const denied = await fetch(`${cfg.origin}${path}/action`,{method:'POST',headers:{Cookie:headers.Cookie,Origin:'https://evil.example'},body:new URLSearchParams({action:'comment',body:'blocked'})});
    assert.equal(denied.status,403);
    const posted = await fetch(`${cfg.origin}${path}/action`,{method:'POST',headers,body:new URLSearchParams({action:'comment',body:'@sam check this'}),redirect:'manual'});
    assert.equal(posted.status,303); assert.equal(calls.at(-1).body.body,'@sam check this');
    const rangeComplete = await fetch(`${cfg.origin}${path}/v/${range.id}/reviewed`,{method:'POST',headers});assert.equal(rangeComplete.status,200);
    assert.equal((await db.query('SELECT * FROM review_marks WHERE repo_id=$1',[repoId])).rows.length,0);
    const complete = await fetch(`${cfg.origin}${version}/reviewed`,{method:'POST',headers});assert.equal(complete.status,200);
    assert.equal((await db.query('SELECT head_sha FROM review_marks WHERE repo_id=$1',[repoId])).rows[0].head_sha,pull.head.sha);
    access = false;
    assert.equal((await fetch(`${cfg.origin}${version}/code?file=src/sync.js`,{headers})).status,404);
    assert.equal((await fetch(`${cfg.origin}${version}/chat`,{method:'POST',headers,body:JSON.stringify({step:1,question:'secret?'})})).status,404);
    const signed = JSON.stringify({action:'synchronize',installation:{id:repoId},pull_request:{...pull,head:{sha:'c'.repeat(40)}}});
    const webhookHeaders = {'X-GitHub-Event':'pull_request','X-GitHub-Delivery':randomUUID(),'X-Hub-Signature-256':'sha256='+createHmac('sha256',cfg.webhookSecret).update(signed).digest('hex')};
    assert.equal((await fetch(`${cfg.origin}/webhook`,{method:'POST',headers:webhookHeaders,body:signed})).status,202);
    assert.equal((await fetch(`${cfg.origin}/webhook`,{method:'POST',headers:webhookHeaders,body:signed})).status,202);
    assert.equal((await db.query("SELECT * FROM runs WHERE repo_id=$1 AND head_sha=$2",[repoId,'c'.repeat(40)])).rows.length,0);
    await db.query('DELETE FROM webhook_deliveries WHERE id=$1',[webhookHeaders['X-GitHub-Delivery']]);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await db.query('DELETE FROM pulls WHERE repo_id=$1',[repoId]);
    await db.query('DELETE FROM repository_settings WHERE repo_id=$1',[repoId]);
    await db.query('DELETE FROM installations WHERE id=$1',[repoId]);
    await db.query('DELETE FROM sessions WHERE id_hash=$1',[hashToken(sessionId)]);
    await db.pool.end();
  }
});

test('OAuth restricts local workspace logins and encrypts authorized sessions', {skip:!enabled}, async () => {
  const db = database(process.env.TEST_DATABASE_URL), userId = 900_000_000 + randomInt(10_000_000);
  const cfg = {origin:'http://127.0.0.1:0', encryptionKey:randomBytes(32),clientId:'test-client',allowedLogins:new Set(['operator'])};
  let login = 'uninvited', exchanges = 0, imports = 0;
  const github = {
    exchangeCode: async () => { exchanges++; return {access_token:'oauth-test-token',expires_in:3600}; },
    getUser: async () => ({id:userId,login}),
    accessibleRepos: async () => { imports++; return []; }
  };
  const server = createHostedServer({cfg,db,github});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  cfg.origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const start = await fetch(`${cfg.origin}/auth/login`,{redirect:'manual'});
    const target = new URL(start.headers.get('location'));
    assert.equal(target.origin,'https://github.com');
    const state = target.searchParams.get('state');
    const callback = `${cfg.origin}/auth/callback?state=${state}&code=test-code`;
    assert.equal((await fetch(callback,{redirect:'manual'})).status,400);
    assert.equal(exchanges,0);
    const headers = {Cookie:`walk_oauth_state=${state}`};
    assert.equal((await fetch(callback,{headers,redirect:'manual'})).status,403);
    assert.equal((await db.query('SELECT id_hash FROM sessions WHERE user_id=$1',[userId])).rows.length,0);
    login = 'operator';
    const accepted = await fetch(callback,{headers,redirect:'manual'});
    assert.equal(accepted.status,303);
    assert.match(accepted.headers.get('set-cookie'),/walk_session=/);
    const saved = (await db.query('SELECT * FROM sessions WHERE user_id=$1',[userId])).rows[0];
    assert.equal(saved.login,'operator');
    assert.notEqual(saved.token_cipher,'oauth-test-token');
    assert.equal(imports,1);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await db.query('DELETE FROM sessions WHERE user_id=$1',[userId]);
    await db.pool.end();
  }
});

test('sync defaults to manual and automatic generation requires both operator and repository opt-in', {skip:!enabled}, async()=>{
  const db=database(process.env.TEST_DATABASE_URL),id=800_000_000+randomInt(10_000_000);
  const repo={id,name:'repo',owner:{login:'org'},private:false};
  const pull={number:1,title:'Bot test',state:'open',draft:false,base:{sha:'a'.repeat(40),repo},head:{sha:'b'.repeat(40)}};
  const list=async()=>[pull,{...pull,number:2,draft:true},{...pull,number:3,state:'closed'}];
  try {
    await syncRepository(db,{generationEnabled:true},repo,id,'installation-token',{list});
    assert.equal((await db.query('SELECT * FROM runs WHERE repo_id=$1',[id])).rows.length,0);
    assert.equal((await db.query('SELECT mode FROM repository_settings WHERE repo_id=$1',[id])).rows[0].mode,'manual');
    await db.query("UPDATE repository_settings SET mode='on_update' WHERE repo_id=$1",[id]);
    await syncRepository(db,{generationEnabled:true},repo,id,'installation-token',{list});
    assert.equal((await db.query('SELECT * FROM runs WHERE repo_id=$1',[id])).rows.length,0);
    await syncRepository(db,{generationEnabled:true,automaticGenerationEnabled:true},repo,id,'installation-token',{list});
    await syncRepository(db,{generationEnabled:true,automaticGenerationEnabled:true},repo,id,'installation-token',{list});
    assert.equal((await db.query('SELECT * FROM runs WHERE repo_id=$1',[id])).rows.length,1);
    await db.query("UPDATE repository_settings SET mode='manual' WHERE repo_id=$1",[id]);
    await syncRepository(db,{generationEnabled:true},repo,id,'installation-token',{list:async()=>[{...pull,head:{sha:'c'.repeat(40)}}]});
    assert.equal((await db.query('SELECT * FROM runs WHERE repo_id=$1',[id])).rows.length,1);
  } finally {
    await db.query('DELETE FROM pulls WHERE repo_id=$1',[id]);
    await db.query('DELETE FROM repository_settings WHERE repo_id=$1',[id]);
    await db.query('DELETE FROM installations WHERE id=$1',[id]);
    await db.pool.end();
  }
});

test('disabled generation syncs PR metadata without queuing jobs, even for automatic repositories', {skip:!enabled}, async()=>{
  const db=database(process.env.TEST_DATABASE_URL),id=810_000_000+randomInt(10_000_000);
  const repo={id,name:'repo',owner:{login:'org'},private:false};
  const pull={number:1,title:'Sync without AI',state:'open',draft:false,base:{sha:'a'.repeat(40),repo},head:{sha:'b'.repeat(40)}};
  try {
    await syncRepository(db,{generationEnabled:false},repo,id,'installation-token',{list:async()=>[pull]});
    assert.equal((await db.query('SELECT * FROM pulls WHERE repo_id=$1',[id])).rows.length,1);
    assert.equal((await db.query('SELECT mode FROM repository_settings WHERE repo_id=$1',[id])).rows[0].mode,'manual');
    await db.query("UPDATE repository_settings SET mode='on_update' WHERE repo_id=$1",[id]);
    await syncRepository(db,{generationEnabled:false,automaticGenerationEnabled:true},repo,id,'installation-token',{list:async()=>[pull]});
    assert.equal((await db.query('SELECT * FROM runs WHERE repo_id=$1',[id])).rows.length,0);
  } finally {
    await db.query('DELETE FROM pulls WHERE repo_id=$1',[id]);
    await db.query('DELETE FROM repository_settings WHERE repo_id=$1',[id]);
    await db.query('DELETE FROM installations WHERE id=$1',[id]);
    await db.pool.end();
  }
});
