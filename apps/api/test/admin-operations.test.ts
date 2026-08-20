import assert from 'node:assert/strict';
import test from 'node:test';
import { adminGlobalSearch, adminModulePermissions, getAdminModule, performAdminModuleAction } from '../src/admin-operations.js';
import { buildAdminExport } from '../src/admin-export.js';

const REQUIRED_MODULES = [
  'farmers', 'buyers', 'marketplace', 'orders', 'payments', 'commissions', 'payouts', 'finance',
  'market-prices', 'content', 'ai', 'advertisements', 'reports', 'analytics', 'notifications',
  'moderation', 'security',
] as const;

test('every operational admin module has an explicit server permission and tailored data contract', () => {
  for (const module of REQUIRED_MODULES) {
    assert.ok(adminModulePermissions[module], `${module} must have a permission`);
    const page = getAdminModule(module, { limit: 25 });
    assert.equal(page.module, module);
    assert.ok(Array.isArray(page.summary));
    assert.ok(Array.isArray(page.records));
    assert.ok(Array.isArray(page.columns));
  }
});

test('unsupported payment mutations cannot edit an immutable successful transaction', () => {
  const payment = getAdminModule('payments', {}).records.find((record: any) => record.status === 'successful');
  assert.ok(payment);
  const amount = payment.amount;
  const result = performAdminModuleAction('payments', payment.id, 'edit_amount', 'Attempted mutation');
  assert.deepEqual(result, { error: 'UNSUPPORTED_ACTION' });
  const after = getAdminModule('payments', {}).records.find((record: any) => record.id === payment.id);
  assert.equal(after.amount, amount);
  assert.equal(after.status, 'successful');
});

test('commission cloning creates a new version without recalculating historical orders', () => {
  const historicalOrder = structuredClone(getAdminModule('orders', {}).records[0]);
  const rule = getAdminModule('commissions', {}).records[0];
  const result = performAdminModuleAction('commissions', rule.id, 'clone', 'Future effective version');
  assert.ok(!('error' in result));
  const currentOrder = getAdminModule('orders', {}).records.find((record: any) => record.id === historicalOrder.id);
  assert.equal(currentOrder.platformFee, historicalOrder.platformFee);
  assert.equal(currentOrder.gross, historicalOrder.gross);
  assert.equal(currentOrder.appliedCommissionRule, historicalOrder.appliedCommissionRule);
});

test('market-price publication appends a new observation without overwriting history', () => {
  const before = getAdminModule('market-prices', {});
  const source = structuredClone(before.records[0]);
  const result = performAdminModuleAction('market-prices', source.id, 'publish_new', 'New effective observation');
  assert.ok(!('error' in result));
  const after = getAdminModule('market-prices', {});
  assert.equal(after.meta.total, before.meta.total + 1);
  const historical = after.records.find((record: any) => record.id === source.id);
  assert.equal(historical.amount, source.amount);
  assert.equal(historical.observedAt, source.observedAt);
});

test('global admin search returns routed, privacy-minimised operational results', () => {
  const results = adminGlobalSearch('coffee');
  assert.ok(results.length > 0);
  assert.ok(results.every(group => group.route.startsWith('/admin/')));
  assert.ok(results.flatMap(group => group.items).every(item => !('passwordHash' in item)));
});

test('finance exports produce valid CSV, OOXML and PDF file signatures', () => {
  const data = getAdminModule('finance', {});
  const csv = buildAdminExport('finance', 'csv', data);
  const xlsx = buildAdminExport('finance', 'xlsx', data);
  const pdf = buildAdminExport('finance', 'pdf', data);
  assert.match(csv.body.toString('utf8'), /Gross merchandise value/);
  assert.equal(xlsx.body.subarray(0, 2).toString(), 'PK');
  assert.equal(pdf.body.subarray(0, 8).toString(), '%PDF-1.4');
});
