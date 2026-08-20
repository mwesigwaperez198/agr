import test from 'node:test';
import assert from 'node:assert/strict';
import { users, roleHasPermission } from '../src/auth.js';
import { canDeleteListing, canModifyListing, canViewOrder, dashboardForRole } from '../src/policies.js';

const admin = users.find(user => user.role === 'ADMIN')!;
const farmer = users.find(user => user.id === 'usr_farmer_demo')!;
const buyer = users.find(user => user.id === 'usr_buyer_demo')!;

test('each primary role has a distinct server-selected dashboard', () => {
  assert.equal(dashboardForRole('ADMIN'), '/admin/dashboard');
  assert.equal(dashboardForRole('FARMER_SELLER'), '/farmer/dashboard');
  assert.equal(dashboardForRole('BUYER'), '/buyer/dashboard');
});

test('farmer ownership is mandatory for listing changes', () => {
  assert.equal(canModifyListing(farmer, { sellerId: farmer.id }), true);
  assert.equal(canModifyListing(farmer, { sellerId: 'another_farmer' }), false);
  assert.equal(canDeleteListing(farmer, { sellerId: 'another_farmer' }), false);
  assert.equal(canModifyListing(buyer, { sellerId: buyer.id }), false);
});

test('authorized admin moderation is explicit rather than inferred from UI', () => {
  assert.equal(roleHasPermission(admin.role, 'marketplace.moderate'), true);
  assert.equal(canModifyListing(admin, { sellerId: farmer.id }), true);
  assert.equal(roleHasPermission(buyer.role, 'marketplace.moderate'), false);
});

test('orders are visible only to participants or authorized admins', () => {
  const order = { buyerId: buyer.id, sellerId: farmer.id };
  assert.equal(canViewOrder(buyer, order), true);
  assert.equal(canViewOrder(farmer, order), true);
  assert.equal(canViewOrder(admin, order), true);
  assert.equal(canViewOrder({ ...buyer, id: 'other_buyer' }, order), false);
  assert.equal(canViewOrder({ ...farmer, id: 'other_farmer' }, order), false);
});

test('suspended users fail resource policies even when ownership matches', () => {
  assert.equal(canModifyListing({ ...farmer, status: 'SUSPENDED' }, { sellerId: farmer.id }), false);
  assert.equal(canViewOrder({ ...buyer, status: 'SUSPENDED' }, { buyerId: buyer.id, sellerId: farmer.id }), false);
});
