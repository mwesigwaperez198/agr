import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { query } from './db.js';

export type PaymentConnectorType = 'sandbox' | 'manual' | 'generic_https';
export type PaymentMethodIcon = 'phone' | 'card' | 'bank' | 'gateway';
export type PaymentEnvironment = 'sandbox' | 'production';

type PaymentCredentials = {
  apiKey: string;
  secretKey: string;
  merchantId: string;
  accountBusinessNumber: string;
};

type EncryptedValue = { iv: string; ciphertext: string; tag: string };
export type PaymentMethodRecord = {
  id: string;
  name: string;
  provider: string;
  icon: PaymentMethodIcon;
  connectorType: PaymentConnectorType;
  enabled: boolean;
  checkoutVisible: boolean;
  isDefault: boolean;
  currency: string;
  feeBasisPoints: number;
  minimumAmount: number;
  maximumAmount: number;
  environment: PaymentEnvironment;
  apiBaseUrl: string | null;
  testPath: string;
  callbackUrl: string;
  encryptedCredentials: EncryptedValue;
  credentialMasks: PaymentCredentials;
  configStatus: 'configured' | 'incomplete' | 'test_failed';
  lastSuccessfulTransaction: string | null;
  lastTestedAt: string | null;
  lastTestResult: 'successful' | 'failed' | 'not_tested';
  lastTestMessage: string | null;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
};

const configuredKey = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY;
if (process.env.NODE_ENV === 'production' && !configuredKey) {
  throw new Error('PAYMENT_CONFIG_ENCRYPTION_KEY is required in production.');
}
function encryptionKey() {
  if (!configuredKey) return createHash('sha256').update('development-only-ephemeral-payment-key').digest();
  const decoded = Buffer.from(configuredKey, 'base64');
  if (decoded.length !== 32) throw new Error('PAYMENT_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return decoded;
}
const key = encryptionKey();

function encryptCredentials(credentials: PaymentCredentials): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function decryptCredentials(value: EncryptedValue): PaymentCredentials {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}
function mask(value: string) { return value ? `${'•'.repeat(10)}${value.slice(-4).toUpperCase()}` : ''; }
function maskCredentials(credentials: PaymentCredentials): PaymentCredentials {
  return { apiKey: mask(credentials.apiKey), secretKey: mask(credentials.secretKey), merchantId: mask(credentials.merchantId), accountBusinessNumber: mask(credentials.accountBusinessNumber) };
}
function configComplete(connectorType: PaymentConnectorType, credentials: PaymentCredentials, apiBaseUrl: string | null) {
  if (connectorType === 'manual') return Boolean(credentials.accountBusinessNumber || credentials.merchantId);
  if (connectorType === 'sandbox') return Boolean(credentials.apiKey && credentials.secretKey && credentials.merchantId);
  return Boolean(apiBaseUrl && credentials.apiKey && credentials.secretKey && credentials.merchantId);
}

const now = '2026-08-16T08:00:00.000Z';
function seed(input: Omit<PaymentMethodRecord, 'encryptedCredentials' | 'credentialMasks' | 'createdAt' | 'updatedAt' | 'removedAt' | 'lastTestedAt' | 'lastTestResult' | 'lastTestMessage'>, credentials: PaymentCredentials): PaymentMethodRecord {
  const productionSandbox = process.env.NODE_ENV === 'production' && input.environment !== 'production';
  return { ...input, enabled: productionSandbox ? false : input.enabled, checkoutVisible: productionSandbox ? false : input.checkoutVisible,
    encryptedCredentials: encryptCredentials(credentials), credentialMasks: maskCredentials(credentials), createdAt: now, updatedAt: now, removedAt: null, lastTestedAt: null, lastTestResult: 'not_tested', lastTestMessage: productionSandbox ? 'Production credentials required before checkout is enabled.' : null };
}

const paymentMethods: PaymentMethodRecord[] = [
  seed({ id: 'pm_mtn_momo', name: 'MTN Mobile Money', provider: 'MTN Uganda', icon: 'phone', connectorType: 'sandbox', enabled: true, checkoutVisible: true, isDefault: true, currency: 'UGX', feeBasisPoints: 150, minimumAmount: 500, maximumAmount: 5_000_000, environment: 'sandbox', apiBaseUrl: null, testPath: '/health', callbackUrl: 'https://api.example.ug/webhooks/payments/mtn', configStatus: 'configured', lastSuccessfulTransaction: '2026-08-16T06:12:00.000Z' }, { apiKey: 'sandbox-mtn-key-8f92', secretKey: 'sandbox-mtn-secret-71aa', merchantId: 'MTN-MERCHANT-2041', accountBusinessNumber: '256700000001' }),
  seed({ id: 'pm_airtel_money', name: 'Airtel Money', provider: 'Airtel Uganda', icon: 'phone', connectorType: 'sandbox', enabled: true, checkoutVisible: true, isDefault: false, currency: 'UGX', feeBasisPoints: 140, minimumAmount: 500, maximumAmount: 5_000_000, environment: 'sandbox', apiBaseUrl: null, testPath: '/health', callbackUrl: 'https://api.example.ug/webhooks/payments/airtel', configStatus: 'configured', lastSuccessfulTransaction: '2026-08-15T14:28:00.000Z' }, { apiKey: 'sandbox-airtel-key-2c17', secretKey: 'sandbox-airtel-secret-9b42', merchantId: 'AIRTEL-MERCHANT-908', accountBusinessNumber: '256750000002' }),
  seed({ id: 'pm_card_gateway', name: 'Visa / Mastercard', provider: 'Card gateway sandbox', icon: 'card', connectorType: 'sandbox', enabled: true, checkoutVisible: true, isDefault: false, currency: 'UGX', feeBasisPoints: 280, minimumAmount: 2_000, maximumAmount: 20_000_000, environment: 'sandbox', apiBaseUrl: null, testPath: '/health', callbackUrl: 'https://api.example.ug/webhooks/payments/card', configStatus: 'configured', lastSuccessfulTransaction: '2026-08-14T10:05:00.000Z' }, { apiKey: 'sandbox-card-key-4d90', secretKey: 'sandbox-card-secret-3ef1', merchantId: 'CARD-MERCHANT-330', accountBusinessNumber: 'HARVEST-CARD-01' }),
  seed({ id: 'pm_bank_transfer', name: 'Bank Transfer', provider: 'Manual bank settlement', icon: 'bank', connectorType: 'manual', enabled: false, checkoutVisible: false, isDefault: false, currency: 'UGX', feeBasisPoints: 50, minimumAmount: 50_000, maximumAmount: 100_000_000, environment: 'production', apiBaseUrl: null, testPath: '/health', callbackUrl: 'https://api.example.ug/webhooks/payments/bank', configStatus: 'configured', lastSuccessfulTransaction: null }, { apiKey: '', secretKey: '', merchantId: 'BANK-ACCOUNT-001', accountBusinessNumber: '000123456789' }),
];

export async function hydratePaymentMethods() {
  const result = await query<{ payload: PaymentMethodRecord }>('select payload from commerce.runtime_payment_methods order by created_at asc');
  for (const row of result?.rows || []) {
    const saved = row.payload;
    const existing = paymentMethods.find(method => method.id === saved.id);
    if (existing) Object.assign(existing, saved);
    else paymentMethods.push(saved);
  }
  return Boolean(result);
}

function persistPaymentMethod(record: PaymentMethodRecord) {
  void query(`insert into commerce.runtime_payment_methods(id,payload,created_at,updated_at) values ($1,$2::jsonb,$3,$4)
    on conflict (id) do update set payload=excluded.payload,updated_at=excluded.updated_at`, [record.id, JSON.stringify(record), record.createdAt, record.updatedAt]).catch(() => undefined);
}

export type PaymentMethodInput = {
  name: string;
  provider: string;
  icon: PaymentMethodIcon;
  connectorType: PaymentConnectorType;
  enabled: boolean;
  checkoutVisible: boolean;
  currency: string;
  feePercent: number;
  minimumAmount: number;
  maximumAmount: number;
  environment: PaymentEnvironment;
  apiBaseUrl?: string;
  testPath?: string;
  callbackUrl: string;
  apiKey?: string;
  secretKey?: string;
  merchantId?: string;
  accountBusinessNumber?: string;
};

export function publicPaymentMethods() {
  return paymentMethods.filter(method => !method.removedAt && method.enabled && method.checkoutVisible && method.configStatus !== 'incomplete').map(method => ({
    id: method.id, name: method.name, provider: method.provider, icon: method.icon, currency: method.currency,
    feeBasisPoints: method.feeBasisPoints, feePercent: method.feeBasisPoints / 100,
    minimumAmount: method.minimumAmount, maximumAmount: method.maximumAmount, isDefault: method.isDefault,
    environment: method.environment,
  })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

export function adminPaymentMethods() {
  return paymentMethods.filter(method => !method.removedAt).map(({ encryptedCredentials: _encrypted, ...method }) => ({ ...method, feePercent: method.feeBasisPoints / 100 }));
}

export function findPaymentMethod(id: string) { return paymentMethods.find(method => method.id === id && !method.removedAt); }

export function createPaymentMethod(input: PaymentMethodInput) {
  const credentials: PaymentCredentials = { apiKey: input.apiKey || '', secretKey: input.secretKey || '', merchantId: input.merchantId || '', accountBusinessNumber: input.accountBusinessNumber || '' };
  const createdAt = new Date().toISOString();
  const complete = configComplete(input.connectorType, credentials, input.apiBaseUrl || null);
  const record: PaymentMethodRecord = {
    id: `pm_${randomUUID().slice(0, 12)}`, name: input.name, provider: input.provider, icon: input.icon,
    connectorType: input.connectorType, enabled: input.enabled && complete, checkoutVisible: input.checkoutVisible && complete,
    isDefault: false, currency: input.currency.toUpperCase(), feeBasisPoints: Math.round(input.feePercent * 100),
    minimumAmount: input.minimumAmount, maximumAmount: input.maximumAmount, environment: input.environment,
    apiBaseUrl: input.apiBaseUrl || null, testPath: input.testPath || '/health', callbackUrl: input.callbackUrl,
    encryptedCredentials: encryptCredentials(credentials), credentialMasks: maskCredentials(credentials),
    configStatus: complete ? 'configured' : 'incomplete',
    lastSuccessfulTransaction: null, lastTestedAt: null, lastTestResult: 'not_tested', lastTestMessage: null,
    createdAt, updatedAt: createdAt, removedAt: null,
  };
  paymentMethods.push(record);
  persistPaymentMethod(record);
  return record;
}

export function updatePaymentMethod(record: PaymentMethodRecord, input: Partial<PaymentMethodInput>) {
  const existing = decryptCredentials(record.encryptedCredentials);
  const credentials: PaymentCredentials = {
    apiKey: input.apiKey || existing.apiKey, secretKey: input.secretKey || existing.secretKey,
    merchantId: input.merchantId || existing.merchantId, accountBusinessNumber: input.accountBusinessNumber || existing.accountBusinessNumber,
  };
  if (input.name !== undefined) record.name = input.name;
  if (input.provider !== undefined) record.provider = input.provider;
  if (input.icon !== undefined) record.icon = input.icon;
  if (input.connectorType !== undefined) record.connectorType = input.connectorType;
  if (input.enabled !== undefined) record.enabled = input.enabled;
  if (input.checkoutVisible !== undefined) record.checkoutVisible = input.checkoutVisible;
  if (input.currency !== undefined) record.currency = input.currency.toUpperCase();
  if (input.feePercent !== undefined) record.feeBasisPoints = Math.round(input.feePercent * 100);
  if (input.minimumAmount !== undefined) record.minimumAmount = input.minimumAmount;
  if (input.maximumAmount !== undefined) record.maximumAmount = input.maximumAmount;
  if (input.environment !== undefined) record.environment = input.environment;
  if (input.apiBaseUrl !== undefined) record.apiBaseUrl = input.apiBaseUrl || null;
  if (input.testPath !== undefined) record.testPath = input.testPath || '/health';
  if (input.callbackUrl !== undefined) record.callbackUrl = input.callbackUrl;
  record.encryptedCredentials = encryptCredentials(credentials); record.credentialMasks = maskCredentials(credentials);
  record.configStatus = configComplete(record.connectorType, credentials, record.apiBaseUrl) ? 'configured' : 'incomplete';
  if (record.configStatus === 'incomplete') { record.enabled = false; record.checkoutVisible = false; }
  if (record.isDefault && (!record.enabled || !record.checkoutVisible)) {
    record.isDefault = false;
    const replacement = paymentMethods.find(method => method.id !== record.id && !method.removedAt && method.enabled && method.checkoutVisible);
    if (replacement) replacement.isDefault = true;
  }
  record.updatedAt = new Date().toISOString();
  persistPaymentMethod(record);
  return record;
}

export function setPaymentMethodEnabled(record: PaymentMethodRecord, enabled: boolean) {
  const wasDefault = record.isDefault;
  record.enabled = enabled;
  if (!enabled) { record.checkoutVisible = false; record.isDefault = false; }
  if (wasDefault && !enabled) {
    const replacement = paymentMethods.find(method => method.id !== record.id && !method.removedAt && method.enabled && method.checkoutVisible);
    if (replacement) replacement.isDefault = true;
  }
  record.updatedAt = new Date().toISOString();
  persistPaymentMethod(record);
  return record;
}
export function setDefaultPaymentMethod(record: PaymentMethodRecord) {
  if (!record.enabled || !record.checkoutVisible) return false;
  for (const method of paymentMethods) method.isDefault = method.id === record.id;
  record.updatedAt = new Date().toISOString();
  persistPaymentMethod(record);
  return true;
}
export function removePaymentMethod(record: PaymentMethodRecord) {
  record.enabled = false; record.checkoutVisible = false; record.isDefault = false; record.removedAt = new Date().toISOString(); record.updatedAt = record.removedAt;
  const replacement = paymentMethods.find(method => !method.removedAt && method.enabled && method.checkoutVisible);
  if (replacement && !paymentMethods.some(method => !method.removedAt && method.isDefault)) replacement.isDefault = true;
  persistPaymentMethod(record);
  if (replacement) persistPaymentMethod(replacement);
}

function isPrivateAddress(address: string) {
  if (address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
  const parts = address.split('.').map(Number);
  return isIP(address) === 4 && (parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}
async function validatedExternalUrl(base: string, path: string) {
  const url = new URL(path, base);
  if (url.protocol !== 'https:') throw new Error('Connection tests require an HTTPS provider endpoint.');
  if (url.username || url.password) throw new Error('Provider URLs cannot contain credentials.');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error('Private or local provider addresses are not allowed.');
  return url;
}

export async function testPaymentMethodConnection(record: PaymentMethodRecord) {
  const testedAt = new Date().toISOString();
  try {
    const credentials = decryptCredentials(record.encryptedCredentials);
    if (!configComplete(record.connectorType, credentials, record.apiBaseUrl)) throw new Error('Complete the required API configuration before testing.');
    if (record.connectorType === 'generic_https') {
      const url = await validatedExternalUrl(record.apiBaseUrl!, record.testPath);
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { authorization: `Bearer ${credentials.apiKey}`, 'x-api-secret': credentials.secretKey, 'x-merchant-id': credentials.merchantId, accept: 'application/json' } });
        if (!response.ok) throw new Error(`Provider test returned HTTP ${response.status}.`);
      } finally { clearTimeout(timeout); }
    }
    record.configStatus = 'configured'; record.lastTestResult = 'successful'; record.lastTestMessage = record.connectorType === 'manual' ? 'Manual payment instructions are configured.' : 'Provider connection test succeeded.';
  } catch (error) {
    record.configStatus = 'test_failed'; record.lastTestResult = 'failed'; record.lastTestMessage = error instanceof Error ? error.message : 'Connection test failed.';
  }
  record.lastTestedAt = testedAt; record.updatedAt = testedAt;
  persistPaymentMethod(record);
  return { successful: record.lastTestResult === 'successful', message: record.lastTestMessage!, testedAt };
}

export function paymentMethodAuditView(record: PaymentMethodRecord | undefined) {
  if (!record) return null;
  const { encryptedCredentials: _encrypted, credentialMasks: _masks, ...safe } = record;
  return safe;
}
