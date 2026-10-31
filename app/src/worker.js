import './env.js';
import { config } from './config.js';
import { database, transaction } from './db.js';
import { createComment, GitHubError, installationToken, listComments, updateComment } from './github.js';
import { generateWalkthrough } from './generate.js';
import { generateLocalWalkthrough } from './local-runner.js';
import { claimRun, walkthroughUrl } from './runs.js';
import { syncAll } from './sync.js';
import { modelSelection } from './model-selection.js';

const cfg = config();
const db = database(cfg.databaseUrl);
const marker = '<!-- pr-walkthrough-app -->';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function publishOne() {
  const { rows } = await db.query(`SELECT p.*, r.id AS run_id FROM pulls p JOIN LATERAL (
    SELECT id FROM runs WHERE repo_id=p.repo_id AND number=p.number
      AND base_sha=p.base_sha AND head_sha=p.head_sha AND status='ready' AND scope='full' AND generator_version=2
    ORDER BY created_at DESC LIMIT 1
  ) r ON true WHERE p.comment_version_id IS DISTINCT FROM r.id LIMIT 1`);
  if (!rows.length) return false;
  const pull = rows[0];
  await transaction(db, async client => {
    const locked = (await client.query('SELECT * FROM pulls WHERE repo_id=$1 AND number=$2 FOR UPDATE', [pull.repo_id, pull.number])).rows[0];
    if (!locked || locked.base_sha !== pull.base_sha || locked.head_sha !== pull.head_sha || locked.comment_version_id === pull.run_id) return;
    const token = await installationToken(cfg, locked.installation_id);
    const url = walkthroughUrl(cfg.origin, locked);
    const body = `${marker}\n📖 **PR walkthrough:** [Open the hosted walkthrough](${url})\n\nThis walkthrough is pinned to \`${locked.head_sha.slice(0, 12)}\`. Sign in with GitHub to view it.`;
    let commentId = locked.comment_id;
    if (!commentId) {
      const existing = (await listComments(token, locked.owner, locked.repo, locked.number)).find(comment =>
        comment.body?.includes(marker) && comment.user?.login === `${cfg.appSlug}[bot]`);
      commentId = existing?.id;
    }
    if (commentId) {
      try { await updateComment(token, locked.owner, locked.repo, commentId, body); }
      catch (error) {
        if (!(error instanceof GitHubError) || error.status !== 404) throw error;
        commentId = null;
      }
    }
    if (!commentId) commentId = (await createComment(token, locked.owner, locked.repo, locked.number, body)).id;
    await client.query('UPDATE pulls SET comment_id=$3, comment_version_id=$4 WHERE repo_id=$1 AND number=$2', [locked.repo_id, locked.number, commentId, pull.run_id]);
  });
  return true;
}

async function processRun(run) {
  if (!cfg.generationEnabled) throw new Error('Generation is disabled by the workspace operator.');
  const { rows } = await db.query('SELECT * FROM pulls WHERE repo_id=$1 AND number=$2', [run.repo_id, run.number]);
  if (!rows.length) throw new Error('PR was removed');
  const pull = rows[0];
  if (pull.base_sha !== run.base_sha || pull.head_sha !== run.head_sha) throw new Error('Superseded by a newer PR version');
  const choice = modelSelection({harness:run.runner || 'opencode',model:run.requested_model},cfg);
  if (pull.private && !cfg.privateAllowedModels.has(choice.modelId)) throw new Error('This model is not approved for private repositories');
  const token = await installationToken(cfg, pull.installation_id);
  const input = {
    owner: pull.owner, repo: pull.repo, number: pull.number, title: pull.title,
    baseSha: run.start_sha || run.base_sha, headSha: run.end_sha || run.head_sha, scope: run.scope, token, model: choice.model, runner: choice.runner
  };
  const { result, usage } = choice.runner ? { result: await generateLocalWalkthrough(input), usage: null } : await generateWalkthrough(input);
  await db.query(`UPDATE runs SET status='ready', result=$2, usage=$3, model=$4, finished_at=now() WHERE id=$1`, [run.id, result, usage, choice.modelId]);
  console.log(`Walkthrough ready: ${pull.owner}/${pull.repo}#${pull.number}`);
}

async function loop() {
  let lastReclaim = 0;
  let lastSync = 0;
  while (true) {
    try {
      if (Date.now() - lastSync > 300_000) {
        lastSync = Date.now();
        try { await syncAll(db, cfg); } catch (error) { console.error('GitHub sync failed:', error.message); }
      }
      if (cfg.generationEnabled && Date.now() - lastReclaim > 60_000) {
        await db.query("UPDATE runs SET status='queued', started_at=NULL WHERE status='running' AND started_at < now() - interval '30 minutes'");
        lastReclaim = Date.now();
      }
      const run = cfg.generationEnabled ? await claimRun(db,{automatic:cfg.automaticGenerationEnabled}) : null;
      if (run) {
        try { await processRun(run); }
        catch (error) {
          console.error('Generation failed', run.id, error);
          const nonRetryable = /^(Superseded by a newer PR version|This model is not approved for private repositories|PR has more than 200 changed files|Repository archive exceeds 100 MB|Snapshot diff file list differs from GitHub)/.test(error.message);
          const visible = nonRetryable
            ? error.message : 'Generation failed. Please retry or contact the app operator.';
          await db.query(`UPDATE runs SET status='failed', error=$2, attempts=CASE WHEN $3 THEN 3 ELSE attempts END, finished_at=now() WHERE id=$1`, [run.id, visible, nonRetryable]);
        }
      }
      const published = cfg.publishWalkthroughLinks ? await publishOne() : false;
      if (!run && !published) await wait(3000);
    } catch (error) { console.error('Worker loop error', error); await wait(5000); }
  }
}

loop();
