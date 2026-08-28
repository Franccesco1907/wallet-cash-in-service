export const MAX_CASH_IN_MINOR = 100_000_000n;

function parseDecimalToMinorUnits(amount: string): bigint {
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

export function decimalToMinorUnits(amount: string): bigint {
  const minor = parseDecimalToMinorUnits(amount);
  if (minor > MAX_CASH_IN_MINOR) {
    throw new Error('Amount must not exceed 1000000.00');
  }
  return minor;
}

export function normalizeAmountInput(value: unknown): unknown {
  let decimal: string;
  if (typeof value === 'string') {
    decimal = value.trim();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const scaled = value * 100;
    const rounded = Math.round(scaled);
    const floatingPointTolerance =
      Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
    if (
      !Number.isSafeInteger(rounded) ||
      Math.abs(scaled - rounded) > floatingPointTolerance
    ) {
      return undefined;
    }
    decimal = minorUnitsToDecimal(BigInt(rounded));
  } else {
    return undefined;
  }

  try {
    decimalToMinorUnits(decimal);
    return decimal;
  } catch {
    return undefined;
  }
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

export function serializeMinorUnits(amountMinor: bigint): number | string {
  const candidate = Number(amountMinor) / 100;
  if (Number.isFinite(candidate) && candidate > 0) {
    try {
      if (parseDecimalToMinorUnits(candidate.toString()) === amountMinor) {
        return candidate;
      }
    } catch {
      // Fall through to the canonical representation.
    }
  }
  return minorUnitsToDecimal(amountMinor);
}
