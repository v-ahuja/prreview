import './env.js';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { database } from './db.js';

const db = database(process.env.DATABASE_URL);
try {
  const directory = new URL('../db/', import.meta.url);
  for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql')).sort()) {
    await db.query(await readFile(fileURLToPath(new URL(file, directory)), 'utf8'));
  }
  console.log('Migration complete');
} finally { await db.pool.end(); }
