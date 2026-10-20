import type { QuoteCalculation, QuoteLine, RecurringLine, SubscriptionSummary } from './engine/engine.types';
import type { QuoteStatus } from './schemas/quote.schema';

/** Cálculo apto para el público: sin referencias internas a versiones de precio. */
export type PublicQuoteLine = Omit<QuoteLine, 'priceRef'>;
export type PublicRecurringLine = Omit<RecurringLine, 'priceRef'>;
export type PublicSubscription = Omit<SubscriptionSummary, 'priceRef'>;
export interface PublicCalculation extends Omit<QuoteCalculation, 'lines' | 'recurring' | 'subscription'> {
  lines: PublicQuoteLine[];
  subscription: PublicSubscription | null;
  recurring: PublicRecurringLine[];
  /** true solo si los importes son definitivos (sin revisión pendiente). */
  isFinal: boolean;
}

export function toPublicCalculation(calc: QuoteCalculation): PublicCalculation {
  return {
    currency: calc.currency,
    status: calc.status,
    isFinal: calc.status === 'priced',
    // Las versiones anteriores a la suscripción no guardan estos campos.
    paymentMode: calc.paymentMode ?? 'purchase',
    subscription: calc.subscription
      ? {
          // Versiones guardadas antes de los planes: plan mensual.
          plan: calc.subscription.plan ?? 'monthly',
          planLabel: calc.subscription.planLabel ?? 'Mensual',
          baseMonthlyCents: calc.subscription.baseMonthlyCents ?? calc.subscription.monthlyCents,
          monthlyCents: calc.subscription.monthlyCents,
          priceMode: calc.subscription.priceMode,
          monthlyTaxCents: calc.subscription.monthlyTaxCents,
          monthlyTotalCents: calc.subscription.monthlyTotalCents,
          billingMonths: calc.subscription.billingMonths ?? 1,
          paymentCents: calc.subscription.paymentCents ?? calc.subscription.monthlyTotalCents,
          termMonths: calc.subscription.termMonths,
          commitmentCents: calc.subscription.commitmentCents,
          hostingCharge: calc.subscription.hostingCharge ?? null,
          annualCharge: calc.subscription.annualCharge ?? null,
          supportIncludedCents: calc.subscription.supportIncludedCents ?? null,
          softwareOnly: calc.subscription.softwareOnly ?? false,
          firstPaymentCents: calc.subscription.firstPaymentCents ?? null,
          subsequentPaymentCents: calc.subscription.subsequentPaymentCents ?? calc.subscription.paymentCents ?? null,
          plans: (calc.subscription.plans ?? []).map((p) => ({
            ...p,
            budgetCents: p.budgetCents ?? null,
            savingsVsMonthlyCents: p.savingsVsMonthlyCents ?? null,
          })),
          hardwareUpfront: calc.subscription.hardwareUpfront,
          includes: [...calc.subscription.includes],
        }
      : null,
    package: calc.package,
    lines: calc.lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      componentSlug: line.componentSlug,
      quantity: line.quantity,
      includedQuantity: line.includedQuantity,
      unitCents: line.unitCents,
      amountCents: line.amountCents,
      priceMode: line.priceMode,
      taxable: line.taxable,
    })),
    includedItems: calc.includedItems.map((item) => ({ ...item })),
    recurring: calc.recurring.map((line) => ({
      componentSlug: line.componentSlug,
      description: line.description,
      billing: line.billing,
      amountCents: line.amountCents,
      priceMode: line.priceMode,
    })),
    providedByClient: (calc.providedByClient ?? []).map((item) => ({ ...item })),
    totals: { ...calc.totals },
    tax: { ...calc.tax },
    depositRateBp: calc.depositRateBp,
    comboSavingsCents: calc.comboSavingsCents,
    reviewReasons: calc.reviewReasons.map((r) => ({ ...r })),
    blockingIssues: calc.blockingIssues.map((i) => ({ ...i })),
  };
}

export interface PublicQuoteView {
  folio: string;
  status: QuoteStatus;
  version: number;
  createdAt: string;
  validUntil: string | null;
  client: { name: string; company?: string };
  industry?: string;
  calculation: PublicCalculation;
  terms: string[];
  business: { tradeName: string };
}

export interface CreateQuoteResult {
  folio: string;
  status: QuoteStatus;
  validUntil: string | null;
  /** Token de acceso: se entrega UNA sola vez; el servidor solo guarda su hash. */
  accessToken: string;
  accessPath: string;
  accessExpiresAt: string;
  calculation: PublicCalculation;
  /** Estado REAL de cada entrega. Nunca se reporta éxito sin confirmación del proveedor. */
  deliveries: {
    pdf: DeliveryState;
    email: DeliveryState;
    whatsapp: DeliveryState;
  };
}

export interface DeliveryState {
  status: 'not_requested' | 'not_available' | 'available' | 'queued' | 'simulated' | 'deferred' | 'sent' | 'failed';
  message: string;
}
