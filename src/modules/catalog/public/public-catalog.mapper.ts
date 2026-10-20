import type { Types } from 'mongoose';
import { add } from '../../../common/money/money';
import type { ComponentPrice } from '../../pricing/schemas/component-price.schema';
import type { PackagePrice } from '../../pricing/schemas/package-price.schema';
import type { Category } from '../schemas/category.schema';
import type { Component } from '../schemas/component.schema';
import type { Industry } from '../schemas/industry.schema';
import type { Package, PackageItem } from '../schemas/package.schema';
import type {
  PublicCategory,
  PublicComponent,
  PublicIndustry,
  PublicPackage,
  PublicPackageDetail,
  PublicPackageItem,
  PublicPricing,
  PublicSubscriptionOffer,
  PublicVariantGroup,
} from './public-catalog.types';

/**
 * Conversión de documentos internos al contrato público.
 * Cada objeto se construye campo por campo (nunca con spread de documentos)
 * para que un campo privado nuevo no pueda filtrarse por accidente.
 */

type Doc<T> = T & { _id: Types.ObjectId };

const PENDING: PublicPricing = { mode: 'pending', amountCents: null, currency: 'MXN', pendingPricing: true };
const ON_REQUEST: PublicPricing = { mode: 'on_request', amountCents: null, currency: 'MXN', pendingPricing: true };

export function componentPricing(price: Pick<ComponentPrice, 'mode' | 'saleCents'> | undefined): PublicPricing {
  if (!price || price.mode === 'pending' || price.saleCents === null) return PENDING;
  return { mode: price.mode, amountCents: price.saleCents, currency: 'MXN', pendingPricing: false };
}

export function toPublicComponent(
  component: Doc<Component>,
  category: Pick<Category, 'slug' | 'name'>,
  price: Pick<ComponentPrice, 'mode' | 'saleCents'> | undefined,
): PublicComponent {
  return {
    slug: component.slug,
    name: component.name,
    description: component.description,
    category: { slug: category.slug, name: category.name },
    kind: component.kind,
    billing: component.billing,
    unit: component.unit,
    pricing: componentPricing(price),
    requiresEvaluation: component.requiresEvaluation,
    maxQuantity: component.maxQuantity,
    exclusiveGroup: component.exclusiveGroup,
  };
}

/** Precio del paquete eligiendo `optionKey` en `groupKey` (las demás variantes por defecto). */
export function variantOptionPricing(
  price: Pick<PackagePrice, 'mode' | 'baseCents' | 'variantPrices'> | undefined,
  group: { key: string; defaultOption: string },
  optionKey: string,
): PublicPricing {
  if (!price || price.mode === 'pending' || price.baseCents === null) return PENDING;
  if (optionKey === group.defaultOption) {
    return { mode: price.mode, amountCents: price.baseCents, currency: 'MXN', pendingPricing: false };
  }
  const delta = price.variantPrices.find((v) => v.groupKey === group.key && v.optionKey === optionKey);
  if (!delta || delta.mode === 'pending' || delta.deltaCents === null) return PENDING;
  return { mode: price.mode, amountCents: add(price.baseCents, delta.deltaCents), currency: 'MXN', pendingPricing: false };
}

/**
 * Precio mostrado para el paquete completo. Si alguna variante cuesta más o su diferencia
 * está pendiente, el paquete se presenta como "desde" el importe base.
 */
export function packagePricing(
  pkg: Pick<Package, 'pricingType' | 'variantGroups'>,
  price: Pick<PackagePrice, 'mode' | 'baseCents' | 'variantPrices'> | undefined,
): PublicPricing {
  if (pkg.pricingType === 'evaluation') return ON_REQUEST;
  if (!price || price.mode === 'pending' || price.baseCents === null) return PENDING;

  const hasHigherOrUnknownVariant = pkg.variantGroups.some((group) =>
    group.options.some((option) => {
      if (option.key === group.defaultOption) return false;
      const delta = price.variantPrices.find((v) => v.groupKey === group.key && v.optionKey === option.key);
      return !delta || delta.mode === 'pending' || (delta.deltaCents ?? 0) > 0;
    }),
  );

  return {
    mode: hasHigherOrUnknownVariant ? 'starting_at' : price.mode,
    amountCents: price.baseCents,
    currency: 'MXN',
    pendingPricing: false,
  };
}

export interface PackageMappingContext {
  price: Doc<PackagePrice> | undefined;
  /** Paquetes contenidos (para combos), por id. */
  packagesById: Map<string, Doc<Package>>;
}

export function toPublicPackage(pkg: Doc<Package>, ctx: PackageMappingContext): PublicPackage {
  return {
    slug: pkg.slug,
    name: pkg.name,
    category: pkg.category,
    summary: pkg.summary,
    pricing: packagePricing(pkg, ctx.price),
    features: [...pkg.features],
    variants: pkg.variantGroups.flatMap((group) =>
      group.options.map((option) => ({
        slug: option.key,
        name: option.name,
        description: option.description,
        pricing: variantOptionPricing(ctx.price, group, option.key),
      })),
    ),
    includesPackages: pkg.includesPackages.flatMap((included) => {
      const target = ctx.packagesById.get(included.package.toString());
      return target ? [{ slug: target.slug, name: target.name }] : [];
    }),
    notes: [...pkg.notes],
    featured: pkg.featured,
    sortOrder: pkg.sortOrder,
    subscription: subscriptionOffer(pkg, ctx.price),
  };
}

export function subscriptionOffer(pkg: Pick<Package, 'rentalProfile'>, price: Pick<PackagePrice, 'rental'> | undefined): PublicSubscriptionOffer | null {
  const profile = pkg.rentalProfile;
  if (!profile?.enabled) return null;
  const rental = price?.rental;
  return {
    pricing:
      !rental || rental.mode === 'pending' || rental.monthlyCents === null
        ? PENDING
        : { mode: rental.mode, amountCents: rental.monthlyCents, currency: 'MXN', pendingPricing: false },
    hardwareUpfront: profile.hardwareUpfront,
    includesHosting: Boolean(profile.hostingCostKey),
    storageGb: profile.storageGb,
    includesDomain: profile.includesDomain,
    softwareOnly: profile.softwareOnly ?? false,
    supportIncludedCents: profile.supportIncludedCents ?? null,
    infrastructureAnnualCents: profile.infrastructureAnnualCents ?? null,
  };
}

export interface PackageDetailContext extends PackageMappingContext {
  componentsById: Map<string, Doc<Component>>;
  recommendedRecurring: PublicComponent[];
  addOns: PublicComponent[];
}

function toPublicItems(items: PackageItem[], componentsById: Map<string, Doc<Component>>): PublicPackageItem[] {
  return items.flatMap((item) => {
    const component = componentsById.get(item.component.toString());
    if (!component) return [];
    return [
      {
        component: { slug: component.slug, name: component.name, unit: component.unit },
        quantity: item.quantity,
        removable: item.removable,
      },
    ];
  });
}

export function toPublicPackageDetail(pkg: Doc<Package>, ctx: PackageDetailContext): PublicPackageDetail {
  const variantGroups: PublicVariantGroup[] = pkg.variantGroups.map((group) => ({
    key: group.key,
    name: group.name,
    defaultOption: group.defaultOption,
    options: group.options.map((option) => ({
      key: option.key,
      name: option.name,
      description: option.description,
      pricing: variantOptionPricing(ctx.price, group, option.key),
      items: toPublicItems(option.items, ctx.componentsById),
    })),
  }));

  return {
    ...toPublicPackage(pkg, ctx),
    pricingType: pkg.pricingType,
    items: toPublicItems(pkg.items, ctx.componentsById),
    variantGroups,
    includedPackages: pkg.includesPackages.flatMap((included) => {
      const target = ctx.packagesById.get(included.package.toString());
      if (!target) return [];
      // Con lean() el Map de Mongoose llega como objeto plano.
      const raw: unknown = included.variants;
      const variants: Record<string, string> = raw instanceof Map ? Object.fromEntries(raw as Map<string, string>) : { ...(raw as Record<string, string>) };
      return [{ slug: target.slug, name: target.name, variants }];
    }),
    recommendedRecurring: ctx.recommendedRecurring,
    addOns: ctx.addOns,
    subscriptionIncludedServices: pkg.rentalProfile?.enabled
      ? [...pkg.rentalProfile.services, ...pkg.rentalProfile.coveredComponents].flatMap((id) => {
          const component = ctx.componentsById.get(id.toString());
          return component ? [component.slug] : [];
        })
      : [],
  };
}

export function toPublicCategory(category: Category): PublicCategory {
  return { slug: category.slug, name: category.name, description: category.description };
}

export function toPublicIndustry(industry: Industry): PublicIndustry {
  return {
    slug: industry.slug,
    name: industry.name,
    description: industry.description,
    exampleSolutions: [...industry.exampleSolutions],
    suggestedSolutions: [...industry.suggestedSolutions],
  };
}
