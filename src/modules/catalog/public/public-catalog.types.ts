import type { BillingType, ComponentKind, PackageCategory, PackagePricingType, SolutionKind } from '../catalog.constants';

/**
 * Contrato PÚBLICO del catálogo. Solo datos comerciales autorizados:
 * nunca costos, márgenes, proveedores, existencias ni créditos internos.
 * Importes en centavos calculados por el backend.
 */
export interface PublicPricing {
  /** fixed = definitivo; starting_at = "desde"; pending = sin precio aprobado; on_request = sujeto a valoración. */
  mode: 'fixed' | 'starting_at' | 'pending' | 'on_request';
  amountCents: number | null;
  currency: 'MXN';
  /** Atajo: true si no existe un importe aprobado que mostrar. */
  pendingPricing: boolean;
}

export interface PublicComponentRef {
  slug: string;
  name: string;
  unit: string;
  /** Nombre cuando viene incluido («Secciones de la página»). */
  includedLabel?: string;
  /** Lo que contiene sin ser un componente propio («Productos ilimitados»). */
  highlights: string[];
  /** Se vende también por separado (puede aparecer en «Puedes agregar» para unidades extra). */
  maxQuantity: number;
}

export interface PublicPackageItem {
  component: PublicComponentRef;
  /** Cantidad incluida en el paquete (no se cobra de nuevo). */
  quantity: number;
  removable: boolean;
}

export interface PublicVariantOption {
  key: string;
  name: string;
  description?: string;
  /** Precio del paquete con esta opción (las demás variantes en su valor por defecto). */
  pricing: PublicPricing;
  items: PublicPackageItem[];
}

export interface PublicVariantGroup {
  key: string;
  name: string;
  defaultOption: string;
  options: PublicVariantOption[];
}

export interface PublicPackageVariant {
  slug: string;
  name: string;
  description?: string;
  pricing: PublicPricing;
}

export interface PublicPackage {
  slug: string;
  name: string;
  category: PackageCategory;
  summary: string;
  pricing: PublicPricing;
  features: string[];
  variants: PublicPackageVariant[];
  includesPackages: { slug: string; name: string }[];
  notes: string[];
  featured: boolean;
  sortOrder: number;
  /** Renta mensual (suscripción); null si el paquete no se ofrece en renta. */
  subscription: PublicSubscriptionOffer | null;
  /**
   * Informativo: lo que costarían por separado los items incluidos que también se venden como
   * complemento (cantidad × precio fijo publicado). No altera el total. 0 = nada que mostrar.
   */
  includedValueCents: number;
}

export interface PublicSubscriptionOffer {
  /** Mensualidad antes de impuestos. */
  pricing: PublicPricing;
  /** POS: el equipo se paga de contado; solo se renta el software. */
  hardwareUpfront: boolean;
  includesHosting: boolean;
  storageGb: number;
  includesDomain: boolean;
  /** La renta cubre solo el software; no incluye equipo. */
  softwareOnly: boolean;
  /** Soporte al usuario ya incluido en la mensualidad. */
  supportIncludedCents: number | null;
  /** Dominio y hosting, una vez al año y aparte de la mensualidad. */
  infrastructureAnnualCents: number | null;
}

export interface PublicPackageDetail extends PublicPackage {
  pricingType: PackagePricingType;
  items: PublicPackageItem[];
  variantGroups: PublicVariantGroup[];
  /** Paquetes contenidos (combos) con sus items, variantes fijadas incluidas. */
  includedPackages: { slug: string; name: string; variants: Record<string, string>; items: PublicPackageItem[] }[];
  recommendedRecurring: PublicComponent[];
  /**
   * Complementos que se pueden agregar («Puedes agregar»), con sus dependencias. Ya excluye lo
   * incluido y lo equivalente, salvo los cuantificables incluidos (solo unidades extra).
   * Vacío = el paquete no tiene adicionales.
   */
  addOns: PublicComponent[];
  /** Slugs de lo que el paquete ya cubre aunque no esté en items: nunca se ofrecen. */
  equivalents: string[];
  /** Slugs de los servicios que la mensualidad ya cubre (no se contratan aparte en suscripción). */
  subscriptionIncludedServices: string[];
}

export interface PublicComponent {
  slug: string;
  name: string;
  description?: string;
  category: { slug: string; name: string };
  kind: ComponentKind;
  billing: BillingType;
  unit: string;
  pricing: PublicPricing;
  requiresEvaluation: boolean;
  maxQuantity: number;
  exclusiveGroup?: string;
  /** Módulos que debe tener la cotización para contratarlo (cualquiera de ellos). Solo en el detalle del paquete. */
  requires?: { slug: string; name: string; message: string }[];
}

export interface PublicCategory {
  slug: string;
  name: string;
  description?: string;
}

export interface PublicIndustry {
  slug: string;
  name: string;
  description?: string;
  exampleSolutions: string[];
  suggestedSolutions: SolutionKind[];
}

export interface ListResponse<T> {
  items: T[];
}
