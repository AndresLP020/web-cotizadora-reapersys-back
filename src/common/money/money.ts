/**
 * Aritmética monetaria de ReaperSys.
 *
 * Convenciones (ver docs/ARCHITECTURE.md § Precisión monetaria):
 * - Los importes son ENTEROS en centavos (unidad menor). 1 MXN = 100 centavos.
 * - Las tasas (IVA, descuentos, anticipos) se expresan en PUNTOS BASE: 10 000 bp = 100 %.
 * - Redondeo: mitad alejándose de cero ("half up" para positivos), al centavo,
 *   aplicado en cada operación que produce fracciones.
 * - Los cálculos intermedios con tasas usan BigInt para evitar desbordes y errores de coma flotante.
 */

export type Cents = number;
export type BasisPoints = number;

export const BASIS_POINTS_SCALE = 10_000;
export const DEFAULT_CURRENCY = 'MXN';

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function assertCents(value: number, label = 'importe'): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} debe ser un entero de centavos seguro; recibido: ${value}`);
  }
}

export function assertBasisPoints(value: number, label = 'tasa'): asserts value is BasisPoints {
  if (!Number.isInteger(value) || value < 0 || value > BASIS_POINTS_SCALE) {
    throw new MoneyError(`${label} debe ser un entero entre 0 y ${BASIS_POINTS_SCALE} puntos base; recibido: ${value}`);
  }
}

/**
 * Convierte una cadena decimal de pesos ("3499", "3,499.50", "-12.5") a centavos sin pasar por float.
 * Rechaza más de dos decimales para no perder precisión silenciosamente.
 */
export function parsePesos(input: string): Cents {
  const normalized = input.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new MoneyError(`Importe inválido: "${input}"`);
  const [, sign, whole = '0', fraction = ''] = match;
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return toSafeNumber(sign ? -cents : cents);
}

/** Pesos enteros → centavos (útil para datos semilla expresados en pesos completos). */
export function fromWholePesos(pesos: number): Cents {
  if (!Number.isSafeInteger(pesos)) throw new MoneyError(`Se esperaban pesos enteros; recibido: ${pesos}`);
  return toSafeNumber(BigInt(pesos) * 100n);
}

export function add(...amounts: Cents[]): Cents {
  let total = 0n;
  for (const amount of amounts) {
    assertCents(amount);
    total += BigInt(amount);
  }
  return toSafeNumber(total);
}

export function subtract(a: Cents, b: Cents): Cents {
  assertCents(a);
  assertCents(b);
  return toSafeNumber(BigInt(a) - BigInt(b));
}

export function multiply(amount: Cents, quantity: number): Cents {
  assertCents(amount);
  if (!Number.isSafeInteger(quantity)) throw new MoneyError(`La cantidad debe ser entera; recibido: ${quantity}`);
  return toSafeNumber(BigInt(amount) * BigInt(quantity));
}

/** Aplica una tasa en puntos base a un importe, redondeando al centavo (mitad alejándose de cero). */
export function applyRate(amount: Cents, rate: BasisPoints): Cents {
  assertCents(amount);
  assertBasisPoints(rate);
  return toSafeNumber(divideRoundHalfAwayFromZero(BigInt(amount) * BigInt(rate), BigInt(BASIS_POINTS_SCALE)));
}

/**
 * Base gravable contenida en un importe que YA incluye el impuesto: gross / (1 + rate).
 * Ejemplo: $116.00 con IVA 16 % → base $100.00 (el impuesto incluido es gross − base).
 */
export function removeIncludedRate(gross: Cents, rate: BasisPoints): Cents {
  assertCents(gross);
  assertBasisPoints(rate);
  const scale = BigInt(BASIS_POINTS_SCALE);
  return toSafeNumber(divideRoundHalfAwayFromZero(BigInt(gross) * scale, scale + BigInt(rate)));
}

/**
 * Divide un total en dos partes (p. ej. anticipo y liquidación) garantizando que sumen exactamente el total.
 * La primera parte se redondea; la segunda absorbe la diferencia.
 */
/** Importe entre un número de periodos (p. ej. meses), redondeado al centavo. */
export function divideBy(amount: Cents, periods: number): Cents {
  assertCents(amount);
  if (!Number.isSafeInteger(periods) || periods <= 0) throw new MoneyError('El número de periodos debe ser un entero positivo.');
  return toSafeNumber(divideRoundHalfAwayFromZero(BigInt(amount), BigInt(periods)));
}

/** Redondea hacia arriba al peso entero (precios de lista limpios: $945.44 → $946.00). */
export function ceilToPeso(amount: Cents): Cents {
  assertCents(amount);
  return amount % 100 === 0 ? amount : amount + (100 - (((amount % 100) + 100) % 100));
}

export function splitByRate(total: Cents, firstPartRate: BasisPoints): { first: Cents; second: Cents } {
  const first = applyRate(total, firstPartRate);
  return { first, second: subtract(total, first) };
}

/** Formato de presentación (no usar para cálculos). */
export function formatMXN(amount: Cents, locale = 'es-MX'): string {
  assertCents(amount);
  const negative = amount < 0;
  const abs = BigInt(Math.abs(amount));
  const pesos = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, '0');
  const pesosFormatted = new Intl.NumberFormat(locale).format(pesos);
  return `${negative ? '-' : ''}$${pesosFormatted}.${cents}`;
}

function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function toSafeNumber(value: bigint): Cents {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError('Importe fuera del rango seguro.');
  }
  return Number(value);
}
