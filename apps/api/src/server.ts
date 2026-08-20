import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { calculateFees } from './money.mjs';
import {
  ROLES, audit, auditEvents, createSession, findSession, isRole, permissionsFor, publicUser,
  registerUser, revokeSession, roleHasPermission, users, verifyPassword, type AuthUserRecord, type Role,
} from './auth.js';
import { canDeleteListing, canModifyListing, canViewOrder, dashboardForRole } from './policies.js';
import { publicTranslationBundle, translationEntries, translationVersion, updateTranslationEntry } from './translations.js';
import {
  settings, categories, listings, marketPrices, buyerRequests, articles, alerts, advertisements,
  notificationsByRole, adminStats, roleProfiles, seedOrders, farmerEarnings, buyerSavedListingIds,
} from './data.js';
import {
  adminAttentionCounts, adminGlobalSearch, adminModulePermissions, adminModuleRecordExists, createAdminModuleRecord, getAdminModule,
  performAdminModuleAction, recordVerifiedPayment, resolveCommissionRule, type AdminModuleKey,
} from './admin-operations.js';
import { hydrateAdminRecordViews, markAdminRecordRead, markAdminRecordsRead, markAdminRecordUnread } from './admin-record-views.js';
import {
  accountNotifications, closeBuyerRequest, createBuyerRequest, createContextConversation, decideBuyerResponse,
  hydrateEngagement, listBuyerRequests, listConversations, listMessages, listOwnedBuyerRequests, markAllNotifications,
  markConversationRead, markNotification, notify, respondToBuyerRequest, sendMessage, withdrawBuyerResponse,
} from './farmer-engagement.js';
import { buildAdminExport } from './admin-export.js';
import { databaseReady, deleteDraftFromDatabase, hydrateDrafts, hydrateListings, hydrateOrders, hydrateRuntimeSettings, hydrateUsers, persistDraft, persistListing, persistOrder, persistRuntimeSetting, persistTranslationEntry, persistUser, query } from './db.js';
import {
  FARMER_CATEGORIES, attachMediaToListing, consumeFarmerDraft, createFarmerReview, createLedgerEntryFromOrder, deleteFarmerDraft, deleteListingMedia,
  farmerDrafts, farmerLedger, farmerPortfolio, findFarmerDraft, findMedia, hydrateFarmerFinance, hydrateFarmerMedia, mediaOwnedAndReady, newListingDraft, restoreFarmerDraft,
  payoutMethodsForFarmer, publicDraft, quoteWithdrawal, requestWithdrawal, reviewsForFarmer, saveListingMedia, syncListingMedia, updateFarmerDraft,
} from './farmer-commerce.js';
import {
  adminPaymentMethods, createPaymentMethod, findPaymentMethod, hydratePaymentMethods, paymentMethodAuditView, publicPaymentMethods,
  removePaymentMethod, setDefaultPaymentMethod, setPaymentMethodEnabled, testPaymentMethodConnection,
  updatePaymentMethod, type PaymentMethodInput,
} from './payment-methods.js';

// Production never presents repository demo records as real marketplace data.
if (process.env.NODE_ENV === 'production') {
  listings.splice(0, listings.length);
  seedOrders.splice(0, seedOrders.length);
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 1_000_000 });
const port = Number(process.env.API_PORT || 8787);
const listingViewers = new Map<string, Set<string>>();

await hydrateRuntimeSettings(settings).catch(error => app.log.warn({ err: error }, 'Database settings unavailable; using development defaults'));
await hydrateUsers(users).catch(error => app.log.warn({ err: error }, 'Database identities unavailable; using development accounts'));
await hydrateEngagement().catch(error => app.log.warn({ err: error }, 'Database engagement unavailable; using development defaults'));
await hydrateAdminRecordViews().catch(error => app.log.warn({ err: error }, 'Database admin read state unavailable; using empty read state'));
await hydrateFarmerMedia().catch(error => app.log.warn({ err: error }, 'Database media unavailable; using empty media state'));
await hydrateFarmerFinance().catch(error => app.log.warn({ err: error }, 'Database farmer finance unavailable; using seed ledger defaults'));
await hydratePaymentMethods().catch(error => app.log.warn({ err: error }, 'Database payment methods unavailable; using configured defaults'));
if (process.env.NODE_ENV !== 'production') await Promise.all(users.map(user => persistUser(user))).catch(error => app.log.warn({ err: error }, 'Development identity seed unavailable'));
await hydrateDrafts().then(rows => rows.forEach(row => restoreFarmerDraft({
  id: row.id, ownerId: row.owner_id, status: 'draft', version: row.version, currentStep: row.current_step, title: row.title, category: row.category,
  crop: row.crop, coffeeType: row.coffee_type, process: row.process, grade: row.grade, description: row.description, harvestDate: row.harvest_date_text,
  productionMethod: row.production_method, quantity: Number(row.quantity), unit: row.unit, price: Number(row.unit_price_ugx), pricingMode: row.pricing_mode,
  minimumAcceptablePrice: row.minimum_acceptable_price_ugx === null ? null : Number(row.minimum_acceptable_price_ugx), district: row.district,
  subRegion: row.sub_region || '', approximateLocation: row.approximate_location, imageIds: row.image_ids || [], createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
}))).catch(error => app.log.warn({ err: error }, 'Database drafts unavailable; starting with empty drafts'));
await hydrateListings().then(rows => rows.forEach(row => {
  if (listings.some(item => item.id === row.id)) return;
  const seller = users.find(item => item.id === row.seller_id);
  listings.push({ id: row.id, sellerId: row.seller_id, seller: seller?.name || row.seller_id, sellerInitials: seller?.avatar || 'AP', verified: seller?.verified || false,
    trusted: false, title: row.title, category: row.category, crop: row.crop, coffeeType: row.coffee_type, process: row.process, grade: row.grade,
    description: row.description, quantity: Number(row.available_quantity), unit: row.unit, price: Number(row.unit_price_ugx), currency: 'UGX',
    negotiable: row.pricing_mode === 'negotiable', minimumAcceptablePrice: row.minimum_acceptable_price_ugx === null ? null : Number(row.minimum_acceptable_price_ugx),
    location: row.approximate_location, district: row.district, subRegion: row.sub_region, distance: 'Online', image: null, images: [], featured: false,
    postedAt: new Date(row.created_at).toLocaleDateString('en-UG'), createdAt: new Date(row.created_at).toISOString(), harvestDate: row.harvest_date_text || 'Available now',
    productionMethod: row.production_method, rating: 0, reviews: 0, delivery: ['Pickup'], moisture: null, available: row.status === 'published' && Number(row.available_quantity) > 0,
    status: row.status, views: Number(row.view_count || 0), interestedBuyers: Number(row.interested_buyer_count || 0), placeholder: row.category === 'coffee' ? '☕' : '🌱', color: '#557a61' } as any);
})).catch(error => app.log.warn({ err: error }, 'Database listings unavailable; starting with seed listings'));
const persistedOrders = await hydrateOrders().catch(error => { app.log.warn({ err: error }, 'Database orders unavailable; starting with seed orders'); return []; });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(multipart, { limits: { files: 1, fileSize: 1_500_000, fields: 4, parts: 5 } });
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

app.addHook('onRequest', async (request: any, reply) => {
  const requestId = request.id || randomUUID();
  reply.header('x-request-id', requestId);
  request.auth = findSession(request.cookies?.agri_session);
  if (request.url.startsWith('/api/v1/orders') || request.url.includes('payment') || request.url.startsWith('/api/v1/admin') || request.url.startsWith('/api/v1/farmer')) {
    reply.header('cache-control', 'private, no-store');
  }
});

function problem(reply: any, status: number, code: string, title: string, errors?: unknown) {
  return reply.status(status).type('application/problem+json').send({
    type: `https://docs.example/errors/${code.toLowerCase()}`,
    title, status, code, errors, traceId: reply.getHeader('x-request-id'),
  });
}

function normalizeUgandaPhone(value: string) {
  const phone = value.trim().replace(/[\s()-]/g, '');
  if (phone.startsWith('+256')) return phone;
  if (phone.startsWith('256')) return `+${phone}`;
  if (phone.startsWith('0')) return `+256${phone.slice(1)}`;
  if (phone.startsWith('7') || phone.startsWith('3')) return `+256${phone}`;
  return phone;
}

app.addHook('preHandler', async (request: any, reply) => {
  const commercePath = request.url.startsWith('/api/v1/farmer') || request.url.startsWith('/api/v1/profile') || request.url.startsWith('/api/v1/orders') || request.url.startsWith('/api/v1/listings') || request.url.startsWith('/api/v1/media/listings') || request.url.startsWith('/api/v1/payments/sandbox') || request.url.startsWith('/api/v1/buyer-requests') || request.url.startsWith('/api/v1/conversations') || request.url.startsWith('/api/v1/notifications');
  if (process.env.NODE_ENV === 'production' && commercePath) return problem(reply, 503, 'FARMER_COMMERCE_REPOSITORY_NOT_DEPLOYED', 'Farmer commerce is unavailable until the PostgreSQL, object-storage and provider adapters are deployed and validated.');
  if (process.env.NODE_ENV === 'production' && request.url.startsWith('/api/v1/ai')) return problem(reply, 503, 'AGRICULTURAL_AI_PROVIDER_NOT_DEPLOYED', 'Agricultural AI is unavailable until a production model, safety and persistence boundary is deployed and validated.');
});

function publicListing(item: any) {
  const { id, sellerId, seller, sellerInitials, verified, trusted, title, category, coffeeType, process, grade,
    description, quantity, unit, price, currency, negotiable, location, distance, image, featured, postedAt,
    harvestDate, rating, reviews, delivery, moisture, available, placeholder, color, crop, images, productionMethod, minimumAcceptablePrice, status, createdAt } = item;
  return { id, sellerId, seller, sellerInitials, verified, trusted, title, category, crop, coffeeType, process, grade,
    description, quantity, unit, price, currency, negotiable, minimumAcceptablePrice, location, distance, image, images, featured, postedAt,
    harvestDate, productionMethod, rating, reviews, delivery, moisture, available, status, createdAt, placeholder, color };
}

const isEmbeddedDevelopmentPreview = process.env.E2B_SANDBOX === 'true';
const sessionCookie: any = {
  path: '/', httpOnly: true,
  sameSite: isEmbeddedDevelopmentPreview ? 'none' : 'strict',
  secure: process.env.NODE_ENV === 'production' || isEmbeddedDevelopmentPreview,
  partitioned: isEmbeddedDevelopmentPreview || undefined,
  maxAge: 7 * 24 * 60 * 60,
};

async function requireAuth(request: any, reply: any) {
  if (!request.auth) return problem(reply, 401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');
  if (request.auth.user.status !== 'ACTIVE') return problem(reply, 403, 'ACCOUNT_UNAVAILABLE', 'This account is not currently active.');
}

function requireRole(...roles: Role[]) {
  return async (request: any, reply: any) => {
    if (!request.auth) return problem(reply, 401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');
    if (!roles.includes(request.auth.user.role)) return problem(reply, 403, 'ROLE_FORBIDDEN', 'Your account role cannot perform this action.');
  };
}

function requirePermission(permission: string) {
  return async (request: any, reply: any) => {
    if (!request.auth) return problem(reply, 401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');
    if (!roleHasPermission(request.auth.user.role, permission)) return problem(reply, 403, 'PERMISSION_FORBIDDEN', 'You do not have the required permission.');
  };
}

async function requireCsrf(request: any, reply: any) {
  if (!request.auth) return problem(reply, 401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');
  const supplied = request.headers['x-csrf-token'];
  if (typeof supplied !== 'string' || supplied !== request.auth.session.csrfToken) {
    return problem(reply, 403, 'CSRF_FAILED', 'The security token is missing or expired. Refresh and try again.');
  }
}

function roleUser(user: AuthUserRecord) {
  return { ...publicUser(user), ...(roleProfiles[user.id] || {}), redirectTo: dashboardForRole(user.role) };
}

app.get('/health', async () => ({ status: 'ok', service: 'agri-api', database: await databaseReady(), time: new Date().toISOString() }));

app.get('/api/v1/public/manifest.webmanifest', async (_request: any, reply) => {
  reply.type('application/manifest+json').header('cache-control', 'public, max-age=300, stale-while-revalidate=3600');
  return {
    name: `${settings.appName} — ${settings.tagline}`,
    short_name: settings.appName.slice(0, 24),
    description: 'Coffee-first marketplace and agricultural guidance for Uganda.',
    start_url: '/', display: 'standalone', background_color: '#f5f5ef',
    theme_color: settings.primaryColor, orientation: 'portrait-primary', lang: settings.defaultLanguage,
    categories: ['business', 'education', 'shopping'],
    icons: [{ src: '/icons/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    shortcuts: [
      { name: 'Browse market', url: '/market', icons: [{ src: '/icons/app-icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
      { name: `Ask ${settings.aiName}`, url: '/ai', icons: [{ src: '/icons/app-icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
    ],
  };
});

app.get('/api/v1/public/translations/:language', async (request: any, reply) => {
  const parsed = z.object({ language: z.string().regex(/^[a-z]{2,3}$/) }).safeParse(request.params);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please choose a supported language.');
  const configured = settings.supportedLanguages.find(item => item.code === parsed.data.language);
  if (!configured || !configured.enabled) return problem(reply, 404, 'TRANSLATION_NOT_AVAILABLE', 'This language is not ready for publication yet.');
  reply.header('cache-control', 'public, max-age=300, stale-while-revalidate=86400');
  if (parsed.data.language === 'en') return { data: { language: 'en', version: translationVersion(), publicationStatus: 'approved', counts: { total: 0, approved: 0, draft: 0 }, messages: {} } };
  return { data: publicTranslationBundle(parsed.data.language) };
});

app.get('/api/v1/public/bootstrap', async (_request: any, reply) => {
  reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
  return {
    config: settings,
    localization: { catalogVersion: translationVersion(), availableLanguages: settings.supportedLanguages },
    user: null,
    role: 'GUEST',
    categories,
    prices: marketPrices,
    listings: process.env.NODE_ENV !== 'production' && settings.marketplaceEnabled && settings.guestAccess.marketplace && settings.guestAccess.productViewing ? listings.filter(item => item.available).slice(0, 8).map(publicListing) : [],
    commerceStatus: process.env.NODE_ENV === 'production' ? 'repository_not_deployed' : 'development_memory',
    buyerRequests: [],
    paymentMethods: publicPaymentMethods(),
    articles: settings.guestAccess.articles ? articles : [],
    alerts,
    advertisements,
    notifications: [],
    weather: { status: 'configuration_required', district: 'Kampala', message: 'Live weather provider is not configured. No forecast is being presented as current.' },
    guestUsage: {
      aiEnabled: settings.guestAccess.ai,
      aiDailyLimit: settings.guestAccess.aiDailyLimit,
      imageAnalysisEnabled: settings.guestAccess.imageAnalysis,
      imageDailyLimit: settings.guestAccess.imageDailyLimit,
      voiceEnabled: settings.guestAccess.voice,
    },
    serverTime: new Date().toISOString(),
  };
});

app.get('/api/v1/public/payment-methods', async (_request: any, reply) => {
  reply.header('cache-control', 'no-store');
  return { data: publicPaymentMethods() };
});

app.get('/api/v1/public/farmers/:id', async (request: any, reply) => {
  if (!settings.guestAccess.farmerProfiles && !request.auth) return problem(reply, 403, 'GUEST_FEATURE_DISABLED', 'Public farmer profiles currently require an account.');
  const farmer = users.find(user => user.id === request.params.id && user.role === 'FARMER_SELLER' && user.status === 'ACTIVE');
  const publicListings = listings.filter(item => item.sellerId === request.params.id && item.available);
  if (!farmer && publicListings.length === 0) return problem(reply, 404, 'NOT_FOUND', 'Farmer profile not found.');
  const profile = farmer ? roleProfiles[farmer.id] || {} : {};
  const listingIdentity = publicListings[0];
  const transactionReviews = reviewsForFarmer(request.params.id);
  const completedOrderCount = [...orders.values()].filter(order => order.sellerId === request.params.id && order.status === 'completed').length;
  reply.header('cache-control', 'public, max-age=120, stale-while-revalidate=600');
  return {
    data: {
      id: request.params.id, name: farmer?.name || listingIdentity.seller,
      firstName: farmer?.firstName || listingIdentity.seller.split(' ')[0],
      avatar: farmer?.avatar || listingIdentity.sellerInitials,
      verified: farmer?.verified ?? listingIdentity.verified, location: farmer?.district || listingIdentity.location,
      farming: profile.farming || [...new Set(publicListings.map(item => item.category))],
      yearsFarming: profile.yearsFarming || null,
      rating: transactionReviews.length ? Number((transactionReviews.reduce((sum, review) => sum + review.rating, 0) / transactionReviews.length).toFixed(1)) : profile.rating || listingIdentity.rating || 0,
      reviewCount: transactionReviews.length || profile.reviewCount || listingIdentity.reviews || 0,
      completedTransactions: completedOrderCount,
      reviews: transactionReviews.map(review => ({ id: review.id, orderId: review.orderId, rating: review.rating, comment: review.comment, createdAt: review.createdAt })),
      coffeeSpecialization: profile.coffeeSpecialization || publicListings.find(item => item.coffeeType)?.coffeeType || null,
      farmType: profile.farmType || 'Farmer / producer', bio: profile.bio || '',
      listings: publicListings.map(publicListing),
    },
  };
});

app.get('/api/v1/public/articles', async (request: any, reply) => {
  if (!settings.guestAccess.articles) return problem(reply, 403, 'GUEST_FEATURE_DISABLED', 'Public agricultural knowledge currently requires an account.');
  const query = z.object({ category: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(24).default(12), cursor: z.string().max(100).optional() }).safeParse(request.query);
  if (!query.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the learning filters.', query.error.flatten());
  let result = [...articles];
  if (query.data.category) result = result.filter(item => item.category.toLowerCase().includes(query.data.category!.toLowerCase()));
  reply.header('cache-control', 'public, max-age=120, stale-while-revalidate=600');
  return { data: result.slice(0, query.data.limit), page: { nextCursor: null, hasMore: result.length > query.data.limit }, meta: { total: result.length } };
});

app.get('/api/v1/public/articles/:slug', async (request: any, reply) => {
  if (!settings.guestAccess.articles) return problem(reply, 403, 'GUEST_FEATURE_DISABLED', 'Public agricultural knowledge currently requires an account.');
  const article = articles.find(item => item.slug === request.params.slug);
  if (!article) return problem(reply, 404, 'NOT_FOUND', 'Agricultural guide not found.');
  reply.header('cache-control', 'public, max-age=120, stale-while-revalidate=600');
  return { data: article };
});

app.post('/api/v1/auth/login', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request: any, reply) => {
  const parsed = z.object({
    identifier: z.string().trim().min(3).max(160),
    password: z.string().min(8).max(200),
    otp: z.string().regex(/^\d{6}$/).optional(),
  }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check your login details.');
  const identifier = parsed.data.identifier.toLowerCase();
  const normalizedIdentifier = /^\+?(?:256|0|[37])/.test(parsed.data.identifier) ? normalizeUgandaPhone(parsed.data.identifier) : parsed.data.identifier;
  const user = users.find(item => item.phone === normalizedIdentifier || item.email?.toLowerCase() === identifier);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return problem(reply, 401, 'INVALID_CREDENTIALS', 'The phone/email or password is incorrect.');
  }
  if (user.status !== 'ACTIVE') return problem(reply, 403, 'ACCOUNT_UNAVAILABLE', 'This account is not currently active.');
  if (user.role === 'ADMIN' || user.twoFactorEnabled) {
    const expected = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
    if (!parsed.data.otp) return problem(reply, 428, 'MFA_REQUIRED', 'Enter the six-digit authenticator code.');
    if (!expected || parsed.data.otp !== expected) return problem(reply, 401, 'INVALID_OTP', 'The verification code is incorrect or expired.');
  }
  const { rawToken, session } = createSession(user.id, request.headers['user-agent'] || '');
  user.lastActiveAt = new Date().toISOString();
  reply.setCookie('agri_session', rawToken, sessionCookie);
  audit({ actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, before: null, after: { role: user.role }, reason: null });
  return { data: { user: roleUser(user), csrfToken: session.csrfToken, redirectTo: dashboardForRole(user.role) } };
});

app.post('/api/v1/auth/register', { config: { rateLimit: { max: 5, timeWindow: '30 minutes' } } }, async (request: any, reply) => {
  const registrationBody = { ...(request.body || {}) };
  if (typeof registrationBody.phone === 'string') {
    const phone = registrationBody.phone.trim().replace(/[\s()-]/g, '');
    registrationBody.phone = normalizeUgandaPhone(registrationBody.phone);
  }
  const parsed = z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().regex(/^\+256\d{9}$/, 'Use a Uganda phone number such as +256700000000'),
    email: z.string().email().max(160).optional().or(z.literal('')),
    password: z.string().min(10).max(200).regex(/[A-Z]/, 'Add an uppercase letter').regex(/[0-9]/, 'Add a number'),
    role: z.enum(['FARMER_SELLER', 'BUYER']),
    location: z.string().trim().min(2).max(100),
  }).safeParse(registrationBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path?.[0] || 'details');
    const labels: Record<string, string> = { name: 'Full name', phone: 'Phone number', email: 'Email', password: 'Password', location: 'Location', role: 'Account type' };
    return problem(reply, 422, 'VALIDATION_FAILED', `${labels[field] || 'Registration details'}: ${issue?.message || 'check this value.'}`, parsed.error.flatten());
  }
  if (users.some(item => item.phone === parsed.data.phone || (parsed.data.email && item.email?.toLowerCase() === parsed.data.email.toLowerCase()))) {
    return problem(reply, 409, 'ACCOUNT_EXISTS', 'An account already uses that phone number or email.');
  }
  const user = registerUser({ ...parsed.data, email: parsed.data.email || undefined });
  await persistUser(user);
  roleProfiles[user.id] = user.role === 'FARMER_SELLER'
    ? { type: 'farmer', verifiedLevel: 'basic', farming: [], yearsFarming: 0, rating: 0, completedTransactions: 0, coffeeSpecialization: null, farmType: 'Individual Farmer', balance: { available: 0, pending: 0, currency: 'UGX' } }
    : { type: 'buyer', verifiedLevel: 'basic', businessName: null, buyerType: 'Individual buyer', interests: [], rating: 0, completedTransactions: 0, savedProducts: 0, openOrders: 0 };
  const { rawToken, session } = createSession(user.id, request.headers['user-agent'] || '');
  reply.setCookie('agri_session', rawToken, sessionCookie);
  audit({ actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id, before: null, after: { role: user.role }, reason: null });
  reply.status(201);
  return { data: { user: roleUser(user), csrfToken: session.csrfToken, redirectTo: dashboardForRole(user.role) } };
});

app.get('/api/v1/me', { preHandler: requireAuth }, async (request: any, reply) => {
  reply.header('cache-control', 'private, no-store');
  return { data: { user: roleUser(request.auth.user), csrfToken: request.auth.session.csrfToken } };
});

const commonProfileFields = {
  name:z.string().trim().min(2).max(100), district:z.string().trim().min(2).max(80), location:z.string().trim().min(2).max(120),
};
app.patch('/api/v1/profile', { preHandler:[requireAuth,requireCsrf,requirePermission('profile.update.own')] }, async(request:any,reply)=>{
  const farmerSchema=z.object({...commonProfileFields,farming:z.array(z.string().trim().min(2).max(50)).max(12),yearsFarming:z.coerce.number().int().min(0).max(80),coffeeSpecialization:z.string().trim().max(80).nullable(),farmType:z.string().trim().min(2).max(100),bio:z.string().trim().max(600)}).strict();
  const buyerSchema=z.object({...commonProfileFields,businessName:z.string().trim().max(120).nullable(),buyerType:z.string().trim().min(2).max(100),interests:z.array(z.string().trim().min(2).max(50)).max(12)}).strict();
  const schema=request.auth.user.role==='FARMER_SELLER'?farmerSchema:request.auth.user.role==='BUYER'?buyerSchema:null;
  if(!schema)return problem(reply,403,'ROLE_FORBIDDEN','Administrator profile changes use security-managed account controls.');const parsed=schema.safeParse(request.body);if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Check your profile fields.',parsed.error.flatten());
  const user=request.auth.user as AuthUserRecord;const before={name:user.name,district:user.district,location:user.location,profile:{...(roleProfiles[user.id]||{})}};user.name=parsed.data.name;user.firstName=parsed.data.name.split(/\s+/)[0];user.district=parsed.data.district;user.location=parsed.data.location;user.avatar=parsed.data.name.split(/\s+/).slice(0,2).map((part:string)=>part[0]?.toUpperCase()).join('')||user.avatar;
  const profile=roleProfiles[user.id]||{type:user.role==='FARMER_SELLER'?'farmer':'buyer'};if(user.role==='FARMER_SELLER'){const input=parsed.data as z.infer<typeof farmerSchema>;Object.assign(profile,{farming:[...new Set(input.farming)],yearsFarming:input.yearsFarming,coffeeSpecialization:input.coffeeSpecialization||null,farmType:input.farmType,bio:input.bio});}else{const input=parsed.data as z.infer<typeof buyerSchema>;Object.assign(profile,{businessName:input.businessName||null,buyerType:input.buyerType,interests:[...new Set(input.interests)]});}roleProfiles[user.id]=profile;
  audit({actorId:user.id,action:'profile.update',targetType:'user_profile',targetId:user.id,before,after:{name:user.name,district:user.district,location:user.location,profile:{...profile}},reason:null});return {data:roleUser(user),message:'Profile updated.'};
});

app.post('/api/v1/auth/logout', { preHandler: [requireAuth, requireCsrf] }, async (request: any, reply) => {
  audit({ actorId: request.auth.user.id, action: 'auth.logout', targetType: 'session', targetId: request.auth.session.id, before: null, after: null, reason: null });
  revokeSession(request.cookies.agri_session);
  reply.clearCookie('agri_session', { path: '/', sameSite: sessionCookie.sameSite, secure: sessionCookie.secure, partitioned: sessionCookie.partitioned });
  return { message: 'Signed out securely.' };
});

app.get('/api/v1/bootstrap', { preHandler: requireAuth }, async (request: any, reply) => {
  const user = request.auth.user as AuthUserRecord;
  reply.header('cache-control', 'private, no-store');
  return {
    config: settings,
    localization: { catalogVersion: translationVersion(), availableLanguages: settings.supportedLanguages },
    user: roleUser(user),
    categories,
    prices: marketPrices,
    listings: process.env.NODE_ENV !== 'production' && settings.marketplaceEnabled ? listings.filter(item => item.available).slice(0, 8) : [],
    commerceStatus: process.env.NODE_ENV === 'production' ? 'repository_not_deployed' : 'development_memory', 
    buyerRequests: settings.buyerRequestsEnabled && (user.role === 'FARMER_SELLER' || user.role === 'ADMIN') ? listBuyerRequests({ status:'open' }, user.id) : [],
    paymentMethods: publicPaymentMethods(),
    articles: user.role === 'FARMER_SELLER' ? articles : [],
    alerts,
    advertisements,
    notifications: settings.notificationsEnabled ? accountNotifications(user.id) : [],
    notificationStatus: 'development_repository',
    adminAttention: user.role === 'ADMIN' ? adminAttentionCounts() : undefined,
    weather: { status: 'configuration_required', district: user.district, message: 'Live weather provider is not configured. No forecast is being presented as current.' },
    serverTime: new Date().toISOString(),
  };
});

app.get('/api/v1/listings', async (request: any, reply) => {
  if (!settings.marketplaceEnabled) return problem(reply, 503, 'MARKETPLACE_DISABLED', 'Marketplace browsing is temporarily unavailable.');
  if (!request.auth && (!settings.guestAccess.marketplace || !settings.guestAccess.search)) {
    return problem(reply, 403, 'GUEST_FEATURE_DISABLED', 'Marketplace search currently requires an account.');
  }
  const query = z.object({
    q: z.string().max(100).optional(),
    category: z.string().max(50).optional(),
    district: z.string().max(80).optional(), coffeeType: z.string().max(60).optional(),
    verified: z.enum(['true', 'false']).optional(), availability: z.enum(['available','all']).default('available'),
    priceMin: z.coerce.number().int().nonnegative().optional(), priceMax: z.coerce.number().int().nonnegative().optional(), quantityMin: z.coerce.number().positive().optional(),
    sort: z.enum(['newest', 'price_low', 'price_high', 'nearby', 'popular']).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(24).default(12),
  }).safeParse(request.query);
  if (!query.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check your search filters.', query.error.flatten());

  let result = query.data.availability === 'all'
    ? listings.filter(item => item.available || (item as any).status === 'sold_out')
    : listings.filter(item => item.available && !['paused','archived','sold_out'].includes((item as any).status));
  const { q, category, district, coffeeType, verified, priceMin, priceMax, quantityMin, sort, limit } = query.data;
  if (q) {
    const term = q.toLowerCase();
    result = result.filter(item => `${item.title} ${(item as any).crop || ''} ${item.description} ${item.location} ${item.coffeeType || ''}`.toLowerCase().includes(term));
  }
  if (category && category !== 'all') result = result.filter(item => item.category === category);
  if (district) result = result.filter(item => `${(item as any).district || ''} ${item.location}`.toLowerCase().includes(district.toLowerCase()));
  if (coffeeType) result = result.filter(item => item.coffeeType?.toLowerCase() === coffeeType.toLowerCase());
  if (verified === 'true') result = result.filter(item => item.verified);
  if (priceMin !== undefined) result = result.filter(item => item.price >= priceMin);
  if (priceMax !== undefined) result = result.filter(item => item.price <= priceMax);
  if (quantityMin !== undefined) result = result.filter(item => item.quantity >= quantityMin);
  if (sort === 'price_low') result.sort((a, b) => a.price - b.price);
  if (sort === 'price_high') result.sort((a, b) => b.price - a.price);
  if (sort === 'newest') result.sort((a, b) => String((b as any).createdAt || '').localeCompare(String((a as any).createdAt || '')));
  if (sort === 'popular') result.sort((a, b) => Number((b as any).views || 0) - Number((a as any).views || 0));
  const savedIds = request.auth?.user.role === 'BUYER' ? (accountSavedListingIds.get(request.auth.user.id) || new Set<string>()) : new Set<string>();
  return { data: result.slice(0, limit).map(item => ({ ...publicListing(item), saved: savedIds.has(item.id) })), page: { nextCursor: null, hasMore: result.length > limit }, meta: { total: result.length } };
});

app.get('/api/v1/listings/:id', async (request: any, reply) => {
  if (!settings.marketplaceEnabled) return problem(reply, 503, 'MARKETPLACE_DISABLED', 'Marketplace product viewing is temporarily unavailable.');
  if (!request.auth && (!settings.guestAccess.marketplace || !settings.guestAccess.productViewing)) {
    return problem(reply, 403, 'GUEST_FEATURE_DISABLED', 'Product viewing currently requires an account.');
  }
  const item = listings.find(listing => listing.id === request.params.id);
  if (!item) return problem(reply, 404, 'NOT_FOUND', 'This listing is no longer available.');
  const privateStatus = ['paused','archived'].includes((item as any).status);
  const canSeePrivateStatus = request.auth?.user.id === item.sellerId || (request.auth?.user.role === 'ADMIN' && roleHasPermission(request.auth.user.role, 'marketplace.moderate'));
  if (privateStatus && !canSeePrivateStatus) return problem(reply, 404, 'NOT_FOUND', 'This listing is no longer available.');
  if (request.auth?.user.id !== item.sellerId) {
    let viewerId = request.auth?.user.id || request.cookies?.agri_market_viewer;
    if (!viewerId) { viewerId = randomUUID(); reply.setCookie('agri_market_viewer', viewerId, { ...sessionCookie, httpOnly: true, maxAge: 365 * 24 * 60 * 60 }); }
    const viewers = listingViewers.get(item.id) || new Set<string>();
    if (!viewers.has(viewerId)) { viewers.add(viewerId); listingViewers.set(item.id, viewers); (item as any).views = Number((item as any).views || 0) + 1; }
  }
  const saved = request.auth?.user.role === 'BUYER' && (accountSavedListingIds.get(request.auth.user.id) || new Set<string>()).has(item.id);
  return { data: request.auth ? { ...item, saved } : publicListing(item) };
});

app.get('/api/v1/listings/:id/quote', async (request: any, reply) => {
  const parsed = z.object({ id: z.string().min(3), quantity: z.coerce.number().int().positive().max(1_000_000), paymentMethodId: z.string().min(3).max(100) }).safeParse({ ...request.params, ...request.query });
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose a valid quantity and payment method.');
  const listing = listings.find(item => item.id === parsed.data.id && item.available);
  if (!listing) return problem(reply, 404, 'NOT_FOUND', 'This listing is no longer available.');
  if (parsed.data.quantity > listing.quantity) return problem(reply, 409, 'INSUFFICIENT_QUANTITY', `Only ${listing.quantity} ${listing.unit} is available.`);
  const method = publicPaymentMethods().find(item => item.id === parsed.data.paymentMethodId && item.currency === (listing.currency || 'UGX'));
  if (!method) return problem(reply, 409, 'PAYMENT_METHOD_UNAVAILABLE', 'Choose an enabled payment method for this currency.');
  const gross = listing.price * parsed.data.quantity; if (!Number.isSafeInteger(gross)) return problem(reply, 422, 'AMOUNT_TOO_LARGE', 'This amount cannot be processed.');
  const rule = resolveCommissionRule(listing.category, listing.sellerId); const fees = calculateFees(gross, rule.rateBasisPoints, method.feeBasisPoints);
  return { data: { ...fees, currency: method.currency, quantity: parsed.data.quantity, unitPrice: listing.price, commissionRule: rule, paymentMethod: { id: method.id, name: method.name, feeBasisPoints: method.feeBasisPoints } } };
});

app.patch('/api/v1/listings/:id', { preHandler: [requireAuth, requireCsrf] }, async (request: any, reply) => {
  const listing = listings.find(item => item.id === request.params.id);
  if (!listing) return problem(reply, 404, 'NOT_FOUND', 'This listing is no longer available.');
  if (!canModifyListing(request.auth.user, listing)) return problem(reply, 403, 'NOT_LISTING_OWNER', 'You can modify only your own listings.');
  const parsed = z.object({
    title: z.string().trim().min(3).max(100).optional(),
    description: z.string().trim().min(10).max(1200).optional(), category: z.enum(FARMER_CATEGORIES).optional(), crop: z.string().trim().max(80).optional(),
    coffeeType: z.string().trim().max(60).nullable().optional(), process: z.string().trim().max(80).nullable().optional(), grade: z.string().trim().max(80).optional(),
    harvestDate: z.string().trim().max(80).optional(), productionMethod: z.enum(['organic','conventional','transitioning']).optional(),
    price: z.number().int().nonnegative().optional(), quantity: z.number().positive().optional(), unit: z.string().trim().max(30).optional(),
    negotiable: z.boolean().optional(), minimumAcceptablePrice: z.number().int().nonnegative().nullable().optional(), imageIds: z.array(z.string().regex(/^media_/)).max(4).optional(),
    existingImages: z.array(z.string().regex(/^\/(?:api\/v1\/media\/listings\/media_|images\/)/)).max(4).optional(),
    district: z.string().trim().max(80).optional(), subRegion: z.string().trim().max(100).optional(), location: z.string().trim().max(120).optional(),
    available: z.boolean().optional(), status: z.enum(['published', 'paused', 'sold_out', 'archived']).optional(),
  }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the listing update.', parsed.error.flatten());
  if (parsed.data.imageIds && !mediaOwnedAndReady(listing.sellerId, parsed.data.imageIds)) return problem(reply, 422, 'IMAGE_OWNERSHIP_INVALID', 'One or more listing images are unavailable.');
  const currentImages = ((listing as any).images || (listing.image ? [listing.image] : [])) as string[];
  if (parsed.data.existingImages?.some(url => !currentImages.includes(url))) return problem(reply, 422, 'IMAGE_OWNERSHIP_INVALID', 'An existing image does not belong to this listing.');
  const submittedImageCount = (parsed.data.existingImages?.length || 0) + (parsed.data.imageIds?.length || 0);
  if (submittedImageCount > 4) return problem(reply, 422, 'IMAGE_LIMIT_EXCEEDED', 'A listing can have no more than four images.');
  if ((parsed.data.existingImages || parsed.data.imageIds) && submittedImageCount < 1) return problem(reply, 422, 'IMAGE_REQUIRED', 'Keep or upload at least one product image.');
  const nextPrice = parsed.data.price ?? listing.price; const nextMinimum = parsed.data.minimumAcceptablePrice ?? (listing as any).minimumAcceptablePrice;
  const nextNegotiable = parsed.data.negotiable ?? listing.negotiable;
  if (nextNegotiable && nextMinimum !== null && nextMinimum > nextPrice) return problem(reply, 422, 'NEGOTIATION_PRICE_INVALID', 'Minimum acceptable price cannot exceed the asking price.');
  const before = { title: listing.title, price: listing.price, quantity: listing.quantity, available: listing.available, status: (listing as any).status, images: (listing as any).images };
  const { imageIds, existingImages, ...changes } = parsed.data; Object.assign(listing, changes, { postedAt: listing.postedAt });
  if (imageIds || existingImages) { const urls = [...(existingImages || []), ...(imageIds || []).map(id => `/api/v1/media/listings/${id}`)]; (listing as any).images = urls; listing.image = urls[0] || null; syncListingMedia(listing.sellerId, listing.id, urls); }
  if (changes.status === 'paused' || changes.status === 'archived' || changes.status === 'sold_out') listing.available = false;
  if (changes.status === 'published') listing.available = true;
  await persistListing(listing);
  audit({ actorId: request.auth.user.id, action: 'listing.update', targetType: 'listing', targetId: listing.id, before, after: { ...changes, imageCount: imageIds?.length }, reason: null });
  return { data: listing, message: 'Listing updated.' };
});

app.delete('/api/v1/listings/:id', { preHandler: [requireAuth, requireCsrf] }, async (request: any, reply) => {
  const listing = listings.find(item => item.id === request.params.id);
  if (!listing) return problem(reply, 404, 'NOT_FOUND', 'This listing is no longer available.');
  if (!canDeleteListing(request.auth.user, listing)) return problem(reply, 403, 'NOT_LISTING_OWNER', 'You can delete only your own listings.');
  (listing as any).status = 'archived';
  listing.available = false;
  await persistListing(listing);
  audit({ actorId: request.auth.user.id, action: 'listing.archive', targetType: 'listing', targetId: listing.id, before: { available: true }, after: { status: 'archived', available: false }, reason: null });
  return { message: 'Listing archived.' };
});

app.get('/api/v1/media/listings/:id', async (request: any, reply) => {
  const parsed = z.object({ id: z.string().regex(/^media_[a-z0-9-]+$/i) }).safeParse(request.params);
  if (!parsed.success) return problem(reply, 404, 'NOT_FOUND', 'Image not found.');
  const image = findMedia(parsed.data.id);
  if (!image || (!image.attachedListingId && request.auth?.user.id !== image.ownerId)) return problem(reply, 404, 'NOT_FOUND', 'Image not found.');
  const attachedListing = image.attachedListingId ? listings.find(item => item.id === image.attachedListingId) : null;
  if (attachedListing && ['paused','archived'].includes((attachedListing as any).status) && request.auth?.user.id !== image.ownerId && request.auth?.user.role !== 'ADMIN') return problem(reply, 404, 'NOT_FOUND', 'Image not found.');
  reply.header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').header('content-disposition', `inline; filename="${image.safeFilename}"`);
  return reply.type(image.mime).send(image.bytes);
});

app.post('/api/v1/farmer/listing-images', {
  preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('listings.create')],
  config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
}, async (request: any, reply) => {
  let file;
  try { file = await request.file(); } catch { return problem(reply, 413, 'IMAGE_TOO_LARGE', 'Use a compressed image smaller than 1.5 MB.'); }
  if (!file) return problem(reply, 422, 'IMAGE_REQUIRED', 'Choose a product image to upload.');
  const bytes = await file.toBuffer();
  const result = saveListingMedia(request.auth.user.id, file.filename || 'upload', file.mimetype, bytes);
  if ('error' in result) {
    const messages: Record<string,string> = {
      UNSUPPORTED_IMAGE_TYPE: 'Use a JPEG, PNG, or WebP product image.', IMAGE_SIZE_INVALID: 'Use a compressed image between 100 bytes and 1.5 MB.',
      IMAGE_EXTENSION_INVALID: 'The image filename extension is not allowed.', IMAGE_EXTENSION_MISMATCH: 'The image filename does not match its actual file type.', IMAGE_DIMENSIONS_INVALID: 'Use a valid image between 160×160 and 4096×4096 pixels.',
      MEDIA_SCANNER_UNAVAILABLE: 'Image scanning is not configured, so uploads are unavailable safely.',
    };
    return problem(reply, result.error === 'MEDIA_SCANNER_UNAVAILABLE' ? 503 : 422, result.error, messages[result.error]);
  }
  reply.status(201); return { data: result.data, message: 'Compressed product image uploaded and validated.' };
});
app.delete('/api/v1/farmer/listing-images/:id', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('listings.create')] }, async (request: any, reply) => {
  const result = deleteListingMedia(request.auth.user.id, request.params.id);
  if ('error' in result) return problem(reply, result.error === 'NOT_FOUND' ? 404 : 409, result.error, result.error === 'MEDIA_IN_USE' ? 'Save the listing without this image before removing it.' : 'Listing image not found.');
  return { message: 'Listing image removed.' };
});

const draftFields = {
  currentStep: z.coerce.number().int().min(1).max(5).optional(), title: z.string().trim().max(100).optional(),
  category: z.enum(FARMER_CATEGORIES).optional(), crop: z.string().trim().max(80).optional(), coffeeType: z.string().trim().max(60).nullable().optional(),
  process: z.string().trim().max(80).nullable().optional(), grade: z.string().trim().max(80).optional(), description: z.string().trim().max(1200).optional(),
  harvestDate: z.string().trim().max(80).optional(), productionMethod: z.enum(['organic','conventional','transitioning']).optional(),
  quantity: z.coerce.number().int().nonnegative().max(1_000_000).optional(), unit: z.string().trim().max(30).optional(),
  price: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), pricingMode: z.enum(['fixed','negotiable']).optional(),
  minimumAcceptablePrice: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(), district: z.string().trim().max(80).optional(),
  subRegion: z.string().trim().max(100).optional(), approximateLocation: z.string().trim().max(120).optional(), imageIds: z.array(z.string().regex(/^media_/)).max(4).optional(),
};

app.get('/api/v1/farmer/listing-drafts', { preHandler: [requireAuth, requireRole('FARMER_SELLER'), requirePermission('listings.create')] }, async (request: any) => ({ data: farmerDrafts(request.auth.user.id) }));
app.post('/api/v1/farmer/listing-drafts', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('listings.create')] }, async (request: any, reply) => {
  const parsed = z.object(draftFields).strict().safeParse(request.body || {});
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check the listing draft fields.', parsed.error.flatten());
  const draft = newListingDraft(request.auth.user.id);
  if (parsed.data.imageIds && !mediaOwnedAndReady(request.auth.user.id, parsed.data.imageIds)) { deleteFarmerDraft(draft); return problem(reply, 422, 'IMAGE_OWNERSHIP_INVALID', 'One or more listing images are unavailable.'); }
  updateFarmerDraft(draft, parsed.data); await persistDraft(draft); reply.status(201); return { data: publicDraft(draft), message: 'Draft saved securely.' };
});
app.get('/api/v1/farmer/listing-drafts/:id', { preHandler: [requireAuth, requireRole('FARMER_SELLER'), requirePermission('listings.create')] }, async (request: any, reply) => {
  const draft = findFarmerDraft(request.auth.user.id, request.params.id);
  if (!draft) return problem(reply, 404, 'NOT_FOUND', 'Listing draft not found.');
  return { data: publicDraft(draft) };
});
app.patch('/api/v1/farmer/listing-drafts/:id', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('listings.create')] }, async (request: any, reply) => {
  const parsed = z.object({ ...draftFields, version: z.coerce.number().int().positive() }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check the listing draft fields.', parsed.error.flatten());
  const draft = findFarmerDraft(request.auth.user.id, request.params.id);
  if (!draft) return problem(reply, 404, 'NOT_FOUND', 'Listing draft not found.');
  if (parsed.data.imageIds && !mediaOwnedAndReady(request.auth.user.id, parsed.data.imageIds)) return problem(reply, 422, 'IMAGE_OWNERSHIP_INVALID', 'One or more listing images are unavailable.');
  const { version, ...changes } = parsed.data; const updated = updateFarmerDraft(draft, changes, version);
  if (!updated) return problem(reply, 409, 'DRAFT_VERSION_CONFLICT', 'This draft changed elsewhere. Reload before saving again.');
  await persistDraft(updated); return { data: publicDraft(updated), message: 'Draft autosaved.' };
});
app.delete('/api/v1/farmer/listing-drafts/:id', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('listings.create')] }, async (request: any, reply) => {
  const draft = findFarmerDraft(request.auth.user.id, request.params.id);
  if (!draft) return problem(reply, 404, 'NOT_FOUND', 'Listing draft not found.');
  deleteFarmerDraft(draft); await deleteDraftFromDatabase(draft.id, request.auth.user.id); return { message: 'Draft deleted.' };
});

app.post('/api/v1/farmer/listing-description-suggestion', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER')] }, async (request: any, reply) => {
  const parsed = z.object({ title: z.string().trim().min(3).max(100), crop: z.string().trim().min(2).max(80), category: z.enum(FARMER_CATEGORIES), qualityNotes: z.string().trim().max(500).optional(), language: z.enum(['en','lg']).default('en') }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Add the product and quality details before requesting a suggestion.');
  return problem(reply, 503, 'AI_LISTING_PROVIDER_NOT_CONFIGURED', 'AI listing suggestions are not configured. Write the description yourself; no unapproved AI text will be published.');
});

app.post('/api/v1/farmer/listing-quote', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER')] }, async (request: any, reply) => {
  const parsed = z.object({ category: z.enum(FARMER_CATEGORIES), quantity: z.coerce.number().int().positive().max(1_000_000), price: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Enter a valid quantity and price.', parsed.error.flatten());
  const gross = parsed.data.quantity * parsed.data.price;
  if (!Number.isSafeInteger(gross)) return problem(reply, 422, 'AMOUNT_TOO_LARGE', 'This listing value is too large.');
  const rule = resolveCommissionRule(parsed.data.category, request.auth.user.id);
  const method = publicPaymentMethods().find(item => item.isDefault) || publicPaymentMethods()[0];
  const fees = calculateFees(gross, rule.rateBasisPoints, method?.feeBasisPoints || 0);
  return { data: { ...fees, currency: 'UGX', commissionRule: rule, paymentMethodEstimate: method ? { id: method.id, name: method.name, feeBasisPoints: method.feeBasisPoints } : null, disclaimer: 'Final provider fee uses the buyer-selected method and is snapshotted on the order.' } };
});

app.post('/api/v1/farmer/listing-drafts/:id/publish', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('listings.create')] }, async (request: any, reply) => {
  const parsed = z.object({ version: z.coerce.number().int().positive(), confirmed: z.literal(true) }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'CONFIRMATION_REQUIRED', 'Review and explicitly confirm the listing before publication.');
  const draft = findFarmerDraft(request.auth.user.id, request.params.id);
  if (!draft) return problem(reply, 404, 'NOT_FOUND', 'Listing draft not found.');
  if (draft.version !== parsed.data.version) return problem(reply, 409, 'DRAFT_VERSION_CONFLICT', 'Reload the latest draft before publishing.');
  if (!draft.title || draft.title.length < 3 || draft.description.length < 10 || !draft.crop || !draft.quantity || !draft.price || !draft.unit || !draft.district || !draft.approximateLocation || !draft.imageIds.length) return problem(reply, 422, 'DRAFT_INCOMPLETE', 'Complete all listing steps and add at least one image before publishing.');
  if (draft.pricingMode === 'negotiable' && (draft.minimumAcceptablePrice === null || draft.minimumAcceptablePrice > draft.price)) return problem(reply, 422, 'NEGOTIATION_PRICE_INVALID', 'Set a valid minimum acceptable price no higher than the asking price.');
  if (!mediaOwnedAndReady(request.auth.user.id, draft.imageIds)) return problem(reply, 422, 'IMAGE_OWNERSHIP_INVALID', 'One or more listing images are unavailable.');
  const seller = request.auth.user as AuthUserRecord; const id = randomUUID(); const imageUrls = draft.imageIds.map(mediaId => `/api/v1/media/listings/${mediaId}`);
  const created: any = {
    id, sellerId: seller.id, seller: seller.name, sellerInitials: seller.avatar, verified: seller.verified, trusted: false,
    title: draft.title, category: draft.category, crop: draft.crop, coffeeType: draft.category === 'coffee' ? draft.coffeeType : null,
    process: draft.process, grade: draft.grade || null, description: draft.description, harvestInformation: draft.harvestDate,
    productionMethod: draft.productionMethod, quantity: draft.quantity, unit: draft.unit, price: draft.price, currency: 'UGX',
    negotiable: draft.pricingMode === 'negotiable', minimumAcceptablePrice: draft.minimumAcceptablePrice,
    location: draft.approximateLocation, district: draft.district, subRegion: draft.subRegion, distance: 'Your listing', image: imageUrls[0], images: imageUrls,
    featured: false, postedAt: 'Just now', createdAt: new Date().toISOString(), harvestDate: draft.harvestDate || 'Available now',
    rating: roleProfiles[seller.id]?.rating || 0, reviews: reviewsForFarmer(seller.id).length, delivery: ['Pickup'], moisture: null,
    available: true, status: 'published', views: 0, interestedBuyers: 0, placeholder: draft.category === 'coffee' ? '☕' : '🌱', color: '#557a61',
  };
  listings.unshift(created); attachMediaToListing(seller.id, draft.imageIds, id); consumeFarmerDraft(draft); await deleteDraftFromDatabase(draft.id, seller.id); await persistListing(created);
  audit({ actorId: seller.id, action: 'listing.publish', targetType: 'listing', targetId: id, before: { draftId: draft.id }, after: { title: created.title, category: created.category, price: created.price, quantity: created.quantity }, reason: 'Farmer confirmed buyer-facing listing preview' });
  reply.status(201); return { data: created, message: 'Your listing is live and ready for buyers.' };
});

app.get('/api/v1/market-prices', async (_request, reply) => {
  reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=180');
  return { data: marketPrices, meta: { generatedAt: new Date().toISOString(), pricesAreIndicative: true } };
});

const buyerRequestInput = z.object({
  product: z.string().trim().min(2).max(100), category: z.enum(['coffee','crops','livestock','inputs']),
  quantity: z.coerce.number().int().positive().max(1_000_000), unit: z.string().trim().min(1).max(30),
  minimumUnitPrice: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  maximumUnitPrice: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  district: z.string().trim().min(2).max(80), description: z.string().trim().min(10).max(1000),
  requiredBy: z.string().date(), expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.maximumUnitPrice !== null && value.minimumUnitPrice !== null && value.maximumUnitPrice < value.minimumUnitPrice) context.addIssue({ code:'custom', path:['maximumUnitPrice'], message:'Maximum price must not be below minimum price.' });
  if (new Date(value.expiresAt).getTime() <= Date.now()) context.addIssue({ code:'custom', path:['expiresAt'], message:'Expiry must be in the future.' });
  if (new Date(value.requiredBy).getTime() <= new Date(value.expiresAt).getTime()) context.addIssue({ code:'custom', path:['requiredBy'], message:'Required date must be after the response expiry.' });
});

app.get('/api/v1/buyer-requests', async (request: any, reply) => {
  if (!settings.buyerRequestsEnabled) return problem(reply, 503, 'BUYER_REQUESTS_DISABLED', 'Buyer requests are temporarily unavailable.');
  const parsed=z.object({category:z.string().max(30).optional(),district:z.string().trim().max(80).optional(),q:z.string().trim().max(100).optional(),status:z.enum(['open','expired','closed','fulfilled','all']).optional()}).safeParse(request.query);
  if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Check the opportunity filters.');
  return { data:listBuyerRequests(parsed.data,request.auth?.user.id), page:{nextCursor:null,hasMore:false} };
});
app.get('/api/v1/buyer/requests', { preHandler:[requireAuth,requireRole('BUYER')] }, async (request:any)=>({data:listOwnedBuyerRequests(request.auth.user.id)}));
app.post('/api/v1/buyer-requests', { preHandler:[requireAuth,requireCsrf,requireRole('BUYER')] }, async (request:any,reply)=>{
  if(!settings.buyerRequestsEnabled)return problem(reply,503,'BUYER_REQUESTS_DISABLED','Buyer requests are temporarily unavailable.');
  const parsed=buyerRequestInput.safeParse(request.body);if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Check the buyer request fields.',parsed.error.flatten());
  const record=createBuyerRequest(request.auth.user.id,parsed.data);audit({actorId:request.auth.user.id,action:'buyer_request.create',targetType:'buyer_request',targetId:record.id,before:null,after:{product:record.product,quantity:record.quantity,expiresAt:record.expiresAt},reason:null});reply.status(201);return {data:record,message:'Buyer request published.'};
});
app.patch('/api/v1/buyer-requests/:id/state', { preHandler:[requireAuth,requireCsrf,requireRole('BUYER')] }, async(request:any,reply)=>{
  const parsed=z.object({status:z.enum(['closed','fulfilled'])}).strict().safeParse(request.body);if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Choose a valid request state.');
  const result=closeBuyerRequest(request.auth.user.id,request.params.id,parsed.data.status);if(!result)return problem(reply,404,'NOT_FOUND','Buyer request not found.');if('error'in result)return problem(reply,409,result.error,'Only an open request can be changed.');return {data:result.data,message:`Buyer request ${parsed.data.status}.`};
});
app.post('/api/v1/buyer-requests/:id/responses', { preHandler:[requireAuth,requireCsrf,requireRole('FARMER_SELLER')] }, async(request:any,reply)=>{
  const parsed=z.object({quantity:z.coerce.number().int().positive().max(1_000_000),unitPrice:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),message:z.string().trim().min(10).max(1000),listingId:z.string().trim().min(3).nullable().optional()}).strict().safeParse(request.body);
  if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Check your response quantity, price and message.',parsed.error.flatten());
  if(parsed.data.listingId&&!listings.some(item=>item.id===parsed.data.listingId&&item.sellerId===request.auth.user.id))return problem(reply,403,'NOT_LISTING_OWNER','You can link only your own listing.');
  const result=respondToBuyerRequest(request.auth.user.id,request.params.id,parsed.data);if('error'in result){const status=result.error==='NOT_FOUND'?404:409;return problem(reply,status,result.error,result.error==='DUPLICATE_RESPONSE'?'You already responded to this opportunity.':'This buyer request is no longer open.');}
  audit({actorId:request.auth.user.id,action:'buyer_request.respond',targetType:'buyer_request_response',targetId:result.data.id,before:null,after:{requestId:request.params.id,quantity:parsed.data.quantity,listingId:parsed.data.listingId||null},reason:null});reply.status(201);return {data:result.data,message:'Your response was sent to the buyer.'};
});
app.patch('/api/v1/buyer-request-responses/:id/withdraw', { preHandler:[requireAuth,requireCsrf,requireRole('FARMER_SELLER')] }, async(request:any,reply)=>{const result=withdrawBuyerResponse(request.auth.user.id,request.params.id);if(!result)return problem(reply,404,'NOT_FOUND','Response not found.');if('error'in result)return problem(reply,409,result.error,'Only a submitted response can be withdrawn.');return {data:result.data,message:'Response withdrawn.'};});
app.patch('/api/v1/buyer-request-responses/:id/decision', { preHandler:[requireAuth,requireCsrf,requireRole('BUYER')] }, async(request:any,reply)=>{const parsed=z.object({decision:z.enum(['accepted','rejected'])}).strict().safeParse(request.body);if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Choose accept or reject.');const result=decideBuyerResponse(request.auth.user.id,request.params.id,parsed.data.decision);if('error'in result)return problem(reply,result.error==='NOT_FOUND'?404:result.error==='NOT_OWNER'?403:409,result.error,'This response cannot be changed.');return {data:result.data,message:`Response ${parsed.data.decision}.`};});

app.get('/api/v1/notifications', { preHandler:requireAuth }, async(request:any,reply)=>{if(!settings.notificationsEnabled)return problem(reply,503,'NOTIFICATIONS_DISABLED','Notifications are temporarily unavailable.');const parsed=z.object({group:z.enum(['all','orders','market','messages','system']).default('all'),unread:z.enum(['true','false']).optional()}).safeParse(request.query);if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Check the notification filter.');const all=accountNotifications(request.auth.user.id);const data=accountNotifications(request.auth.user.id,parsed.data.group,parsed.data.unread==='true');return {data,meta:{unreadCount:all.filter(item=>item.unread).length,total:data.length}};});
app.patch('/api/v1/notifications/:id/read', { preHandler:[requireAuth,requireCsrf] }, async(request:any,reply)=>{const record=markNotification(request.auth.user.id,request.params.id);if(!record)return problem(reply,404,'NOT_FOUND','Notification not found.');return {data:{...record,unread:false},meta:{unreadCount:accountNotifications(request.auth.user.id,'all',true).length}};});
app.post('/api/v1/notifications/read-all', { preHandler:[requireAuth,requireCsrf] }, async(request:any)=>{markAllNotifications(request.auth.user.id);return {data:accountNotifications(request.auth.user.id),meta:{unreadCount:0},message:'All notifications marked as read.'};});

app.get('/api/v1/conversations', { preHandler:requireAuth }, async(request:any)=>({data:listConversations(request.auth.user.id)}));
app.post('/api/v1/conversations', { preHandler:[requireAuth,requireCsrf] }, async(request:any,reply)=>{
  const parsed=z.object({listingId:z.string().min(3).optional(),orderId:z.string().min(3).optional(),responseId:z.string().min(3).optional()}).strict().refine(value=>[value.listingId,value.orderId,value.responseId].filter(Boolean).length===1,'Choose exactly one conversation context.').safeParse(request.body);
  if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Choose one valid listing, order or opportunity response.');
  const listing=parsed.data.listingId?listings.find(item=>item.id===parsed.data.listingId):undefined;const order=parsed.data.orderId?orders.get(parsed.data.orderId):undefined;
  if(parsed.data.listingId&&!listing)return problem(reply,404,'NOT_FOUND','Listing not found.');if(parsed.data.orderId&&!order)return problem(reply,404,'NOT_FOUND','Order not found.');
  const result=createContextConversation(request.auth.user.id,request.auth.user.role,{listing,order,responseId:parsed.data.responseId});if('error'in result)return problem(reply,result.error==='NOT_FOUND'?404:403,result.error,'You cannot start this conversation.');reply.status(201);return {data:result.data,message:'Conversation ready.'};
});
app.get('/api/v1/conversations/:id/messages', { preHandler:requireAuth }, async(request:any,reply)=>{const data=listMessages(request.auth.user.id,request.params.id);if(!data)return problem(reply,404,'NOT_FOUND','Conversation not found.');return {data};});
app.post('/api/v1/conversations/:id/messages', { preHandler:[requireAuth,requireCsrf] }, async(request:any,reply)=>{const parsed=z.object({body:z.string().trim().min(1).max(2000)}).strict().safeParse(request.body);if(!parsed.success)return problem(reply,422,'VALIDATION_FAILED','Write a message of up to 2,000 characters.');const record=sendMessage(request.auth.user.id,request.params.id,parsed.data.body);if(!record)return problem(reply,404,'NOT_FOUND','Conversation not found.');reply.status(201);return {data:record,message:'Message sent.'};});
app.post('/api/v1/conversations/:id/read', { preHandler:[requireAuth,requireCsrf] }, async(request:any,reply)=>markConversationRead(request.auth.user.id,request.params.id)?{message:'Conversation marked read.'}:problem(reply,404,'NOT_FOUND','Conversation not found.'));

app.get('/api/v1/cart', { preHandler: [requireAuth, requireRole('BUYER'), requirePermission('orders.create')] }, async (request: any) => {
  const cart = accountCarts.get(request.auth.user.id) || [];
  return { data: cart.map(item => { const listing = listings.find(candidate => candidate.id === item.listingId && candidate.available); return listing ? { ...item, listing: publicListing(listing) } : null; }).filter(Boolean) };
});

app.post('/api/v1/cart/merge', { preHandler: [requireAuth, requireCsrf, requireRole('BUYER'), requirePermission('orders.create')] }, async (request: any, reply) => {
  const parsed = z.object({ items: z.array(z.object({ listingId: z.string().min(1).max(100), quantity: z.number().int().positive().max(1_000_000) })).max(50) }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the temporary cart items.', parsed.error.flatten());
  const merged = new Map((accountCarts.get(request.auth.user.id) || []).map(item => [item.listingId, item]));
  let skipped = 0;
  for (const item of parsed.data.items) {
    const listing = listings.find(candidate => candidate.id === item.listingId && candidate.available);
    if (!listing) { skipped += 1; continue; }
    const previous = merged.get(item.listingId);
    merged.set(item.listingId, { listingId: item.listingId, quantity: Math.min(listing.quantity, Math.max(previous?.quantity || 0, item.quantity)) });
  }
  const cart = [...merged.values()];
  accountCarts.set(request.auth.user.id, cart);
  return { data: cart, meta: { merged: parsed.data.items.length - skipped, skipped }, message: 'Temporary cart merged with your buyer account.' };
});

const aiInput = z.object({
  message: z.string().trim().min(2).max(1200),
  language: z.enum(['en', 'lg', 'nyn', 'ach']).default('en'),
  mode: z.enum(['text', 'image', 'voice']).default('text'),
  context: z.object({ district: z.string().optional(), crop: z.string().optional() }).optional(),
});

function aiAnswer(message: string, language: string) {
  const q = message.toLowerCase();
  if (language === 'lg' || /luganda|ebikoola|emmwanyi|kirwadde/.test(q)) {
    return {
      summary: 'Ebikoola by’emmwanyi okufuuka bya kyenvu kiyinza okuva ku mazzi agatasaana, obutaba na biriisa bimala, oba obulwadde. Ekifaananyi oba ebibuuzo ebirala byandiyambye okumanya obubonero obusingawo.',
      possibleCauses: ['Amazzi mangi oba matono', 'Obutaba na nitrogen oba magnesium emala', 'Emirandira okuba n’obuzibu'],
      checks: ['Kebera oba ettaka linnyogovu nnyo', 'Laba oba kyenvu kitandikira ku bikoola ebikadde oba ebipya', 'Kebera obubonero ku mirandira n’omuti'],
      actions: ['Longoosa amakubo g’amazzi', 'Twala ekifaananyi ekiri okumpi n’eky’omuti gwonna', 'Buuza omukugu w’ebyobulimi nga obubonero bweyongera'],
      prevention: ['Kuuma drainage ennungi', 'Kozesa ebigimusa okusinziira ku kukebera ettaka'],
      warning: 'Toteeka ddagala nga tonnakakasa kizibu. Goberera label era kozesa eby’okwekuuma.',
      confidence: 'medium',
      followUp: 'Ebikoola ebya kyenvu bitandikira wansi ku muti oba waggulu? Enkuba etonnya nnyo gye muli?',
      sources: [{ title: 'Platform coffee care guide', type: 'expert-reviewed demo content' }],
    };
  }
  if (/yellow|leaf|leaves|disease|coffee/.test(q)) {
    return {
      summary: 'Yellow coffee leaves can be linked to water stress, nutrient imbalance, root damage, or disease. The pattern on the plant matters, so this is not a diagnosis yet.',
      possibleCauses: ['Poor drainage or prolonged dry soil', 'Nitrogen or magnesium deficiency', 'Root damage or a developing pest/disease issue'],
      checks: ['Is yellowing on old leaves first, or new leaves?', 'Is the soil waterlogged, dry, or compacted?', 'Look under leaves and around the stem for spots, insects, or lesions'],
      actions: ['Improve drainage and avoid watering already wet soil', 'Upload one close leaf photo and one whole-tree photo', 'Mark affected trees and compare changes over 3–5 days', 'Ask a local extension officer before applying a pesticide'],
      prevention: ['Use soil-test-guided nutrition', 'Keep a clean field and pruning tools', 'Maintain airflow without over-pruning'],
      warning: 'If many trees decline quickly, berries develop dark lesions, or branches die back, contact a qualified crop professional promptly. Follow all product labels and protective-equipment requirements.',
      confidence: 'medium',
      followUp: 'Which district are you in, how old are the trees, and did the yellowing start after heavy rain?',
      sources: [{ title: 'Platform coffee health guide', type: 'expert-reviewed demo content' }],
    };
  }
  if (/cow|goat|pig|chicken|animal|skin|not eating/.test(q)) {
    return {
      summary: 'Visible or described signs can have several causes, and a message or photograph cannot confirm an animal diagnosis.',
      possibleCauses: ['Feed or water problem', 'Parasites or infection', 'Stress, injury, or housing conditions'],
      checks: ['Check appetite, water intake, temperature if trained, breathing, stool, and mobility', 'Look for other animals with similar signs', 'Note when the problem began and recent feed changes'],
      actions: ['Separate a sick animal when contagious illness is possible', 'Provide clean water and a quiet, dry area', 'Contact a qualified veterinary professional for examination'],
      prevention: ['Keep housing clean and dry', 'Follow a locally approved vaccination and parasite-control plan'],
      warning: 'Seek urgent veterinary help for breathing difficulty, collapse, severe bleeding, inability to stand, seizures, or rapidly spreading illness.',
      confidence: 'low',
      followUp: 'What animal, age, main sign, and duration? Is it still eating and drinking?',
      sources: [],
    };
  }
  return {
    summary: 'I can help best with a little more detail about your farm and the exact problem.',
    possibleCauses: [],
    checks: ['Name the crop or animal', 'Share your district', 'Describe the symptoms and how long they have been present'],
    actions: ['You can add a clear photo in good daylight', 'Mention any treatment already tried'],
    prevention: [],
    warning: 'For urgent animal illness, severe crop damage, or chemical exposure, contact a qualified local professional.',
    confidence: 'needs-more-information',
    followUp: 'What crop or animal are we discussing, and what is the most important sign you can see?',
    sources: [],
  };
}

type GuestUsageRecord = { date: string; textAndVoice: number; images: number };
type AccountAIUsageRecord = { date: string; total: number };
type AIRateWindow = { startedAt: number; count: number };
const guestAIUsage = new Map<string, GuestUsageRecord>();
const accountAIUsage = new Map<string, AccountAIUsageRecord>();
const aiRateWindows = new Map<string, AIRateWindow>();
const accountCarts = new Map<string, Array<{ listingId: string; quantity: number }>>();
const accountSavedListingIds = new Map<string, Set<string>>([['usr_buyer_demo', new Set(buyerSavedListingIds)]]);
const accountAIConversations = new Map<string, Array<{ role: 'user' | 'assistant'; summary: string }>>();
const persistedAIConversations = await query<{ account_id: string; payload: Array<{ role: 'user' | 'assistant'; summary: string }> }>('select account_id, payload from communication.runtime_ai_conversations').catch(() => null);
for (const row of persistedAIConversations?.rows || []) accountAIConversations.set(row.account_id, row.payload || []);

function kampalaDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nextKampalaMidnight(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1) - 3 * 60 * 60 * 1000).toISOString();
}

function consumeAIRateWindow(key: string) {
  const now = Date.now();
  const duration = 5 * 60 * 1000;
  const current = aiRateWindows.get(key);
  const window = !current || now - current.startedAt >= duration ? { startedAt: now, count: 0 } : current;
  const limit = settings.aiRateLimitPerFiveMinutes;
  if (window.count >= limit) return { allowed: false, limit, remaining: 0, resetAt: new Date(window.startedAt + duration).toISOString() };
  window.count += 1;
  aiRateWindows.set(key, window);
  return { allowed: true, limit, remaining: Math.max(0, limit - window.count), resetAt: new Date(window.startedAt + duration).toISOString() };
}

function guestIdentity(request: any, reply: any) {
  let id = request.cookies?.agri_guest;
  if (!id) {
    id = randomUUID();
    reply.setCookie('agri_guest', id, { ...sessionCookie, httpOnly: true, maxAge: 365 * 24 * 60 * 60 });
  }
  return id as string;
}

app.post('/api/v1/ai/ask', {
  config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
}, async (request: any, reply) => {
  if (!settings.aiEnabled) return problem(reply, 503, 'AI_DISABLED', 'The agricultural AI service is temporarily unavailable.');
  const parsed = aiInput.safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please add a little more detail to your question.', parsed.error.flatten());
  if (parsed.data.mode === 'image') return problem(reply, 503, 'AI_IMAGE_PROVIDER_NOT_CONFIGURED', 'Image analysis is unavailable because no secure image-model provider is configured. The selected photo was not uploaded or analyzed.');
  if (parsed.data.mode === 'voice' && !settings.aiVoiceEnabled) return problem(reply, 503, 'AI_VOICE_DISABLED', 'AI voice assistance is temporarily disabled by platform policy.');

  let usageMeta: any = { authenticated: Boolean(request.auth) };
  if (request.auth) {
    if (request.auth.user.status !== 'ACTIVE') return problem(reply, 403, 'ACCOUNT_UNAVAILABLE', 'This account is not currently active.');
    const csrfResult = await requireCsrf(request, reply);
    if (reply.sent) return csrfResult;
    const today = kampalaDay();
    const daily = accountAIUsage.get(request.auth.user.id)?.date === today ? accountAIUsage.get(request.auth.user.id)! : { date: today, total: 0 };
    if (daily.total >= settings.aiAuthenticatedDailyLimit) return reply.status(429).type('application/problem+json').send({
      type: 'https://docs.example/errors/account-ai-limit', title: 'You’ve reached today’s account AI limit.', status: 429,
      code: 'ACCOUNT_AI_LIMIT_REACHED', limit: settings.aiAuthenticatedDailyLimit, used: daily.total,
      resetAt: nextKampalaMidnight(today), traceId: reply.getHeader('x-request-id'),
    });
    const rate = consumeAIRateWindow(`account:${request.auth.user.id}`);
    if (!rate.allowed) return reply.status(429).type('application/problem+json').send({
      type: 'https://docs.example/errors/ai-rate-limit', title: 'Too many AI requests. Please wait before asking again.', status: 429,
      code: 'AI_RATE_LIMIT_REACHED', limit: rate.limit, resetAt: rate.resetAt, traceId: reply.getHeader('x-request-id'),
    });
    daily.total += 1; accountAIUsage.set(request.auth.user.id, daily);
    usageMeta = { authenticated: true, mode: parsed.data.mode, used: daily.total, limit: settings.aiAuthenticatedDailyLimit, remaining: Math.max(0, settings.aiAuthenticatedDailyLimit - daily.total), rateRemaining: rate.remaining };
  } else {
    if (!settings.guestAccess.ai) return problem(reply, 403, 'GUEST_AI_DISABLED', 'AI Advisor currently requires an account.');
    if (parsed.data.mode === 'image' && !settings.guestAccess.imageAnalysis) return problem(reply, 403, 'GUEST_IMAGE_AI_DISABLED', 'Guest image analysis currently requires an account.');
    if (parsed.data.mode === 'voice' && !settings.guestAccess.voice) return problem(reply, 403, 'GUEST_VOICE_DISABLED', 'Guest voice AI currently requires an account.');
    const id = guestIdentity(request, reply);
    const rate = consumeAIRateWindow(`guest:${id}`);
    if (!rate.allowed) return reply.status(429).type('application/problem+json').send({
      type: 'https://docs.example/errors/ai-rate-limit', title: 'Too many AI requests. Please wait before asking again.', status: 429,
      code: 'AI_RATE_LIMIT_REACHED', limit: rate.limit, resetAt: rate.resetAt, traceId: reply.getHeader('x-request-id'),
    });
    const today = kampalaDay();
    const usage = guestAIUsage.get(id)?.date === today ? guestAIUsage.get(id)! : { date: today, textAndVoice: 0, images: 0 };
    const isImage = parsed.data.mode === 'image';
    const used = isImage ? usage.images : usage.textAndVoice;
    const limit = isImage ? settings.guestAccess.imageDailyLimit : settings.guestAccess.aiDailyLimit;
    if (used >= limit) {
      return reply.status(429).type('application/problem+json').send({
        type: 'https://docs.example/errors/guest-ai-limit',
        title: `You’ve reached today’s free guest ${isImage ? 'image analysis' : 'AI'} limit.`,
        status: 429, code: 'GUEST_AI_LIMIT_REACHED', limit, used,
        resetAt: nextKampalaMidnight(today), traceId: reply.getHeader('x-request-id'),
      });
    }
    if (isImage) usage.images += 1; else usage.textAndVoice += 1;
    guestAIUsage.set(id, usage);
    usageMeta = {
      authenticated: false, mode: parsed.data.mode, used: isImage ? usage.images : usage.textAndVoice,
      limit, remaining: Math.max(0, limit - (isImage ? usage.images : usage.textAndVoice)), rateRemaining: rate.remaining,
    };
  }

  await new Promise(resolve => setTimeout(resolve, 500));
  return {
    data: {
      id: `aim_${randomUUID().slice(0, 10)}`,
      role: 'assistant',
      ...aiAnswer(parsed.data.message, parsed.data.language),
      createdAt: new Date().toISOString(),
      disclaimer: 'General educational guidance; not a guaranteed crop or veterinary diagnosis.',
    },
    meta: { guestUsage: usageMeta },
  };
});

app.post('/api/v1/ai/migrate-guest', { preHandler: [requireAuth, requireCsrf] }, async (request: any, reply) => {
  const parsed = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), summary: z.string().trim().min(1).max(4000) })).min(1).max(20) }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the temporary AI conversation.', parsed.error.flatten());
  const current = accountAIConversations.get(request.auth.user.id) || [];
  const normalized = parsed.data.messages.filter(message => message.summary.length > 0);
  accountAIConversations.set(request.auth.user.id, [...current, ...normalized].slice(-100));
  await query(`insert into communication.runtime_ai_conversations(account_id,payload,updated_at) values ($1,$2::jsonb,now()) on conflict (account_id) do update set payload=excluded.payload,updated_at=now()`, [request.auth.user.id, JSON.stringify(accountAIConversations.get(request.auth.user.id))]);
  return { data: { migratedMessages: normalized.length }, message: 'Temporary AI conversation saved to your account history.' };
});

const orderInput = z.object({
  listingId: z.string().min(3),
  quantity: z.coerce.number().positive(),
  deliveryMethod: z.enum(['pickup', 'delivery']).default('pickup'),
  paymentMethodId: z.string().min(3).max(100),
});
const orderIdempotency = new Map<string, { requestHash: string; response: any }>();
const orders = new Map<string, any>([...seedOrders.map(order => [order.id, { ...order }] as const), ...persistedOrders.map(row => [row.id, row.payload] as const)]);

app.get('/api/v1/orders', { preHandler: requireAuth }, async (request: any) => {
  const ownOrders = [...orders.values()].filter(order => canViewOrder(request.auth.user, order));
  return { data: ownOrders, meta: { total: ownOrders.length, roleView: request.auth.user.role } };
});

app.get('/api/v1/orders/:id', { preHandler: requireAuth }, async (request: any, reply) => {
  const order = orders.get(request.params.id);
  if (!order) return problem(reply, 404, 'NOT_FOUND', 'Order not found.');
  if (!canViewOrder(request.auth.user, order)) return problem(reply, 403, 'NOT_ORDER_PARTICIPANT', 'You cannot view another user’s order.');
  return { data: order };
});

app.post('/api/v1/orders', {
  preHandler: [requireAuth, requireCsrf, requireRole('BUYER'), requirePermission('orders.create')],
}, async (request: any, reply) => {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8 || key.length > 100) return problem(reply, 400, 'IDEMPOTENCY_REQUIRED', 'Please retry this order safely.');
  const buyer = request.auth.user as AuthUserRecord;
  const parsed = orderInput.safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the order quantity.', parsed.error.flatten());
  const idempotencyId = `${buyer.id}:${key}`; const requestHash = JSON.stringify(parsed.data); const existing = orderIdempotency.get(idempotencyId);
  if (existing) return existing.requestHash === requestHash ? existing.response : problem(reply, 409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for different order details.');
  const listing = listings.find(item => item.id === parsed.data.listingId && item.available);
  if (!listing) return problem(reply, 404, 'NOT_FOUND', 'This listing is no longer available.');
  if (parsed.data.quantity > listing.quantity) return problem(reply, 409, 'INSUFFICIENT_QUANTITY', `Only ${listing.quantity} ${listing.unit} is available.`);

  const gross = Math.round(listing.price * parsed.data.quantity);
  if (!Number.isSafeInteger(gross)) return problem(reply, 422, 'AMOUNT_TOO_LARGE', 'This order amount cannot be processed.');
  const method = publicPaymentMethods().find(item => item.id === parsed.data.paymentMethodId);
  if (!method) return problem(reply, 409, 'PAYMENT_METHOD_UNAVAILABLE', 'This payment method is no longer available. Choose another method.');
  if (method.currency !== (listing.currency || 'UGX')) return problem(reply, 409, 'PAYMENT_CURRENCY_UNSUPPORTED', 'This payment method does not support the listing currency.');
  if (gross < method.minimumAmount || gross > method.maximumAmount) return problem(reply, 422, 'PAYMENT_AMOUNT_OUT_OF_RANGE', `This method accepts amounts from ${method.minimumAmount} to ${method.maximumAmount} ${method.currency}.`);
  const commissionRule = resolveCommissionRule(listing.category, listing.sellerId);
  const fees = calculateFees(gross, commissionRule.rateBasisPoints, method.feeBasisPoints);
  const id = randomUUID();
  const order = {
    id, reference: `HL-${new Date().getFullYear()}-${String(orders.size + 1).padStart(5, '0')}`,
    buyerId: buyer.id, buyerName: buyer.name, sellerId: listing.sellerId, sellerName: listing.seller, status: 'payment_pending',
    listing: Object.freeze({ id: listing.id, title: listing.title, category: listing.category, unit: listing.unit, unitPrice: listing.price }),
    quantity: parsed.data.quantity, currency: method.currency, ...fees,
    paymentMethod: Object.freeze({ id: method.id, name: method.name, provider: method.provider, icon: method.icon, environment: method.environment, feeBasisPoints: method.feeBasisPoints }),
    financialSnapshot: Object.freeze({ amountsStoredInSmallestCurrencyUnit: true, paymentFeeBasisPoints: method.feeBasisPoints, commissionBasisPoints: commissionRule.rateBasisPoints, commissionRuleId: commissionRule.id, commissionRuleVersion: commissionRule.version, commissionEffectiveFrom: commissionRule.effectiveFrom }),
    inventoryReservation: { quantity: parsed.data.quantity, status: 'reserved' },
    deliveryMethod: parsed.data.deliveryMethod, createdAt: new Date().toISOString(),
    notice: 'Payment is marked verified only after a valid server-side provider event.',
  };
  listing.quantity -= parsed.data.quantity;
  if (listing.quantity === 0) { listing.available = false; (listing as any).status = 'sold_out'; }
  orders.set(id, order);
  await persistOrder(order, idempotencyId, requestHash);
  notify(order.sellerId, 'orders', 'New order awaiting payment', `${order.buyerName} ordered ${order.quantity} ${order.listing.unit} of ${order.listing.title}.`, `/orders`);
  const response = { data: order };
  orderIdempotency.set(idempotencyId, { requestHash, response });
  reply.status(201);
  return response;
});

const processedProviderEvents = new Map<string, any>();
const processedProviderReferences = new Map<string, string>();
app.post('/api/v1/payments/sandbox/verify', { preHandler: [requireAuth, requireCsrf, requireRole('BUYER')] }, async (request: any, reply) => {
  if (process.env.NODE_ENV === 'production') return problem(reply, 404, 'NOT_FOUND', 'Not found.');
  const parsed = z.object({ orderId: z.string(), eventId: z.string().min(8), providerReference: z.string().min(5), amount: z.number().int().positive() }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'INVALID_PROVIDER_EVENT', 'The provider event could not be verified.', parsed.error.flatten());
  if (processedProviderEvents.has(parsed.data.eventId)) return processedProviderEvents.get(parsed.data.eventId);
  const order = orders.get(parsed.data.orderId);
  if (!order) return problem(reply, 404, 'NOT_FOUND', 'Order not found.');
  if (!canViewOrder(request.auth.user, order)) return problem(reply, 403, 'NOT_ORDER_PARTICIPANT', 'You cannot pay another buyer’s order.');
  if (parsed.data.amount !== order.buyerTotal) return problem(reply, 409, 'PAYMENT_AMOUNT_MISMATCH', 'The received amount does not match the order total.');
  if (!order.paymentMethod?.id) return problem(reply, 409, 'PAYMENT_METHOD_REQUIRED', 'This order does not have a payment-method snapshot.');
  if (order.payment?.status === 'verified') return { data: order, duplicate: true };
  const referenceOrder = processedProviderReferences.get(parsed.data.providerReference);
  if (referenceOrder && referenceOrder !== order.id) return problem(reply, 409, 'PROVIDER_REFERENCE_REUSED', 'This provider reference has already been applied to another order.');
  const verifiedAt = new Date().toISOString();
  order.status = 'payment_verified';
  order.payment = {
    id: `pay_${randomUUID().slice(0, 12)}`, status: 'verified', provider: order.paymentMethod.provider,
    paymentMethod: { ...order.paymentMethod }, providerReference: parsed.data.providerReference,
    amount: parsed.data.amount, currency: order.currency, providerEventId: parsed.data.eventId, verifiedAt,
  };
  const configuredMethod = findPaymentMethod(order.paymentMethod.id);
  if (configuredMethod) { configuredMethod.lastSuccessfulTransaction = verifiedAt; configuredMethod.updatedAt = verifiedAt; }
  recordVerifiedPayment({
    id: order.payment.id, orderId: order.reference, buyer: order.buyerName, amount: order.buyerTotal,
    paymentMethodId: order.paymentMethod.id, method: order.paymentMethod.name, provider: order.paymentMethod.provider,
    status: 'successful', reference: parsed.data.providerReference, date: verifiedAt,
  });
  const response = { data: order, duplicate: false };
  await persistOrder(order);
  processedProviderEvents.set(parsed.data.eventId, response);
  processedProviderReferences.set(parsed.data.providerReference, order.id);
  notify(order.sellerId, 'orders', 'Order payment verified', `Payment for ${order.reference} was verified. You can begin fulfilment.`, `/orders`);
  return response;
});

app.patch('/api/v1/orders/:id/complete', { preHandler: [requireAuth, requireCsrf, requireRole('BUYER')] }, async (request: any, reply) => {
  const order = orders.get(request.params.id);
  if (!order) return problem(reply, 404, 'NOT_FOUND', 'Order not found.');
  if (order.buyerId !== request.auth.user.id) return problem(reply, 403, 'NOT_ORDER_BUYER', 'Only the purchasing buyer can confirm this delivery.');
  if (order.status !== 'delivered') return problem(reply, 409, 'INVALID_ORDER_TRANSITION', 'Only a delivered order can be completed.');
  const before = order.status; order.status = 'completed'; order.completedAt = new Date().toISOString(); order.updatedLabel = 'Just now';
  if (order.inventoryReservation?.status === 'reserved') order.inventoryReservation.status = 'consumed';
  await persistOrder(order);
  const ledgerEntry = createLedgerEntryFromOrder(order);
  audit({ actorId: request.auth.user.id, action: 'order.complete', targetType: 'order', targetId: order.id, before: { status: before }, after: { status: order.status, ledgerEntryId: ledgerEntry.id }, reason: 'Buyer confirmed delivery' });
  notify(order.sellerId, 'orders', 'Order completed', `${order.reference} was completed and its net earnings were posted to your ledger.`, `/earnings`);
  return { data: order, ledger: { id: ledgerEntry.id, status: ledgerEntry.status }, message: 'Delivery confirmed and seller earnings released to the ledger.' };
});

app.patch('/api/v1/orders/:id/cancel', { preHandler: [requireAuth, requireCsrf, requireRole('BUYER')] }, async (request: any, reply) => {
  const order = orders.get(request.params.id);
  if (!order) return problem(reply, 404, 'NOT_FOUND', 'Order not found.');
  if (order.buyerId !== request.auth.user.id) return problem(reply, 403, 'NOT_ORDER_BUYER', 'You cannot cancel another buyer’s order.');
  if (order.status !== 'payment_pending') return problem(reply, 409, 'INVALID_ORDER_TRANSITION', 'Only an unpaid order can be cancelled directly. Request support for a paid order.');
  const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'REASON_REQUIRED', 'Record why you are cancelling this order.');
  order.status = 'cancelled'; order.cancelledAt = new Date().toISOString();
  if (order.inventoryReservation?.status === 'reserved') {
    const listing = listings.find(item => item.id === order.listing.id);
    if (listing) { listing.quantity += order.inventoryReservation.quantity; listing.available = true; if ((listing as any).status === 'sold_out') (listing as any).status = 'published'; }
    order.inventoryReservation.status = 'released';
  }
  await persistOrder(order);
  audit({ actorId: request.auth.user.id, action: 'order.cancel', targetType: 'order', targetId: order.id, before: { status: 'payment_pending' }, after: { status: 'cancelled' }, reason: parsed.data.reason });
  notify(order.sellerId, 'orders', 'Unpaid order cancelled', `${order.reference} was cancelled before payment. Reserved stock was released.`, `/orders`);
  return { data: order, message: 'Unpaid order cancelled.' };
});

app.post('/api/v1/orders/:id/review', { preHandler: [requireAuth, requireCsrf, requireRole('BUYER'), requirePermission('reviews.create.completed')] }, async (request: any, reply) => {
  const order = orders.get(request.params.id);
  if (!order) return problem(reply, 404, 'NOT_FOUND', 'Order not found.');
  const parsed = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose a rating from 1 to 5 and an optional comment.', parsed.error.flatten());
  const result = createFarmerReview(order, request.auth.user.id, parsed.data.rating, parsed.data.comment);
  if ('error' in result) return problem(reply, result.error === 'REVIEW_ALREADY_EXISTS' ? 409 : 403, result.error, result.error === 'REVIEW_ALREADY_EXISTS' ? 'This completed transaction already has a review.' : 'Only the buyer from a completed transaction can review the farmer.');
  const farmerReviews = reviewsForFarmer(order.sellerId); const averageRating = farmerReviews.reduce((sum, review) => sum + review.rating, 0) / farmerReviews.length;
  for (const listing of listings.filter(item => item.sellerId === order.sellerId)) { listing.rating = Number(averageRating.toFixed(1)); listing.reviews = farmerReviews.length; }
  if (roleProfiles[order.sellerId]) { roleProfiles[order.sellerId].rating = Number(averageRating.toFixed(1)); roleProfiles[order.sellerId].reviewCount = farmerReviews.length; }
  audit({ actorId: request.auth.user.id, action: 'farmer.review.create', targetType: 'order', targetId: order.id, before: null, after: { reviewId: result.data.id, farmerId: order.sellerId, rating: result.data.rating }, reason: null });
  notify(order.sellerId, 'market', 'New verified review', `${order.buyerName} rated completed order ${order.reference} ${result.data.rating} out of 5.`, `/farmer/${order.sellerId}`);
  reply.status(201); return { data: result.data, message: 'Farmer review published.' };
});

app.get('/api/v1/farmer/dashboard', { preHandler: [requireAuth, requireRole('FARMER_SELLER')] }, async (request: any) => {
  const farmerId = request.auth.user.id; const ownListings = listings.filter(item => item.sellerId === farmerId); const ownOrders = [...orders.values()].filter(order => order.sellerId === farmerId);
  const portfolio = farmerPortfolio(farmerId, [...orders.values()]); const active = ownListings.filter(item => item.available && (item as any).status !== 'archived');
  return { data: {
    farmer: roleUser(request.auth.user),
    stats: { activeListings: active.length, drafts: farmerDrafts(farmerId).length, pendingOrders: ownOrders.filter(order => !['completed','cancelled','refunded'].includes(order.status)).length, completedSales: portfolio.totals.completedSales, availableEarnings: portfolio.totals.availableBalance, pendingEarnings: portfolio.totals.pendingBalance, platformFees: portfolio.totals.platformFees, paymentFees: portfolio.totals.paymentFees, grossRevenue: portfolio.totals.grossRevenue },
    prices: marketPrices, marketListings: listings.filter(item => item.available && item.sellerId !== farmerId).slice(0,4).map(publicListing), buyerOpportunities: settings.buyerRequestsEnabled ? listBuyerRequests({status:'open'},farmerId).slice(0,4) : [], alerts, recentOrders: ownOrders.slice(0,5), recentNotifications: accountNotifications(farmerId).slice(0,5), notificationStatus: 'development_repository', learning: articles.slice(0,4),
    weather: { status: 'configuration_required', district: request.auth.user.district, message: 'Live weather provider is not configured. No forecast is being presented as current.' },
  } };
});

app.get('/api/v1/farmer/listings', { preHandler: [requireAuth, requireRole('FARMER_SELLER')] }, async (request: any, reply) => {
  const parsed = z.object({ status: z.enum(['ALL','published','draft','paused','sold_out','archived']).default('ALL') }).safeParse(request.query);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose a valid product status.');
  const farmerId = request.auth.user.id; const allOrders = [...orders.values()];
  const published = listings.filter(item => item.sellerId === farmerId).map(item => ({ ...item, kind: 'listing', status: (item as any).status || (item.available ? 'published' : 'paused'), orderCount: allOrders.filter(order => order.listing.id === item.id).length, createdAt: (item as any).createdAt || item.postedAt }));
  const draftRecords = farmerDrafts(farmerId).map(draft => ({ ...draft, kind: 'draft', image: draft.images[0]?.url || null, orderCount: 0, views: 0, interestedBuyers: 0 }));
  const result = [...draftRecords, ...published].filter(item => parsed.data.status === 'ALL' || item.status === parsed.data.status);
  return { data: result, meta: { total: result.length, counts: Object.fromEntries(['published','draft','paused','sold_out','archived'].map(status => [status, [...draftRecords,...published].filter(item => item.status === status).length])) } };
});

app.get('/api/v1/farmer/earnings', { preHandler: [requireAuth, requireRole('FARMER_SELLER'), requirePermission('earnings.read.own')] }, async (request: any, reply) => {
  const parsed = z.object({ period: z.enum(['today','week','month','year','all']).default('all') }).safeParse(request.query);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose a valid earnings period.');
  return { data: farmerPortfolio(request.auth.user.id, [...orders.values()], parsed.data.period) };
});

app.get('/api/v1/farmer/payout-methods', { preHandler: [requireAuth, requireRole('FARMER_SELLER'), requirePermission('earnings.read.own')] }, async (request: any) => ({ data: payoutMethodsForFarmer(request.auth.user) }));
app.post('/api/v1/farmer/withdrawal-quote', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('earnings.read.own')] }, async (request: any, reply) => {
  const parsed = z.object({ amount: z.coerce.number().int().positive() }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Enter a valid withdrawal amount.');
  const portfolio = farmerPortfolio(request.auth.user.id, [...orders.values()]);
  return { data: { ...quoteWithdrawal(parsed.data.amount), availableBalance: portfolio.totals.availableBalance, requiresTwoFactor: parsed.data.amount >= 1_000_000 } };
});
const withdrawalIdempotency = new Map<string, { requestHash: string; response: any }>();
app.post('/api/v1/farmer/withdrawals', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('earnings.read.own')] }, async (request: any, reply) => {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8 || key.length > 100) return problem(reply, 400, 'IDEMPOTENCY_REQUIRED', 'Retry this withdrawal with a valid idempotency key.');
  const parsed = z.object({ amount: z.coerce.number().int().positive(), payoutMethodId: z.string().trim().min(3).max(100), confirmation: z.string().trim().max(100).optional(), otp: z.string().regex(/^\d{6}$/).optional() }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Enter a valid withdrawal amount and payout method.', parsed.error.flatten());
  const idempotencyId = `${request.auth.user.id}:${key}`; const requestHash = JSON.stringify({ amount: parsed.data.amount, payoutMethodId: parsed.data.payoutMethodId }); const prior = withdrawalIdempotency.get(idempotencyId);
  if (prior) return prior.requestHash === requestHash ? prior.response : problem(reply, 409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for different withdrawal details.');
  const result = requestWithdrawal(request.auth.user, [...orders.values()], parsed.data);
  if ('error' in result) {
    const messages: Record<string,string> = { ACCOUNT_VERIFICATION_REQUIRED: 'Verify your farmer account before requesting a withdrawal.', PAYOUT_METHOD_INVALID: 'Choose an enabled payout method.', WITHDRAWAL_MINIMUM: `The minimum withdrawal is ${'minimum' in result ? result.minimum : 10000} UGX.`, INSUFFICIENT_BALANCE: `Available balance is ${'available' in result ? result.available : 0} UGX.`, TWO_FACTOR_REQUIRED: 'Enable authenticator-based two-factor authentication before a high-value withdrawal.', STEP_UP_REQUIRED: 'Type the exact amount and enter a current authenticator code.' };
    return problem(reply, ['INSUFFICIENT_BALANCE','WITHDRAWAL_MINIMUM'].includes(result.error) ? 409 : 403, result.error, messages[result.error]);
  }
  audit({ actorId: request.auth.user.id, action: 'farmer.withdrawal.request', targetType: 'withdrawal', targetId: result.data.id, before: null, after: { amount: result.data.amount, fee: result.data.fee, amountReceived: result.data.amountReceived, payoutMethodId: result.data.payoutMethodId, status: result.data.status }, reason: 'Farmer requested eligible available funds', sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0,12) } });
  const response = { data: result.data, message: 'Withdrawal requested. Funds are reserved while the payout is reviewed.' }; withdrawalIdempotency.set(idempotencyId, { requestHash, response });
  reply.status(201); return response;
});

app.get('/api/v1/farmer/earnings/statement', { preHandler: [requireAuth, requireRole('FARMER_SELLER'), requirePermission('earnings.read.own')] }, async (request: any, reply) => {
  const parsed = z.object({ format: z.enum(['csv','xlsx','pdf']).default('csv'), from: z.string().date().optional(), to: z.string().date().optional(), product: z.string().trim().max(100).optional(), status: z.enum(['ALL','available','withdrawn','reversed']).default('ALL') }).safeParse(request.query);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check the statement filters.', parsed.error.flatten());
  const records = farmerLedger(request.auth.user.id, parsed.data);
  const columns = [{key:'completedAt',label:'Date'},{key:'id',label:'Transaction ID'},{key:'orderReference',label:'Order reference'},{key:'product',label:'Product'},{key:'quantity',label:'Quantity'},{key:'unit',label:'Unit'},{key:'gross',label:'Gross sale'},{key:'commission',label:'Commission'},{key:'paymentFee',label:'Payment fee'},{key:'net',label:'Net earnings'},{key:'status',label:'Status'}];
  const output = buildAdminExport('farmer-earnings', parsed.data.format, { reportTitle: 'Farmer earnings statement', columns, records });
  audit({ actorId: request.auth.user.id, action: 'farmer.earnings.statement.export', targetType: 'farmer_ledger', targetId: parsed.data.format, before: null, after: { records: records.length, filters: { from: parsed.data.from, to: parsed.data.to, product: parsed.data.product, status: parsed.data.status } }, reason: 'Farmer downloaded own earnings statement' });
  reply.header('content-disposition', `attachment; filename="farmer-earnings-${new Date().toISOString().slice(0,10)}.${output.extension}"`);
  return reply.type(output.contentType).send(output.body);
});

app.get('/api/v1/buyer/saved', { preHandler: [requireAuth, requireRole('BUYER'), requirePermission('saved.manage.own')] }, async (request: any) => {
  const ids = accountSavedListingIds.get(request.auth.user.id) || new Set<string>();
  return { data: listings.filter(item => ids.has(item.id) && item.available).map(publicListing), meta: { total: ids.size } };
});
app.post('/api/v1/buyer/saved/:listingId', { preHandler: [requireAuth, requireCsrf, requireRole('BUYER'), requirePermission('saved.manage.own')] }, async (request: any, reply) => {
  const listing = listings.find(item => item.id === request.params.listingId && item.available);
  if (!listing) return problem(reply, 404, 'NOT_FOUND', 'This listing is no longer available.');
  const ids = accountSavedListingIds.get(request.auth.user.id) || new Set<string>(); const wasSaved = ids.has(listing.id); ids.add(listing.id); accountSavedListingIds.set(request.auth.user.id, ids);
  if (!wasSaved) (listing as any).interestedBuyers = Number((listing as any).interestedBuyers || 0) + 1;
  return { data: { listingId: listing.id, saved: true }, message: 'Product saved to your buyer account.' };
});
app.delete('/api/v1/buyer/saved/:listingId', { preHandler: [requireAuth, requireCsrf, requireRole('BUYER'), requirePermission('saved.manage.own')] }, async (request: any) => {
  const ids = accountSavedListingIds.get(request.auth.user.id) || new Set<string>(); const wasSaved = ids.delete(request.params.listingId); accountSavedListingIds.set(request.auth.user.id, ids);
  const listing = listings.find(item => item.id === request.params.listingId); if (listing && wasSaved) (listing as any).interestedBuyers = Math.max(0, Number((listing as any).interestedBuyers || 0) - 1);
  return { data: { listingId: request.params.listingId, saved: false }, message: 'Product removed from saved items.' };
});

app.patch('/api/v1/orders/:id/status', { preHandler: [requireAuth, requireCsrf, requireRole('FARMER_SELLER'), requirePermission('orders.fulfil.own')] }, async (request: any, reply) => {
  const order = orders.get(request.params.id);
  if (!order) return problem(reply, 404, 'NOT_FOUND', 'Order not found.');
  if (order.sellerId !== request.auth.user.id) return problem(reply, 403, 'NOT_ORDER_SELLER', 'You can update only orders for your products.');
  const parsed = z.object({ status: z.enum(['processing', 'ready_for_delivery', 'delivered']) }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'INVALID_ORDER_STATE', 'Farmers cannot set payment or financial order states.');
  const allowed: Record<string, string[]> = {
    payment_verified: ['processing'], processing: ['ready_for_delivery'], ready_for_delivery: ['delivered'],
  };
  if (!allowed[order.status]?.includes(parsed.data.status)) return problem(reply, 409, 'INVALID_ORDER_TRANSITION', `The order cannot move from ${order.status} to ${parsed.data.status}.`);
  const oldStatus = order.status;
  order.status = parsed.data.status;
  order.updatedLabel = 'Just now';
  await persistOrder(order);
  audit({ actorId: request.auth.user.id, action: 'order.status.update', targetType: 'order', targetId: order.id, before: { status: oldStatus }, after: { status: order.status }, reason: null });
  notify(order.buyerId, 'orders', 'Order status updated', `${order.reference} is now ${String(order.status).replaceAll('_',' ')}.`, `/orders`);
  return { data: order, message: 'Order status updated.' };
});

app.get('/api/v1/admin/users', { preHandler: [requireAuth, requireRole('ADMIN'), requirePermission('users.read')] }, async (request: any, reply) => {
  const parsed = z.object({ q: z.string().max(100).optional(), role: z.enum(['ALL', ...ROLES]).default('ALL'), status: z.enum(['ALL', 'ACTIVE', 'PENDING', 'SUSPENDED', 'DELETED']).default('ALL') }).safeParse(request.query);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the user filters.');
  let result = users;
  if (parsed.data.q) {
    const q = parsed.data.q.toLowerCase();
    result = result.filter(user => `${user.name} ${user.phone} ${user.email || ''} ${user.location}`.toLowerCase().includes(q));
  }
  if (parsed.data.role !== 'ALL') result = result.filter(user => user.role === parsed.data.role);
  if (parsed.data.status !== 'ALL') result = result.filter(user => user.status === parsed.data.status);
  return { data: result.map(user => {
    const userListings = listings.filter(listing => listing.sellerId === user.id);
    const userOrders = seedOrders.filter(order => order.sellerId === user.id || order.buyerId === user.id);
    return { ...publicUser(user), joinedAt: user.joinedAt, lastActiveAt: user.lastActiveAt, listingCount: userListings.length, orderCount: userOrders.length, completedOrders: userOrders.filter(order => order.status === 'completed').length, marketplaceValue: userOrders.reduce((sum, order) => sum + order.gross, 0), reportCount: 0, twoFactorStatus: user.twoFactorEnabled ? 'enabled' : user.role === 'ADMIN' ? 'required' : 'available' };
  }), meta: { total: result.length } };
});

app.patch('/api/v1/admin/users/:id/role', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('users.role.change')] }, async (request: any, reply) => {
  const parsed = z.object({ role: z.enum(ROLES), reason: z.string().trim().min(3).max(300), confirmation: z.string().trim().max(80), otp: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose a valid role, record a reason and complete step-up verification.');
  const target = users.find(user => user.id === request.params.id);
  if (!target) return problem(reply, 404, 'NOT_FOUND', 'User not found.');
  if (target.id === request.auth.user.id) return problem(reply, 409, 'SELF_ROLE_CHANGE_BLOCKED', 'You cannot change your own administrator role.');
  const expectedOtp = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
  if (parsed.data.confirmation !== target.id || !expectedOtp || parsed.data.otp !== expectedOtp) {
    audit({ actorId: request.auth.user.id, action: 'user.role.change.denied', targetType: 'user', targetId: target.id, before: { role: target.role }, after: null, reason: parsed.data.reason, result: 'denied', sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
    return problem(reply, 403, 'STEP_UP_REQUIRED', `Type ${target.id} and enter a current authenticator code.`);
  }
  const oldRole = target.role;
  if (oldRole === parsed.data.role) return { data: publicUser(target), message: 'The user already has this role.' };
  if (parsed.data.role === 'ADMIN' && !target.twoFactorEnabled) {
    return problem(reply, 409, 'ADMIN_MFA_REQUIRED', 'Two-factor authentication must be enrolled before granting the ADMIN role.');
  }
  target.role = parsed.data.role;
  await persistUser(target);
  audit({ actorId: request.auth.user.id, action: 'user.role.change', targetType: 'user', targetId: target.id, before: { role: oldRole }, after: { role: target.role }, reason: parsed.data.reason, sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
  return { data: publicUser(target), message: `Role changed from ${oldRole} to ${target.role}.` };
});

app.patch('/api/v1/admin/users/:id/status', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('users.status.change')] }, async (request: any, reply) => {
  const parsed = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(3).max(300) }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose a status and record a reason.');
  const target = users.find(user => user.id === request.params.id);
  if (!target) return problem(reply, 404, 'NOT_FOUND', 'User not found.');
  if (target.id === request.auth.user.id) return problem(reply, 409, 'SELF_STATUS_CHANGE_BLOCKED', 'You cannot suspend your own administrator account.');
  const oldStatus = target.status;
  target.status = parsed.data.status;
  await persistUser(target);
  audit({ actorId: request.auth.user.id, action: 'user.status.change', targetType: 'user', targetId: target.id, before: { status: oldStatus }, after: { status: target.status }, reason: parsed.data.reason });
  return { data: publicUser(target), message: `Account is now ${target.status.toLowerCase()}.` };
});

const adminModuleKeys = Object.keys(adminModulePermissions) as [AdminModuleKey, ...AdminModuleKey[]];

app.patch('/api/v1/admin/users/:id/verification', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('farmers.verify')] }, async (request: any, reply) => {
  const parsed = z.object({ verified: z.boolean(), reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Record the evidence-based reason for this verification decision.');
  const target = users.find(user => user.id === request.params.id);
  if (!target) return problem(reply, 404, 'NOT_FOUND', 'User not found.');
  if (target.role === 'ADMIN') return problem(reply, 409, 'ADMIN_VERIFICATION_PROTECTED', 'Administrator trust is managed through security policy and role controls.');
  const before = { verified: target.verified };
  target.verified = parsed.data.verified;
  await persistUser(target);
  audit({ actorId: request.auth.user.id, action: 'user.verification.change', targetType: 'user', targetId: target.id, before, after: { verified: target.verified }, reason: parsed.data.reason, sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
  return { data: publicUser(target), message: target.verified ? 'User verification approved.' : 'User verification removed.' };
});

const paymentMethodFields = {
  name: z.string().trim().min(2).max(80), provider: z.string().trim().min(2).max(120),
  icon: z.enum(['phone', 'card', 'bank', 'gateway']), connectorType: z.enum(['sandbox', 'manual', 'generic_https']),
  enabled: z.boolean(), checkoutVisible: z.boolean(), currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  feePercent: z.coerce.number().min(0).max(100), minimumAmount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maximumAmount: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), environment: z.enum(['sandbox', 'production']),
  apiBaseUrl: z.string().trim().url().refine(value => value.startsWith('https://'), 'API base URL must use HTTPS.').optional().or(z.literal('')),
  testPath: z.string().trim().max(160).regex(/^\//).optional(), callbackUrl: z.string().trim().url().refine(value => value.startsWith('https://'), 'Callback URL must use HTTPS.'),
  apiKey: z.string().trim().max(500).optional(), secretKey: z.string().trim().max(500).optional(),
  merchantId: z.string().trim().max(200).optional(), accountBusinessNumber: z.string().trim().max(200).optional(),
};
const paymentMethodCreateInput = z.object({ ...paymentMethodFields, reason: z.string().trim().min(3).max(500), confirmation: z.literal('SAVE PAYMENT METHOD'), otp: z.string().regex(/^\d{6}$/) }).strict()
  .refine(value => value.maximumAmount >= value.minimumAmount, { message: 'Maximum amount must be at least the minimum amount.', path: ['maximumAmount'] })
  .refine(value => !(value.environment === 'production' && value.connectorType === 'sandbox'), { message: 'A sandbox adapter cannot be enabled as a production environment.', path: ['environment'] });
const paymentMethodUpdateInput = z.object({
  ...Object.fromEntries(Object.entries(paymentMethodFields).map(([key, validator]) => [key, (validator as z.ZodTypeAny).optional()])),
  reason: z.string().trim().min(3).max(500), confirmation: z.literal('SAVE PAYMENT METHOD'), otp: z.string().regex(/^\d{6}$/),
}).strict();
function validAuthenticatorOtp(otp: string | undefined) {
  const expected = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
  return Boolean(expected && otp === expected);
}
function paymentMethodSessionContext(request: any) {
  return { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) };
}

app.get('/api/v1/admin/payment-methods', { preHandler: [requireAuth, requireRole('ADMIN'), requirePermission('payment-methods.manage')] }, async () => ({
  data: adminPaymentMethods(), meta: { credentialsMasked: true, encryptedAtRest: true, total: adminPaymentMethods().length },
}));

app.post('/api/v1/admin/payment-methods', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('payment-methods.manage')] }, async (request: any, reply) => {
  const parsed = paymentMethodCreateInput.safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check the payment method details.', parsed.error.flatten());
  if (!validAuthenticatorOtp(parsed.data.otp)) return problem(reply, 403, 'STEP_UP_REQUIRED', 'Enter a current authenticator code to save payment credentials.');
  const { reason, confirmation: _confirmation, otp: _otp, ...input } = parsed.data;
  const record = createPaymentMethod(input as PaymentMethodInput);
  audit({ actorId: request.auth.user.id, action: 'admin.payment-method.create', targetType: 'payment_method', targetId: record.id, before: null, after: paymentMethodAuditView(record), reason, sessionContext: paymentMethodSessionContext(request) });
  reply.status(201);
  return { data: adminPaymentMethods().find(method => method.id === record.id), message: 'Payment method saved. Credentials are encrypted and will not be shown again.' };
});

app.patch('/api/v1/admin/payment-methods/:id', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('payment-methods.manage')] }, async (request: any, reply) => {
  const params = z.object({ id: z.string().trim().min(3).max(100) }).safeParse(request.params);
  const parsed = paymentMethodUpdateInput.safeParse(request.body);
  if (!params.success || !parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check the payment method details.', parsed.success ? params.error.flatten() : parsed.error.flatten());
  const record = findPaymentMethod(params.data.id);
  if (!record) return problem(reply, 404, 'NOT_FOUND', 'Payment method not found.');
  if (!validAuthenticatorOtp(parsed.data.otp)) return problem(reply, 403, 'STEP_UP_REQUIRED', 'Enter a current authenticator code to update payment credentials.');
  const { reason, confirmation: _confirmation, otp: _otp, ...input } = parsed.data;
  const nextMinimum = input.minimumAmount ?? record.minimumAmount; const nextMaximum = input.maximumAmount ?? record.maximumAmount;
  if (nextMaximum < nextMinimum) return problem(reply, 422, 'AMOUNT_RANGE_INVALID', 'Maximum amount must be at least the minimum amount.');
  const nextConnector = input.connectorType || record.connectorType; const nextEnvironment = input.environment || record.environment;
  if (nextEnvironment === 'production' && nextConnector === 'sandbox') return problem(reply, 422, 'ENVIRONMENT_INVALID', 'A sandbox adapter cannot be enabled as a production environment.');
  const endpointChanged = (input.apiBaseUrl !== undefined && (input.apiBaseUrl || null) !== record.apiBaseUrl) || (input.connectorType !== undefined && input.connectorType !== record.connectorType) || (input.environment !== undefined && input.environment !== record.environment);
  if (endpointChanged && (input.connectorType || record.connectorType) !== 'manual' && (!input.apiKey || !input.secretKey || !input.merchantId)) {
    return problem(reply, 422, 'CREDENTIAL_REENTRY_REQUIRED', 'Re-enter all provider credentials when changing the endpoint, connector, or environment. Existing secrets will not be forwarded to a new destination.');
  }
  const before = { method: paymentMethodAuditView(record), registryDefaultId: adminPaymentMethods().find(method => method.isDefault)?.id || null };
  updatePaymentMethod(record, input as Partial<PaymentMethodInput>);
  const after = { method: paymentMethodAuditView(record), registryDefaultId: adminPaymentMethods().find(method => method.isDefault)?.id || null };
  audit({ actorId: request.auth.user.id, action: 'admin.payment-method.update', targetType: 'payment_method', targetId: record.id, before, after, reason, sessionContext: paymentMethodSessionContext(request) });
  return { data: adminPaymentMethods().find(method => method.id === record.id), message: 'Payment method updated. Existing transaction snapshots were not changed.' };
});

app.post('/api/v1/admin/payment-methods/:id/action', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('payment-methods.manage')] }, async (request: any, reply) => {
  const params = z.object({ id: z.string().trim().min(3).max(100) }).safeParse(request.params);
  const body = z.object({ action: z.enum(['enable', 'disable', 'set_default', 'test_connection']), reason: z.string().trim().min(3).max(500), confirmation: z.string().trim().max(100).optional(), otp: z.string().regex(/^\d{6}$/).optional() }).strict().safeParse(request.body);
  if (!params.success || !body.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check the payment method action.', body.success ? params.error.flatten() : body.error.flatten());
  const record = findPaymentMethod(params.data.id);
  if (!record) return problem(reply, 404, 'NOT_FOUND', 'Payment method not found.');
  const sensitive = body.data.action !== 'test_connection';
  if (sensitive && (body.data.confirmation !== record.id || !validAuthenticatorOtp(body.data.otp))) {
    audit({ actorId: request.auth.user.id, action: `admin.payment-method.${body.data.action}.denied`, targetType: 'payment_method', targetId: record.id, before: null, after: null, reason: body.data.reason, result: 'denied', sessionContext: paymentMethodSessionContext(request) });
    return problem(reply, 403, 'STEP_UP_REQUIRED', `Type ${record.id} and enter a current authenticator code to continue.`);
  }
  const before = { method: paymentMethodAuditView(record), registryDefaultId: adminPaymentMethods().find(method => method.isDefault)?.id || null };
  let message = '';
  if (body.data.action === 'enable') {
    if (record.configStatus === 'incomplete') return problem(reply, 409, 'PAYMENT_CONFIGURATION_INCOMPLETE', 'Complete the required provider configuration before enabling this method.');
    setPaymentMethodEnabled(record, true); message = 'Payment method enabled. Checkout visibility follows its saved configuration.';
  }
  if (body.data.action === 'disable') { setPaymentMethodEnabled(record, false); message = 'Payment method disabled and removed from checkout. Historical transactions were preserved.'; }
  if (body.data.action === 'set_default') {
    if (!setDefaultPaymentMethod(record)) return problem(reply, 409, 'PAYMENT_METHOD_UNAVAILABLE', 'Enable the method and make it visible at checkout before setting it as default.');
    message = 'Default checkout payment method updated.';
  }
  let connection;
  if (body.data.action === 'test_connection') { connection = await testPaymentMethodConnection(record); message = connection.message; }
  const after = { method: paymentMethodAuditView(record), registryDefaultId: adminPaymentMethods().find(method => method.isDefault)?.id || null };
  audit({ actorId: request.auth.user.id, action: `admin.payment-method.${body.data.action}`, targetType: 'payment_method', targetId: record.id, before, after, reason: body.data.reason, sessionContext: paymentMethodSessionContext(request) });
  return { data: adminPaymentMethods().find(method => method.id === record.id), connection, message };
});

app.delete('/api/v1/admin/payment-methods/:id', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('payment-methods.manage')] }, async (request: any, reply) => {
  const params = z.object({ id: z.string().trim().min(3).max(100) }).safeParse(request.params);
  const body = z.object({ reason: z.string().trim().min(3).max(500), confirmation: z.string().trim().max(100), otp: z.string().regex(/^\d{6}$/) }).strict().safeParse(request.body);
  if (!params.success || !body.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Provide a reason and step-up verification to remove this method.', body.success ? params.error.flatten() : body.error.flatten());
  const record = findPaymentMethod(params.data.id);
  if (!record) return problem(reply, 404, 'NOT_FOUND', 'Payment method not found.');
  if (body.data.confirmation !== record.id || !validAuthenticatorOtp(body.data.otp)) return problem(reply, 403, 'STEP_UP_REQUIRED', `Type ${record.id} and enter a current authenticator code to continue.`);
  const before = { method: paymentMethodAuditView(record), registryDefaultId: adminPaymentMethods().find(method => method.isDefault)?.id || null };
  removePaymentMethod(record);
  const after = { method: paymentMethodAuditView(record), registryDefaultId: adminPaymentMethods().find(method => method.isDefault)?.id || null };
  audit({ actorId: request.auth.user.id, action: 'admin.payment-method.remove', targetType: 'payment_method', targetId: record.id, before, after, reason: body.data.reason, sessionContext: paymentMethodSessionContext(request) });
  return { data: { id: record.id, removedAt: record.removedAt }, message: 'Payment method removed from configuration and checkout. Historical transactions were preserved.' };
});

app.get('/api/v1/admin/attention', { preHandler: [requireAuth, requireRole('ADMIN')] }, async () => ({
  data: adminAttentionCounts(), updatedAt: new Date().toISOString(),
}));

app.get('/api/v1/admin/search', { preHandler: [requireAuth, requireRole('ADMIN')] }, async (request: any, reply) => {
  const parsed = z.object({ q: z.string().trim().min(2).max(100) }).safeParse(request.query);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Enter at least two characters to search.');
  return { data: adminGlobalSearch(parsed.data.q), meta: { query: parsed.data.q } };
});

app.get('/api/v1/admin/operations/:module', { preHandler: [requireAuth, requireRole('ADMIN')] }, async (request: any, reply) => {
  const parsed = z.object({
    module: z.enum(adminModuleKeys), q: z.string().trim().max(100).optional(), status: z.string().trim().max(40).optional(),
    readState: z.enum(['ALL', 'READ', 'UNREAD']).optional(), cursor: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
  }).safeParse({ ...request.params, ...request.query });
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the administrator module filters.', parsed.error.flatten());
  const permission = adminModulePermissions[parsed.data.module];
  if (!roleHasPermission(request.auth.user.role, permission)) return problem(reply, 403, 'PERMISSION_FORBIDDEN', 'You do not have access to this administrator module.');
  return { data: getAdminModule(parsed.data.module, parsed.data, request.auth.user.id) };
});

app.patch('/api/v1/admin/operations/:module/:id/read-state', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN')] }, async (request: any, reply) => {
  const params = z.object({ module: z.enum(adminModuleKeys), id: z.string().trim().min(1).max(160) }).safeParse(request.params);
  const body = z.object({ unread: z.boolean() }).strict().safeParse(request.body);
  if (!params.success || !body.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check the administrator record read state.');
  const permission = adminModulePermissions[params.data.module];
  if (!roleHasPermission(request.auth.user.role, permission)) return problem(reply, 403, 'PERMISSION_FORBIDDEN', 'You do not have access to this administrator module.');
  if (!adminModuleRecordExists(params.data.module, params.data.id)) return problem(reply, 404, 'NOT_FOUND', 'The administrator record was not found.');
  if (body.data.unread) {
    markAdminRecordUnread(request.auth.user.id, params.data.module, params.data.id);
    return { data: { id: params.data.id, unread: true, readAt: null } };
  }
  const view = markAdminRecordRead(request.auth.user.id, params.data.module, params.data.id);
  return { data: { id: params.data.id, unread: false, readAt: view.firstViewedAt } };
});

app.post('/api/v1/admin/operations/:module/read-visible', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN')] }, async (request: any, reply) => {
  const params = z.object({ module: z.enum(adminModuleKeys) }).safeParse(request.params);
  const body = z.object({ recordIds: z.array(z.string().trim().min(1).max(160)).min(1).max(100) }).strict().safeParse(request.body);
  if (!params.success || !body.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose one or more visible administrator records.');
  const permission = adminModulePermissions[params.data.module];
  if (!roleHasPermission(request.auth.user.role, permission)) return problem(reply, 403, 'PERMISSION_FORBIDDEN', 'You do not have access to this administrator module.');
  const recordIds = [...new Set(body.data.recordIds)];
  if (recordIds.some(recordId => !adminModuleRecordExists(params.data.module, recordId))) return problem(reply, 404, 'NOT_FOUND', 'One or more administrator records were not found.');
  const views = markAdminRecordsRead(request.auth.user.id, params.data.module, recordIds);
  return { data: views.map(view => ({ id: view.recordId, unread: false, readAt: view.firstViewedAt })), meta: { updated: views.length } };
});

app.get('/api/v1/admin/operations/:module/export', { preHandler: [requireAuth, requireRole('ADMIN')] }, async (request: any, reply) => {
  const parsed = z.object({ module: z.enum(adminModuleKeys), format: z.enum(['csv', 'xlsx', 'pdf']).default('csv') }).safeParse({ ...request.params, ...request.query });
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose CSV, Excel or PDF export format.');
  const permission = adminModulePermissions[parsed.data.module];
  if (!roleHasPermission(request.auth.user.role, permission)) return problem(reply, 403, 'PERMISSION_FORBIDDEN', 'You do not have permission to export this module.');
  const dataset = getAdminModule(parsed.data.module, { limit: 100 });
  const output = buildAdminExport(parsed.data.module, parsed.data.format, dataset);
  audit({ actorId: request.auth.user.id, action: `admin.${parsed.data.module}.export`, targetType: parsed.data.module, targetId: parsed.data.format, before: null, after: { format: parsed.data.format, records: dataset.meta.total }, reason: 'Administrator data export' });
  reply.header('content-disposition', `attachment; filename="${parsed.data.module}-${new Date().toISOString().slice(0, 10)}.${output.extension}"`);
  return reply.type(output.contentType).send(output.body);
});

app.post('/api/v1/admin/operations/market-prices/import', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('market_prices.manage')] }, async (request: any, reply) => {
  const parsed = z.object({
    rows: z.array(z.object({ title: z.string().trim().min(2).max(160), amount: z.coerce.number().positive().max(1_000_000_000), category: z.string().trim().max(80).optional(), grade: z.string().trim().max(80).optional(), location: z.string().trim().max(100).optional(), unit: z.string().trim().max(30).optional(), source: z.string().trim().max(160).optional(), effectiveAt: z.string().datetime().or(z.string().date()).optional() })).min(1).max(500),
    confirmation: z.literal('IMPORT PRICES'), otp: z.string().regex(/^\d{6}$/),
  }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check the price import columns and values.', parsed.error.flatten());
  const expectedOtp = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
  if (!expectedOtp || parsed.data.otp !== expectedOtp) return problem(reply, 403, 'STEP_UP_REQUIRED', 'Enter a current authenticator code to import published prices.');
  const created = parsed.data.rows.map(row => createAdminModuleRecord('market-prices', row)).filter(Boolean);
  audit({ actorId: request.auth.user.id, action: 'admin.market-prices.import', targetType: 'market-prices', targetId: `batch_${randomUUID().slice(0, 8)}`, before: null, after: { rows: created.length, ids: created.map(record => record!.id) }, reason: 'Administrator CSV price import; prior history retained', sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
  reply.status(201);
  return { data: created, message: `${created.length} price observations imported without overwriting history.` };
});

app.post('/api/v1/admin/operations/:module', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN')] }, async (request: any, reply) => {
  const params = z.object({ module: z.enum(['market-prices', 'content', 'advertisements', 'notifications', 'commissions']) }).safeParse(request.params);
  const body = z.object({
    title: z.string().trim().min(3).max(160), description: z.string().trim().max(4000).optional(),
    category: z.string().trim().max(80).optional(), grade: z.string().trim().max(80).optional(), location: z.string().trim().max(100).optional(),
    amount: z.coerce.number().min(0).max(1_000_000_000).optional(), unit: z.string().trim().max(30).optional(),
    source: z.string().trim().max(160).optional(), effectiveAt: z.string().datetime().or(z.string().date()).optional(),
    advertiser: z.string().trim().max(160).optional(), start: z.string().date().optional(), end: z.string().date().optional(), audience: z.string().trim().max(160).optional(),
    channel: z.string().trim().max(80).optional(), scheduledFor: z.string().datetime().optional(),
    type: z.string().trim().max(80).optional(), language: z.string().trim().max(40).optional(),
    status: z.string().trim().max(40).optional(), scope: z.string().trim().max(80).optional(), seller: z.string().trim().max(120).optional(), amountBand: z.string().trim().max(120).optional(), campaign: z.string().trim().max(120).optional(),
    confirmation: z.string().trim().max(80).optional(), otp: z.string().regex(/^\d{6}$/).optional(),
  }).safeParse(request.body);
  if (!params.success || !body.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please complete the required fields with valid values.', body.success ? params.error.flatten() : body.error.flatten());
  const module = params.data.module as AdminModuleKey;
  if (!roleHasPermission(request.auth.user.role, adminModulePermissions[module])) return problem(reply, 403, 'PERMISSION_FORBIDDEN', 'You do not have permission to create this record.');
  if (['market-prices', 'commissions'].includes(module) && body.data.amount === undefined) return problem(reply, 422, 'AMOUNT_REQUIRED', 'Enter the value to publish.');
  if (module === 'commissions') {
    const expected = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
    if (body.data.confirmation !== 'CREATE COMMISSION' || !body.data.otp || body.data.otp !== expected) return problem(reply, 403, 'STEP_UP_REQUIRED', 'Type CREATE COMMISSION and enter a current authenticator code.');
  }
  const record = createAdminModuleRecord(module, body.data);
  if (!record) return problem(reply, 422, 'OPERATION_NOT_SUPPORTED', 'This module does not support record creation.');
  audit({ actorId: request.auth.user.id, action: `admin.${module}.create`, targetType: module, targetId: record.id, before: null, after: record, reason: 'Administrator-created CMS record', sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
  reply.status(201);
  return { data: record, message: 'Record created and added to the operational history.' };
});

app.post('/api/v1/admin/operations/:module/:id/action', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN')] }, async (request: any, reply) => {
  const params = z.object({ module: z.enum(adminModuleKeys), id: z.string().trim().min(1).max(160) }).safeParse(request.params);
  const body = z.object({
    action: z.string().trim().min(2).max(60), reason: z.string().trim().min(3).max(500).optional(),
    confirmation: z.string().trim().max(80).optional(), otp: z.string().regex(/^\d{6}$/).optional(),
  }).safeParse(request.body);
  if (!params.success || !body.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the action and provide a valid reason where required.', body.success ? params.error.flatten() : body.error.flatten());
  const permission = adminModulePermissions[params.data.module];
  if (!roleHasPermission(request.auth.user.role, permission)) return problem(reply, 403, 'PERMISSION_FORBIDDEN', 'You do not have permission to perform this action.');
  const reasonRequired = ['approve', 'verify', 'suspend', 'reject', 'remove', 'resolve', 'dismiss', 'escalate', 'request_changes', 'request_cancellation', 'request_refund', 'hold', 'release', 'retry', 'investigate', 'archive', 'cancel', 'open_dispute', 'revoke'].includes(body.data.action);
  if (reasonRequired && !body.data.reason) return problem(reply, 422, 'REASON_REQUIRED', 'Record a reason for this sensitive action.');
  const sensitive = (params.data.module === 'payouts' && ['approve', 'retry', 'release'].includes(body.data.action)) || (['payments', 'orders'].includes(params.data.module) && body.data.action === 'request_refund') || (params.data.module === 'commissions' && ['clone', 'archive'].includes(body.data.action)) || (params.data.module === 'security' && body.data.action === 'revoke');
  if (sensitive) {
    const expected = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
    if (body.data.confirmation !== params.data.id || !body.data.otp || body.data.otp !== expected) {
      audit({ actorId: request.auth.user.id, action: `admin.${params.data.module}.${body.data.action}.denied`, targetType: params.data.module, targetId: params.data.id, before: null, after: null, reason: body.data.reason || 'Step-up verification failed', result: 'denied', sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
      return problem(reply, 403, 'STEP_UP_REQUIRED', `Type ${params.data.id} and enter a current authenticator code to continue.`);
    }
  }
  const result = performAdminModuleAction(params.data.module, params.data.id, body.data.action, body.data.reason);
  if ('error' in result) return result.error === 'NOT_FOUND'
    ? problem(reply, 404, 'NOT_FOUND', 'The selected administrator record was not found.')
    : problem(reply, 422, 'ACTION_NOT_ALLOWED', 'This action is not available for the record in its current state.');
  audit({
    actorId: request.auth.user.id, action: `admin.${params.data.module}.${body.data.action}`,
    targetType: params.data.module, targetId: params.data.id, before: result.before, after: result.after,
    reason: body.data.reason || null, result: 'success',
    sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) },
  });
  return { data: result.after, message: result.message, attention: adminAttentionCounts() };
});

app.get('/api/v1/admin/audit-logs', { preHandler: [requireAuth, requireRole('ADMIN'), requirePermission('audit.read')] }, async (request: any, reply) => {
  const parsed = z.object({ q: z.string().trim().max(100).optional(), action: z.string().trim().max(100).optional(), cursor: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the audit filters.');
  let result = auditEvents;
  if (parsed.data.q) { const term = parsed.data.q.toLowerCase(); result = result.filter(event => JSON.stringify(event).toLowerCase().includes(term)); }
  if (parsed.data.action) result = result.filter(event => event.action === parsed.data.action);
  const page = result.slice(parsed.data.cursor, parsed.data.cursor + parsed.data.limit);
  return { data: page, meta: { total: result.length, appendOnly: true }, page: { hasMore: parsed.data.cursor + page.length < result.length, nextCursor: parsed.data.cursor + page.length < result.length ? parsed.data.cursor + page.length : null } };
});

app.get('/api/v1/admin/translations', { preHandler: [requireAuth, requireRole('ADMIN'), requirePermission('languages.manage')] }, async (request: any, reply) => {
  const parsed = z.object({
    language: z.string().regex(/^[a-z]{2,3}$/).default('lg'),
    status: z.enum(['ALL', 'draft', 'approved']).default('ALL'),
    domain: z.string().max(80).optional(), q: z.string().trim().max(120).optional(),
    cursor: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(40),
  }).safeParse(request.query);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the translation filters.', parsed.error.flatten());
  let result = translationEntries.filter(entry => entry.language === parsed.data.language);
  if (parsed.data.status !== 'ALL') result = result.filter(entry => entry.status === parsed.data.status);
  if (parsed.data.domain) result = result.filter(entry => entry.domain === parsed.data.domain);
  if (parsed.data.q) { const term = parsed.data.q.toLowerCase(); result = result.filter(entry => `${entry.source} ${entry.text}`.toLowerCase().includes(term)); }
  const start = parsed.data.cursor;
  const page = result.slice(start, start + parsed.data.limit);
  return { data: page, page: { nextCursor: start + page.length < result.length ? start + page.length : null, hasMore: start + page.length < result.length }, meta: { total: result.length, version: translationVersion(), domains: [...new Set(translationEntries.filter(entry => entry.language === parsed.data.language).map(entry => entry.domain))].sort() } };
});

app.patch('/api/v1/admin/translations/:id', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('languages.manage')] }, async (request: any, reply) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(1200).optional(), status: z.enum(['draft', 'approved']).optional() }).strict().refine(value => value.text !== undefined || value.status !== undefined).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Enter translated text or choose a review status.', parsed.error.flatten());
  const existing = translationEntries.find(entry => entry.id === request.params.id);
  if (!existing) return problem(reply, 404, 'NOT_FOUND', 'Translation entry not found.');
  const before = { text: existing.text, status: existing.status, reviewedBy: existing.reviewedBy };
  const updated = updateTranslationEntry(existing.id, parsed.data, request.auth.user.id)!;
  await persistTranslationEntry(updated);
  audit({ actorId: request.auth.user.id, action: 'translation.review', targetType: 'translation', targetId: existing.id, before, after: { text: updated.text, status: updated.status, reviewedBy: updated.reviewedBy }, reason: updated.status === 'approved' ? 'Agricultural language review approved' : 'Translation retained as draft' });
  return { data: updated, meta: { catalogVersion: translationVersion() }, message: updated.status === 'approved' ? 'Translation approved and published.' : 'Translation draft updated.' };
});

app.patch('/api/v1/admin/languages/:code', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('languages.manage')] }, async (request: any, reply) => {
  const parsed = z.object({ enabled: z.boolean().optional(), makeDefault: z.boolean().optional(), voiceProvider: z.string().trim().min(2).max(120).optional(), fallback: z.string().regex(/^[a-z]{2,3}$/).optional() }).refine(value => Object.keys(value).length > 0).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Choose a valid language control to update.');
  const language = settings.supportedLanguages.find(item => item.code === request.params.code);
  if (!language) return problem(reply, 404, 'NOT_FOUND', 'Language not found.');
  if (parsed.data.enabled === false && settings.defaultLanguage === language.code) return problem(reply, 409, 'DEFAULT_LANGUAGE_REQUIRED', 'Choose a different default language before disabling this one.');
  if (parsed.data.enabled === true && language.publicationStatus === 'planned') return problem(reply, 409, 'LANGUAGE_REVIEW_REQUIRED', 'A planned language cannot be enabled until its catalogue exists for review.');
  const before = structuredClone(language); const oldDefault = settings.defaultLanguage;
  if (parsed.data.enabled !== undefined) language.enabled = parsed.data.enabled;
  if (parsed.data.voiceProvider !== undefined) (language as any).voiceProvider = parsed.data.voiceProvider;
  if (parsed.data.fallback !== undefined) (language as any).fallback = parsed.data.fallback;
  if (parsed.data.makeDefault) { if (!language.enabled) return problem(reply, 409, 'LANGUAGE_DISABLED', 'Enable the language before making it default.'); settings.defaultLanguage = language.code; }
  audit({ actorId: request.auth.user.id, action: 'language.configuration.update', targetType: 'language', targetId: language.code, before: { language: before, defaultLanguage: oldDefault }, after: { language, defaultLanguage: settings.defaultLanguage }, reason: 'Administrator language configuration', sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
  return { data: { language, defaultLanguage: settings.defaultLanguage }, message: 'Language controls published.' };
});

app.get('/api/v1/admin/ai-limits', { preHandler: [requireAuth, requireRole('ADMIN'), requirePermission('ai.manage')] }, async () => ({ data: {
  aiEnabled: settings.aiEnabled, aiImageEnabled: settings.aiImageEnabled, aiVoiceEnabled: settings.aiVoiceEnabled,
  aiAuthenticatedDailyLimit: settings.aiAuthenticatedDailyLimit, aiRateLimitPerFiveMinutes: settings.aiRateLimitPerFiveMinutes,
  guestAi: settings.guestAccess.ai, guestImageAnalysis: settings.guestAccess.imageAnalysis, guestVoice: settings.guestAccess.voice,
  guestDailyLimit: settings.guestAccess.aiDailyLimit, guestImageDailyLimit: settings.guestAccess.imageDailyLimit,
} }));

app.patch('/api/v1/admin/ai-limits', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('ai.manage')] }, async (request: any, reply) => {
  const parsed = z.object({
    aiEnabled: z.boolean(), aiImageEnabled: z.boolean(), aiVoiceEnabled: z.boolean(),
    aiAuthenticatedDailyLimit: z.number().int().min(1).max(1000), aiRateLimitPerFiveMinutes: z.number().int().min(1).max(20),
    guestAi: z.boolean(), guestImageAnalysis: z.boolean(), guestVoice: z.boolean(),
    guestDailyLimit: z.number().int().min(0).max(100), guestImageDailyLimit: z.number().int().min(0).max(50),
    confirmation: z.literal('PUBLISH SETTINGS'), otp: z.string().regex(/^\d{6}$/),
  }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Check every AI access and usage limit.', parsed.error.flatten());
  const expectedOtp = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
  if (!expectedOtp || parsed.data.otp !== expectedOtp) return problem(reply, 403, 'STEP_UP_REQUIRED', 'Enter a current authenticator code to publish AI policy.');
  const before = {
    aiEnabled: settings.aiEnabled, aiImageEnabled: settings.aiImageEnabled, aiVoiceEnabled: settings.aiVoiceEnabled,
    aiAuthenticatedDailyLimit: settings.aiAuthenticatedDailyLimit, aiRateLimitPerFiveMinutes: settings.aiRateLimitPerFiveMinutes,
    guestAi: settings.guestAccess.ai, guestImageAnalysis: settings.guestAccess.imageAnalysis, guestVoice: settings.guestAccess.voice,
    guestDailyLimit: settings.guestAccess.aiDailyLimit, guestImageDailyLimit: settings.guestAccess.imageDailyLimit,
  };
  settings.aiEnabled = parsed.data.aiEnabled; settings.aiImageEnabled = parsed.data.aiImageEnabled; settings.aiVoiceEnabled = parsed.data.aiVoiceEnabled;
  settings.aiAuthenticatedDailyLimit = parsed.data.aiAuthenticatedDailyLimit; settings.aiRateLimitPerFiveMinutes = parsed.data.aiRateLimitPerFiveMinutes;
  settings.guestAccess.ai = parsed.data.guestAi; settings.guestAccess.imageAnalysis = parsed.data.guestImageAnalysis; settings.guestAccess.voice = parsed.data.guestVoice;
  settings.guestAccess.aiDailyLimit = parsed.data.guestDailyLimit; settings.guestAccess.imageDailyLimit = parsed.data.guestImageDailyLimit;
  const after = { ...before, ...parsed.data }; delete (after as any).confirmation; delete (after as any).otp;
  audit({ actorId: request.auth.user.id, action: 'ai.limits.update', targetType: 'ai_policy', targetId: 'global', before, after, reason: 'Administrator AI usage policy publication', sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
  return { data: after, message: 'AI access and usage limits published.' };
});

app.get('/api/v1/admin/guest-settings', { preHandler: [requireAuth, requireRole('ADMIN'), requirePermission('settings.manage')] }, async () => ({ data: settings.guestAccess }));

app.patch('/api/v1/admin/guest-settings', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('settings.manage')] }, async (request: any, reply) => {
  const parsed = z.object({
    marketplace: z.boolean().optional(), ai: z.boolean().optional(),
    aiDailyLimit: z.number().int().min(0).max(100).optional(),
    imageAnalysis: z.boolean().optional(), imageDailyLimit: z.number().int().min(0).max(50).optional(),
    voice: z.boolean().optional(), articles: z.boolean().optional(), productViewing: z.boolean().optional(),
    farmerProfiles: z.boolean().optional(), search: z.boolean().optional(), cart: z.boolean().optional(),
    confirmation: z.literal('PUBLISH SETTINGS'), otp: z.string().regex(/^\d{6}$/),
  }).strict().safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the guest-access settings.', parsed.error.flatten());
  const expectedOtp = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
  if (!expectedOtp || parsed.data.otp !== expectedOtp) return problem(reply, 403, 'STEP_UP_REQUIRED', 'Enter a current authenticator code to publish platform access policy.');
  const { confirmation: _confirmation, otp: _otp, ...guestValues } = parsed.data;
  const before = { ...settings.guestAccess };
  Object.assign(settings.guestAccess, guestValues);
  await persistRuntimeSetting('guestAccess', settings.guestAccess, request.auth.user.id);
  audit({ actorId: request.auth.user.id, action: 'guest_access.update', targetType: 'system_setting', targetId: 'guestAccess', before, after: settings.guestAccess, reason: null, sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
  return { data: settings.guestAccess, message: 'Guest-access settings published. Public clients receive them on refresh.' };
});

app.patch('/api/v1/admin/settings/:key', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('settings.manage')] }, async (request: any, reply) => {
  const key = request.params.key as keyof typeof settings;
  const allowed = ['appName', 'tagline', 'primaryColor', 'secondaryColor', 'supportPhone', 'country', 'timezone', 'maintenanceMode', 'systemBanner', 'marketplaceEnabled', 'aiEnabled', 'aiImageEnabled', 'aiVoiceEnabled', 'aiAuthenticatedDailyLimit', 'aiRateLimitPerFiveMinutes', 'notificationsEnabled', 'coffeeHubEnabled', 'buyerRequestsEnabled'];
  if (!allowed.includes(key)) return problem(reply, 422, 'SETTING_NOT_EDITABLE', 'This setting cannot be changed here.');
  const body = z.object({ value: z.union([z.string().max(500), z.number().int().min(0).max(10_000), z.boolean()]), confirmation: z.literal('PUBLISH SETTINGS').optional(), otp: z.string().regex(/^\d{6}$/).optional() }).safeParse(request.body);
  if (!body.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the setting value.');
  if (key === 'aiRateLimitPerFiveMinutes' && (typeof body.data.value !== 'number' || body.data.value < 1 || body.data.value > 20)) return problem(reply, 422, 'VALIDATION_FAILED', 'AI rate limit must be between 1 and 20 requests per five minutes.');
  if (key === 'aiAuthenticatedDailyLimit' && (typeof body.data.value !== 'number' || body.data.value < 1 || body.data.value > 1000)) return problem(reply, 422, 'VALIDATION_FAILED', 'Authenticated AI daily limit must be between 1 and 1,000 requests.');
  const highImpact = ['maintenanceMode', 'marketplaceEnabled', 'aiEnabled', 'aiImageEnabled', 'aiVoiceEnabled', 'aiAuthenticatedDailyLimit', 'aiRateLimitPerFiveMinutes', 'notificationsEnabled', 'coffeeHubEnabled', 'buyerRequestsEnabled'].includes(key);
  if (highImpact) {
    const expectedOtp = process.env.NODE_ENV === 'production' ? process.env.DEMO_TOTP_CODE : (process.env.DEMO_TOTP_CODE || '246810');
    if (body.data.confirmation !== 'PUBLISH SETTINGS' || !body.data.otp || body.data.otp !== expectedOtp) return problem(reply, 403, 'STEP_UP_REQUIRED', 'Type PUBLISH SETTINGS and enter a current authenticator code.');
  }
  const oldValue = (settings as any)[key];
  (settings as any)[key] = body.data.value;
  const persistedVersion = await persistRuntimeSetting('runtime', { [key]: body.data.value }, request.auth.user.id);
  audit({ actorId: request.auth.user.id, action: 'setting.update', targetType: 'system_setting', targetId: key, before: { value: oldValue }, after: { value: body.data.value }, reason: null, sessionContext: { sessionId: request.auth.session.id, deviceFingerprint: request.auth.session.userAgentHash.slice(0, 12) } });
  return { data: { key, value: body.data.value, version: persistedVersion || Date.now() }, message: 'Setting published. Clients will receive it on refresh.' };
});

app.post('/api/v1/admin/alerts', { preHandler: [requireAuth, requireCsrf, requireRole('ADMIN'), requirePermission('notifications.manage')] }, async (request: any, reply) => {
  const parsed = z.object({ title: z.string().min(5).max(100), body: z.string().min(10).max(500), severity: z.enum(['info', 'warning', 'urgent']) }).safeParse(request.body);
  if (!parsed.success) return problem(reply, 422, 'VALIDATION_FAILED', 'Please check the alert content.', parsed.error.flatten());
  const alert = { id: `alert_${randomUUID().slice(0, 8)}`, type: 'admin', ...parsed.data, publishedAt: 'Just now' };
  alerts.unshift(alert);
  audit({ actorId: request.auth.user.id, action: 'alert.publish', targetType: 'alert', targetId: alert.id, before: null, after: { title: alert.title, severity: alert.severity }, reason: null });
  reply.status(201);
  return { data: alert, message: 'Alert published to the live application.' };
});

app.get('/api/v1/admin/dashboard', { preHandler: [requireAuth, requireRole('ADMIN'), requirePermission('admin.dashboard.read')] }, async () => ({
  data: {
    ...adminStats,
    attention: adminAttentionCounts(),
    revenueTrend: [
      { label: 'Mar', value: 5100000 }, { label: 'Apr', value: 6200000 }, { label: 'May', value: 5900000 },
      { label: 'Jun', value: 8100000 }, { label: 'Jul', value: 7600000 }, { label: 'Aug', value: 9230000 },
    ],
    marketplaceBreakdown: [
      { label: 'Coffee', value: 68 }, { label: 'Fresh crops', value: 17 }, { label: 'Animals', value: 9 }, { label: 'Inputs', value: 6 },
    ],
    operationalAlerts: [
      { id: 'ops_1', severity: 'urgent', title: 'High-priority fraud report', detail: 'An administrator must review an off-platform OTP request.', route: '/admin/reports' },
      { id: 'ops_2', severity: 'warning', title: 'Payout requires approval', detail: 'A seller payout is waiting for step-up review.', route: '/admin/payouts' },
      { id: 'ops_3', severity: 'info', title: 'Luganda catalogue is still draft', detail: 'Agricultural language review is required before approval.', route: '/admin/languages' },
    ],
    recentActivity: auditEvents.slice(0, 8),
  },
}));

app.setNotFoundHandler((_request, reply) => problem(reply, 404, 'NOT_FOUND', 'We could not find that page or item.'));
app.setErrorHandler((error: any, request, reply) => {
  const status = Number(error.statusCode || 500);
  if (status < 500) {
    request.log.warn({ code: error.code, status }, 'request rejected');
    return problem(reply, status, 'INVALID_REQUEST', status === 429 ? 'Too many requests. Please wait and try again.' : 'The request could not be processed.');
  }
  request.log.error({ err: error }, 'request failed');
  return problem(reply, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
});

export { app };

const invokedAsEntryPoint = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (invokedAsEntryPoint) {
  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
