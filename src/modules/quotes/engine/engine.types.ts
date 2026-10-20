/**
 * Tipos del motor de cotización. El motor es PURO: no accede a la base de datos.
 * Recibe una foto inmutable del catálogo (CatalogSnapshot) y la selección del cliente,
 * y devuelve un cálculo determinista en centavos.
 */
import type {
  BillingType,
  ComboRemovalPolicy,
  CompatibilityRuleType,
  PackageCategory,
  PackagePricingType,
  PriceMode,
  RuleAction,
} from '../../catalog/catalog.constants';
import type { SubscriptionPlan, SubscriptionPlanSettings } from '../../pricing/subscription-plans';

// ---------------------------------------------------------------- foto del catálogo

export interface EnginePriceRef {
  /** Id de la versión de precio usada (para el snapshot de la cotización). */
  priceId: string;
  version: number;
}

export interface EngineComponent {
  id: string;
  slug: string;
  name: string;
  unit: string;
  billing: BillingType;
  active: boolean;
  publicVisible: boolean;
  requiresEvaluation: boolean;
  taxable: boolean;
  maxQuantity: number;
  exclusiveGroup?: string;
  price: (EnginePriceRef & { mode: PriceMode; saleCents: number | null }) | null;
}

export interface EngineItem {
  componentId: string;
  quantity: number;
  removable: boolean;
  essential: boolean;
}

export interface EngineVariantGroup {
  key: string;
  name: string;
  defaultOption: string;
  options: { key: string; name: string; items: EngineItem[] }[];
}

export interface EnginePackagePrice extends EnginePriceRef {
  mode: PriceMode;
  baseCents: number | null;
  variantPrices: { groupKey: string; optionKey: string; mode: 'fixed' | 'pending'; deltaCents: number | null }[];
  removalCredits: { componentId: string; mode: 'fixed' | 'pending'; creditCents: number | null }[];
}

export interface EnginePackage {
  id: string;
  slug: string;
  name: string;
  category: PackageCategory;
  pricingType: PackagePricingType;
  active: boolean;
  /** Lo que el cliente se lleva con el paquete. */
  features: string[];
  items: EngineItem[];
  variantGroups: EngineVariantGroup[];
  includesPackages: { packageId: string; variants: Record<string, string> }[];
  comboPolicy?: { onEssentialRemoval: ComboRemovalPolicy; onVariantChange: ComboRemovalPolicy };
  price: EnginePackagePrice | null;
  /** Mantenimiento que se cobra cada mes junto con la compra del paquete. */
  recommendedRecurringIds: string[];
  /** Complementos opcionales compatibles; vacío o ausente = cualquier complemento público. */
  addOnIds?: string[];
  /** Suscripción mensual; null si el paquete no se ofrece en renta. */
  rental: EnginePackageRental | null;
}

export interface EnginePackageRental {
  /** Modo y mensualidad de la versión de precio publicada (misma referencia que `price`). */
  mode: PriceMode;
  monthlyCents: number | null;
  /** Pago inicial (instalación o, en POS, el equipo que se paga de contado). */
  setupFeeCents: number | null;
  hardwareUpfront: boolean;
  includesHosting: boolean;
  storageGb: number;
  includesDomain: boolean;
  /** Servicios y componentes recurrentes que la mensualidad ya cubre (no se cobran aparte). */
  includedComponentIds: string[];
  /** Nombres de los servicios incluidos (mantenimiento, soporte…), para el desglose al cliente. */
  serviceNames: string[];
  /** Soporte al usuario ya incluido en la mensualidad. Null si no aplica. */
  supportIncludedCents?: number | null;
  /** Dominio y hosting, una vez al año y aparte de la mensualidad. */
  infrastructureAnnualCents?: number | null;
  /** La renta cubre solo el software; no incluye equipo. */
  softwareOnly?: boolean;
}

export interface EngineRule {
  key: string;
  type: CompatibilityRuleType;
  subjectId: string;
  packageCategories: PackageCategory[];
  targetIds: string[];
  action: RuleAction;
  message: string;
}

export interface EngineSettings {
  taxRateBp: number;
  taxTreatment: 'exclusive' | 'inclusive';
  taxConfirmed: boolean;
  depositRateBp: number;
  validityDays: number | null;
  /** Plazo mínimo del plan mensual, recargo del mes con mes y descuentos semestral y anual. */
  rentalPlans: SubscriptionPlanSettings;
}

export interface CatalogSnapshot {
  components: Map<string, EngineComponent>;
  componentsBySlug: Map<string, EngineComponent>;
  packages: Map<string, EnginePackage>;
  packagesBySlug: Map<string, EnginePackage>;
  rulesBySubject: Map<string, EngineRule[]>;
  settings: EngineSettings;
}

// ---------------------------------------------------------------- selección

/** purchase = el cliente compra el sistema; subscription = lo renta por mensualidad (ReaperSys conserva la propiedad). */
export const PAYMENT_MODES = ['purchase', 'subscription'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface QuoteSelection {
  /** Por omisión, compra. */
  paymentMode?: PaymentMode;
  /** Solo en suscripción; por omisión, mensual con plazo mínimo. */
  subscriptionPlan?: SubscriptionPlan;
  /** null = comenzar desde cero (solución personalizada). */
  packageSlug: string | null;
  /** Paquete simple: { groupKey: optionKey }. Combo: { "slugIncluido/groupKey": optionKey }. */
  variants: Record<string, string>;
  /** Slugs de componentes incluidos que el cliente retira. */
  removedComponents: string[];
  /** Complementos de pago único con su cantidad TOTAL deseada (incluye lo que ya trae el paquete). */
  components: { slug: string; quantity: number }[];
  /** Servicios recurrentes elegidos. */
  recurring: string[];
  /** Dominio u hosting (slugs de INFRASTRUCTURE_SLUGS) con los que el cliente ya cuenta: no se cobran. */
  clientProvided?: string[];
}

// ---------------------------------------------------------------- resultado

export type ReviewReasonCode =
  | 'package_pending_price'
  | 'package_starting_at'
  | 'package_requires_evaluation'
  | 'variant_pending_price'
  | 'component_pending_price'
  | 'component_starting_at'
  | 'component_requires_evaluation'
  | 'removal_credit_pending'
  | 'combo_essential_removed'
  | 'combo_variant_changed'
  | 'combo_discount_recalculated'
  | 'recurring_starting_at'
  | 'compatibility_review'
  | 'custom_solution'
  | 'negative_total'
  | 'validity_not_configured'
  | 'subscription_pending_price'
  | 'subscription_starting_at'
  | 'subscription_upfront_pending'
  | 'subscription_adjustment';

export interface ReviewReason {
  code: ReviewReasonCode;
  message: string;
  componentSlug?: string;
}

export interface BlockingIssue {
  code: 'compatibility_blocked';
  message: string;
  componentSlug: string;
  ruleKey: string;
}

export type LineKind = 'package' | 'variant' | 'addon' | 'removal_credit' | 'subscription_setup';

export interface QuoteLine {
  kind: LineKind;
  description: string;
  componentSlug?: string;
  /** Unidades cobradas (para complementos: total − incluidas). */
  quantity: number;
  /** Unidades ya incluidas en el paquete (solo complementos). */
  includedQuantity?: number;
  unitCents: number | null;
  /** null = importe pendiente de valoración. Negativo en créditos de retiro. */
  amountCents: number | null;
  priceMode: PriceMode | 'credit';
  taxable: boolean;
  priceRef?: EnginePriceRef & { type: 'component' | 'package' };
}

export interface IncludedItem {
  componentSlug: string;
  name: string;
  quantity: number;
  /** Paquete que aporta el componente (útil en combos). */
  fromPackage: string;
  removable: boolean;
  removed: boolean;
}

export interface RecurringLine {
  componentSlug: string;
  description: string;
  billing: BillingType;
  amountCents: number | null;
  priceMode: PriceMode;
  priceRef?: EnginePriceRef & { type: 'component' };
}

export interface QuoteTotals {
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  recurringMonthlyCents: number;
  recurringAnnualCents: number;
  /** true si algún importe está pendiente: los totales son parciales y no definitivos. */
  hasPendingAmounts: boolean;
}

/** Opción de plan con sus importes, para comparar. */
export interface SubscriptionPlanOption {
  plan: SubscriptionPlan;
  label: string;
  billingMonths: number;
  /** 0 = sin plazo forzoso. */
  termMonths: number;
  /** Positivo = recargo, negativo = descuento (puntos base). */
  adjustmentBp: number;
  monthlyCents: number | null;
  /** Igual que monthlyCents. */
  monthlyTotalCents: number | null;
  /** Importe de cada cobro (mensualidad × meses del cobro). */
  paymentCents: number | null;
  /** Presupuesto del plazo oficial. Null sin plazo o sin precio. */
  budgetCents: number | null;
  /**
   * Diferencia frente a pagar el plan mensual durante el mismo plazo
   * (1 mes si no hay plazo). Positivo = ahorra; negativo = cuesta más.
   */
  savingsVsMonthlyCents: number | null;
}

/** Hosting del primer pago. En cotizaciones viejas, si `upfront` no viene, iba en cada periodo. */
export interface SubscriptionHostingCharge {
  name: string;
  monthlyCents: number | null;
  billingMonths: number;
  chargeCents: number | null;
  upfront?: boolean;
}

/** Mensualidad de la suscripción (se cobra aparte del pago inicial). */
export interface SubscriptionSummary {
  plan: SubscriptionPlan;
  planLabel: string;
  /** Mensualidad base publicada (plan mensual). */
  baseMonthlyCents: number | null;
  /** Mensualidad del plan elegido. */
  monthlyCents: number | null;
  priceMode: PriceMode;
  /** Siempre 0. Se conserva para cotizaciones ya guardadas. */
  monthlyTaxCents: number;
  /** Igual que monthlyCents. */
  monthlyTotalCents: number | null;
  /** Meses de cada cobro e importe de ese cobro. */
  billingMonths: number;
  paymentCents: number | null;
  /** Plazo oficial del plan; 0 = sin plazo forzoso (mes con mes). */
  termMonths: number;
  /** Presupuesto del plazo (null sin plazo o sin precio). */
  commitmentCents: number | null;
  /**
   * Hosting del primer pago. `upfront` indica que no se repite en los siguientes cobros.
   * Cotizaciones anteriores lo traían dentro de cada periodo (`upfront` ausente).
   */
  hostingCharge: SubscriptionHostingCharge | null;
  /** Dominio y hosting cobrados cada año, aparte de la mensualidad. */
  annualCharge?: { name: string; cents: number } | null;
  /** Soporte al usuario ya incluido en la mensualidad. */
  supportIncludedCents?: number | null;
  /** La renta cubre solo el software. */
  softwareOnly?: boolean;
  /** Primer cobro: cargos de contado + dominio y hosting del año + primer periodo. Null si falta algún importe. */
  firstPaymentCents: number | null;
  /** A partir del segundo cobro: solo el periodo del plan. */
  subsequentPaymentCents: number | null;
  /** Todos los planes con sus importes, para que el cliente compare. */
  plans: SubscriptionPlanOption[];
  hardwareUpfront: boolean;
  /** Lo que cubre la mensualidad, para mostrarlo al cliente. */
  includes: string[];
  priceRef?: EnginePriceRef & { type: 'package' };
}

export type CalculationStatus = 'priced' | 'needs_review' | 'blocked';

export interface QuoteCalculation {
  currency: 'MXN';
  status: CalculationStatus;
  paymentMode: PaymentMode;
  /** Solo en suscripción; las líneas y totales representan entonces el pago inicial. */
  subscription: SubscriptionSummary | null;
  package: { slug: string; name: string; category: PackageCategory; variants: Record<string, string> } | null;
  lines: QuoteLine[];
  includedItems: IncludedItem[];
  recurring: RecurringLine[];
  /** Dominio u hosting que el cliente ya tiene y por eso no se cobran. Ausente en cotizaciones anteriores. */
  providedByClient?: { componentSlug: string; name: string }[];
  totals: QuoteTotals;
  tax: { rateBp: number; treatment: 'exclusive' | 'inclusive'; confirmed: boolean };
  depositRateBp: number;
  /** Ahorro informativo de un combo frente a sus paquetes por separado (ya reflejado en su precio). */
  comboSavingsCents: number | null;
  reviewReasons: ReviewReason[];
  blockingIssues: BlockingIssue[];
}

/** Error de entrada (selección imposible): se traduce a HTTP 400. */
export class QuoteSelectionError extends Error {
  override name = 'QuoteSelectionError';
}
