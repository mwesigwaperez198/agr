import { randomUUID } from 'node:crypto';
import { activeSessions, publicUser, revokeSessionById, users } from './auth.js';
import { adminRecordReadAt } from './admin-record-views.js';
import {
  adminStats, advertisements, alerts, articles, farmerEarnings, listings, marketPrices,
  roleProfiles, seedOrders,
} from './data.js';

export type AdminModuleKey =
  | 'farmers' | 'buyers' | 'marketplace' | 'orders' | 'payments' | 'commissions' | 'payouts'
  | 'finance' | 'market-prices' | 'content' | 'ai' | 'advertisements' | 'reports' | 'analytics'
  | 'notifications' | 'moderation' | 'security';

export const adminModulePermissions: Record<AdminModuleKey, string> = {
  farmers: 'farmers.verify', buyers: 'users.read', marketplace: 'marketplace.moderate', orders: 'orders.read.all',
  payments: 'payments.read', commissions: 'commissions.manage', payouts: 'payouts.manage', finance: 'finance.read',
  'market-prices': 'market_prices.manage', content: 'content.manage', ai: 'ai.manage', advertisements: 'advertisements.manage',
  reports: 'reports.manage', analytics: 'analytics.read', notifications: 'notifications.manage',
  moderation: 'marketplace.moderate', security: 'security.manage',
};

type AdminAction = { id: string; label: string; tone?: 'primary' | 'danger' | 'neutral'; requiresReason?: boolean; stepUp?: boolean };
type AdminColumn = { key: string; label: string; format?: 'money' | 'number' | 'status' | 'date' | 'percent' };

type PaymentRecord = {
  id: string; orderId: string; buyer: string; amount: number; paymentMethodId: string; method: string; provider: string;
  status: string; reference: string; date: string; investigation?: string;
};
const orderAdjustments: Array<{ id: string; orderId: string; type: 'refund_request' | 'cancellation_request'; amount: number; reason: string; status: string; createdAt: string }> = [];
const paymentAdjustments: Array<{ id: string; paymentId: string; type: 'refund_request' | 'reversal'; amount: number; reason: string; status: string; createdAt: string }> = [];
const payments: PaymentRecord[] = [
  { id: 'pay_10042', orderId: 'HL-2026-00142', buyer: 'Daniel Okello', amount: 751100, paymentMethodId: 'pm_mtn_momo', method: 'MTN Mobile Money', provider: 'MTN Uganda', status: 'successful', reference: 'MM-884201', date: '2026-08-16T06:12:00Z' },
  { id: 'pay_10038', orderId: 'HL-2026-00138', buyer: 'Daniel Okello', amount: 883050, paymentMethodId: 'pm_airtel_money', method: 'Airtel Money', provider: 'Airtel Uganda', status: 'successful', reference: 'MM-883105', date: '2026-08-12T10:32:00Z' },
  { id: 'pay_10037', orderId: 'HL-2026-00137', buyer: 'Kampala Fresh Foods', amount: 528000, paymentMethodId: 'pm_mtn_momo', method: 'MTN Mobile Money', provider: 'MTN Uganda', status: 'failed', reference: 'MM-882991', date: '2026-08-12T08:07:00Z' },
  { id: 'pay_10031', orderId: 'HL-2026-00131', buyer: 'Lake Victoria Coffee Exports', amount: 2192400, paymentMethodId: 'pm_bank_transfer', method: 'Bank Transfer', provider: 'Manual bank settlement', status: 'refunded', reference: 'BT-551204', date: '2026-08-05T08:17:00Z' },
];

export function recordVerifiedPayment(input: PaymentRecord) {
  if (payments.some(payment => payment.id === input.id || payment.reference === input.reference)) return;
  payments.unshift(Object.freeze({ ...input }));
}

const commissionRules = [
  { id: 'com_coffee_v3', category: 'Coffee', rateBasisPoints: 500, rate: 5, scope: 'Category', seller: 'All sellers', amountBand: 'All amounts', campaign: 'Standard', version: 3, effectiveFrom: '2026-08-01', effectiveTo: null, status: 'active' },
  { id: 'com_crops_v2', category: 'Food crops', rateBasisPoints: 400, rate: 4, scope: 'Category', seller: 'All sellers', amountBand: 'All amounts', campaign: 'Standard', version: 2, effectiveFrom: '2026-08-01', effectiveTo: null, status: 'active' },
  { id: 'com_animals_v1', category: 'Animals', rateBasisPoints: 300, rate: 3, scope: 'Category', seller: 'All sellers', amountBand: 'All amounts', campaign: 'Standard', version: 1, effectiveFrom: '2026-07-01', effectiveTo: null, status: 'active' },
  { id: 'com_featured_v1', category: 'Featured transactions', rateBasisPoints: 600, rate: 6, scope: 'Promotion', seller: 'Verified sellers', amountBand: 'UGX 500,000+', campaign: 'August coffee', version: 1, effectiveFrom: '2026-08-15', effectiveTo: '2026-09-15', status: 'scheduled' },
];

export function resolveCommissionRule(category: string, sellerId?: string) {
  const normalized = category.toLowerCase();
  const target = normalized === 'coffee' ? 'Coffee' : ['livestock', 'poultry', 'animals'].includes(normalized) ? 'Animals' : 'Food crops';
  const eligible = commissionRules.filter(rule => rule.status === 'active' && rule.category === target && (rule.seller === 'All sellers' || rule.seller === sellerId));
  const rule = eligible.sort((a, b) => b.version - a.version)[0] || commissionRules.find(candidate => candidate.status === 'active')!;
  return Object.freeze({ id: rule.id, version: rule.version, category: rule.category, rateBasisPoints: rule.rateBasisPoints, effectiveFrom: rule.effectiveFrom });
}

const payouts = [
  { id: 'pout_2041', seller: 'Sarah Nakato', order: 'HL-2026-00142', gross: 740000, commission: 37000, fees: 11100, net: 691900, method: 'Mobile Money', status: 'review_required', date: '2026-08-16T07:00:00Z' },
  { id: 'pout_2038', seller: 'Nabumali Coffee Group', order: 'HL-2026-00138', gross: 870000, commission: 43500, fees: 13050, net: 813450, method: 'Bank', status: 'processing', date: '2026-08-14T09:20:00Z' },
  { id: 'pout_2031', seller: 'Sarah Nakato', order: 'HL-2026-00131', gross: 2160000, commission: 108000, fees: 32400, net: 2019600, method: 'Mobile Money', status: 'completed', date: '2026-08-09T10:00:00Z' },
  { id: 'pout_2027', seller: 'Musa Kato', order: 'HL-2026-00127', gross: 950000, commission: 47500, fees: 14250, net: 888250, method: 'Mobile Money', status: 'failed', date: '2026-08-07T12:35:00Z' },
];

const reports = [
  { id: 'rep_301', type: 'Reported product', subject: 'Fresh Robusta coffee cherries', reporter: 'Buyer account', reason: 'Potentially misleading grade', priority: 'high', status: 'new', assignedTo: 'Unassigned', createdAt: '2026-08-16T07:42:00Z' },
  { id: 'rep_298', type: 'Fraud suspicion', subject: 'Off-platform payment request', reporter: 'Sarah Nakato', reason: 'Buyer requested an OTP', priority: 'urgent', status: 'under_review', assignedTo: 'Amina Nansubuga', createdAt: '2026-08-16T06:15:00Z' },
  { id: 'rep_294', type: 'Reported advertisement', subject: 'Input supplier promotion', reporter: 'Farmer account', reason: 'Unclear product claims', priority: 'medium', status: 'new', assignedTo: 'Unassigned', createdAt: '2026-08-15T13:20:00Z' },
  { id: 'rep_287', type: 'Reported message', subject: 'Abusive buyer conversation', reporter: 'Farmer account', reason: 'Harassment', priority: 'medium', status: 'resolved', assignedTo: 'Amina Nansubuga', createdAt: '2026-08-14T11:05:00Z' },
];

const notificationCampaigns = [
  { id: 'camp_91', title: 'Heavy rain preparation', audience: 'Farmers · Central Region', channel: 'In-app + Push', scheduledFor: '2026-08-16T07:15:00Z', sent: 4120, delivered: 4038, read: 2860, failed: 82, status: 'sent' },
  { id: 'camp_90', title: 'Robusta reference price update', audience: 'Coffee farmers', channel: 'In-app', scheduledFor: '2026-08-16T06:35:00Z', sent: 2810, delivered: 2810, read: 1722, failed: 0, status: 'sent' },
  { id: 'camp_92', title: 'Planned maintenance notice', audience: 'All users', channel: 'In-app + Email', scheduledFor: '2026-08-18T18:00:00Z', sent: 0, delivered: 0, read: 0, failed: 0, status: 'scheduled' },
];

const moderationQueue = [
  { id: 'mod_501', priority: 'high', type: 'Farmer verification', user: 'New farmer · Masaka', content: 'Identity and farm evidence', reason: 'Manual document review', status: 'pending', assignedAdmin: 'Unassigned', createdAt: '2026-08-16T08:10:00Z' },
  { id: 'mod_499', priority: 'urgent', type: 'Suspicious listing', user: 'Marketplace seller', content: 'Premium coffee seed offer', reason: 'Possible prohibited claim', status: 'pending', assignedAdmin: 'Amina Nansubuga', createdAt: '2026-08-16T07:51:00Z' },
  { id: 'mod_492', priority: 'medium', type: 'Reported image', user: 'Farmer account', content: 'Livestock listing image', reason: 'Image mismatch', status: 'under_review', assignedAdmin: 'Unassigned', createdAt: '2026-08-15T14:20:00Z' },
  { id: 'mod_488', priority: 'medium', type: 'Flagged AI content', user: 'Guest session', content: 'Pesticide dosage answer', reason: 'Safety escalation check', status: 'pending', assignedAdmin: 'Unassigned', createdAt: '2026-08-15T10:25:00Z' },
];

const aiSources = [
  { id: 'ais_1', source: 'Uganda coffee production guide', authority: 'Agricultural review team', documents: 42, language: 'English', lastReviewed: '2026-08-12', status: 'active' },
  { id: 'ais_2', source: 'Coffee terminology — Luganda', authority: 'Language review queue', documents: 1169, language: 'Luganda', lastReviewed: '2026-08-16', status: 'draft' },
  { id: 'ais_3', source: 'Animal husbandry safety set', authority: 'Veterinary review team', documents: 27, language: 'English', lastReviewed: '2026-08-09', status: 'active' },
];
const aiLogs = [
  { id: 'ail_1', question: 'Why are coffee leaves yellow?', language: 'English', userType: 'Farmer', mode: 'text', responseStatus: 'answered', responseTimeMs: 824, time: '2026-08-16T08:12:00Z' },
  { id: 'ail_2', question: 'My goat is not eating', language: 'Luganda', userType: 'Guest', mode: 'voice', responseStatus: 'escalated', responseTimeMs: 1102, time: '2026-08-16T08:04:00Z' },
  { id: 'ail_3', question: 'Check this coffee leaf photo', language: 'English', userType: 'Farmer', mode: 'image', responseStatus: 'failed', responseTimeMs: 2050, time: '2026-08-16T07:51:00Z' },
];

const securityEvents = [
  { id: 'sec_1', severity: 'high', event: 'Multiple failed administrator logins', actor: 'Unknown', approximateLocation: 'Kampala', status: 'investigating', occurredAt: '2026-08-16T07:48:00Z' },
  { id: 'sec_2', severity: 'info', event: 'Administrator MFA login successful', actor: 'Amina Nansubuga', approximateLocation: 'Kampala', status: 'reviewed', occurredAt: '2026-08-16T07:35:00Z' },
  { id: 'sec_3', severity: 'medium', event: 'Unusual payout review requested', actor: 'System risk rule', approximateLocation: 'Uganda', status: 'open', occurredAt: '2026-08-16T06:58:00Z' },
];

const advertisementCampaigns = advertisements.map((advertisement, index) => ({
  ...advertisement, campaign: advertisement.title, advertiser: advertisement.sponsor,
  type: index === 0 ? 'Homepage advertisement' : 'Featured product', budget: 450000,
  start: '2026-08-15', end: '2026-08-30', impressions: 12840, clicks: 742, conversions: 38,
  ctr: 5.8, revenue: 215000, status: 'active',
}));

function statusActions(module: AdminModuleKey, record: any): AdminAction[] {
  if (module === 'farmers') return record.verified
    ? [{ id: 'suspend', label: 'Suspend', tone: 'danger', requiresReason: true }]
    : [{ id: 'verify', label: 'Verify farmer', tone: 'primary', requiresReason: true }, { id: 'reject', label: 'Reject', tone: 'danger', requiresReason: true }];
  if (module === 'buyers') return [{ id: record.status === 'ACTIVE' ? 'suspend' : 'activate', label: record.status === 'ACTIVE' ? 'Suspend' : 'Activate', tone: record.status === 'ACTIVE' ? 'danger' : 'primary', requiresReason: true }, { id: 'verify', label: 'Verify', tone: 'primary' }];
  if (module === 'marketplace') return [{ id: 'approve', label: 'Approve', tone: 'primary', requiresReason: true }, { id: 'request_changes', label: 'Request changes', requiresReason: true }, { id: record.featured ? 'unfeature' : 'feature', label: record.featured ? 'Remove feature' : 'Feature' }, { id: 'suspend', label: 'Suspend', tone: 'danger', requiresReason: true }];
  if (module === 'orders') return [{ id: 'review', label: 'Review timeline' }, { id: 'open_dispute', label: 'Open dispute', tone: 'danger', requiresReason: true }, { id: 'request_cancellation', label: 'Request cancellation', requiresReason: true }, { id: 'request_refund', label: 'Request refund', tone: 'danger', requiresReason: true, stepUp: true }];
  if (module === 'payments') return [{ id: 'investigate', label: 'Investigate', requiresReason: true }, ...(record.status === 'failed' ? [{ id: 'retry', label: 'Retry provider', tone: 'primary' as const, requiresReason: true }] : []), ...(record.status === 'successful' ? [{ id: 'request_refund', label: 'Request refund', tone: 'danger' as const, requiresReason: true, stepUp: true }] : []), { id: 'export', label: 'Export record' }];
  if (module === 'commissions') return [{ id: 'clone', label: 'Create new version', tone: 'primary' }, { id: 'archive', label: 'Archive', requiresReason: true }];
  if (module === 'payouts') return record.status === 'review_required'
    ? [{ id: 'approve', label: 'Approve payout', tone: 'primary', requiresReason: true, stepUp: true }, { id: 'hold', label: 'Hold', tone: 'danger', requiresReason: true }]
    : record.status === 'failed' ? [{ id: 'retry', label: 'Retry', tone: 'primary', requiresReason: true, stepUp: true }]
      : record.status === 'held' ? [{ id: 'release', label: 'Release hold', tone: 'primary', requiresReason: true, stepUp: true }] : [{ id: 'review', label: 'View history' }];
  if (module === 'market-prices') return [{ id: 'publish_new', label: 'Publish new price', tone: 'primary' }, { id: 'archive', label: 'Archive', requiresReason: true }];
  if (module === 'content') return [{ id: record.status === 'published' ? 'archive' : 'publish', label: record.status === 'published' ? 'Archive' : 'Publish', tone: 'primary' }, { id: 'review', label: 'Open editor' }];
  if (module === 'ai') return [{ id: record.status === 'active' ? 'disable' : 'enable', label: record.status === 'active' ? 'Disable source' : 'Enable source', requiresReason: true }, { id: 'review', label: 'Review source' }];
  if (module === 'advertisements') return record.status === 'pending_review'
    ? [{ id: 'approve', label: 'Approve campaign', tone: 'primary', requiresReason: true }, { id: 'remove', label: 'Reject & remove', tone: 'danger', requiresReason: true }]
    : [{ id: record.status === 'active' ? 'pause' : 'resume', label: record.status === 'active' ? 'Pause' : 'Resume', tone: 'primary' }, { id: 'remove', label: 'Remove', tone: 'danger', requiresReason: true }];
  if (module === 'reports') return [...(record.assignedTo === 'Unassigned' ? [{ id: 'assign', label: 'Assign to me' }] : []), { id: 'investigate', label: 'Investigate', tone: 'primary' }, { id: 'resolve', label: 'Resolve', requiresReason: true }, { id: 'dismiss', label: 'Dismiss', requiresReason: true }, { id: 'escalate', label: 'Escalate', tone: 'danger', requiresReason: true }];
  if (module === 'notifications') return record.status === 'scheduled' ? [{ id: 'send_now', label: 'Send now', tone: 'primary' }, { id: 'cancel', label: 'Cancel', tone: 'danger', requiresReason: true }] : [{ id: 'view_delivery', label: 'Delivery report' }];
  if (module === 'moderation') return [...(record.assignedAdmin === 'Unassigned' ? [{ id: 'assign', label: 'Assign to me' }] : []), { id: 'approve', label: 'Approve', tone: 'primary', requiresReason: true }, { id: 'request_changes', label: 'Request changes', requiresReason: true }, { id: 'reject', label: 'Reject', tone: 'danger', requiresReason: true }, { id: 'remove', label: 'Remove content', tone: 'danger', requiresReason: true }, { id: 'suspend', label: 'Suspend account', tone: 'danger', requiresReason: true }, { id: 'escalate', label: 'Escalate', requiresReason: true }];
  if (module === 'security') return record.kind === 'session'
    ? [{ id: 'revoke', label: 'Revoke session', tone: 'danger', requiresReason: true, stepUp: true }]
    : [{ id: 'review', label: 'Review event', tone: 'primary' }, { id: 'resolve', label: 'Resolve', requiresReason: true }];
  return [];
}

function withActions(module: AdminModuleKey, records: any[]) {
  return records.map(record => ({ ...record, actions: statusActions(module, record) }));
}

function farmerRecords() {
  return users.filter(user => user.role === 'FARMER_SELLER').map(user => {
    const profile = roleProfiles[user.id] || {};
    const products = listings.filter(item => item.sellerId === user.id);
    const orders = seedOrders.filter(order => order.sellerId === user.id);
    return { ...publicUser(user), farm: profile.farmType || 'Farmer profile', products: products.length, orders: orders.length, sales: orders.reduce((sum, order) => sum + order.gross, 0), rating: profile.rating || 0, verification: user.verified ? 'verified' : 'pending', evidenceStatus: user.verified ? 'reviewed' : 'manual review required', complaints: user.id === 'usr_farmer_1' ? 0 : 1, verifiedBadge: user.verified, completedTransactions: profile.completedTransactions || orders.filter(order => order.status === 'completed').length };
  });
}
function buyerRecords() {
  return users.filter(user => user.role === 'BUYER').map(user => {
    const profile = roleProfiles[user.id] || {};
    const orders = seedOrders.filter(order => order.buyerId === user.id);
    return { ...publicUser(user), orders: orders.length, totalPurchases: orders.reduce((sum, order) => sum + order.buyerTotal, 0), verification: user.verified ? 'verified' : 'pending', joined: user.joinedAt, lastActive: user.lastActiveAt, savedProducts: profile.savedProducts || 0, messages: 6, reports: 0, reviews: orders.filter(order => order.status === 'completed').length, twoFactor: user.twoFactorEnabled ? 'enabled' : 'available' };
  });
}

const columns: Record<AdminModuleKey, AdminColumn[]> = {
  farmers: [{ key: 'name', label: 'Farmer' }, { key: 'farm', label: 'Farm' }, { key: 'location', label: 'Location' }, { key: 'products', label: 'Products', format: 'number' }, { key: 'orders', label: 'Orders', format: 'number' }, { key: 'sales', label: 'Sales', format: 'money' }, { key: 'verification', label: 'Verification', format: 'status' }, { key: 'rating', label: 'Rating' }, { key: 'status', label: 'Status', format: 'status' }],
  buyers: [{ key: 'name', label: 'Buyer' }, { key: 'location', label: 'Location' }, { key: 'orders', label: 'Orders', format: 'number' }, { key: 'totalPurchases', label: 'Purchases', format: 'money' }, { key: 'verification', label: 'Verification', format: 'status' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'lastActive', label: 'Last active', format: 'date' }],
  marketplace: [{ key: 'title', label: 'Product' }, { key: 'seller', label: 'Seller' }, { key: 'category', label: 'Category' }, { key: 'price', label: 'Price', format: 'money' }, { key: 'quantity', label: 'Quantity', format: 'number' }, { key: 'location', label: 'Location' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'views', label: 'Views', format: 'number' }],
  orders: [{ key: 'reference', label: 'Order' }, { key: 'buyerName', label: 'Buyer' }, { key: 'sellerName', label: 'Seller' }, { key: 'product', label: 'Product' }, { key: 'buyerTotal', label: 'Amount', format: 'money' }, { key: 'platformFee', label: 'Commission', format: 'money' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'createdAt', label: 'Date', format: 'date' }],
  payments: [{ key: 'id', label: 'Transaction' }, { key: 'orderId', label: 'Order' }, { key: 'buyer', label: 'Buyer' }, { key: 'amount', label: 'Amount', format: 'money' }, { key: 'method', label: 'Method' }, { key: 'provider', label: 'Provider' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'reference', label: 'Reference' }, { key: 'date', label: 'Date', format: 'date' }],
  commissions: [{ key: 'category', label: 'Rule' }, { key: 'scope', label: 'Scope' }, { key: 'seller', label: 'Seller scope' }, { key: 'amountBand', label: 'Amount band' }, { key: 'campaign', label: 'Campaign' }, { key: 'rate', label: 'Commission', format: 'percent' }, { key: 'version', label: 'Version' }, { key: 'effectiveFrom', label: 'Effective from', format: 'date' }, { key: 'effectiveTo', label: 'Effective to', format: 'date' }, { key: 'status', label: 'Status', format: 'status' }],
  payouts: [{ key: 'id', label: 'Payout' }, { key: 'seller', label: 'Seller' }, { key: 'order', label: 'Order' }, { key: 'gross', label: 'Gross sale', format: 'money' }, { key: 'commission', label: 'Commission', format: 'money' }, { key: 'net', label: 'Net payout', format: 'money' }, { key: 'method', label: 'Method' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'date', label: 'Date', format: 'date' }],
  finance: [],
  'market-prices': [{ key: 'product', label: 'Commodity' }, { key: 'category', label: 'Category' }, { key: 'grade', label: 'Grade' }, { key: 'location', label: 'Region' }, { key: 'amount', label: 'Price', format: 'money' }, { key: 'unit', label: 'Unit' }, { key: 'source', label: 'Source' }, { key: 'observedAt', label: 'Effective date', format: 'date' }, { key: 'status', label: 'Status', format: 'status' }],
  content: [{ key: 'title', label: 'Content' }, { key: 'type', label: 'Type' }, { key: 'category', label: 'Category' }, { key: 'language', label: 'Language' }, { key: 'author', label: 'Author' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'publishedAt', label: 'Publish date', format: 'date' }],
  ai: [{ key: 'source', label: 'Knowledge source' }, { key: 'authority', label: 'Authority' }, { key: 'documents', label: 'Documents', format: 'number' }, { key: 'language', label: 'Language' }, { key: 'lastReviewed', label: 'Last reviewed', format: 'date' }, { key: 'status', label: 'Status', format: 'status' }],
  advertisements: [{ key: 'campaign', label: 'Campaign' }, { key: 'advertiser', label: 'Advertiser' }, { key: 'type', label: 'Type' }, { key: 'budget', label: 'Budget', format: 'money' }, { key: 'start', label: 'Start', format: 'date' }, { key: 'end', label: 'End', format: 'date' }, { key: 'impressions', label: 'Impressions', format: 'number' }, { key: 'clicks', label: 'Clicks', format: 'number' }, { key: 'ctr', label: 'CTR', format: 'percent' }, { key: 'status', label: 'Status', format: 'status' }],
  reports: [{ key: 'id', label: 'Report' }, { key: 'type', label: 'Type' }, { key: 'subject', label: 'Subject' }, { key: 'reporter', label: 'Reporter' }, { key: 'reason', label: 'Reason' }, { key: 'priority', label: 'Priority', format: 'status' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'assignedTo', label: 'Assigned admin' }, { key: 'createdAt', label: 'Created', format: 'date' }],
  analytics: [],
  notifications: [{ key: 'title', label: 'Notification' }, { key: 'audience', label: 'Audience' }, { key: 'channel', label: 'Channels' }, { key: 'scheduledFor', label: 'Schedule', format: 'date' }, { key: 'sent', label: 'Sent', format: 'number' }, { key: 'delivered', label: 'Delivered', format: 'number' }, { key: 'read', label: 'Read', format: 'number' }, { key: 'failed', label: 'Failed', format: 'number' }, { key: 'status', label: 'Status', format: 'status' }],
  moderation: [{ key: 'priority', label: 'Priority', format: 'status' }, { key: 'type', label: 'Type' }, { key: 'user', label: 'User' }, { key: 'content', label: 'Content' }, { key: 'reason', label: 'Reason' }, { key: 'createdAt', label: 'Created', format: 'date' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'assignedAdmin', label: 'Assigned admin' }],
  security: [{ key: 'severity', label: 'Severity', format: 'status' }, { key: 'event', label: 'Security event' }, { key: 'actor', label: 'Actor' }, { key: 'approximateLocation', label: 'Approximate location' }, { key: 'status', label: 'Status', format: 'status' }, { key: 'occurredAt', label: 'Time', format: 'date' }],
};

function recordsFor(module: AdminModuleKey) {
  if (module === 'farmers') return farmerRecords();
  if (module === 'buyers') return buyerRecords();
  if (module === 'marketplace') return listings.map(item => ({ ...item, status: item.status || (item.available ? 'published' : 'paused'), imageCount: item.image ? 1 : 0, linkedOrders: seedOrders.filter(order => order.listing.id === item.id).length, moderationEvidence: item.verified ? 'Seller identity verified' : 'Seller verification pending' }));
  if (module === 'orders') return seedOrders.map(order => ({ ...order, product: order.listing.title, delivery: order.deliveryMethod, messages: 4, dispute: order.status === 'disputed' ? 'open' : 'none', participantCount: 2, appliedCommissionRule: 'Version retained on order' }));
  if (module === 'payments') return payments;
  if (module === 'commissions') return commissionRules;
  if (module === 'payouts') return payouts;
  if (module === 'market-prices') return marketPrices.map(price => ({ ...price, grade: (price as any).grade || (price.category === 'coffee' ? 'Reference grade' : 'Market grade'), historyEntries: Array.isArray(price.history) ? price.history.length + 1 : 1, effectiveAt: price.observedAt, status: (price as any).status || 'published' }));
  if (module === 'content') return [
    ...articles.map(article => ({ ...article, type: (article as any).type || 'Article', language: (article as any).language || 'English', author: (article as any).author || 'Agricultural content team', status: (article as any).status || 'published', publishedAt: (article as any).publishedAt || '2026-08-12T08:00:00Z' })),
    ...alerts.map(alert => ({ ...alert, type: 'Alert', category: 'Agricultural alert', language: 'English', author: 'Platform operations', status: (alert as any).status || 'published', publishedAt: alert.publishedAt })),
  ];
  if (module === 'ai') return aiSources;
  if (module === 'advertisements') return advertisementCampaigns;
  if (module === 'reports') return reports;
  if (module === 'notifications') return notificationCampaigns;
  if (module === 'moderation') return moderationQueue;
  if (module === 'security') return [
    ...securityEvents,
    ...activeSessions().map(session => ({
      ...session, kind: 'session', severity: 'info', event: 'Active authenticated session',
      actor: users.find(user => user.id === session.userId)?.name || session.userId,
      approximateLocation: 'Location minimised', status: 'active', occurredAt: session.createdAt,
    })),
  ];
  return [];
}

export function adminModuleRecordExists(module: AdminModuleKey, recordId: string) {
  if (module === 'finance' || module === 'analytics') return false;
  return recordsFor(module).some(record => record.id === recordId);
}

function summaryFor(module: AdminModuleKey, records: any[]) {
  const total = records.length;
  if (module === 'farmers') return [{ label: 'Farmers', value: adminStats.farmers }, { label: 'Verified', value: records.filter(item => item.verified).length }, { label: 'Pending verification', value: records.filter(item => !item.verified).length }, { label: 'Seller sales', value: records.reduce((sum, item) => sum + item.sales, 0), format: 'money' }];
  if (module === 'buyers') return [{ label: 'Buyers', value: adminStats.buyers }, { label: 'Active', value: records.filter(item => item.status === 'ACTIVE').length }, { label: 'Verified', value: records.filter(item => item.verified).length }, { label: 'Purchases', value: records.reduce((sum, item) => sum + item.totalPurchases, 0), format: 'money' }];
  if (module === 'marketplace') return [{ label: 'Active listings', value: adminStats.activeListings }, { label: 'Coffee listings', value: records.filter(item => item.category === 'coffee').length }, { label: 'Featured', value: records.filter(item => item.featured).length }, { label: 'Needs review', value: records.filter(item => item.status === 'pending_review').length }];
  if (module === 'orders') return [{ label: 'All orders', value: adminStats.totalOrders }, { label: 'Completed', value: adminStats.completedOrders }, { label: 'Active', value: records.filter(item => !['completed', 'cancelled', 'refunded'].includes(item.status)).length }, { label: 'Order value', value: records.reduce((sum, item) => sum + item.gross, 0), format: 'money' }];
  if (module === 'payments') return [{ label: 'Transactions', value: total }, { label: 'Successful', value: records.filter(item => item.status === 'successful').length }, { label: 'Failed', value: records.filter(item => item.status === 'failed').length }, { label: 'Processed value', value: records.reduce((sum, item) => sum + item.amount, 0), format: 'money' }];
  if (module === 'commissions') return [{ label: 'Active rules', value: records.filter(item => item.status === 'active').length }, { label: 'Default coffee rate', value: 5, format: 'percent' }, { label: 'Commission revenue', value: adminStats.platformRevenue, format: 'money' }, { label: 'Scheduled rules', value: records.filter(item => item.status === 'scheduled').length }];
  if (module === 'payouts') return [{ label: 'Pending payouts', value: adminStats.pendingSettlements, format: 'money' }, { label: 'Review required', value: records.filter(item => item.status === 'review_required').length }, { label: 'Processing', value: records.filter(item => item.status === 'processing').length }, { label: 'Failed', value: records.filter(item => item.status === 'failed').length }];
  if (module === 'market-prices') return [{ label: 'Published prices', value: total }, { label: 'Coffee references', value: records.filter(item => item.category === 'coffee').length }, { label: 'Updated today', value: total }, { label: 'Sources', value: new Set(records.map(item => item.source)).size }];
  if (module === 'content') return [{ label: 'Published content', value: records.filter(item => item.status === 'published').length }, { label: 'Articles', value: records.filter(item => item.type === 'Article').length }, { label: 'Alerts', value: records.filter(item => item.type === 'Alert').length }, { label: 'Needs review', value: records.filter(item => item.status === 'review').length }];
  if (module === 'ai') return [{ label: 'Requests today', value: 642 }, { label: 'Questions answered', value: 614 }, { label: 'Image analyses', value: 88 }, { label: 'Failed responses', value: aiLogs.filter(item => item.responseStatus === 'failed').length }];
  if (module === 'advertisements') return [{ label: 'Active campaigns', value: adminStats.activeAdvertisements }, { label: 'Impressions', value: records.reduce((sum, item) => sum + item.impressions, 0) }, { label: 'Clicks', value: records.reduce((sum, item) => sum + item.clicks, 0) }, { label: 'Ad revenue', value: records.reduce((sum, item) => sum + item.revenue, 0), format: 'money' }];
  if (module === 'reports') return [{ label: 'Open reports', value: records.filter(item => !['resolved', 'dismissed'].includes(item.status)).length }, { label: 'High priority', value: records.filter(item => ['high', 'urgent'].includes(item.priority)).length }, { label: 'Under review', value: records.filter(item => item.status === 'under_review').length }, { label: 'Resolved', value: records.filter(item => item.status === 'resolved').length }];
  if (module === 'notifications') return [{ label: 'Campaigns', value: total }, { label: 'Sent', value: records.reduce((sum, item) => sum + item.sent, 0) }, { label: 'Delivered', value: records.reduce((sum, item) => sum + item.delivered, 0) }, { label: 'Failed', value: records.reduce((sum, item) => sum + item.failed, 0) }];
  if (module === 'moderation') return [{ label: 'Queue', value: total }, { label: 'Urgent / high', value: records.filter(item => ['urgent', 'high'].includes(item.priority)).length }, { label: 'Unassigned', value: records.filter(item => item.assignedAdmin === 'Unassigned').length }, { label: 'Under review', value: records.filter(item => item.status === 'under_review').length }];
  if (module === 'security') return [{ label: 'Admin 2FA', value: 100, format: 'percent' }, { label: 'Active sessions', value: 1 }, { label: 'Failed login alerts', value: records.filter(item => item.event.includes('failed')).length }, { label: 'Open security alerts', value: records.filter(item => !['resolved', 'reviewed'].includes(item.status)).length }];
  return [];
}

const readonlyPanels: Record<'finance' | 'analytics', any> = {
  finance: {
    summary: [
      { label: 'Gross merchandise value', value: adminStats.grossSales, format: 'money' },
      { label: 'Platform revenue', value: adminStats.platformRevenue, format: 'money' },
      { label: 'Seller payouts', value: adminStats.sellerPayouts, format: 'money' },
      { label: 'Refunds', value: adminStats.refunds, format: 'money' },
      { label: 'Payment fees', value: adminStats.paymentFees, format: 'money' },
      { label: 'Net revenue', value: adminStats.netPlatformRevenue, format: 'money' },
    ],
    charts: [
      { id: 'revenue', title: 'Revenue over time', labels: ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'], values: [5100000, 6200000, 5900000, 8100000, 7600000, 9230000], format: 'money' },
      { id: 'category', title: 'Sales by category', labels: ['Coffee', 'Crops', 'Animals', 'Inputs'], values: [68, 17, 9, 6], format: 'percent' },
    ],
    breakdowns: [
      { title: 'Separate financial ledgers', items: [{ label: 'Seller funds', value: adminStats.sellerPayouts }, { label: 'Platform commission', value: adminStats.platformRevenue }, { label: 'Payment provider fees', value: adminStats.paymentFees }, { label: 'Pending settlements', value: adminStats.pendingSettlements }] },
    ],
  },
  analytics: {
    summary: [
      { label: 'Registered users', value: adminStats.users }, { label: 'Active farmers', value: adminStats.farmers },
      { label: 'Active buyers', value: adminStats.buyers }, { label: 'Marketplace conversion', value: 8.4, format: 'percent' },
      { label: 'Coffee listings', value: 148 }, { label: 'Coffee volume', value: 48200, suffix: ' kg' },
    ],
    charts: [
      { id: 'growth', title: 'Farmer and buyer growth', labels: ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'], values: [48, 56, 64, 72, 84, 100], format: 'percent' },
      { id: 'coffee', title: 'Coffee marketplace participation', labels: ['Mukono', 'Mbale', 'Masaka', 'Luwero'], values: [34, 28, 22, 16], format: 'percent' },
    ],
    breakdowns: [
      { title: 'Top marketplace categories', items: [{ label: 'Coffee', value: 148 }, { label: 'Fresh crops', value: 96 }, { label: 'Animals', value: 62 }, { label: 'Inputs', value: 41 }] },
      { title: 'Privacy-safe regional activity', items: [{ label: 'Central Region', value: 46 }, { label: 'Eastern Region', value: 24 }, { label: 'Western Region', value: 18 }, { label: 'Northern Region', value: 12 }] },
    ],
  },
};

const createActions: Partial<Record<AdminModuleKey, AdminAction[]>> = {
  'market-prices': [{ id: 'create_price', label: 'Add market price', tone: 'primary' }],
  content: [{ id: 'create_article', label: 'Publish article', tone: 'primary' }],
  advertisements: [{ id: 'create_advertisement', label: 'Create advertisement', tone: 'primary' }],
  notifications: [{ id: 'create_notification', label: 'Send notification', tone: 'primary' }],
  commissions: [{ id: 'create_commission', label: 'New commission version', tone: 'primary', stepUp: true }],
};

export function getAdminModule(module: AdminModuleKey, input: { q?: string; status?: string; readState?: 'ALL' | 'READ' | 'UNREAD'; cursor?: number; limit?: number }, viewerAdminId?: string) {
  if (module === 'finance') {
    const methodTotals = new Map<string, { label: string; value: number }>();
    for (const payment of payments.filter(record => record.status === 'successful')) {
      const current = methodTotals.get(payment.paymentMethodId) || { label: `${payment.method} · ${payment.paymentMethodId}`, value: 0 };
      current.value += payment.amount; methodTotals.set(payment.paymentMethodId, current);
    }
    return { module, ...readonlyPanels.finance, breakdowns: [...readonlyPanels.finance.breakdowns, { title: 'Successful value by payment method snapshot', items: [...methodTotals.values()] }], records: [], columns: [], createActions: [], page: { nextCursor: null, hasMore: false }, meta: { total: payments.length } };
  }
  if (module === 'analytics') return { module, ...readonlyPanels.analytics, records: [], columns: [], createActions: [], page: { nextCursor: null, hasMore: false }, meta: { total: 0 } };
  const moduleRecords = recordsFor(module);
  const moduleUnreadCount = viewerAdminId ? moduleRecords.filter(record => !adminRecordReadAt(viewerAdminId, module, record.id)).length : 0;
  let records = moduleRecords;
  const term = input.q?.trim().toLowerCase();
  if (term) records = records.filter(record => JSON.stringify(record).toLowerCase().includes(term));
  if (input.status && input.status !== 'ALL') records = records.filter(record => String(record.status || record.verification).toLowerCase() === input.status!.toLowerCase());
  const withReadState = records.map(record => {
    const readAt = viewerAdminId ? adminRecordReadAt(viewerAdminId, module, record.id) : null;
    return { ...record, readAt, unread: viewerAdminId ? !readAt : false };
  });
  records = input.readState === 'READ' ? withReadState.filter(record => !record.unread) : input.readState === 'UNREAD' ? withReadState.filter(record => record.unread) : withReadState;
  const cursor = input.cursor || 0;
  const limit = Math.min(input.limit || 25, 100);
  const page = withActions(module, records.slice(cursor, cursor + limit));
  return {
    module, summary: summaryFor(module, recordsFor(module)), columns: columns[module], records: page,
    createActions: createActions[module] || [], charts: module === 'ai'
      ? [{ id: 'ai_modes', title: 'AI requests by mode', labels: ['Text', 'Image', 'Voice'], values: [71, 18, 11], format: 'percent' }]
      : module === 'market-prices'
        ? [{ id: 'price_history', title: 'Robusta reference price history', labels: ['May', 'Jun', 'Jul', 'Aug'], values: [6800, 7000, 7150, 7400], format: 'money' }]
        : [],
    secondaryRecords: module === 'ai'
      ? { title: 'Privacy-safe AI operations log', columns: [{ key: 'question', label: 'Question' }, { key: 'language', label: 'Language' }, { key: 'userType', label: 'User type' }, { key: 'mode', label: 'Mode' }, { key: 'responseStatus', label: 'Status' }, { key: 'responseTimeMs', label: 'Response time' }], records: aiLogs }
      : module === 'security'
        ? { title: 'Enforced administrator security policy', columns: [{ key: 'control', label: 'Control' }, { key: 'value', label: 'Policy' }, { key: 'status', label: 'Status' }], records: [
          { id: 'pol_mfa', control: 'Administrator 2FA', value: 'Mandatory authenticator factor', status: 'enforced' },
          { id: 'pol_lockout', control: 'Login lockout', value: '8 attempts / 10 minutes', status: 'enforced' },
          { id: 'pol_session', control: 'Session maximum age', value: '7 days; revocable', status: 'enforced' },
          { id: 'pol_password', control: 'Password baseline', value: '10+ characters, uppercase and number', status: 'enforced' },
        ] }
        : null,
    page: { nextCursor: cursor + page.length < records.length ? cursor + page.length : null, hasMore: cursor + page.length < records.length },
    meta: { total: records.length, moduleTotal: moduleRecords.length, unreadCount: moduleUnreadCount, statuses: [...new Set(moduleRecords.map(record => record.status || record.verification).filter(Boolean))] },
  };
}

export function adminAttentionCounts() {
  return {
    farmers: users.filter(user => user.role === 'FARMER_SELLER' && !user.verified).length,
    payouts: payouts.filter(item => ['review_required', 'failed'].includes(item.status)).length,
    reports: reports.filter(item => !['resolved', 'dismissed'].includes(item.status)).length,
    moderation: moderationQueue.filter(item => item.status !== 'resolved').length,
    payments: payments.filter(item => item.status === 'failed').length,
  };
}

export function createAdminModuleRecord(module: AdminModuleKey, input: Record<string, any>) {
  const now = new Date().toISOString();
  if (module === 'market-prices') {
    const record = { id: `price_${randomUUID().slice(0, 8)}`, product: input.title, category: input.category || 'coffee', grade: input.grade || 'Reference grade', location: input.location || 'Uganda', amount: Number(input.amount), unit: input.unit || 'kg', currency: 'UGX', source: input.source || 'Administrator publication', observedAt: input.effectiveAt || now, freshness: 'Updated now', trend: 'stable', history: [], status: input.status || 'published' };
    marketPrices.unshift(record as any); return record;
  }
  if (module === 'content') {
    const record = { id: `content_${randomUUID().slice(0, 8)}`, slug: String(input.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), title: input.title, excerpt: input.description, body: input.description, type: input.type || 'Article', category: input.category || 'Coffee', language: input.language || 'English', author: 'Agricultural content team', status: input.scheduledFor ? 'scheduled' : input.status || 'draft', scheduledFor: input.scheduledFor || null, publishedAt: input.status === 'published' && !input.scheduledFor ? now : null };
    (articles as any).unshift(record); return record;
  }
  if (module === 'advertisements') {
    const record = { id: `ad_${randomUUID().slice(0, 8)}`, campaign: input.title, title: input.title, advertiser: input.advertiser || 'Platform campaign', sponsor: input.advertiser || 'Platform campaign', type: input.type || 'Homepage advertisement', budget: Number(input.amount || 0), start: input.start || now.slice(0, 10), end: input.end || null, impressions: 0, clicks: 0, conversions: 0, ctr: 0, revenue: 0, status: input.status || 'pending_review' };
    advertisementCampaigns.unshift(record as any); return record;
  }
  if (module === 'notifications') {
    const record = { id: `camp_${randomUUID().slice(0, 8)}`, title: input.title, message: input.description || '', audience: input.audience || 'All users', channel: input.channel || 'In-app', scheduledFor: input.scheduledFor || now, sent: 0, delivered: 0, read: 0, failed: 0, status: input.status || 'scheduled' };
    notificationCampaigns.unshift(record as any); return record;
  }
  if (module === 'commissions') {
    const existing = commissionRules.filter(rule => rule.category.toLowerCase() === String(input.title).toLowerCase());
    const record = { id: `com_${randomUUID().slice(0, 8)}`, category: input.title, rateBasisPoints: Math.round(Number(input.amount) * 100), rate: Number(input.amount), scope: input.scope || 'Category', seller: input.seller || 'All sellers', amountBand: input.amountBand || 'All amounts', campaign: input.campaign || 'Standard', version: Math.max(0, ...existing.map(rule => rule.version)) + 1, effectiveFrom: input.effectiveAt || now.slice(0, 10), effectiveTo: null, status: 'scheduled' };
    commissionRules.push(record as any); return record;
  }
  return null;
}

export function performAdminModuleAction(module: AdminModuleKey, id: string, action: string, reason?: string) {
  const record = recordsFor(module).find(item => item.id === id || item.reference === id);
  if (!record) return { error: 'NOT_FOUND' as const };
  if (!statusActions(module, record).some(candidate => candidate.id === action)) return { error: 'UNSUPPORTED_ACTION' as const };
  const before = structuredClone(record);
  if (module === 'farmers' || module === 'buyers') {
    const user = users.find(item => item.id === id)!;
    if (action === 'verify') user.verified = true;
    if (action === 'suspend') user.status = 'SUSPENDED';
    if (action === 'activate') user.status = 'ACTIVE';
    if (action === 'reject') { user.verified = false; user.status = 'SUSPENDED'; }
  } else if (module === 'marketplace') {
    const item = listings.find(listing => listing.id === id)!;
    if (action === 'approve') { item.status = 'published'; item.available = true; }
    if (action === 'request_changes') { item.status = 'changes_requested'; item.available = false; }
    if (action === 'suspend') { item.status = 'paused'; item.available = false; }
    if (action === 'feature') item.featured = true;
    if (action === 'unfeature') item.featured = false;
  } else if (module === 'orders') {
    const order = seedOrders.find(item => item.id === id)!;
    if (action === 'open_dispute') order.status = 'disputed';
    if (action === 'request_cancellation') { order.status = 'cancellation_review'; orderAdjustments.push({ id: `oadj_${randomUUID().slice(0, 8)}`, orderId: order.id, type: 'cancellation_request', amount: 0, reason: reason || 'Administrator cancellation review', status: 'pending', createdAt: new Date().toISOString() }); }
    if (action === 'request_refund') { order.status = 'refund_review'; orderAdjustments.push({ id: `oadj_${randomUUID().slice(0, 8)}`, orderId: order.id, type: 'refund_request', amount: order.buyerTotal, reason: reason || 'Administrator refund review', status: 'provider_review', createdAt: new Date().toISOString() }); }
  } else if (module === 'payments') {
    const payment = payments.find(item => item.id === id)!;
    if (action === 'investigate') payment.investigation = reason || 'Under administrator review';
    if (action === 'retry' && payment.status === 'failed') payment.status = 'processing';
    if (action === 'request_refund' && payment.status === 'successful') {
      const adjustment = { id: `adj_${randomUUID().slice(0, 8)}`, paymentId: payment.id, type: 'refund_request' as const, amount: payment.amount, reason: reason || 'Administrator refund request', status: 'provider_review', createdAt: new Date().toISOString() };
      paymentAdjustments.push(adjustment); payment.investigation = `Refund adjustment ${adjustment.id} awaiting provider review`;
    }
  } else if (module === 'commissions') {
    const rule = commissionRules.find(item => item.id === id)!;
    if (action === 'archive') rule.status = 'archived';
    if (action === 'clone') commissionRules.push({ ...rule, id: `com_${randomUUID().slice(0, 8)}`, version: rule.version + 1, status: 'scheduled', effectiveFrom: new Date().toISOString().slice(0, 10) });
  } else if (module === 'payouts') {
    const payout = payouts.find(item => item.id === id)!;
    if (action === 'approve') payout.status = 'processing';
    if (action === 'hold') payout.status = 'held';
    if (action === 'retry' && payout.status === 'failed') payout.status = 'processing';
    if (action === 'release' && payout.status === 'held') payout.status = 'review_required';
  } else if (module === 'market-prices') {
    const price = marketPrices.find(item => item.id === id)! as any;
    if (action === 'archive') price.status = 'archived';
    if (action === 'publish_new') marketPrices.unshift({ ...price, id: `price_${randomUUID().slice(0, 8)}`, observedAt: new Date().toISOString(), freshness: 'Updated now', status: 'published' } as any);
  } else if (module === 'content') {
    const source = [...articles, ...alerts].find(item => item.id === id) as any;
    if (source) source.status = action === 'archive' ? 'archived' : action === 'publish' ? 'published' : source.status;
  } else if (module === 'ai') {
    const source = aiSources.find(item => item.id === id)!;
    if (action === 'disable') source.status = 'disabled';
    if (action === 'enable') source.status = 'active';
  } else if (module === 'advertisements') {
    const advertisement = advertisementCampaigns.find(item => item.id === id)!;
    if (action === 'approve') advertisement.status = 'active';
    if (action === 'pause') advertisement.status = 'paused';
    if (action === 'resume') advertisement.status = 'active';
    if (action === 'remove') advertisement.status = 'removed';
  } else if (module === 'reports') {
    const report = reports.find(item => item.id === id)!;
    if (action === 'assign') { report.assignedTo = 'Current administrator'; report.status = 'under_review'; }
    if (action === 'investigate') report.status = 'under_review';
    if (action === 'resolve') report.status = 'resolved';
    if (action === 'dismiss') report.status = 'dismissed';
    if (action === 'escalate') { report.status = 'escalated'; report.priority = 'urgent'; }
  } else if (module === 'notifications') {
    const campaign = notificationCampaigns.find(item => item.id === id)!;
    if (action === 'send_now') { campaign.status = 'sent'; campaign.sent = adminStats.users; campaign.delivered = Math.floor(adminStats.users * .97); }
    if (action === 'cancel') campaign.status = 'cancelled';
  } else if (module === 'moderation') {
    const item = moderationQueue.find(record => record.id === id)!;
    if (action === 'assign') { item.assignedAdmin = 'Current administrator'; item.status = 'under_review'; }
    if (action === 'approve') item.status = 'approved';
    if (action === 'request_changes') item.status = 'changes_requested';
    if (action === 'reject') item.status = 'rejected';
    if (action === 'remove') item.status = 'removed';
    if (action === 'suspend') item.status = 'account_suspension_requested';
    if (action === 'escalate') { item.status = 'escalated'; item.priority = 'urgent'; }
  } else if (module === 'security') {
    if (action === 'revoke') revokeSessionById(id);
    else {
      const event = securityEvents.find(item => item.id === id)!;
      if (action === 'review') event.status = 'investigating';
      if (action === 'resolve') event.status = 'resolved';
    }
  }
  const after = recordsFor(module).find(item => item.id === id || item.reference === id) || record;
  return { before, after, message: `${action.replaceAll('_', ' ')} completed.` };
}

export function adminGlobalSearch(query: string) {
  const term = query.toLowerCase();
  const groups = [
    { type: 'User', route: '/admin/users', items: users.map(user => ({ id: user.id, title: user.name, subtitle: `${user.role} · ${user.phone}` })) },
    { type: 'Product', route: '/admin/marketplace', items: listings.map(item => ({ id: item.id, title: item.title, subtitle: `${item.seller} · ${item.location}` })) },
    { type: 'Order', route: '/admin/orders', items: seedOrders.map(item => ({ id: item.id, title: item.reference, subtitle: `${item.listing.title} · ${item.buyerName}` })) },
    { type: 'Payment', route: '/admin/payments', items: payments.map(item => ({ id: item.id, title: item.reference, subtitle: `${item.orderId} · ${item.status}` })) },
    { type: 'Report', route: '/admin/reports', items: reports.map(item => ({ id: item.id, title: item.subject, subtitle: `${item.type} · ${item.status}` })) },
    { type: 'Advertisement', route: '/admin/advertisements', items: advertisementCampaigns.map(item => ({ id: item.id, title: item.campaign, subtitle: `${item.advertiser} · ${item.status}` })) },
    { type: 'Market price', route: '/admin/market-prices', items: marketPrices.map(item => ({ id: item.id, title: item.product, subtitle: `${item.location} · UGX ${item.amount}/${item.unit}` })) },
  ];
  return groups.map(group => ({ ...group, items: group.items.filter(item => `${item.id} ${item.title} ${item.subtitle}`.toLowerCase().includes(term)).slice(0, 5) })).filter(group => group.items.length > 0);
}
