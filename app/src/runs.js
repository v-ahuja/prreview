import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';

export function pullFields(pull, installationId) {
  return {
    repoId: pull.base.repo.id,
    number: pull.number,
    owner: pull.base.repo.owner.login,
    repo: pull.base.repo.name,
    installationId,
    title: pull.title,
    private: pull.base.repo.private,
    baseSha: pull.base.sha,
    headSha: pull.head.sha,
    metadata: pull
  };
}

export async function savePull(db, pull) {
  await transaction(db, async client => {
    await client.query(`INSERT INTO installations (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET active=true, updated_at=now()`, [pull.installationId]);
    await client.query(`INSERT INTO repository_settings (repo_id, installation_id, owner, repo)
      VALUES ($1,$2,$3,$4) ON CONFLICT (repo_id) DO UPDATE SET installation_id=$2, owner=$3, repo=$4`,
    [pull.repoId, pull.installationId, pull.owner, pull.repo]);
    await client.query(`INSERT INTO pulls (repo_id, number, owner, repo, installation_id, title, private, base_sha, head_sha)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (repo_id, number) DO UPDATE SET owner=$3, repo=$4, installation_id=$5, title=$6,
        private=$7, base_sha=$8, head_sha=$9, updated_at=now()`,
    [pull.repoId, pull.number, pull.owner, pull.repo, pull.installationId, pull.title, pull.private, pull.baseSha, pull.headSha]);
    await client.query('UPDATE pulls SET metadata=$3 WHERE repo_id=$1 AND number=$2', [pull.repoId, pull.number, pull.metadata || {}]);
  });
}

export async function queueRun(db, pull, selection = { scope: 'full', startSha: '', endSha: '' }, generator = {}) {
  const {runner = '', model = '', trigger = 'manual', requestedBy = null} = generator;
  return transaction(db, async client => {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [pull.repoId]);
    const existing = (await client.query(`SELECT id,status,attempts FROM runs WHERE repo_id=$1 AND number=$2 AND base_sha=$3 AND head_sha=$4 AND scope=$5 AND start_sha=$6 AND end_sha=$7 AND generator_version=2 AND runner=$8 AND requested_model=$9`,
      [pull.repoId, pull.number, pull.baseSha, pull.headSha, selection.scope, selection.startSha, selection.endSha, runner, model])).rows[0];
    if (existing) {
      if (existing.status === 'queued' && trigger === 'manual') await client.query("UPDATE runs SET trigger='manual', requested_by=COALESCE(requested_by,$2) WHERE id=$1", [existing.id, requestedBy]);
      if (existing.status !== 'failed') return existing;
      if (existing.attempts >= 3) return { ...existing, limited: true };
      return (await client.query(`UPDATE runs SET status='queued', error=NULL, trigger=$2, requested_by=$3 WHERE id=$1 RETURNING id,status,attempts`, [existing.id,trigger,requestedBy])).rows[0];
    }
    const count = Number((await client.query(`SELECT count(*) AS n FROM runs WHERE repo_id=$1 AND created_at > now() - interval '1 day'`, [pull.repoId])).rows[0].n);
    if (count >= 20) return { limited: true };
    const id = randomUUID();
    return (await client.query(`INSERT INTO runs (id, repo_id, number, base_sha, head_sha, status, scope, start_sha, end_sha, runner, requested_model, trigger, requested_by)
      VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,$10,$11,$12) RETURNING id,status,attempts`, [id, pull.repoId, pull.number, pull.baseSha, pull.headSha, selection.scope, selection.startSha, selection.endSha, runner, model, trigger, requestedBy])).rows[0];
  });
}

export async function claimRun(db, {automatic = false} = {}) {
  return transaction(db, async client => {
    const { rows } = await client.query(`SELECT id FROM runs WHERE status='queued' AND (trigger='manual' OR $1::boolean) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [automatic]);
    if (!rows.length) return null;
    const result = await client.query(`UPDATE runs SET status='running', attempts=attempts+1, started_at=now(), error=NULL WHERE id=$1 RETURNING *`, [rows[0].id]);
    return result.rows[0];
  });
}

export function walkthroughUrl(origin, pull) {
  return `${origin}/p/${encodeURIComponent(pull.owner)}/${encodeURIComponent(pull.repo)}/${pull.number}?tab=walkthrough`;
}
