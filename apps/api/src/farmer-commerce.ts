/**
 * Farmer commerce domain helpers. Draft/media state is hydrated from PostgreSQL at startup
 * and written through the same domain transitions used by the HTTP API.
 */
import { randomUUID } from 'node:crypto';
import { seedOrders } from './data.js';
import { query } from './db.js';

export const FARMER_CATEGORIES = ['coffee', 'crops', 'animals', 'inputs', 'cereals', 'fruits', 'vegetables', 'legumes', 'honey', 'poultry', 'livestock', 'seeds', 'seedlings', 'equipment', 'other'] as const;
export type FarmerCategory = typeof FARMER_CATEGORIES[number];
export type DraftStatus = 'draft';

export type ListingDraft = {
  id: string; ownerId: string; status: DraftStatus; version: number; currentStep: number;
  title: string; category: FarmerCategory; crop: string; coffeeType: string | null; process: string | null;
  grade: string; description: string; harvestDate: string; productionMethod: 'organic' | 'conventional' | 'transitioning';
  quantity: number; unit: string; price: number; pricingMode: 'fixed' | 'negotiable'; minimumAcceptablePrice: number | null;
  district: string; subRegion: string; approximateLocation: string; imageIds: string[];
  createdAt: string; updatedAt: string;
};

export type ListingMedia = {
  id: string; ownerId: string; safeFilename: string; mime: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Buffer; size: number; width: number; height: number; scanStatus: 'development_validated' | 'scanner_approved';
  attachedListingId: string | null; createdAt: string;
};

export type LedgerEntry = {
  id: string; orderId: string; orderReference: string; sellerId: string; listingId: string; product: string;
  quantity: number; unit: string; unitPrice: number; gross: number; commission: number; paymentFee: number; net: number;
  currency: 'UGX'; commissionRule: { id: string; version: number; rateBasisPoints: number };
  paymentMethod: { id: string; name: string; provider: string } | null;
  status: 'available' | 'withdrawn' | 'reversed'; completedAt: string;
};

export type Withdrawal = {
  id: string; farmerId: string; amount: number; fee: number; amountReceived: number; payoutMethodId: string;
  payoutMethodSnapshot: { type: string; label: string; maskedAccount: string };
  status: 'requested' | 'pending' | 'approved' | 'processing' | 'completed' | 'failed' | 'reversed';
  providerTransactionId: string | null; failureReason: string | null; requestedAt: string; updatedAt: string;
};

export type FarmerReview = {
  id: string; orderId: string; buyerId: string; farmerId: string; rating: number; comment: string | null; createdAt: string;
};

const drafts: ListingDraft[] = [];
const media = new Map<string, ListingMedia>();
const ledger: LedgerEntry[] = [];
const withdrawals: Withdrawal[] = [];
const reviews: FarmerReview[] = [];

export async function hydrateFarmerFinance() {
  const result = await query<{ kind: string; payload: any }>('select kind, payload from commerce.runtime_finance');
  for (const row of result?.rows || []) {
    if (row.kind === 'ledger') ledger.push(...(row.payload || []));
    if (row.kind === 'withdrawals') withdrawals.push(...(row.payload || []));
    if (row.kind === 'reviews') reviews.push(...(row.payload || []));
  }
  return Boolean(result);
}

function persistFinance() {
  const records = [['ledger', ledger], ['withdrawals', withdrawals], ['reviews', reviews]] as const;
  void Promise.all(records.map(([kind, payload]) => query(`insert into commerce.runtime_finance(kind,payload,updated_at) values ($1,$2::jsonb,now()) on conflict (kind) do update set payload=excluded.payload,updated_at=now()`, [kind, JSON.stringify(payload)]))).catch(() => undefined);
}

export async function hydrateFarmerMedia() {
  const result = await query<any>('select id, owner_id, safe_filename, mime_type, bytes, byte_size, width, height, scan_status, attached_listing_id, created_at from commerce.runtime_media order by created_at asc');
  for (const row of result?.rows || []) media.set(row.id, {
    id: row.id, ownerId: row.owner_id, safeFilename: row.safe_filename, mime: row.mime_type,
    bytes: Buffer.from(row.bytes), size: row.byte_size, width: row.width, height: row.height,
    scanStatus: row.scan_status, attachedListingId: row.attached_listing_id, createdAt: new Date(row.created_at).toISOString(),
  });
  return Boolean(result);
}

function persistMedia(record: ListingMedia) {
  void query(`insert into commerce.runtime_media(id, owner_id, safe_filename, mime_type, bytes, byte_size, width, height, scan_status, attached_listing_id, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) on conflict (id) do update set safe_filename=excluded.safe_filename,mime_type=excluded.mime_type,
    bytes=excluded.bytes,byte_size=excluded.byte_size,width=excluded.width,height=excluded.height,scan_status=excluded.scan_status,
    attached_listing_id=excluded.attached_listing_id,updated_at=now()`,
    [record.id, record.ownerId, record.safeFilename, record.mime, record.bytes, record.size, record.width, record.height, record.scanStatus, record.attachedListingId, record.createdAt]).catch(() => undefined);
}

function safeInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

export function newListingDraft(ownerId: string): ListingDraft {
  const now = new Date().toISOString();
  const draft: ListingDraft = {
    id: randomUUID(), ownerId, status: 'draft', version: 1, currentStep: 1,
    title: '', category: 'coffee', crop: 'Coffee', coffeeType: 'Robusta', process: 'Fresh cherry', grade: '', description: '',
    harvestDate: '', productionMethod: 'conventional', quantity: 0, unit: 'kg', price: 0, pricingMode: 'fixed',
    minimumAcceptablePrice: null, district: '', subRegion: '', approximateLocation: '', imageIds: [], createdAt: now, updatedAt: now,
  };
  drafts.unshift(draft); return draft;
}

export function restoreFarmerDraft(record: ListingDraft) {
  if (!drafts.some(existing => existing.id === record.id)) drafts.push(record);
  return record;
}

export function farmerDrafts(ownerId: string) { return drafts.filter(draft => draft.ownerId === ownerId).map(publicDraft); }
export function findFarmerDraft(ownerId: string, id: string) { return drafts.find(draft => draft.id === id && draft.ownerId === ownerId); }
export function publicDraft(draft: ListingDraft) {
  return { ...draft, images: draft.imageIds.map(id => publicMedia(media.get(id))).filter(Boolean) };
}

export function updateFarmerDraft(draft: ListingDraft, input: Partial<Omit<ListingDraft, 'id' | 'ownerId' | 'status' | 'createdAt' | 'updatedAt' | 'version'>>, expectedVersion?: number) {
  if (expectedVersion !== undefined && expectedVersion !== draft.version) return null;
  const allowed = ['currentStep','title','category','crop','coffeeType','process','grade','description','harvestDate','productionMethod','quantity','unit','price','pricingMode','minimumAcceptablePrice','district','subRegion','approximateLocation','imageIds'] as const;
  for (const key of allowed) if (input[key] !== undefined) (draft as any)[key] = input[key];
  draft.quantity = safeInteger(draft.quantity); draft.price = safeInteger(draft.price);
  draft.minimumAcceptablePrice = draft.minimumAcceptablePrice === null ? null : safeInteger(draft.minimumAcceptablePrice);
  draft.currentStep = Math.max(1, Math.min(5, safeInteger(draft.currentStep, 1)));
  draft.version += 1; draft.updatedAt = new Date().toISOString(); return draft;
}
export function deleteFarmerDraft(draft: ListingDraft) {
  const index = drafts.indexOf(draft); if (index >= 0) drafts.splice(index, 1);
  for (const imageId of draft.imageIds) {
    const image = media.get(imageId); const referencedElsewhere = drafts.some(other => other.imageIds.includes(imageId));
    if (image?.ownerId === draft.ownerId && !referencedElsewhere) media.delete(imageId);
  }
}
export function consumeFarmerDraft(draft: ListingDraft) { const index = drafts.indexOf(draft); if (index >= 0) drafts.splice(index, 1); }

function extensionFor(mime: ListingMedia['mime']) { return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'; }
function jpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1]; offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}
function imageDimensions(buffer: Buffer, mime: ListingMedia['mime']) {
  if (mime === 'image/png') {
    const signature = '89504e470d0a1a0a';
    if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature || buffer.subarray(12, 16).toString() !== 'IHDR') return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') return jpegDimensions(buffer);
  if (buffer.length < 30 || buffer.subarray(0, 4).toString() !== 'RIFF' || buffer.subarray(8, 12).toString() !== 'WEBP') return null;
  const kind = buffer.subarray(12, 16).toString();
  if (kind === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  if (kind === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function saveListingMedia(ownerId: string, originalFilename: string, suppliedMime: string, bytes: Buffer) {
  const mime = suppliedMime === 'image/jpg' ? 'image/jpeg' : suppliedMime as ListingMedia['mime'];
  if (!['image/jpeg','image/png','image/webp'].includes(mime)) return { error: 'UNSUPPORTED_IMAGE_TYPE' as const };
  if (bytes.length < 100 || bytes.length > 1_500_000) return { error: 'IMAGE_SIZE_INVALID' as const };
  const extension = originalFilename.toLowerCase().split('.').pop();
  if (!extension || !['jpg','jpeg','png','webp'].includes(extension)) return { error: 'IMAGE_EXTENSION_INVALID' as const };
  const extensionMatchesMime = mime === 'image/jpeg' ? ['jpg','jpeg'].includes(extension) : extension === extensionFor(mime);
  if (!extensionMatchesMime) return { error: 'IMAGE_EXTENSION_MISMATCH' as const };
  const dimensions = imageDimensions(bytes, mime);
  if (!dimensions || dimensions.width < 160 || dimensions.height < 160 || dimensions.width > 4096 || dimensions.height > 4096 || dimensions.width * dimensions.height > 16_000_000) return { error: 'IMAGE_DIMENSIONS_INVALID' as const };
  if (process.env.NODE_ENV === 'production' && process.env.MEDIA_SCANNER_MODE !== 'configured') return { error: 'MEDIA_SCANNER_UNAVAILABLE' as const };
  const id = `media_${randomUUID().slice(0, 12)}`;
  const record: ListingMedia = {
    id, ownerId, safeFilename: `${id}.${extensionFor(mime)}`, mime, bytes: Buffer.from(bytes), size: bytes.length,
    width: dimensions.width, height: dimensions.height, scanStatus: process.env.MEDIA_SCANNER_MODE === 'configured' ? 'scanner_approved' : 'development_validated', attachedListingId: null, createdAt: new Date().toISOString(),
  };
  media.set(id, record); persistMedia(record); return { data: publicMedia(record) };
}
export function findMedia(id: string) { return media.get(id); }
export function mediaOwnedAndReady(ownerId: string, ids: string[]) { return ids.length <= 4 && new Set(ids).size === ids.length && ids.every(id => { const record=media.get(id); return record?.ownerId === ownerId && record.attachedListingId === null; }); }
export function attachMediaToListing(ownerId: string, ids: string[], listingId: string) { for (const id of ids) { const record = media.get(id); if (record?.ownerId === ownerId) { record.attachedListingId = listingId; persistMedia(record); } } }
export function syncListingMedia(ownerId: string, listingId: string, orderedUrls: string[]) {
  const retained = new Set(orderedUrls.map(url => url.split('/').pop()).filter(Boolean));
  for (const record of media.values()) if (record.ownerId === ownerId && record.attachedListingId === listingId && !retained.has(record.id)) { record.attachedListingId = null; persistMedia(record); }
  for (const id of retained) { const record=media.get(id!); if (record?.ownerId===ownerId && (record.attachedListingId===null || record.attachedListingId===listingId)) { record.attachedListingId=listingId; persistMedia(record); } }
}
export function deleteListingMedia(ownerId: string, id: string) {
  const record = media.get(id); if (!record || record.ownerId !== ownerId) return { error: 'NOT_FOUND' as const };
  if (record.attachedListingId || drafts.some(draft => draft.imageIds.includes(id))) return { error: 'MEDIA_IN_USE' as const };
  media.delete(id); void query('delete from commerce.runtime_media where id = $1 and owner_id = $2', [id, ownerId]).catch(() => undefined); return { deleted: true as const };
}
export function publicMedia(record?: ListingMedia) { return record ? { id: record.id, url: `/api/v1/media/listings/${record.id}`, width: record.width, height: record.height, size: record.size, scanStatus: record.scanStatus } : null; }

function seedLedger() {
  if (ledger.length) return;
  for (const order of seedOrders.filter(order => order.status === 'completed')) {
    const rate = order.gross ? Math.round(order.platformFee * 10_000 / order.gross) : 0;
    ledger.push(Object.freeze({
      id: `txn_${order.id}`, orderId: order.id, orderReference: order.reference, sellerId: order.sellerId,
      listingId: order.listing.id, product: order.listing.title, quantity: order.quantity, unit: order.listing.unit,
      unitPrice: order.listing.unitPrice, gross: order.gross, commission: order.platformFee, paymentFee: order.paymentFee,
      net: order.sellerNet, currency: 'UGX' as const, commissionRule: { id: 'seed_historical_rule', version: 1, rateBasisPoints: rate },
      paymentMethod: null, status: order.reference.endsWith('00122') ? 'withdrawn' as const : 'available' as const,
      completedAt: order.createdAt,
    }));
  }
}
seedLedger();

export function createLedgerEntryFromOrder(order: any) {
  const existing = ledger.find(entry => entry.orderId === order.id); if (existing) return existing;
  if (order.status !== 'completed') throw new Error('Only completed orders can enter the seller ledger.');
  const record: LedgerEntry = Object.freeze({
    id: `txn_${randomUUID().slice(0, 12)}`, orderId: order.id, orderReference: order.reference, sellerId: order.sellerId,
    listingId: order.listing.id, product: order.listing.title, quantity: order.quantity, unit: order.listing.unit,
    unitPrice: order.listing.unitPrice, gross: order.gross, commission: order.platformFee, paymentFee: order.paymentFee,
    net: order.sellerNet, currency: 'UGX', commissionRule: Object.freeze({
      id: order.financialSnapshot?.commissionRuleId || 'historical', version: order.financialSnapshot?.commissionRuleVersion || 1,
      rateBasisPoints: order.financialSnapshot?.commissionBasisPoints || Math.round(order.platformFee * 10_000 / order.gross),
    }), paymentMethod: order.paymentMethod ? Object.freeze({ id: order.paymentMethod.id, name: order.paymentMethod.name, provider: order.paymentMethod.provider }) : null,
    status: 'available', completedAt: order.completedAt || new Date().toISOString(),
  });
  ledger.unshift(record); persistFinance(); return record;
}

export function farmerLedger(farmerId: string, filters?: { from?: string; to?: string; product?: string; status?: string }) {
  return ledger.filter(entry => entry.sellerId === farmerId)
    .filter(entry => !filters?.from || entry.completedAt >= filters.from)
    .filter(entry => !filters?.to || entry.completedAt <= `${filters.to}T23:59:59.999Z`)
    .filter(entry => !filters?.product || entry.product.toLowerCase().includes(filters.product.toLowerCase()))
    .filter(entry => !filters?.status || filters.status === 'ALL' || entry.status === filters.status);
}
function sum(items: any[], key: string) { return items.reduce((total, item) => total + Number(item[key] || 0), 0); }
export function farmerPortfolio(farmerId: string, allOrders: any[], period: 'today' | 'week' | 'month' | 'year' | 'all' = 'all') {
  const now = new Date();
  const cutoff = new Date(0);
  if (period === 'today') cutoff.setTime(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());
  if (period === 'week') cutoff.setTime(now.getTime() - 7 * 86400000);
  if (period === 'month') cutoff.setTime(new Date(now.getFullYear(), now.getMonth(), 1).getTime());
  if (period === 'year') cutoff.setTime(new Date(now.getFullYear(), 0, 1).getTime());
  const entries = farmerLedger(farmerId).filter(entry => period === 'all' || new Date(entry.completedAt) >= cutoff);
  const pendingOrders = allOrders.filter(order => order.sellerId === farmerId && ['payment_verified','processing','ready_for_delivery','delivered'].includes(order.status));
  const activeWithdrawals = withdrawals.filter(item => item.farmerId === farmerId && ['requested','pending','approved','processing','completed'].includes(item.status));
  const availableBeforeWithdrawals = sum(entries.filter(entry => entry.status === 'available'), 'net');
  const reservedOrPaid = activeWithdrawals.reduce((total, item) => total + item.amount, 0);
  const products = new Map<string, any>();
  for (const entry of entries) {
    const current = products.get(entry.product) || { product: entry.product, quantitySold: 0, unit: entry.unit, gross: 0, commission: 0, paymentFees: 0, net: 0, orders: 0 };
    current.quantitySold += entry.quantity; current.gross += entry.gross; current.commission += entry.commission; current.paymentFees += entry.paymentFee; current.net += entry.net; current.orders += 1;
    products.set(entry.product, current);
  }
  const productPerformance = [...products.values()].map(item => ({ ...item, averagePrice: item.quantitySold ? Math.round(item.gross / item.quantitySold) : 0 })).sort((a,b) => b.net - a.net);
  const byMonth = new Map<string, { label: string; gross: number; net: number }>();
  for (const entry of entries) { const label = entry.completedAt.slice(0,7); const point = byMonth.get(label) || { label, gross: 0, net: 0 }; point.gross += entry.gross; point.net += entry.net; byMonth.set(label, point); }
  return {
    period, totals: {
      completedSales: entries.length, grossRevenue: sum(entries,'gross'), platformFees: sum(entries,'commission'), paymentFees: sum(entries,'paymentFee'),
      netEarnings: sum(entries,'net'), pendingBalance: sum(pendingOrders,'sellerNet'), availableBalance: Math.max(0, availableBeforeWithdrawals - reservedOrPaid),
      withdrawn: withdrawals.filter(item => item.farmerId === farmerId && item.status === 'completed').reduce((total,item)=>total+item.amountReceived,0),
      quantitySold: sum(entries,'quantity'),
    },
    productPerformance, series: [...byMonth.values()].sort((a,b)=>a.label.localeCompare(b.label)), entries,
    recentSales: entries.slice(0,5), withdrawals: withdrawals.filter(item => item.farmerId === farmerId),
  };
}

export function payoutMethodsForFarmer(farmer: { phone: string }) {
  const last4 = farmer.phone.replace(/\D/g,'').slice(-4);
  return [{ id: 'payout_mobile_primary', type: 'mobile_money', label: 'Primary mobile money', maskedAccount: `••••••${last4}`, enabled: true }];
}
export function quoteWithdrawal(amountInput: number) {
  const amount = safeInteger(amountInput); const minimum = 10_000; const fee = amount >= minimum ? 1_000 : 0;
  return { amount, fee, amountReceived: Math.max(0, amount - fee), minimum, highValueThreshold: 1_000_000, currency: 'UGX' as const, providerStatus: 'configuration_required' as const };
}
export function requestWithdrawal(farmer: { id: string; phone: string; verified: boolean; twoFactorEnabled: boolean }, allOrders: any[], input: { amount: number; payoutMethodId: string; confirmation?: string; otp?: string }) {
  if (!farmer.verified) return { error: 'ACCOUNT_VERIFICATION_REQUIRED' as const };
  const method = payoutMethodsForFarmer(farmer).find(item => item.id === input.payoutMethodId && item.enabled);
  if (!method) return { error: 'PAYOUT_METHOD_INVALID' as const };
  const { amount, minimum, fee } = quoteWithdrawal(input.amount);
  const available = farmerPortfolio(farmer.id, allOrders).totals.availableBalance;
  if (amount < minimum) return { error: 'WITHDRAWAL_MINIMUM' as const, minimum };
  if (amount > available) return { error: 'INSUFFICIENT_BALANCE' as const, available };
  if (amount >= 1_000_000) {
    if (!farmer.twoFactorEnabled) return { error: 'TWO_FACTOR_REQUIRED' as const };
    const expected = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
    if (input.confirmation !== String(amount) || !expected || input.otp !== expected) return { error: 'STEP_UP_REQUIRED' as const };
  }
  const now = new Date().toISOString();
  const record: Withdrawal = {
    id: `wd_${randomUUID().slice(0,12)}`, farmerId: farmer.id, amount, fee, amountReceived: amount - fee,
    payoutMethodId: method.id, payoutMethodSnapshot: { type: method.type, label: method.label, maskedAccount: method.maskedAccount },
    status: 'requested', providerTransactionId: null, failureReason: null, requestedAt: now, updatedAt: now,
  };
  withdrawals.unshift(record); persistFinance(); return { data: record };
}

export function createFarmerReview(order: any, buyerId: string, rating: number, comment?: string) {
  if (order.status !== 'completed' || order.buyerId !== buyerId || order.sellerId === buyerId) return { error: 'REVIEW_NOT_ALLOWED' as const };
  if (reviews.some(review => review.orderId === order.id && review.buyerId === buyerId)) return { error: 'REVIEW_ALREADY_EXISTS' as const };
  const review: FarmerReview = { id: `review_${randomUUID().slice(0,12)}`, orderId: order.id, buyerId, farmerId: order.sellerId, rating, comment: comment?.trim() || null, createdAt: new Date().toISOString() };
  reviews.push(review); persistFinance(); return { data: review };
}
export function reviewsForFarmer(farmerId: string) { return reviews.filter(review => review.farmerId === farmerId); }
