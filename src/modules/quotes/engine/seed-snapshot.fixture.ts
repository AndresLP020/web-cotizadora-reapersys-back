/**
 * Construye un CatalogSnapshot a partir de los datos semilla del brief, sin base de datos.
 * Solo para pruebas: así el motor se verifica contra el catálogo comercial real.
 */
import { fromWholePesos } from '../../../common/money/money';
import { seedComponents, seedPackages, seedRules, type SeedPackageItem } from '../../../database/seeds/catalog.seed-data';
import { DEFAULT_PLAN_SETTINGS } from '../../pricing/subscription-plans';
import type { CatalogSnapshot, EngineComponent, EngineItem, EnginePackage, EngineRule, EngineSettings } from './engine.types';

export const CONFIRMED_SETTINGS: EngineSettings = {
  taxRateBp: 1_600,
  taxTreatment: 'exclusive',
  taxConfirmed: true,
  depositRateBp: 5_000,
  validityDays: 15,
  rentalPlans: DEFAULT_PLAN_SETTINGS,
};

export interface SnapshotOverrides {
  settings?: Partial<EngineSettings>;
  /** Mutaciones puntuales sobre los paquetes (p. ej. créditos de retiro aprobados). */
  mutatePackage?: (pkg: EnginePackage) => void;
}

export function seedSnapshot(overrides: SnapshotOverrides = {}): CatalogSnapshot {
  const components = new Map<string, EngineComponent>();
  for (const seed of seedComponents) {
    components.set(seed.slug, {
      id: seed.slug,
      slug: seed.slug,
      name: seed.name,
      unit: seed.unit ?? 'unidad',
      billing: seed.billing ?? 'one_time',
      active: true,
      publicVisible: seed.publicVisible ?? false,
      requiresEvaluation: seed.requiresEvaluation ?? false,
      taxable: true,
      maxQuantity: seed.maxQuantity ?? 1,
      exclusiveGroup: seed.exclusiveGroup,
      price: {
        priceId: `price-${seed.slug}`,
        version: 1,
        mode: seed.price.mode,
        saleCents: seed.price.mode === 'pending' ? null : fromWholePesos(seed.price.pesos!),
      },
    });
  }

  const toItem = (item: SeedPackageItem): EngineItem => ({
    componentId: item.component,
    quantity: item.quantity ?? 1,
    removable: item.removable ?? false,
    essential: item.essential ?? false,
  });

  const packages = new Map<string, EnginePackage>();
  for (const seed of seedPackages) {
    const removable = [...(seed.items ?? []), ...(seed.variantGroups ?? []).flatMap((g) => g.options.flatMap((o) => o.items))].filter(
      (i) => i.removable,
    );
    const pkg: EnginePackage = {
      id: seed.slug,
      slug: seed.slug,
      name: seed.name,
      category: seed.category,
      pricingType: seed.pricingType ?? 'fixed',
      active: true,
      features: [...seed.features],
      items: (seed.items ?? []).map(toItem),
      variantGroups: (seed.variantGroups ?? []).map((g) => ({
        key: g.key,
        name: g.name,
        defaultOption: g.defaultOption,
        options: g.options.map((o) => ({ key: o.key, name: o.name, items: o.items.map(toItem) })),
      })),
      includesPackages: (seed.includesPackages ?? []).map((i) => ({ packageId: i.package, variants: i.variants ?? {} })),
      comboPolicy: seed.comboPolicy,
      recommendedRecurringIds: seed.recommendedRecurring ?? [],
      addOnIds: seed.addOns ?? [],
      price: {
        priceId: `price-${seed.slug}`,
        version: 1,
        mode: seed.price.mode,
        baseCents: seed.price.mode === 'pending' ? null : fromWholePesos(seed.price.basePesos!),
        variantPrices: (seed.price.variantDeltas ?? []).map((d) => ({
          groupKey: d.group,
          optionKey: d.option,
          mode: d.pesos === null ? 'pending' : 'fixed',
          deltaCents: d.pesos === null ? null : fromWholePesos(d.pesos),
        })),
        removalCredits: removable.map((i) => ({ componentId: i.component, mode: 'pending', creditCents: null })),
      },
      // Mensualidad pendiente: cada prueba aprueba la que necesita con mutatePackage.
      rental: seed.rental
        ? {
            mode: seed.rental.saleMonthlyCents != null ? 'fixed' : 'pending',
            monthlyCents: seed.rental.saleMonthlyCents ?? null,
            setupFeeCents: null,
            hardwareUpfront: seed.rental.hardwareUpfront,
            includesHosting: seed.rental.hostingCostKey !== null,
            storageGb: seed.rental.storageGb,
            includesDomain: seed.rental.includesDomain,
            includedComponentIds: [...seed.rental.services, ...seed.rental.covered],
            serviceNames: seed.rental.services.map((slug) => components.get(slug)!.name),
            supportIncludedCents: seed.rental.supportIncludedCents ?? null,
            infrastructureAnnualCents: seed.rental.infrastructureAnnualCents ?? null,
            softwareOnly: seed.rental.softwareOnly ?? false,
          }
        : null,
    };
    overrides.mutatePackage?.(pkg);
    packages.set(pkg.id, pkg);
  }

  const rulesBySubject = new Map<string, EngineRule[]>();
  for (const rule of seedRules) {
    const list = rulesBySubject.get(rule.subject) ?? [];
    list.push({
      key: rule.key,
      type: rule.type,
      subjectId: rule.subject,
      packageCategories: rule.packageCategories ?? [],
      targetIds: rule.targets ?? [],
      action: rule.action,
      message: rule.message,
    });
    rulesBySubject.set(rule.subject, list);
  }

  return {
    components,
    componentsBySlug: components,
    packages,
    packagesBySlug: packages,
    rulesBySubject,
    settings: { ...CONFIRMED_SETTINGS, ...overrides.settings },
  };
}
