import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const ROLES = ['ADMIN', 'FARMER_SELLER', 'BUYER'] as const;
export type Role = typeof ROLES[number];
export type UserStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'DELETED';

export type AuthUserRecord = {
  id: string;
  name: string;
  firstName: string;
  phone: string;
  email: string | null;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  verified: boolean;
  phoneVerified: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  location: string;
  district: string;
  avatar: string;
  joinedAt: string;
  lastActiveAt: string;
};

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  ADMIN: [
    'admin.dashboard.read', 'users.read', 'users.status.change', 'users.role.change',
    'farmers.verify', 'marketplace.moderate', 'orders.read.all', 'payments.read',
    'commissions.manage', 'payouts.manage', 'finance.read', 'payment-methods.manage', 'content.manage',
    'market_prices.manage', 'ai.manage', 'advertisements.manage', 'reports.manage',
    'analytics.read', 'notifications.manage', 'languages.manage', 'settings.manage',
    'security.manage', 'audit.read',
  ],
  FARMER_SELLER: [
    'marketplace.read', 'listings.create', 'listings.read.own', 'listings.update.own',
    'listings.delete.own', 'orders.read.seller', 'orders.fulfil.own', 'earnings.read.own',
    'messages.manage.own', 'notifications.read.own', 'ai.agriculture.use',
    'profile.update.own', 'farm.manage.own',
  ],
  BUYER: [
    'marketplace.read', 'orders.create', 'orders.read.buyer', 'saved.manage.own',
    'messages.manage.own', 'notifications.read.own', 'reviews.create.completed',
    'buyer_requests.manage.own', 'profile.update.own',
  ],
};

function developmentPassword(role: Role) {
  if (process.env.NODE_ENV === 'production') return randomBytes(32).toString('base64url');
  if (role === 'ADMIN') return process.env.DEV_ADMIN_PASSWORD || 'AdminDemo!2026';
  if (role === 'FARMER_SELLER') return process.env.DEV_FARMER_PASSWORD || 'FarmerDemo!2026';
  return process.env.DEV_BUYER_PASSWORD || 'BuyerDemo!2026';
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, expectedBase64] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedBase64) return false;
  const expected = Buffer.from(expectedBase64, 'base64url');
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const users: AuthUserRecord[] = [
  {
    id: 'usr_admin_demo', name: 'Amina Nansubuga', firstName: 'Amina',
    phone: '+256700000001', email: 'admin@harvestlink.ug', passwordHash: hashPassword(developmentPassword('ADMIN')),
    role: 'ADMIN', status: 'ACTIVE', verified: true, phoneVerified: true, emailVerified: true,
    twoFactorEnabled: true, location: 'Kampala, Central Region', district: 'Kampala', avatar: 'AN',
    joinedAt: '2026-01-12T08:00:00Z', lastActiveAt: '2026-08-16T08:22:00Z',
  },
  {
    id: 'usr_farmer_demo', name: 'Sarah Nakato', firstName: 'Sarah',
    phone: '+256700111222', email: 'sarah@example.ug', passwordHash: hashPassword(developmentPassword('FARMER_SELLER')),
    role: 'FARMER_SELLER', status: 'ACTIVE', verified: true, phoneVerified: true, emailVerified: false,
    twoFactorEnabled: false, location: 'Mukono, Central Region', district: 'Mukono', avatar: 'SN',
    joinedAt: '2026-03-08T09:30:00Z', lastActiveAt: '2026-08-16T08:15:00Z',
  },
  {
    id: 'usr_buyer_demo', name: 'Daniel Okello', firstName: 'Daniel',
    phone: '+256700333444', email: 'daniel@okellofoods.ug', passwordHash: hashPassword(developmentPassword('BUYER')),
    role: 'BUYER', status: 'ACTIVE', verified: true, phoneVerified: true, emailVerified: true,
    twoFactorEnabled: false, location: 'Kampala, Central Region', district: 'Kampala', avatar: 'DO',
    joinedAt: '2026-04-22T11:10:00Z', lastActiveAt: '2026-08-16T07:58:00Z',
  },
  {
    id: 'usr_001', name: 'Musa Kato', firstName: 'Musa', phone: '+256701000001', email: null,
    passwordHash: hashPassword(randomBytes(32).toString('base64url')), role: 'FARMER_SELLER', status: 'ACTIVE',
    verified: true, phoneVerified: true, emailVerified: false, twoFactorEnabled: false,
    location: 'Mukono, Central Region', district: 'Mukono', avatar: 'MK', joinedAt: '2026-02-10T09:00:00Z', lastActiveAt: '2026-08-16T07:20:00Z',
  },
  {
    id: 'usr_002', name: 'Nabumali Coffee Group', firstName: 'Nabumali', phone: '+256701000002', email: 'hello@nabumali.ug',
    passwordHash: hashPassword(randomBytes(32).toString('base64url')), role: 'FARMER_SELLER', status: 'ACTIVE',
    verified: true, phoneVerified: true, emailVerified: true, twoFactorEnabled: false,
    location: 'Mbale, Eastern Region', district: 'Mbale', avatar: 'NC', joinedAt: '2026-02-18T09:00:00Z', lastActiveAt: '2026-08-16T06:40:00Z',
  },
  {
    id: 'usr_farmer_pending', name: 'Maria Nakyewa', firstName: 'Maria', phone: '+256701000008', email: 'maria.pending@example.ug',
    passwordHash: hashPassword(randomBytes(32).toString('base64url')), role: 'FARMER_SELLER', status: 'ACTIVE',
    verified: false, phoneVerified: true, emailVerified: false, twoFactorEnabled: false,
    location: 'Masaka, Central Region', district: 'Masaka', avatar: 'MN', joinedAt: '2026-08-15T09:00:00Z', lastActiveAt: '2026-08-16T06:12:00Z',
  },
  {
    id: 'usr_buyer_002', name: 'Lake Victoria Coffee Exports', firstName: 'Lake Victoria', phone: '+256702000001', email: 'trade@lvcoffee.ug',
    passwordHash: hashPassword(randomBytes(32).toString('base64url')), role: 'BUYER', status: 'ACTIVE',
    verified: true, phoneVerified: true, emailVerified: true, twoFactorEnabled: true,
    location: 'Kampala, Central Region', district: 'Kampala', avatar: 'LV', joinedAt: '2026-02-22T09:00:00Z', lastActiveAt: '2026-08-16T08:00:00Z',
  },
];

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgentHash: string;
};

const sessions = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');

export function createSession(userId: string, userAgent = '') {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = digest(rawToken);
  const now = Date.now();
  const session: SessionRecord = {
    id: randomUUID(), userId, tokenHash, csrfToken: randomBytes(24).toString('base64url'),
    createdAt: now, expiresAt: now + SESSION_TTL_MS, lastSeenAt: now, userAgentHash: digest(userAgent),
  };
  sessions.set(tokenHash, session);
  return { rawToken, session };
}

export function findSession(rawToken?: string) {
  if (!rawToken) return null;
  const tokenHash = digest(rawToken);
  const session = sessions.get(tokenHash);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash);
    return null;
  }
  session.lastSeenAt = Date.now();
  const user = users.find(item => item.id === session.userId);
  if (!user || user.status !== 'ACTIVE') return null;
  return { session, user };
}

export function revokeSession(rawToken?: string) {
  if (rawToken) sessions.delete(digest(rawToken));
}

export function activeSessions() {
  const now = Date.now();
  return [...sessions.values()].filter(session => session.expiresAt > now).map(session => ({
    id: session.id, userId: session.userId, createdAt: new Date(session.createdAt).toISOString(),
    lastSeenAt: new Date(session.lastSeenAt).toISOString(), expiresAt: new Date(session.expiresAt).toISOString(),
    deviceFingerprint: session.userAgentHash.slice(0, 12),
  }));
}

export function revokeSessionById(id: string) {
  const entry = [...sessions.entries()].find(([, session]) => session.id === id);
  if (!entry) return false;
  sessions.delete(entry[0]);
  return true;
}

export function permissionsFor(role: Role) { return [...ROLE_PERMISSIONS[role]]; }
export function roleHasPermission(role: Role, permission: string) { return ROLE_PERMISSIONS[role].includes(permission); }
export function isRole(value: unknown): value is Role { return typeof value === 'string' && ROLES.includes(value as Role); }

export function publicUser(user: AuthUserRecord) {
  return {
    id: user.id, name: user.name, firstName: user.firstName, phone: user.phone,
    email: user.email, role: user.role, status: user.status, verified: user.verified,
    phoneVerified: user.phoneVerified, emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled, location: user.location, district: user.district,
    avatar: user.avatar, permissions: permissionsFor(user.role),
  };
}

export function registerUser(input: { name: string; phone: string; email?: string; password: string; role: 'FARMER_SELLER' | 'BUYER'; location: string }) {
  const user: AuthUserRecord = {
    id: `usr_${randomUUID().slice(0, 12)}`, name: input.name.trim(), firstName: input.name.trim().split(/\s+/)[0],
    phone: input.phone, email: input.email?.trim().toLowerCase() || null, passwordHash: hashPassword(input.password),
    role: input.role, status: 'ACTIVE', verified: false, phoneVerified: false, emailVerified: false,
    twoFactorEnabled: false, location: input.location, district: input.location.split(',')[0].trim(),
    avatar: input.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(),
    joinedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
  };
  users.push(user);
  return user;
}

export type AuditEvent = {
  id: string; actorId: string; action: string; targetType: string; targetId: string;
  before: unknown; after: unknown; reason: string | null; occurredAt: string;
  result: 'success' | 'denied' | 'failed'; sessionContext: { sessionId: string; deviceFingerprint: string } | null;
};
export const auditEvents: AuditEvent[] = [];
type AuditInput = Omit<AuditEvent, 'id' | 'occurredAt' | 'result' | 'sessionContext'> & Partial<Pick<AuditEvent, 'result' | 'sessionContext'>>;
export function audit(event: AuditInput) {
  auditEvents.unshift({ id: `aud_${randomUUID().slice(0, 12)}`, occurredAt: new Date().toISOString(), result: event.result || 'success', sessionContext: event.sessionContext || null, ...event });
}
