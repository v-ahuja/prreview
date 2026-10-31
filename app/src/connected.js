import './env.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { database } from './db.js';
import { createHostedServer } from './server.js';
import { createGitHubSetupServer } from './github-setup.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
let server, worker, shuttingDown = false;

async function startWorkspace() {
  const cfg = config();
  await new Promise((resolve, reject) => {
    const migrate = spawn(process.execPath, ['src/migrate.js'], { cwd: appRoot, stdio: 'inherit' });
    migrate.on('error', reject);
    migrate.on('exit', code => code === 0 ? resolve() : reject(new Error('Database migration failed.')));
  });
  const db = database(cfg.databaseUrl);
  server = createHostedServer({ cfg, db });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, cfg.host, resolve); });
  console.log(`GitHub workspace ready at ${cfg.origin}`);
  function startWorker() {
    if (shuttingDown) return;
    worker = spawn(process.execPath, ['src/worker.js'], { cwd: appRoot, stdio: 'inherit' });
    worker.on('error', error => console.error('Worker could not start:', error.message));
    worker.on('exit', () => { if (!shuttingDown) setTimeout(startWorker, 5000); });
  }
  startWorker();
}

async function main() {
  if (existsSync(envPath) || process.env.GITHUB_APP_ID) return startWorkspace();
  const origin = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:3100';
  const address = new URL(origin);
  if (address.hostname !== '127.0.0.1' || address.protocol !== 'http:' || address.pathname !== '/') throw new Error('Local setup requires an http://127.0.0.1 origin.');
  const login = process.env.SETUP_GITHUB_LOGIN;
  if (!login) throw new Error('Set SETUP_GITHUB_LOGIN to the GitHub login that will use this workspace.');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Set DATABASE_URL to a dedicated PostgreSQL database.');
  const db = database(databaseUrl);
  try { await db.query('SELECT 1'); } finally { await db.pool.end(); }
  server = createGitHubSetupServer({ origin, databaseUrl, login, envPath,
    name: process.env.SETUP_APP_NAME || `PR Walkthrough ${login}`.slice(0, 34),
    runner: process.env.WALKTHROUGH_RUNNER || 'codex', model: process.env.WALKTHROUGH_MODEL || '',
    complete: async values => {
      Object.assign(process.env, values);
      // Finish the callback response before replacing the setup listener.
      setImmediate(() => server.close(() => startWorkspace().catch(fatal)));
    }
  });
  server.once('error', fatal);
  server.listen(Number(address.port || 80), '127.0.0.1', () => console.log(`Connect GitHub at ${origin}`));
}

function fatal(error) { console.error(error.message); process.exitCode = 1; shutdown(); }
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  worker?.kill('SIGTERM');
  server?.close();
  setTimeout(() => process.exit(process.exitCode || 0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
main().catch(fatal);
