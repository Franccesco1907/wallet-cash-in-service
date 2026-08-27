export function decimalToMinorUnits(amount: string): bigint {
  const normalized = amount.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(
      'Amount must be a decimal with at most two fractional digits',
    );
  }
  const [whole, fractional = ''] = normalized.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'));
  if (minor <= 0n) throw new Error('Amount must be greater than zero');
  return minor;
}

export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

export function minorUnitsToDecimal(amountMinor: bigint): string {
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const whole = absolute / 100n;
  const fractional = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fractional}`;
}
