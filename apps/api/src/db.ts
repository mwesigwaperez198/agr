import dotenv from 'dotenv';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { AuthUserRecord } from './auth.js';

// Shell/deployment environment variables take precedence over local .env.
dotenv.config({ path: new URL('../../../.env', import.meta.url), quiet: true });

const configuredUrl = process.env.DATABASE_URL?.trim();
const unusableUrl = !configuredUrl || /user:password|localhost:5432\/agri_connect/.test(configuredUrl);
export const databaseConfigured = !unusableUrl;

let pool: Pool | null = null;
function getPool() {
  if (!databaseConfigured) return null;
  pool ??= new Pool({ connectionString: configuredUrl, max: Number(process.env.DB_POOL_MAX || 10), idleTimeoutMillis: 30_000 });
  return pool;
}

export async function databaseReady() {
  const currentPool = getPool();
  if (!currentPool) return { configured: false, reachable: false };
  try {
    await currentPool.query('select 1');
    return { configured: true, reachable: true };
  } catch {
    return { configured: true, reachable: false };
  }
}

export async function withDatabase<T>(work: (client: PoolClient) => Promise<T>) {
  const currentPool = getPool();
  if (!currentPool) return null;
  const client = await currentPool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  const currentPool = getPool();
  if (!currentPool) return null;
  return currentPool.query<T>(text, values);
}

export async function hydrateRuntimeSettings(settings: Record<string, any>) {
  const result = await query<{ key: string; value_json: unknown }>('select key, value_json from content.system_settings where key in ($1, $2)', ['runtime', 'guestAccess']);
  if (!result) return false;
  for (const row of result.rows) {
    if (row.key === 'guestAccess' && row.value_json && typeof row.value_json === 'object') Object.assign(settings.guestAccess, row.value_json);
    if (row.key === 'runtime' && row.value_json && typeof row.value_json === 'object') Object.assign(settings, row.value_json);
  }
  return true;
}

export async function persistRuntimeSetting(key: string, value: unknown, actorId?: string) {
  const result = await query<{ version: number }>(
    `insert into content.system_settings(key, value_json, version, updated_by)
     values ($1, $2::jsonb, 1, $3::uuid)
     on conflict (key) do update set value_json = content.system_settings.value_json || excluded.value_json, version = content.system_settings.version + 1,
       updated_by = excluded.updated_by, updated_at = now()
     returning version`,
    [key, JSON.stringify(value), actorId || null],
  );
  return result?.rows[0]?.version ?? null;
}

export async function hydrateUsers(users: AuthUserRecord[]) {
  const result = await query<any>(`select id, display_name, first_name, phone, email, password_hash, primary_role, status,
    verified, two_factor_enabled, location, district, avatar, phone_verified, email_verified, joined_at, last_active_at
    from identity.accounts where password_hash is not null`);
  if (!result) return false;
  for (const row of result.rows) {
    const existing = users.find(user => user.id === row.id);
    const record: AuthUserRecord = {
      id: row.id, name: row.display_name || row.id, firstName: row.first_name || row.display_name?.split(/\s+/)[0] || row.id,
      phone: row.phone || '', email: row.email || null, passwordHash: row.password_hash, role: row.primary_role,
      status: String(row.status).toUpperCase() as AuthUserRecord['status'], verified: Boolean(row.verified), phoneVerified: Boolean(row.phone_verified),
      emailVerified: Boolean(row.email_verified), twoFactorEnabled: Boolean(row.two_factor_enabled), location: row.location || '',
      district: row.district || '', avatar: row.avatar || '', joinedAt: new Date(row.joined_at).toISOString(), lastActiveAt: new Date(row.last_active_at).toISOString(),
    };
    if (existing) Object.assign(existing, record); else users.push(record);
  }
  return true;
}

export async function persistUser(user: AuthUserRecord) {
  await query(`insert into identity.accounts(id, primary_role, status, verified, two_factor_enabled, display_name, first_name, phone, email,
    password_hash, location, district, avatar, phone_verified, email_verified, joined_at, last_active_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    on conflict (id) do update set primary_role=excluded.primary_role, status=excluded.status, verified=excluded.verified,
      two_factor_enabled=excluded.two_factor_enabled, display_name=excluded.display_name, first_name=excluded.first_name,
      phone=excluded.phone, email=excluded.email, password_hash=excluded.password_hash, location=excluded.location,
      district=excluded.district, avatar=excluded.avatar, phone_verified=excluded.phone_verified, email_verified=excluded.email_verified,
      last_active_at=excluded.last_active_at`,
    [user.id, user.role, user.status, user.verified, user.twoFactorEnabled, user.name, user.firstName, user.phone,
      user.email, user.passwordHash, user.location, user.district, user.avatar, user.phoneVerified, user.emailVerified,
      user.joinedAt, user.lastActiveAt]);
}

export async function hydrateTranslations(entries: Array<{ language: string; source: string; text: string; status: string; reviewedBy: string | null; updatedAt: string }>) {
  const result = await query<any>('select language_code, message_key, value, status, updated_at from content.ui_translations');
  if (!result) return false;
  for (const row of result.rows) {
    const entry = entries.find(item => item.language === row.language_code && item.source === row.message_key);
    if (entry) Object.assign(entry, { text: row.value, status: row.status, updatedAt: new Date(row.updated_at).toISOString() });
  }
  return true;
}

export async function persistTranslationEntry(entry: { language: string; source: string; text: string; status: string }) {
  await query(`insert into content.ui_translations(language_code, message_key, value, status, updated_at)
    values ($1,$2,$3,$4,now()) on conflict (language_code,message_key) do update set value=excluded.value, status=excluded.status, updated_at=now()`,
    [entry.language, entry.source, entry.text, entry.status]);
}

export async function hydrateDrafts() {
  const result = await query<any>('select id::text, owner_id, version, current_step, category, title, crop, coffee_type, process, grade, description, harvest_date_text, production_method, quantity, unit, unit_price_ugx, pricing_mode, minimum_acceptable_price_ugx, district, sub_region, approximate_location, image_ids, created_at, updated_at from commerce.listing_drafts order by updated_at desc');
  return result?.rows || [];
}

export async function persistDraft(draft: any) {
  await query(`insert into commerce.listing_drafts(id, owner_id, version, current_step, category, title, crop, coffee_type, process, grade,
    description, harvest_date_text, production_method, quantity, unit, unit_price_ugx, pricing_mode, minimum_acceptable_price_ugx,
    district, sub_region, approximate_location, image_ids, created_at, updated_at)
    values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    on conflict (id) do update set version=excluded.version,current_step=excluded.current_step,category=excluded.category,title=excluded.title,
      crop=excluded.crop,coffee_type=excluded.coffee_type,process=excluded.process,grade=excluded.grade,description=excluded.description,
      harvest_date_text=excluded.harvest_date_text,production_method=excluded.production_method,quantity=excluded.quantity,unit=excluded.unit,
      unit_price_ugx=excluded.unit_price_ugx,pricing_mode=excluded.pricing_mode,minimum_acceptable_price_ugx=excluded.minimum_acceptable_price_ugx,
      district=excluded.district,sub_region=excluded.sub_region,approximate_location=excluded.approximate_location,image_ids=excluded.image_ids,updated_at=excluded.updated_at`,
    [draft.id, draft.ownerId, draft.version, draft.currentStep, draft.category, draft.title, draft.crop, draft.coffeeType, draft.process, draft.grade,
      draft.description, draft.harvestDate, draft.productionMethod, draft.quantity, draft.unit, draft.price, draft.pricingMode, draft.minimumAcceptablePrice,
      draft.district, draft.subRegion, draft.approximateLocation, draft.imageIds, draft.createdAt, draft.updatedAt]);
}

export async function deleteDraftFromDatabase(id: string, ownerId: string) {
  await query('delete from commerce.listing_drafts where id = $1::uuid and owner_id = $2', [id, ownerId]);
}

export async function persistListing(listing: any) {
  await query(`insert into commerce.listings(id, seller_id, status, category, title, crop, coffee_type, process, grade, description, harvest_date_text,
    production_method, available_quantity, unit, unit_price_ugx, pricing_mode, minimum_acceptable_price_ugx, district, sub_region, approximate_location,
    view_count, interested_buyer_count, published_at, created_at, updated_at)
    values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
    on conflict (id) do update set status=excluded.status,title=excluded.title,description=excluded.description,available_quantity=excluded.available_quantity,
      unit_price_ugx=excluded.unit_price_ugx,pricing_mode=excluded.pricing_mode,minimum_acceptable_price_ugx=excluded.minimum_acceptable_price_ugx,
      district=excluded.district,sub_region=excluded.sub_region,approximate_location=excluded.approximate_location,view_count=excluded.view_count,
      interested_buyer_count=excluded.interested_buyer_count,updated_at=excluded.updated_at`,
    [listing.id, listing.sellerId, listing.status, listing.category, listing.title, listing.crop || listing.title, listing.coffeeType, listing.process, listing.grade,
      listing.description, listing.harvestDate || null, listing.productionMethod || 'conventional', listing.quantity, listing.unit, listing.price,
      listing.negotiable ? 'negotiable' : 'fixed', listing.minimumAcceptablePrice ?? null, listing.district || listing.location || '', listing.subRegion || null,
      listing.location || listing.approximateLocation || '', listing.views || 0, listing.interestedBuyers || 0, listing.createdAt, listing.createdAt, new Date().toISOString()]);
}

export async function hydrateListings() {
  const result = await query<any>('select id::text, seller_id, status, category, title, crop, coffee_type, process, grade, description, harvest_date_text, production_method, available_quantity, unit, unit_price_ugx, pricing_mode, minimum_acceptable_price_ugx, district, sub_region, approximate_location, view_count, interested_buyer_count, published_at, created_at from commerce.listings order by created_at desc');
  return result?.rows || [];
}

export async function hydrateOrders() {
  const result = await query<{ id: string; payload: any }>('select id::text, payload from commerce.runtime_orders order by created_at asc');
  return result?.rows || [];
}

export async function persistOrder(order: any, idempotencyId?: string, requestHash?: string) {
  await query(`insert into commerce.runtime_orders(id, buyer_id, seller_id, listing_id, status, reference, idempotency_key, request_hash, payload, created_at, updated_at)
    values ($1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9::jsonb,$10,$10)
    on conflict (id) do update set buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,listing_id=excluded.listing_id,status=excluded.status,
      reference=excluded.reference,idempotency_key=coalesce(excluded.idempotency_key, commerce.runtime_orders.idempotency_key),
      request_hash=coalesce(excluded.request_hash, commerce.runtime_orders.request_hash),payload=excluded.payload,updated_at=now()`,
    [order.id, order.buyerId, order.sellerId, order.listing?.id, order.status, order.reference, idempotencyId || null, requestHash || null, JSON.stringify(order), order.createdAt]);
}

export async function closeDatabase() { if (pool) await pool.end(); pool = null; }
