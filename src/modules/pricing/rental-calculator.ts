import { add, applyRate, ceilToPeso, divideBy, multiply, subtract } from '../../common/money/money';
import type { PriceMode } from '../catalog/catalog.constants';

/**
 * Mensualidad SUGERIDA de una suscripción (modelo: ReaperSys conserva la propiedad):
 *
 *   recuperación del paquete  = valor recuperable × (1 + recargo por financiamiento) ÷ plazo mínimo
 * + almacenamiento            = GB × costo por GB-mes
 * + dominio                   = costo anual ÷ 12
 * + servicio de mantenimiento/soporte incluido (su precio de venta publicado)
 *
 * El hosting no entra en la mensualidad: su costo se cobra en el primer pago.
 *
 * redondeada hacia arriba al peso. Es una sugerencia: el administrador la confirma y la publica.
 */

export interface RentalCostInput {
  /** null = valor pendiente de definir (p. ej. la parte de software de un POS). */
  recoverableCents: number | null;
  termMonths: number;
  financingBp: number;
  hosting: { name: string; monthlyCents: number; confirmed: boolean } | null;
  storage: { gb: number; perGbMonthCents: number; confirmed: boolean } | null;
  domain: { yearCents: number; confirmed: boolean } | null;
  services: { name: string; mode: PriceMode; monthlyCents: number | null }[];
  /**
   * Porcentaje del cálculo que se cobra (puntos base, 10 000 = 100 %).
   * La tienda virtual se renta a la mitad (5 000). El hosting no entra en esta base.
   */
  monthlyRateBp?: number;
}

export interface RentalBreakdownLine {
  key: 'recovery' | 'hosting' | 'storage' | 'domain' | 'service' | 'package' | 'combo_discount' | 'rental_rate';
  label: string;
  monthlyCents: number | null;
  note?: string;
}

export interface RentalSuggestion {
  lines: RentalBreakdownLine[];
  /** Suma exacta (sin redondear); null si falta algún dato. */
  rawMonthlyCents: number | null;
  suggestedMonthlyCents: number | null;
  /** pending = faltan datos; starting_at = hay costos por confirmar o servicios «desde»; fixed = todo confirmado. */
  mode: PriceMode;
  missing: string[];
  unconfirmed: string[];
}

export function suggestRental(input: RentalCostInput): RentalSuggestion {
  const lines: RentalBreakdownLine[] = [];
  const missing: string[] = [];
  const unconfirmed: string[] = [];

  if (input.recoverableCents === null) {
    missing.push('Valor a recuperar en el plazo');
    lines.push({ key: 'recovery', label: 'Recuperación de la implementación', monthlyCents: null, note: 'Valor pendiente de definir' });
  } else {
    const withFinancing = add(input.recoverableCents, applyRate(input.recoverableCents, input.financingBp));
    lines.push({
      key: 'recovery',
      label: 'Recuperación de la implementación',
      monthlyCents: divideBy(withFinancing, input.termMonths),
      note: `${input.termMonths} meses${input.financingBp ? ` · recargo ${input.financingBp / 100} %` : ''}`,
    });
  }

  if (input.hosting) {
    lines.push({
      key: 'hosting',
      label: input.hosting.name,
      monthlyCents: input.hosting.monthlyCents,
      note: 'Se cobra en el primer pago; no entra en la mensualidad',
    });
  }
  if (input.storage && input.storage.gb > 0) {
    lines.push({
      key: 'storage',
      label: `Almacenamiento (${input.storage.gb} GB)`,
      monthlyCents: multiply(input.storage.perGbMonthCents, input.storage.gb),
    });
    if (!input.storage.confirmed) unconfirmed.push('Almacenamiento');
  }
  if (input.domain) {
    lines.push({ key: 'domain', label: 'Dominio', monthlyCents: divideBy(input.domain.yearCents, 12), note: 'Costo anual ÷ 12' });
    if (!input.domain.confirmed) unconfirmed.push('Dominio');
  }

  let startingAt = false;
  for (const service of input.services) {
    lines.push({
      key: 'service',
      label: service.name,
      monthlyCents: service.mode === 'pending' ? null : service.monthlyCents,
      note: service.mode === 'starting_at' ? 'Precio «desde»' : undefined,
    });
    if (service.mode === 'pending' || service.monthlyCents === null) missing.push(`Precio de ${service.name}`);
    if (service.mode === 'starting_at') startingAt = true;
  }

  const monthlyLines = lines.filter((line) => line.key !== 'hosting');
  const complete = monthlyLines.every((line) => line.monthlyCents !== null);
  let rawMonthlyCents = complete ? add(...monthlyLines.map((line) => line.monthlyCents!)) : null;
  const rate = input.monthlyRateBp ?? 10_000;
  if (rawMonthlyCents !== null && rate !== 10_000) {
    const charged = applyRate(rawMonthlyCents, rate);
    lines.push({
      key: 'rental_rate',
      label: 'Renta de la tienda virtual',
      monthlyCents: -subtract(rawMonthlyCents, charged),
      note: `${rate / 100} % del cálculo`,
    });
    rawMonthlyCents = charged;
  }
  return {
    lines,
    rawMonthlyCents,
    suggestedMonthlyCents: rawMonthlyCents === null ? null : ceilToPeso(rawMonthlyCents),
    mode: !complete ? 'pending' : unconfirmed.length > 0 || startingAt ? 'starting_at' : 'fixed',
    missing,
    unconfirmed,
  };
}

/**
 * Mensualidad de un combo: suma de las mensualidades sugeridas de sus paquetes con el MISMO
 * porcentaje de descuento que tiene su precio de compra frente a esos paquetes por separado.
 */
export function combineRentals(
  parts: { name: string; suggestion: RentalSuggestion }[],
  prices: { comboCents: number | null; partsCents: number | null },
): RentalSuggestion {
  const lines: RentalBreakdownLine[] = parts.map((p) => ({ key: 'package', label: p.name, monthlyCents: p.suggestion.suggestedMonthlyCents }));
  const missing = [...new Set(parts.flatMap((p) => p.suggestion.missing.map((m) => `${p.name}: ${m}`)))];
  const unconfirmed = [...new Set(parts.flatMap((p) => p.suggestion.unconfirmed))];
  if (prices.comboCents === null || prices.partsCents === null || prices.partsCents === 0) missing.push('Precio del combo y de sus paquetes');

  const complete = missing.length === 0 && parts.every((p) => p.suggestion.suggestedMonthlyCents !== null);
  if (!complete) return { lines, rawMonthlyCents: null, suggestedMonthlyCents: null, mode: 'pending', missing, unconfirmed };

  const sum = add(...parts.map((p) => p.suggestion.suggestedMonthlyCents!));
  const savings = Math.max(0, subtract(prices.partsCents!, prices.comboCents!));
  const discountBp = Math.round((savings * 10_000) / prices.partsCents!);
  const discount = applyRate(sum, discountBp);
  if (discount > 0) lines.push({ key: 'combo_discount', label: 'Descuento del combo', monthlyCents: -discount, note: `${discountBp / 100} %, igual que su precio de compra` });
  const raw = subtract(sum, discount);
  const startingAt = parts.some((p) => p.suggestion.mode !== 'fixed');
  return { lines, rawMonthlyCents: raw, suggestedMonthlyCents: ceilToPeso(raw), mode: startingAt ? 'starting_at' : 'fixed', missing, unconfirmed };
}
