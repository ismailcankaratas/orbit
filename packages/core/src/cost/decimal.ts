/**
 * Exact decimal arithmetic for pricing (bigint only, never floats).
 *
 * A rate in USD/MTok is parsed to a scaled integer (RATE_SCALE = 1e6, i.e. up to
 * 6 fractional digits). Since USD = tokens * rate / 1e6, micro-USD =
 * tokens * rate, so `tokens * scaledRate / RATE_SCALE` is micro-USD.
 * Rounding: round half up, applied ONCE per request on the summed numerator
 * (see `roundHalfUp`), never per token class.
 */
export const RATE_SCALE = 1_000_000n;
const DECIMAL_RE = /^\d{1,6}(\.\d{1,6})?$/;

/** Parse "12.50" -> 12500000n (rate * 1e6). Throws on malformed input. */
export function parseRate(s: string): bigint {
  if (!DECIMAL_RE.test(s)) throw new Error(`Invalid decimal rate: ${JSON.stringify(s)}`);
  const [whole = '0', frac = ''] = s.split('.');
  return BigInt(whole) * RATE_SCALE + BigInt(frac.padEnd(6, '0'));
}

/** numerator / denominator, rounded half up (non-negative values). */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Format integer micro-USD as a decimal USD string with 6 decimals ("0.042100"). */
export function formatMicroUsd(micro: bigint): string {
  const neg = micro < 0n;
  const abs = neg ? -micro : micro;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0');
  return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}
