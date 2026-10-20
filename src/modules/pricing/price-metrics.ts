/**
 * Indicadores PRIVADOS de rentabilidad. Se expresan en puntos base (10 000 = 100 %).
 *
 *   Recargo sobre costo (markup) = (precio − costo) / costo
 *   Margen bruto (margin)        = (precio − costo) / precio
 *
 * Ejemplo: costo $100, precio $150 → recargo 50 %, margen 33.33 %. No son intercambiables.
 */

function ratioBp(numerator: bigint, denominator: bigint): number {
  // Redondeo mitad alejándose de cero, igual que el módulo monetario.
  const scaled = numerator * 10_000n;
  const negative = scaled < 0n !== denominator < 0n;
  const n = scaled < 0n ? -scaled : scaled;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const rounded = (n % d) * 2n >= d ? q + 1n : q;
  return Number(negative ? -rounded : rounded);
}

/** null si falta el costo o es cero (el recargo no está definido). */
export function markupBp(saleCents: number | null, costCents: number | null): number | null {
  if (saleCents === null || costCents === null || costCents === 0) return null;
  return ratioBp(BigInt(saleCents - costCents), BigInt(costCents));
}

/** null si falta el costo o el precio es cero (el margen no está definido). */
export function marginBp(saleCents: number | null, costCents: number | null): number | null {
  if (saleCents === null || costCents === null || saleCents === 0) return null;
  return ratioBp(BigInt(saleCents - costCents), BigInt(saleCents));
}

export function priceMetrics(saleCents: number | null, costCents: number | null) {
  return {
    markupBp: markupBp(saleCents, costCents),
    marginBp: marginBp(saleCents, costCents),
    grossProfitCents: saleCents !== null && costCents !== null ? saleCents - costCents : null,
  };
}
