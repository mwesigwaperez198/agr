import { query } from './db.js';

export type AdminRecordView = {
  adminId: string;
  module: string;
  recordId: string;
  firstViewedAt: string;
  lastViewedAt: string;
  unread: boolean;
};

const adminRecordViews = new Map<string, AdminRecordView>();
const keyFor = (adminId: string, module: string, recordId: string) => `${adminId}\u0000${module}\u0000${recordId}`;

export async function hydrateAdminRecordViews() {
  const result = await query<AdminRecordView>('select admin_id as "adminId", module, record_id as "recordId", first_viewed_at as "firstViewedAt", last_viewed_at as "lastViewedAt", unread from audit.admin_record_views');
  for (const view of result?.rows || []) adminRecordViews.set(keyFor(view.adminId, view.module, view.recordId), view);
  return Boolean(result);
}

function persist(view: AdminRecordView) {
  void query(`insert into audit.admin_record_views(admin_id,module,record_id,first_viewed_at,last_viewed_at,unread)
    values ($1,$2,$3,$4,$5,$6) on conflict (admin_id,module,record_id) do update set first_viewed_at=excluded.first_viewed_at,last_viewed_at=excluded.last_viewed_at,unread=excluded.unread`,
    [view.adminId, view.module, view.recordId, view.firstViewedAt, view.lastViewedAt, view.unread]).catch(() => undefined);
}

export function adminRecordReadAt(adminId: string, module: string, recordId: string) {
  const view = adminRecordViews.get(keyFor(adminId, module, recordId));
  return view && !view.unread ? view.firstViewedAt : null;
}

export function markAdminRecordRead(adminId: string, module: string, recordId: string, now = new Date().toISOString()) {
  const key = keyFor(adminId, module, recordId);
  const existing = adminRecordViews.get(key);
  const view: AdminRecordView = existing
    ? { ...existing, lastViewedAt: now, unread: false }
    : { adminId, module, recordId, firstViewedAt: now, lastViewedAt: now, unread: false };
  adminRecordViews.set(key, view);
  persist(view);
  return view;
}

export function markAdminRecordUnread(adminId: string, module: string, recordId: string) {
  const key = keyFor(adminId, module, recordId);
  const existing = adminRecordViews.get(key);
  if (!existing) return false;
  adminRecordViews.set(key, { ...existing, unread: true });
  persist({ ...existing, unread: true });
  return true;
}

export function markAdminRecordsRead(adminId: string, module: string, recordIds: string[], now = new Date().toISOString()) {
  return recordIds.map(recordId => markAdminRecordRead(adminId, module, recordId, now));
}
