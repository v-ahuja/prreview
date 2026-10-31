import { getPull, installationRepos, installationToken, listInstallations, listPulls } from './github.js';
import { pullFields, queueRun, savePull } from './runs.js';

export async function syncPull(db, pull, installationId, { opened = false, generationEnabled = false, generator = {} } = {}) {
  const fields = pullFields(pull, installationId);
  await savePull(db, fields);
  const { rows } = await db.query('SELECT mode FROM repository_settings WHERE repo_id=$1', [fields.repoId]);
  if (generationEnabled && pull.state === 'open' && !pull.draft && (rows[0].mode === 'on_update' || opened && rows[0].mode === 'on_open'))
    await queueRun(db, fields, undefined, {...generator, trigger:'automatic'});
  return fields;
}

export async function syncRepository(db, cfg, repository, installationId, token, { list = listPulls } = {}) {
  await db.query('INSERT INTO installations(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET active=true', [installationId]);
  await db.query(`INSERT INTO repository_settings(repo_id,installation_id,owner,repo) VALUES($1,$2,$3,$4)
    ON CONFLICT(repo_id) DO UPDATE SET installation_id=$2,owner=$3,repo=$4`, [repository.id, installationId, repository.owner.login, repository.name]);
  try {
    const pulls = await list(token, repository.owner.login, repository.name, 'all');
    for (const pull of pulls) await syncPull(db, pull, installationId, { generationEnabled: cfg.generationEnabled && cfg.automaticGenerationEnabled, generator: cfg });
    await db.query('UPDATE repository_settings SET synced_at=now(),sync_error=NULL WHERE repo_id=$1', [repository.id]);
  } catch (error) {
    await db.query('UPDATE repository_settings SET sync_error=$2 WHERE repo_id=$1', [repository.id, error.message.slice(0, 500)]);
    throw error;
  }
}

export async function syncAll(db, cfg) {
  const installations = await listInstallations(cfg);
  for (const installation of installations) {
    if (installation.suspended_at) continue;
    // A local subscription-backed worker only serves the operator's account or
    // installations explicitly connected by an allowed signed-in user via /sync.
    if (cfg.allowedLogins?.size && !cfg.allowedLogins.has(installation.account?.login?.toLowerCase())) {
      const known = await db.query('SELECT id FROM installations WHERE id=$1 AND active=true', [installation.id]);
      if (!known.rows.length) continue;
    }
    const token = await installationToken(cfg, installation.id);
    for (const repository of await installationRepos(token)) {
      try { await syncRepository(db, cfg, repository, installation.id, token); }
      catch (error) { console.error('Repository sync failed', repository.full_name, error.message); }
    }
  }
  await db.query("DELETE FROM webhook_deliveries WHERE received_at < now() - interval '7 days'");
}

export async function syncWebhookPull(db, cfg, payload) {
  if (!payload.installation?.id) return;
  if (payload.pull_request?.base?.repo) return syncPull(db, payload.pull_request, payload.installation.id, { opened: payload.action === 'opened', generationEnabled: cfg.generationEnabled && cfg.automaticGenerationEnabled, generator: cfg });
  const number = payload.issue?.pull_request && payload.issue.number || payload.pull_request?.number;
  if (!number || !payload.repository) return;
  const token = await installationToken(cfg, payload.installation.id);
  const pull = await getPull(token, payload.repository.owner.login, payload.repository.name, number);
  await syncPull(db, pull, payload.installation.id, { generationEnabled: cfg.generationEnabled && cfg.automaticGenerationEnabled, generator: cfg });
}
