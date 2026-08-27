import { createHash } from 'node:crypto';

export interface FingerprintInput {
  userId: string;
  amountMinor: bigint;
  currency: string;
  paymentMethod: string;
}

export function requestFingerprint(input: FingerprintInput): string {
  const canonical = JSON.stringify({
    user_id: input.userId,
    amount_minor: input.amountMinor.toString(),
    currency: input.currency,
    payment_method: input.paymentMethod,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
