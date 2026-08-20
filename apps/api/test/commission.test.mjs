import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFees } from '../src/money.mjs';

test('commission uses integer basis points without floating point drift', () => {
  assert.deepEqual(calculateFees(100000, 500, 150), {
    gross: 100000,
    platformFee: 5000,
    paymentFee: 1500,
    buyerTotal: 101500,
    sellerNet: 95000,
  });
});

test('half-up rounding is deterministic for indivisible UGX amounts', () => {
  assert.equal(calculateFees(99999, 500, 0).platformFee, 5000);
});
