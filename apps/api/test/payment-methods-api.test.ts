import assert from 'node:assert/strict';
import test from 'node:test';
import { auditEvents } from '../src/auth.js';
import { app } from '../src/server.js';

function sessionCookie(response: Awaited<ReturnType<typeof app.inject>>) {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  assert.ok(value);
  return value.split(';')[0];
}

test.after(async () => { await app.close(); });

test('payment-method APIs enforce role/permission, mask secrets, audit changes, and remove disabled methods from checkout', async () => {
  await app.ready();
  const guest = await app.inject({ method: 'GET', url: '/api/v1/admin/payment-methods' });
  assert.equal(guest.statusCode, 401);

  const buyerLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'daniel@okellofoods.ug', password: 'BuyerDemo!2026' } });
  assert.equal(buyerLogin.statusCode, 200);
  const buyerForbidden = await app.inject({ method: 'GET', url: '/api/v1/admin/payment-methods', headers: { cookie: sessionCookie(buyerLogin) } });
  assert.equal(buyerForbidden.statusCode, 403);

  const adminLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'admin@harvestlink.ug', password: 'AdminDemo!2026', otp: '246810' } });
  assert.equal(adminLogin.statusCode, 200);
  const adminSession = sessionCookie(adminLogin);
  const csrf = adminLogin.json().data.csrfToken;
  const list = await app.inject({ method: 'GET', url: '/api/v1/admin/payment-methods', headers: { cookie: adminSession } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().meta.credentialsMasked, true);
  assert.equal(list.body.includes('encryptedCredentials'), false);
  assert.equal(list.body.includes('sandbox-mtn-key-8f92'), false);

  const paymentTable = await app.inject({ method: 'GET', url: '/api/v1/admin/operations/payments', headers: { cookie: adminSession } });
  assert.equal(paymentTable.statusCode, 200);
  const initialTable = paymentTable.json().data;
  assert.equal(initialTable.meta.unreadCount, initialTable.meta.moduleTotal);
  assert.equal(initialTable.records.every((record: any) => record.unread && record.readAt === null), true);
  const firstPaymentId = initialTable.records[0].id;

  const buyerReadAttempt = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/operations/payments/${firstPaymentId}/read-state`,
    headers: { cookie: sessionCookie(buyerLogin), 'x-csrf-token': buyerLogin.json().data.csrfToken }, payload: { unread: false },
  });
  assert.equal(buyerReadAttempt.statusCode, 403);

  const markRead = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/operations/payments/${firstPaymentId}/read-state`,
    headers: { cookie: adminSession, 'x-csrf-token': csrf }, payload: { unread: false },
  });
  assert.equal(markRead.statusCode, 200, markRead.body);
  assert.equal(markRead.json().data.unread, false);
  assert.ok(markRead.json().data.readAt);

  const readOnly = await app.inject({ method: 'GET', url: '/api/v1/admin/operations/payments?readState=READ', headers: { cookie: adminSession } });
  assert.equal(readOnly.statusCode, 200);
  assert.deepEqual(readOnly.json().data.records.map((record: any) => record.id), [firstPaymentId]);
  const unreadOnly = await app.inject({ method: 'GET', url: '/api/v1/admin/operations/payments?readState=UNREAD', headers: { cookie: adminSession } });
  assert.equal(unreadOnly.json().data.records.some((record: any) => record.id === firstPaymentId), false);

  const markUnread = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/operations/payments/${firstPaymentId}/read-state`,
    headers: { cookie: adminSession, 'x-csrf-token': csrf }, payload: { unread: true },
  });
  assert.equal(markUnread.statusCode, 200);
  assert.equal(markUnread.json().data.readAt, null);

  const visibleIds = initialTable.records.slice(0, 2).map((record: any) => record.id);
  const readVisible = await app.inject({
    method: 'POST', url: '/api/v1/admin/operations/payments/read-visible',
    headers: { cookie: adminSession, 'x-csrf-token': csrf }, payload: { recordIds: visibleIds },
  });
  assert.equal(readVisible.statusCode, 200, readVisible.body);
  assert.equal(readVisible.json().meta.updated, visibleIds.length);

  const apiKey = 'api-route-private-key-8f92';
  const secretKey = 'api-route-private-secret-7aa1';
  const created = await app.inject({
    method: 'POST', url: '/api/v1/admin/payment-methods', headers: { cookie: adminSession, 'x-csrf-token': csrf },
    payload: {
      name: 'API Route Test Gateway', provider: 'Route Test Uganda', icon: 'gateway', connectorType: 'sandbox',
      enabled: true, checkoutVisible: true, currency: 'UGX', feePercent: 1.2, minimumAmount: 500,
      maximumAmount: 2_000_000, environment: 'sandbox', callbackUrl: 'https://api.example.ug/webhooks/payments/route-test',
      testPath: '/health', apiKey, secretKey, merchantId: 'route-merchant-2001', accountBusinessNumber: 'route-account-3002',
      reason: 'Automated payment-method API security verification', confirmation: 'SAVE PAYMENT METHOD', otp: '246810',
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.body.includes(apiKey), false);
  assert.equal(created.body.includes(secretKey), false);
  const methodId = created.json().data.id;

  const disable = await app.inject({
    method: 'POST', url: `/api/v1/admin/payment-methods/${methodId}/action`, headers: { cookie: adminSession, 'x-csrf-token': csrf },
    payload: { action: 'disable', reason: 'Verify immediate buyer checkout removal', confirmation: methodId, otp: '246810' },
  });
  assert.equal(disable.statusCode, 200, disable.body);
  const publicMethods = await app.inject({ method: 'GET', url: '/api/v1/public/payment-methods' });
  assert.equal(publicMethods.json().data.some((method: any) => method.id === methodId), false);
  assert.equal(publicMethods.headers['cache-control'], 'no-store');

  const events = auditEvents.filter(event => event.targetId === methodId);
  assert.equal(events.length, 2);
  const auditJson = JSON.stringify(events);
  assert.equal(auditJson.includes(apiKey), false);
  assert.equal(auditJson.includes(secretKey), false);
  assert.equal(auditJson.includes('8F92'), false, 'credential masks must not enter audit data');

  const removed = await app.inject({
    method: 'DELETE', url: `/api/v1/admin/payment-methods/${methodId}`, headers: { cookie: adminSession, 'x-csrf-token': csrf },
    payload: { reason: 'Remove automated payment-method test configuration', confirmation: methodId, otp: '246810' },
  });
  assert.equal(removed.statusCode, 200, removed.body);
});
