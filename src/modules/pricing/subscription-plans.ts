import { add, applyRate, ceilToPeso, subtract } from '../../common/money/money';

/**
 * Planes de la suscripción. La mensualidad publicada de cada paquete es la del plan «mensual».
 * Los demás planes se derivan de ella, cada uno en su plazo oficial:
 *
 *  - monthly:    pago cada mes → precio base.
 *  - semiannual: se cobra y se presupuesta cada 6 meses → descuento.
 *  - annual:     se cobra y se presupuesta cada 12 meses → descuento mayor.
 *
 * Los importes ajustados se redondean hacia arriba al peso (precios de lista limpios).
 */
export const SUBSCRIPTION_PLANS = ['monthly', 'semiannual', 'annual'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export interface SubscriptionPlanSettings {
  minimumTermMonths: number;
  monthToMonthSurchargeBp: number;
  semiannualDiscountBp: number;
  annualDiscountBp: number;
}

export const DEFAULT_PLAN_SETTINGS: SubscriptionPlanSettings = {
  minimumTermMonths: 12,
  monthToMonthSurchargeBp: 1_500,
  semiannualDiscountBp: 500,
  annualDiscountBp: 1_000,
};

/** Completa con los valores por omisión (bases creadas antes de los planes). */
export function planSettingsOf(rental: Partial<SubscriptionPlanSettings> | null | undefined): SubscriptionPlanSettings {
  return {
    minimumTermMonths: rental?.minimumTermMonths ?? DEFAULT_PLAN_SETTINGS.minimumTermMonths,
    monthToMonthSurchargeBp: rental?.monthToMonthSurchargeBp ?? DEFAULT_PLAN_SETTINGS.monthToMonthSurchargeBp,
    semiannualDiscountBp: rental?.semiannualDiscountBp ?? DEFAULT_PLAN_SETTINGS.semiannualDiscountBp,
    annualDiscountBp: rental?.annualDiscountBp ?? DEFAULT_PLAN_SETTINGS.annualDiscountBp,
  };
}

export interface PlanTerms {
  plan: SubscriptionPlan;
  label: string;
  /** Meses que se cobran en cada pago (1, 6 o 12). */
  billingMonths: number;
  /** Plazo mínimo; 0 = sin plazo forzoso. */
  termMonths: number;
  /** Positivo = recargo, negativo = descuento (puntos base). */
  adjustmentBp: number;
}

export function planTerms(plan: SubscriptionPlan, settings: SubscriptionPlanSettings): PlanTerms {
  switch (plan) {
    case 'monthly':
      return { plan, label: 'Mensual', billingMonths: 1, termMonths: settings.minimumTermMonths, adjustmentBp: 0 };
    case 'semiannual':
      return { plan, label: 'Semestral', billingMonths: 6, termMonths: 6, adjustmentBp: -settings.semiannualDiscountBp };
    case 'annual':
      return { plan, label: 'Anual', billingMonths: 12, termMonths: 12, adjustmentBp: -settings.annualDiscountBp };
  }
}

/** Mensualidad del plan a partir de la mensualidad base publicada. */
export function planMonthlyCents(baseMonthlyCents: number, terms: PlanTerms): number {
  if (terms.adjustmentBp === 0) return baseMonthlyCents;
  const adjustment = applyRate(baseMonthlyCents, Math.abs(terms.adjustmentBp));
  return ceilToPeso(terms.adjustmentBp > 0 ? add(baseMonthlyCents, adjustment) : subtract(baseMonthlyCents, adjustment));
}
