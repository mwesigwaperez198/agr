import assert from 'node:assert/strict';
import test from 'node:test';
import { adminRecordReadAt, markAdminRecordRead, markAdminRecordsRead, markAdminRecordUnread } from '../src/admin-record-views.js';

test('administrator record read state is isolated by administrator, module, and record', () => {
  const viewed = markAdminRecordRead('admin_one', 'payments', 'pay_10042', '2026-08-16T10:00:00.000Z');
  assert.equal(viewed.firstViewedAt, '2026-08-16T10:00:00.000Z');
  assert.equal(adminRecordReadAt('admin_one', 'payments', 'pay_10042'), viewed.firstViewedAt);
  assert.equal(adminRecordReadAt('admin_two', 'payments', 'pay_10042'), null);
  assert.equal(adminRecordReadAt('admin_one', 'orders', 'pay_10042'), null);
  assert.equal(adminRecordReadAt('admin_one', 'payments', 'pay_other'), null);
});

test('reopening retains first-view time while marking unread preserves viewing history', () => {
  markAdminRecordRead('admin_reopen', 'reports', 'rep_301', '2026-08-16T10:01:00.000Z');
  const reopened = markAdminRecordRead('admin_reopen', 'reports', 'rep_301', '2026-08-16T10:05:00.000Z');
  assert.equal(reopened.firstViewedAt, '2026-08-16T10:01:00.000Z');
  assert.equal(reopened.lastViewedAt, '2026-08-16T10:05:00.000Z');
  assert.equal(markAdminRecordUnread('admin_reopen', 'reports', 'rep_301'), true);
  assert.equal(adminRecordReadAt('admin_reopen', 'reports', 'rep_301'), null);
  const readAgain = markAdminRecordRead('admin_reopen', 'reports', 'rep_301', '2026-08-16T10:08:00.000Z');
  assert.equal(readAgain.firstViewedAt, '2026-08-16T10:01:00.000Z');
  assert.equal(readAgain.lastViewedAt, '2026-08-16T10:08:00.000Z');
});

test('visible records can be marked read in one bounded operation', () => {
  const views = markAdminRecordsRead('admin_bulk', 'orders', ['ord_1', 'ord_2'], '2026-08-16T10:10:00.000Z');
  assert.deepEqual(views.map(view => view.recordId), ['ord_1', 'ord_2']);
  assert.equal(adminRecordReadAt('admin_bulk', 'orders', 'ord_1'), '2026-08-16T10:10:00.000Z');
  assert.equal(adminRecordReadAt('admin_bulk', 'orders', 'ord_2'), '2026-08-16T10:10:00.000Z');
});
