export function roundBasisPoints(amount, basisPoints) {
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(basisPoints)) {
    throw new TypeError('Currency and basis points must be safe integers');
  }
  return Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
}

export function calculateFees(gross, commissionBasisPoints, paymentBasisPoints) {
  const platformFee = roundBasisPoints(gross, commissionBasisPoints);
  const paymentFee = roundBasisPoints(gross, paymentBasisPoints);
  return {
    gross,
    platformFee,
    paymentFee,
    buyerTotal: gross + paymentFee,
    sellerNet: gross - platformFee,
  };
}
