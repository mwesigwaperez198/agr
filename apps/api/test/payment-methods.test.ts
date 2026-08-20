import assert from 'node:assert/strict';
import test from 'node:test';
import { permissionsFor } from '../src/auth.js';
import {
  adminPaymentMethods, createPaymentMethod, findPaymentMethod, paymentMethodAuditView, publicPaymentMethods,
  removePaymentMethod, setDefaultPaymentMethod, setPaymentMethodEnabled, testPaymentMethodConnection, updatePaymentMethod,
} from '../src/payment-methods.js';

const input = {
  name: 'Dynamic Test Gateway', provider: 'Test Provider Uganda', icon: 'gateway' as const,
  connectorType: 'sandbox' as const, enabled: true, checkoutVisible: true, currency: 'UGX', feePercent: 1.25,
  minimumAmount: 1000, maximumAmount: 2_000_000, environment: 'sandbox' as const,
  callbackUrl: 'https://api.example.ug/webhooks/payments/test', testPath: '/health',
  apiKey: 'plain-api-secret-8f92', secretKey: 'plain-secret-key-7aa1', merchantId: 'merchant-private-2001',
  accountBusinessNumber: 'private-account-3302',
};

test('payment-method administration uses a dedicated least-privilege permission', () => {
  assert.equal(permissionsFor('ADMIN').includes('payment-methods.manage'), true);
  assert.equal(permissionsFor('BUYER').includes('payment-methods.manage'), false);
  assert.equal(permissionsFor('FARMER_SELLER').includes('payment-methods.manage'), false);
});

test('credentials cross the storage boundary encrypted and projections expose masks only', () => {
  const record = createPaymentMethod(input);
  try {
    const encryptedJson = JSON.stringify(record.encryptedCredentials);
    assert.equal(encryptedJson.includes(input.apiKey), false);
    assert.equal(encryptedJson.includes(input.secretKey), false);
    const projection = adminPaymentMethods().find(method => method.id === record.id)!;
    const projectionJson = JSON.stringify(projection);
    assert.equal('encryptedCredentials' in projection, false);
    assert.equal(projectionJson.includes(input.apiKey), false);
    assert.equal(projectionJson.includes(input.secretKey), false);
    assert.match(projection.credentialMasks.apiKey, /8F92$/);
    assert.match(projection.credentialMasks.secretKey, /7AA1$/);
    const auditJson = JSON.stringify(paymentMethodAuditView(record));
    assert.equal(auditJson.includes(input.apiKey), false);
    assert.equal(auditJson.includes('8F92'), false, 'even credential masks are excluded from audit values');
  } finally { removePaymentMethod(record); }
});

test('blank edit credential fields retain encrypted values without returning plaintext', () => {
  const record = createPaymentMethod(input);
  try {
    const beforeMask = record.credentialMasks.apiKey;
    updatePaymentMethod(record, { name: 'Renamed Dynamic Gateway', apiKey: '', secretKey: '' });
    assert.equal(record.credentialMasks.apiKey, beforeMask);
    assert.equal(adminPaymentMethods().find(method => method.id === record.id)?.name, 'Renamed Dynamic Gateway');
    assert.equal(JSON.stringify(adminPaymentMethods()).includes(input.apiKey), false);
  } finally { removePaymentMethod(record); }
});

test('disabled methods leave checkout immediately while immutable transaction snapshots survive', () => {
  const record = createPaymentMethod(input);
  const checkout = publicPaymentMethods().find(method => method.id === record.id)!;
  const historicalSnapshot = structuredClone(checkout);
  assert.ok(checkout);
  setPaymentMethodEnabled(record, false);
  assert.equal(publicPaymentMethods().some(method => method.id === record.id), false);
  assert.deepEqual(historicalSnapshot, checkout);
  assert.equal(historicalSnapshot.name, input.name);
  removePaymentMethod(record);
});

test('only an enabled checkout-visible method can become default', () => {
  const record = createPaymentMethod({ ...input, name: 'Default Selection Test', enabled: false, checkoutVisible: false });
  const originalDefaultId = publicPaymentMethods().find(method => method.isDefault)?.id;
  try {
    assert.equal(setDefaultPaymentMethod(record), false);
    setPaymentMethodEnabled(record, true);
    updatePaymentMethod(record, { checkoutVisible: true });
    assert.equal(setDefaultPaymentMethod(record), true);
    assert.equal(publicPaymentMethods().find(method => method.isDefault)?.id, record.id);
  } finally {
    removePaymentMethod(record);
    const original = originalDefaultId ? findPaymentMethod(originalDefaultId) : undefined;
    if (original) setDefaultPaymentMethod(original);
  }
});

test('connection testing executes server-side and updates safe health metadata', async () => {
  const record = createPaymentMethod(input);
  try {
    const result = await testPaymentMethodConnection(record);
    assert.equal(result.successful, true);
    assert.equal(record.lastTestResult, 'successful');
    assert.equal(JSON.stringify(result).includes(input.apiKey), false);
  } finally { removePaymentMethod(record); }
});
