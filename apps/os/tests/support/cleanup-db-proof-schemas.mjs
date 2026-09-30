// Last-resort teardown for the two scratch schemas created by DB proof suites.
// The gate runner invokes this after Vitest exits, including a failed test run or worker exit.
// No other schema or production table may be changed here.
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { Client } = createRequire(join(app, 'package.json'))('pg');
const source = readFileSync(join(app, 'core/db/tls.ts'), 'utf8');
const ca = source.match(/export const SUPABASE_ROOT_2021_CA = `([\s\S]*?)`;/)?.[1];
const fingerprint = source.match(/export const SUPABASE_ROOT_2021_CA_SHA256 =\s*"([A-F0-9:]+)"/)?.[1];
const names = ['ascend_pool_test', 'ascend_request_test'];

async function main() {
  if (!ca || new X509Certificate(ca).fingerprint256 !== fingerprint)
    throw Error('database trust anchor invalid');
  const endpoint = new URL(process.env.ASCEND_TEST_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(endpoint.protocol) || !endpoint.hostname ||
      !endpoint.username || !endpoint.password) throw Error('admin proof input invalid');
  const client = new Client({
    host: endpoint.hostname, port: endpoint.port ? Number(endpoint.port) : 5432,
    user: decodeURIComponent(endpoint.username), password: decodeURIComponent(endpoint.password),
    database: decodeURIComponent(endpoint.pathname.slice(1)),
    ssl: { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeoutMillis: 15_000, statement_timeout: 60_000,
  });
  try {
    await client.connect();
    await client.query('BEGIN');
    try {
      const role = await client.query(`SELECT coalesce((SELECT rolbypassrls FROM pg_roles
        WHERE rolname = current_user), false) AS admin`);
      if (role.rows[0]?.admin !== true) throw Error('admin authority required for scratch cleanup');
      const found = await client.query(`SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)`, [names]);
      for (const { nspname } of found.rows) {
        if (!names.includes(nspname)) throw Error('unexpected scratch schema');
        await client.query(`DROP SCHEMA "${nspname}" CASCADE`);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    await client.query('BEGIN READ ONLY');
    const residue = await client.query(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = ANY($1)`, [names]);
    await client.query('ROLLBACK');
    if (residue.rows[0]?.n !== 0) throw Error('scratch schema residue');
    console.log('db scratch cleanup: verified zero schemas');
  } finally { await client.end().catch(() => {}); }
}

main().catch(() => { console.error('db scratch cleanup failed; private diagnostic withheld'); process.exitCode = 1; });
