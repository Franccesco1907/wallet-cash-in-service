import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
  normalizeAmountInput,
  normalizeCurrency,
  serializeMinorUnits,
} from './money.js';
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

  it('formats balances beyond Number safe range without precision loss', () => {
    expect(minorUnitsToDecimal(9007199254740993n)).toBe('90071992547409.93');
  });

  it('rejects cash-in amounts above the documented maximum', () => {
    expect(decimalToMinorUnits('1000000.00')).toBe(100000000n);
    expect(() => decimalToMinorUnits('1000000.01')).toThrow(
      'Amount must not exceed 1000000.00',
    );
  });

  it('serializes safe cents as numbers and unsafe balances as text', () => {
    expect(serializeMinorUnits(10000n)).toBe(100);
    expect(serializeMinorUnits(9007199254740992n)).toBe('90071992547409.92');
  });

  it('normalizes bounded numeric amounts without accepting fractional cents', () => {
    expect(normalizeAmountInput(123456.78)).toBe('123456.78');
    expect(normalizeAmountInput(1.001)).toBeUndefined();
    expect(normalizeAmountInput(1000000.01)).toBeUndefined();
  });
});
