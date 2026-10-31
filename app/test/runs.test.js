import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { database } from '../src/db.js';
import { claimRun, queueRun, savePull } from '../src/runs.js';

test('queue is idempotent and bounds retry and daily spend', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const db = database(process.env.TEST_DATABASE_URL);
  const repoId = 900_000_000 + randomInt(10_000_000);
  const installationId = repoId;
  const pull = { repoId, number: 1, owner: 'fixture', repo: 'fixture', installationId,
    title: 'Test', private: false, baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) };
  try {
    await savePull(db, pull);
    const first = await queueRun(db, pull);
    assert.equal((await queueRun(db, pull)).id, first.id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await claimRun(db);
      assert.equal(claimed.id, first.id);
      assert.equal(claimed.attempts, attempt);
      await db.query("UPDATE runs SET status='failed' WHERE id=$1", [first.id]);
      const next = await queueRun(db, pull);
      assert.equal(next.limited || false, attempt === 3);
    }
    for (let i = 1; i < 20; i++) {
      const version = { ...pull, headSha: i.toString(16).padStart(40, '0') };
      assert.equal((await queueRun(db, version)).status, 'queued');
    }
    assert.equal((await queueRun(db, { ...pull, headSha: 'f'.repeat(40) })).limited, true);
  } finally {
    await db.query('DELETE FROM runs WHERE repo_id=$1', [repoId]);
    await db.query('DELETE FROM pulls WHERE repo_id=$1', [repoId]);
    await db.query('DELETE FROM repository_settings WHERE repo_id=$1', [repoId]);
    await db.query('DELETE FROM installations WHERE id=$1', [installationId]);
    await db.pool.end();
  }
});
