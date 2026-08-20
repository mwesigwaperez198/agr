export type Role = 'ADMIN' | 'FARMER_SELLER' | 'BUYER';

export type AuthUser = {
  id: string;
  name: string;
  firstName: string;
  phone: string;
  email: string | null;
  role: Role;
  status: string;
  verified: boolean;
  twoFactorEnabled: boolean;
  location: string;
  district: string;
  avatar: string;
  permissions: string[];
  redirectTo: string;
  [key: string]: any;
};

export type CheckoutPaymentMethod = {
  id: string; name: string; provider: string; icon: 'phone' | 'card' | 'bank' | 'gateway'; currency: string;
  feeBasisPoints: number; feePercent: number; minimumAmount: number; maximumAmount: number; isDefault: boolean;
  environment: 'sandbox' | 'production';
};

export type AdminPaymentMethod = CheckoutPaymentMethod & {
  connectorType: 'sandbox' | 'manual' | 'generic_https'; enabled: boolean; checkoutVisible: boolean;
  apiBaseUrl: string | null; testPath: string; callbackUrl: string;
  credentialMasks: { apiKey: string; secretKey: string; merchantId: string; accountBusinessNumber: string };
  configStatus: 'configured' | 'incomplete' | 'test_failed'; lastSuccessfulTransaction: string | null;
  lastTestedAt: string | null; lastTestResult: 'successful' | 'failed' | 'not_tested'; lastTestMessage: string | null;
  createdAt: string; updatedAt: string;
};

export type Bootstrap = {
  config: any;
  localization?: any;
  user: AuthUser | null;
  role?: 'GUEST';
  guestUsage?: any;
  categories: any[];
  prices: any[];
  listings: any[];
  buyerRequests: any[];
  paymentMethods?: CheckoutPaymentMethod[];
  articles: any[];
  alerts: any[];
  advertisements?: any[];
  notifications: any[];
  adminAttention?: Record<string, number>;
  weather: any;
  commerceStatus?: 'development_memory' | 'repository_not_deployed';
  serverTime: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  details: any;
  constructor(message: string, status: number, code = 'REQUEST_FAILED', details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options?.body && !isFormData ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' && csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...(options?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new ApiError(body.title || 'Something went wrong. Please try again.', response.status, body.code, body.errors);
    const sessionEndpoint = path === '/api/v1/me' || path.startsWith('/api/v1/auth/');
    if (response.status === 401 && !sessionEndpoint) {
      csrfToken = '';
      if (typeof window !== 'undefined') queueMicrotask(() => window.dispatchEvent(new CustomEvent('agri:session-expired', { detail: { path } })));
    }
    throw error;
  }
  return body;
}

function rememberSession<T extends { data?: { csrfToken?: string } }>(response: T) {
  if (response.data?.csrfToken) csrfToken = response.data.csrfToken;
  return response;
}

export const api = {
  me: async () => rememberSession(await request<any>('/api/v1/me')),
  login: async (body: { identifier: string; password: string; otp?: string }) => rememberSession(await request<any>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) })),
  register: async (body: any) => rememberSession(await request<any>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(body) })),
  logout: async () => { const response = await request<any>('/api/v1/auth/logout', { method: 'POST' }); csrfToken = ''; return response; },
  bootstrap: () => request<Bootstrap>('/api/v1/bootstrap'),
  publicBootstrap: () => request<Bootstrap>('/api/v1/public/bootstrap'),
  publicPaymentMethods: () => request<{ data: CheckoutPaymentMethod[] }>('/api/v1/public/payment-methods'),
  // Translation catalogues are versioned by the API, so never let a browser or
  // service worker keep an older catalogue after an administrator publishes an edit.
  translations: (language: string) => request<any>(`/api/v1/public/translations/${encodeURIComponent(language)}?v=${Date.now()}`, { cache: 'no-store' }),
  publicFarmer: (id: string) => request<any>(`/api/v1/public/farmers/${encodeURIComponent(id)}`),
  updateProfile: (body: any) => request<any>('/api/v1/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  publicArticles: () => request<any>('/api/v1/public/articles'),
  publicArticle: (slug: string) => request<any>(`/api/v1/public/articles/${encodeURIComponent(slug)}`),
  listings: (params: URLSearchParams) => request<any>(`/api/v1/listings?${params}`),
  listing: (id: string) => request<any>(`/api/v1/listings/${id}`),
  listingQuote: (id: string, quantity: number, paymentMethodId: string) => request<any>(`/api/v1/listings/${encodeURIComponent(id)}/quote?quantity=${quantity}&paymentMethodId=${encodeURIComponent(paymentMethodId)}`),
  updateListing: (id: string, body: any) => request<any>(`/api/v1/listings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteListing: (id: string) => request<any>(`/api/v1/listings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  notifications: (group = 'all', unreadOnly = false) => request<any>(`/api/v1/notifications?group=${encodeURIComponent(group)}${unreadOnly ? '&unread=true' : ''}`),
  markNotificationRead: (id: string) => request<any>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<any>('/api/v1/notifications/read-all', { method: 'POST' }),
  askAI: (message: string, language: string, mode: 'text' | 'image' | 'voice' = 'text') => request<any>('/api/v1/ai/ask', { method: 'POST', body: JSON.stringify({ message, language, mode }) }),
  migrateGuestAI: (messages: Array<{ role: 'user' | 'assistant'; summary: string }>) => request<any>('/api/v1/ai/migrate-guest', { method: 'POST', body: JSON.stringify({ messages }) }),
  orders: () => request<any>('/api/v1/orders'),
  order: (id: string) => request<any>(`/api/v1/orders/${encodeURIComponent(id)}`),
  updateOrderStatus: (id: string, status: string) => request<any>(`/api/v1/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createOrder: (body: any) => request<any>('/api/v1/orders', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) }),
  verifySandboxPayment: (body: any) => request<any>('/api/v1/payments/sandbox/verify', { method: 'POST', body: JSON.stringify(body) }),
  farmerDashboard: () => request<any>('/api/v1/farmer/dashboard'),
  farmerListings: (status = 'ALL') => request<any>(`/api/v1/farmer/listings?status=${encodeURIComponent(status)}`),
  farmerDrafts: () => request<any>('/api/v1/farmer/listing-drafts'),
  farmerDraft: (id: string) => request<any>(`/api/v1/farmer/listing-drafts/${encodeURIComponent(id)}`),
  createFarmerDraft: (body: any = {}) => request<any>('/api/v1/farmer/listing-drafts', { method: 'POST', body: JSON.stringify(body) }),
  saveFarmerDraft: (id: string, body: any) => request<any>(`/api/v1/farmer/listing-drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteFarmerDraft: (id: string) => request<any>(`/api/v1/farmer/listing-drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  publishFarmerDraft: (id: string, version: number) => request<any>(`/api/v1/farmer/listing-drafts/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ version, confirmed: true }) }),
  farmerListingQuote: (body: { category: string; quantity: number; price: number }) => request<any>('/api/v1/farmer/listing-quote', { method: 'POST', body: JSON.stringify(body) }),
  farmerDescriptionSuggestion: (body: any) => request<any>('/api/v1/farmer/listing-description-suggestion', { method: 'POST', body: JSON.stringify(body) }),
  uploadListingImage: (file: File, onProgress?: (percent: number) => void) => new Promise<any>((resolve, reject) => {
    const body = new FormData(); body.append('file', file, file.name); const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/farmer/listing-images'); xhr.withCredentials = true; if (csrfToken) xhr.setRequestHeader('x-csrf-token', csrfToken);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new ApiError('The image upload was interrupted. Try again.', 0, 'NETWORK_ERROR'));
    xhr.onload = () => { const response = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })(); if (xhr.status >= 200 && xhr.status < 300) resolve(response); else reject(new ApiError(response.title || 'The image could not be uploaded.', xhr.status, response.code, response.errors)); };
    xhr.send(body);
  }),
  deleteListingImage: (id: string) => request<any>(`/api/v1/farmer/listing-images/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  farmerEarnings: (period = 'all') => request<any>(`/api/v1/farmer/earnings?period=${encodeURIComponent(period)}`),
  farmerPayoutMethods: () => request<any>('/api/v1/farmer/payout-methods'),
  farmerWithdrawalQuote: (amount: number) => request<any>('/api/v1/farmer/withdrawal-quote', { method: 'POST', body: JSON.stringify({ amount }) }),
  requestWithdrawal: (body: any, idempotencyKey = crypto.randomUUID()) => request<any>('/api/v1/farmer/withdrawals', { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) }),
  completeOrder: (id: string) => request<any>(`/api/v1/orders/${encodeURIComponent(id)}/complete`, { method: 'PATCH' }),
  cancelOrder: (id: string, reason: string) => request<any>(`/api/v1/orders/${encodeURIComponent(id)}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  reviewOrder: (id: string, body: { rating: number; comment?: string }) => request<any>(`/api/v1/orders/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(body) }),
  farmerStatement: async (format: 'csv' | 'xlsx' | 'pdf', filters: Record<string,string> = {}) => {
    const params = new URLSearchParams({ format, ...filters }); const response = await fetch(`/api/v1/farmer/earnings/statement?${params}`, { credentials: 'same-origin' });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(body.title || 'The statement could not be generated.', response.status, body.code); }
    return response.blob();
  },
  buyerSaved: () => request<any>('/api/v1/buyer/saved'),
  saveBuyerListing: (id: string) => request<any>(`/api/v1/buyer/saved/${encodeURIComponent(id)}`, { method: 'POST' }),
  removeBuyerSavedListing: (id: string) => request<any>(`/api/v1/buyer/saved/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  buyerRequests: (params = new URLSearchParams()) => request<any>(`/api/v1/buyer-requests?${params}`),
  createBuyerRequest: (body: any) => request<any>('/api/v1/buyer-requests', { method: 'POST', body: JSON.stringify(body) }),
  ownBuyerRequests: () => request<any>('/api/v1/buyer/requests'),
  setBuyerRequestState: (id: string, status: 'closed'|'fulfilled') => request<any>(`/api/v1/buyer-requests/${encodeURIComponent(id)}/state`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  respondToBuyerRequest: (id: string, body: any) => request<any>(`/api/v1/buyer-requests/${encodeURIComponent(id)}/responses`, { method: 'POST', body: JSON.stringify(body) }),
  withdrawBuyerResponse: (id: string) => request<any>(`/api/v1/buyer-request-responses/${encodeURIComponent(id)}/withdraw`, { method: 'PATCH' }),
  decideBuyerResponse: (id: string, decision: 'accepted'|'rejected') => request<any>(`/api/v1/buyer-request-responses/${encodeURIComponent(id)}/decision`, { method: 'PATCH', body: JSON.stringify({ decision }) }),
  conversations: () => request<any>('/api/v1/conversations'),
  createConversation: (body: { listingId?: string; orderId?: string; responseId?: string }) => request<any>('/api/v1/conversations', { method: 'POST', body: JSON.stringify(body) }),
  conversationMessages: (id: string) => request<any>(`/api/v1/conversations/${encodeURIComponent(id)}/messages`),
  sendMessage: (id: string, body: string) => request<any>(`/api/v1/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  markConversationRead: (id: string) => request<any>(`/api/v1/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  adminStats: () => request<any>('/api/v1/admin/dashboard'),
  adminAttention: () => request<any>('/api/v1/admin/attention'),
  adminPaymentMethods: () => request<any>('/api/v1/admin/payment-methods'),
  createPaymentMethod: (body: any) => request<any>('/api/v1/admin/payment-methods', { method: 'POST', body: JSON.stringify(body) }),
  updatePaymentMethod: (id: string, body: any) => request<any>(`/api/v1/admin/payment-methods/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  paymentMethodAction: (id: string, body: any) => request<any>(`/api/v1/admin/payment-methods/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify(body) }),
  removePaymentMethod: (id: string, body: any) => request<any>(`/api/v1/admin/payment-methods/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify(body) }),
  adminSearch: (q: string) => request<any>(`/api/v1/admin/search?q=${encodeURIComponent(q)}`),
  adminModule: (module: string, params = new URLSearchParams()) => request<any>(`/api/v1/admin/operations/${encodeURIComponent(module)}?${params}`),
  setAdminRecordReadState: (module: string, id: string, unread: boolean) => request<any>(`/api/v1/admin/operations/${encodeURIComponent(module)}/${encodeURIComponent(id)}/read-state`, { method: 'PATCH', body: JSON.stringify({ unread }) }),
  markVisibleAdminRecordsRead: (module: string, recordIds: string[]) => request<any>(`/api/v1/admin/operations/${encodeURIComponent(module)}/read-visible`, { method: 'POST', body: JSON.stringify({ recordIds }) }),
  createAdminModuleRecord: (module: string, body: any) => request<any>(`/api/v1/admin/operations/${encodeURIComponent(module)}`, { method: 'POST', body: JSON.stringify(body) }),
  importMarketPrices: (body: { rows: any[]; confirmation: string; otp: string }) => request<any>('/api/v1/admin/operations/market-prices/import', { method: 'POST', body: JSON.stringify(body) }),
  adminExport: async (module: string, format: 'csv' | 'xlsx' | 'pdf') => {
    const response = await fetch(`/api/v1/admin/operations/${encodeURIComponent(module)}/export?format=${format}`, { credentials: 'same-origin' });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(body.title || 'The export could not be generated.', response.status, body.code); }
    return response.blob();
  },
  adminModuleAction: (module: string, id: string, body: { action: string; reason?: string; confirmation?: string; otp?: string }) => request<any>(`/api/v1/admin/operations/${encodeURIComponent(module)}/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify(body) }),
  adminUsers: (params: URLSearchParams) => request<any>(`/api/v1/admin/users?${params}`),
  changeUserRole: (id: string, role: Role, reason: string, confirmation: string, otp: string) => request<any>(`/api/v1/admin/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: JSON.stringify({ role, reason, confirmation, otp }) }),
  changeUserStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) => request<any>(`/api/v1/admin/users/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }),
  changeUserVerification: (id: string, verified: boolean, reason: string) => request<any>(`/api/v1/admin/users/${encodeURIComponent(id)}/verification`, { method: 'PATCH', body: JSON.stringify({ verified, reason }) }),
  auditLogs: (params = new URLSearchParams()) => request<any>(`/api/v1/admin/audit-logs?${params}`),
  aiLimits: () => request<any>('/api/v1/admin/ai-limits'),
  updateAiLimits: (body: any) => request<any>('/api/v1/admin/ai-limits', { method: 'PATCH', body: JSON.stringify(body) }),
  adminTranslations: (params: URLSearchParams) => request<any>(`/api/v1/admin/translations?${params}`),
  updateTranslation: (id: string, body: { text?: string; status?: 'draft' | 'approved' }) => request<any>(`/api/v1/admin/translations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateLanguage: (code: string, body: { enabled?: boolean; makeDefault?: boolean; voiceProvider?: string; fallback?: string }) => request<any>(`/api/v1/admin/languages/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateSetting: (key: string, value: string | number | boolean, stepUp?: { confirmation: string; otp: string }) => request<any>(`/api/v1/admin/settings/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ value, ...stepUp }) }),
  guestSettings: () => request<any>('/api/v1/admin/guest-settings'),
  updateGuestSettings: (body: any) => request<any>('/api/v1/admin/guest-settings', { method: 'PATCH', body: JSON.stringify(body) }),
  mergeCart: (items: Array<{ listingId: string; quantity: number }>) => request<any>('/api/v1/cart/merge', { method: 'POST', body: JSON.stringify({ items }) }),
  cart: () => request<any>('/api/v1/cart'),
  publishAlert: (body: any) => request<any>('/api/v1/admin/alerts', { method: 'POST', body: JSON.stringify(body) }),
};
