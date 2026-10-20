/** Enumeraciones compartidas del catálogo comercial. */

/** custom = software a la medida o asesoría («Aún no estoy seguro»): se valora antes de dar un total. */
export const PACKAGE_CATEGORIES = ['web', 'ecommerce', 'pos', 'combo', 'custom'] as const;
export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number];

export const SOLUTION_KINDS = ['landing', 'web', 'ecommerce', 'pos', 'combo', 'custom'] as const;
export type SolutionKind = (typeof SOLUTION_KINDS)[number];

export const COMPONENT_KINDS = ['feature', 'service', 'hardware', 'software', 'license', 'recurring_service'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** Separa costos únicos, mensuales, anuales y variables de terceros (regla comercial 5). */
export const BILLING_TYPES = ['one_time', 'monthly', 'annual', 'third_party_variable'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const COMPONENT_CONDITIONS = ['new', 'refurbished'] as const;
export type ComponentCondition = (typeof COMPONENT_CONDITIONS)[number];

export const LIFECYCLE_STATUSES = ['draft', 'active', 'inactive'] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/** Estado de precio desnormalizado en el componente; se actualiza al publicar. */
export const COMPONENT_PRICING_STATUSES = ['pending_pricing', 'priced'] as const;
export type ComponentPricingStatus = (typeof COMPONENT_PRICING_STATUSES)[number];

/** fixed = definitivo; starting_at = mínimo comercial sujeto a evaluación; pending = sin precio aprobado. */
export const PRICE_MODES = ['fixed', 'starting_at', 'pending'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const PRICE_VERSION_STATUSES = ['draft', 'published', 'superseded'] as const;
export type PriceVersionStatus = (typeof PRICE_VERSION_STATUSES)[number];

/** fixed = precio de paquete; calculated = suma de componentes; evaluation = sujeto a valoración. */
export const PACKAGE_PRICING_TYPES = ['fixed', 'calculated', 'evaluation'] as const;
export type PackagePricingType = (typeof PACKAGE_PRICING_TYPES)[number];

/** Qué ocurre con el descuento de un combo cuando se retira un elemento esencial. */
export const COMBO_REMOVAL_POLICIES = ['recalculate', 'review'] as const;
export type ComboRemovalPolicy = (typeof COMBO_REMOVAL_POLICIES)[number];

export const COMPATIBILITY_RULE_TYPES = [
  /** El componente solo aplica si la cotización contiene un paquete de alguna de estas categorías. */
  'requires_package_category',
  /** El componente requiere otro componente en la cotización. */
  'requires_component',
  /** El componente no puede coexistir con otro. */
  'excludes_component',
] as const;
export type CompatibilityRuleType = (typeof COMPATIBILITY_RULE_TYPES)[number];

/** block = no se permite; review = se permite pero la cotización pasa a valoración. */
export const RULE_ACTIONS = ['block', 'review'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

/** Valida importes en centavos: entero seguro no negativo, o null cuando el precio está pendiente. */
export const centsValidator = {
  validator: (value: unknown) => value === null || value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0),
  message: 'El importe debe ser un entero de centavos no negativo.',
};

/** Igual que centsValidator pero admite negativos (deltas de variantes). */
export const signedCentsValidator = {
  validator: (value: unknown) => value === null || value === undefined || Number.isSafeInteger(value),
  message: 'El importe debe ser un entero de centavos.',
};
