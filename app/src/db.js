import pg from 'pg';

export function database(url) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { pool, query: (sql, args = []) => pool.query(sql, args) };
}

export async function transaction(db, fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
