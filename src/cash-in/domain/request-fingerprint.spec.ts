import { decimalToMinorUnits, normalizeCurrency } from './money.js';
import { requestFingerprint } from './request-fingerprint.js';

describe('cash-in request normalization', () => {
  it.each([
    ['100', 10000n],
    ['100.00', 10000n],
    ['0.01', 1n],
  ])('converts %s to minor units', (amount, expected) => {
    expect(decimalToMinorUnits(amount)).toBe(expected);
  });

  it.each(['0', '-1', '1.001', 'not-money'])(
    'rejects invalid amount %s',
    (amount) => {
      expect(() => decimalToMinorUnits(amount)).toThrow();
    },
  );

  it('normalizes currency and fingerprints fixed business fields', () => {
    const first = requestFingerprint({
      userId: 'usr_1',
      amountMinor: 10000n,
      currency: normalizeCurrency(' pen '),
      paymentMethod: 'card_ref',
    });
    const second = requestFingerprint({
      paymentMethod: 'card_ref',
      currency: 'PEN',
      amountMinor: 10000n,
      userId: 'usr_1',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
