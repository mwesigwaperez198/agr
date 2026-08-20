import dotenv from 'dotenv';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), override: true, quiet: true });
const url = process.env.DATABASE_URL?.trim();
if (!url || /user:password|localhost:5432\/agri_connect/.test(url)) {
  throw new Error('DATABASE_URL is still a placeholder. Set a real PostgreSQL connection string before migrating.');
}

const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
const rootDir = fileURLToPath(new URL('../', import.meta.url));
try {
  await client.query('begin');
  await client.query(`create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now())`);
  // schema.sql is the current baseline. 001_primary_roles.sql is only for a
  // legacy database whose users table still has user_type; applying it to a
  // fresh baseline would be incorrect. Apply that legacy migration separately
  // after reviewing its unmapped-user report.
  const files = ['database/schema.sql', 'database/migrations/002_guest_access.sql', 'database/migrations/003_reference_data.sql', 'database/migrations/004_runtime_defaults.sql', 'database/migrations/005_identity_runtime_columns.sql', 'apps/api/migrations/20260816_001_farmer_commerce.sql', 'database/migrations/006_marketplace_runtime_columns.sql', 'database/migrations/007_runtime_orders.sql', 'database/migrations/008_runtime_engagement.sql', 'database/migrations/009_admin_record_views.sql', 'database/migrations/010_runtime_media.sql', 'database/migrations/011_runtime_finance.sql', 'database/migrations/012_runtime_payment_methods.sql', 'database/migrations/013_runtime_ai_conversations.sql'];
  for (const file of files) {
    const version = file;
    const applied = await client.query('select 1 from public.schema_migrations where version = $1', [version]);
    if (applied.rowCount) continue;
    await client.query(await readFile(resolve(rootDir, file), 'utf8'));
    await client.query('insert into public.schema_migrations(version) values ($1)', [version]);
    console.log(`applied ${version}`);
  }
  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally { client.release(); await pool.end(); }
