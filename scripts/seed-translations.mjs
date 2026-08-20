import dotenv from 'dotenv';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), override: true, quiet: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const entries = JSON.parse(await readFile(new URL('../apps/api/src/l10n/lg.draft.json', import.meta.url), 'utf8'));
const client = await pool.connect();
try {
  await client.query('begin');
  for (const entry of entries) await client.query(`insert into content.ui_translations(language_code, message_key, value, status, updated_at)
    values ($1,$2,$3,$4,$5) on conflict (language_code,message_key) do update set value=excluded.value,status=excluded.status,updated_at=excluded.updated_at`,
    [entry.language, entry.source, entry.text, entry.status, entry.updatedAt]);
  await client.query('commit');
  console.log(`seeded ${entries.length} translation entries`);
} catch (error) { await client.query('rollback'); throw error; }
finally { client.release(); await pool.end(); }
