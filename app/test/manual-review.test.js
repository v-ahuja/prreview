import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {modelSelection} from '../src/model-selection.js';
import {parsePatch,splitRows} from '../src/diff-model.js';
import {safeScene} from '../src/diagram-data.js';
import {performPullAction} from '../src/github-actions.js';
import {database} from '../src/db.js';
import {savePull,queueRun,claimRun} from '../src/runs.js';

test('harness selection validates CLI model names and OpenCode provider models',()=>{
  assert.deepEqual(modelSelection({harness:'claude',model:'sonnet'}),{harness:'claude',runner:'claude',model:'sonnet',modelId:'claude/sonnet'});
  assert.equal(modelSelection({harness:'codex',model:''}).modelId,'codex/default');
  assert.equal(modelSelection(new URLSearchParams({harness:'opencode',model:'openai/gpt-5'})).runner,'');
  assert.throws(()=>modelSelection({harness:'shell',model:'anything'}),/Choose Codex/);
  for(const model of ['--dangerous','x; pwd','$(env)','a\nb'])assert.throws(()=>modelSelection({harness:'codex',model}),/valid model/);
  assert.throws(()=>modelSelection({harness:'opencode',model:'missing-provider'}),/provider\/model/);
});

test('split diff keeps old and new line numbers correct across separate hunks',()=>{
  const hunks=parsePatch('@@ -5,3 +5,4 @@ named function\n context\n-old\n+new\n+extra\n tail\n@@ -100 +101 @@\n-last\n+next\n\\ No newline at end of file');
  assert.equal(hunks.length,2);
  const pairs=splitRows(hunks[0].rows);
  assert.deepEqual(pairs.map(p=>[p.left?.old,p.right?.new]),[[5,5],[6,6],[undefined,7],[7,8]]);
  assert.deepEqual(splitRows(hunks[1].rows).map(p=>[p.left.old,p.right.new]),[[100,101]]);
  assert.equal(parsePatch('Binary files differ').length,0);
});

test('drawing imports remove external links and reject active web content and oversized scenes',()=>{
  const scene=safeScene({elements:[{type:'rectangle',x:0,y:0,width:100,height:50,link:'javascript:alert(1)',customData:{secret:1}}]});
  assert.equal(scene.elements[0].link,null);assert.equal(scene.elements[0].customData,undefined);
  assert.throws(()=>safeScene({elements:[{type:'embeddable'}]}),/Embedded web content/);
  assert.throws(()=>safeScene({elements:[],files:{image:{dataURL:'https://tracker.example/image.png'}}}),/PNG/);
  assert.throws(()=>safeScene({elements:[{type:'rectangle',x:Infinity}]}),/coordinates/);
  assert.throws(()=>safeScene({elements:Array(1001).fill({type:'rectangle'})}),/1,000/);
});

test('review submissions batch ranged comments against the displayed head',async()=>{
  const calls=[],head='b'.repeat(40),pull={number:1,state:'open',head:{sha:head},base:{repo:{owner:{login:'team'},name:'repo'}},user:{login:'author'}};
  const input={token:'user',pull,repository:{},user:{login:'reviewer'},request:async(path,options)=>{calls.push({path,...options});return {};}};
  const comments=[{path:'src/file.js',start_line:3,line:5,side:'RIGHT',body:'**Review** this range.'}];
  const form=new URLSearchParams({action:'review',head,event:'COMMENT',comments:JSON.stringify(comments)});
  await performPullAction({...input,form});
  assert.deepEqual(calls[0].body.comments,[{...comments[0],start_side:'RIGHT'}]);assert.equal(calls[0].body.commit_id,head);
  form.set('head','a'.repeat(40));await assert.rejects(performPullAction({...input,form}),/changed while/);
  form.set('head',head);form.set('comments',JSON.stringify([{...comments[0],start_line:6}]));
  await assert.rejects(performPullAction({...input,form}),/range/);assert.equal(calls.length,1);
});

test('manual runs record model and requester, deduplicate per model, and leave automatic jobs unclaimed',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const db=database(process.env.TEST_DATABASE_URL),id=950_000_000+randomInt(10_000_000);
  const pull={repoId:id,number:1,owner:'fixture',repo:'manual',installationId:id,title:'Manual review',private:false,baseSha:'a'.repeat(40),headSha:'b'.repeat(40)};
  try{
    await savePull(db,pull);
    const auto=await queueRun(db,pull,undefined,{runner:'codex',model:'automatic',trigger:'automatic'});
    const first=await queueRun(db,pull,undefined,{runner:'codex',model:'chosen-model',requestedBy:123});
    const second=await queueRun(db,pull,undefined,{runner:'claude',model:'sonnet',requestedBy:123});
    assert.notEqual(first.id,second.id);
    assert.equal((await queueRun(db,pull,undefined,{runner:'codex',model:'chosen-model'})).id,first.id);
    const claimed=await claimRun(db);assert.equal(claimed.id,first.id);assert.equal(claimed.requested_by,'123');assert.equal(claimed.requested_model,'chosen-model');
    assert.equal((await claimRun(db)).id,second.id);assert.equal(await claimRun(db),null);
    assert.equal((await db.query('SELECT status FROM runs WHERE id=$1',[auto.id])).rows[0].status,'queued');
    await queueRun(db,pull,undefined,{runner:'codex',model:'automatic',trigger:'manual',requestedBy:123});
    assert.equal((await claimRun(db)).id,auto.id);
  }finally{
    await db.query('DELETE FROM pulls WHERE repo_id=$1',[id]);await db.query('DELETE FROM repository_settings WHERE repo_id=$1',[id]);await db.query('DELETE FROM installations WHERE id=$1',[id]);await db.pool.end();
  }
});
