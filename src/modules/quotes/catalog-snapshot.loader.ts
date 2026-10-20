import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { CompatibilityRule } from '../catalog/schemas/compatibility-rule.schema';
import { Component } from '../catalog/schemas/component.schema';
import { Package, type PackageItem } from '../catalog/schemas/package.schema';
import { PricingService } from '../pricing/pricing.service';
import { planSettingsOf } from '../pricing/subscription-plans';
import { SettingsService } from '../settings/settings.service';
import type { CatalogSnapshot, EngineComponent, EngineItem, EnginePackage, EngineRule } from './engine/engine.types';

type Doc<T> = T & { _id: Types.ObjectId };

/**
 * Construye la foto del catálogo que consume el motor: componentes, paquetes y reglas
 * con sus precios PUBLICADOS vigentes y la configuración comercial.
 * El catálogo es pequeño, por lo que se carga completo en cada cálculo (siempre fresco).
 */
@Injectable()
export class CatalogSnapshotLoader {
  constructor(
    @InjectModel(Component.name) private readonly components: Model<Component>,
    @InjectModel(Package.name) private readonly packages: Model<Package>,
    @InjectModel(CompatibilityRule.name) private readonly rules: Model<CompatibilityRule>,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
  ) {}

  async load(): Promise<CatalogSnapshot> {
    const [components, packages, rules, settings] = await Promise.all([
      this.components.find({}).lean<Doc<Component>[]>(),
      this.packages.find({}).lean<Doc<Package>[]>(),
      this.rules.find({ active: true }).lean<Doc<CompatibilityRule>[]>(),
      this.settings.get(),
    ]);
    const [componentPrices, packagePrices] = await Promise.all([
      this.pricing.getPublishedComponentPrices(components.map((c) => c._id)),
      this.pricing.getPublishedPackagePrices(packages.map((p) => p._id)),
    ]);

    const engineComponents = new Map<string, EngineComponent>();
    for (const c of components) {
      const price = componentPrices.get(c._id.toString());
      engineComponents.set(c._id.toString(), {
        id: c._id.toString(),
        slug: c.slug,
        name: c.name,
        unit: c.unit,
        billing: c.billing,
        active: c.status === 'active',
        publicVisible: c.publicVisible,
        requiresEvaluation: c.requiresEvaluation,
        taxable: c.taxable,
        maxQuantity: c.maxQuantity,
        exclusiveGroup: c.exclusiveGroup,
        price: price ? { priceId: price._id.toString(), version: price.version, mode: price.mode, saleCents: price.saleCents } : null,
      });
    }

    const toItems = (items: PackageItem[]): EngineItem[] =>
      items.map((i) => ({ componentId: i.component.toString(), quantity: i.quantity, removable: i.removable, essential: i.essential }));

    const enginePackages = new Map<string, EnginePackage>();
    for (const p of packages) {
      const price = packagePrices.get(p._id.toString());
      const profile = p.rentalProfile;
      enginePackages.set(p._id.toString(), {
        id: p._id.toString(),
        slug: p.slug,
        name: p.name,
        category: p.category,
        pricingType: p.pricingType,
        active: p.status === 'active',
        features: [...(p.features ?? [])],
        items: toItems(p.items),
        variantGroups: p.variantGroups.map((g) => ({
          key: g.key,
          name: g.name,
          defaultOption: g.defaultOption,
          options: g.options.map((o) => ({ key: o.key, name: o.name, items: toItems(o.items) })),
        })),
        includesPackages: p.includesPackages.map((i) => {
          // Con lean() el Map de variantes llega como objeto plano.
          const raw: unknown = i.variants;
          const variants = raw instanceof Map ? Object.fromEntries(raw as Map<string, string>) : { ...(raw as Record<string, string>) };
          return { packageId: i.package.toString(), variants };
        }),
        recommendedRecurringIds: (p.recommendedRecurring ?? []).map((id) => id.toString()),
        addOnIds: (p.addOns ?? []).map((id) => id.toString()),
        comboPolicy: p.comboPolicy ? { onEssentialRemoval: p.comboPolicy.onEssentialRemoval, onVariantChange: p.comboPolicy.onVariantChange } : undefined,
        price: price
          ? {
              priceId: price._id.toString(),
              version: price.version,
              mode: price.mode,
              baseCents: price.baseCents,
              variantPrices: price.variantPrices.map((v) => ({ groupKey: v.groupKey, optionKey: v.optionKey, mode: v.mode, deltaCents: v.deltaCents })),
              removalCredits: price.removalCredits.map((c) => ({ componentId: c.component.toString(), mode: c.mode, creditCents: c.creditCents })),
            }
          : null,
        rental: profile?.enabled
          ? {
              mode: price?.rental?.mode ?? 'pending',
              monthlyCents: price?.rental?.monthlyCents ?? null,
              setupFeeCents: price?.rental?.setupFeeCents ?? null,
              hardwareUpfront: profile.hardwareUpfront,
              includesHosting: Boolean(profile.hostingCostKey),
              storageGb: profile.storageGb,
              includesDomain: profile.includesDomain,
              includedComponentIds: [...profile.services, ...profile.coveredComponents].map((id) => id.toString()),
              serviceNames: profile.services.map((id) => engineComponents.get(id.toString())?.name).filter((n): n is string => Boolean(n)),
              supportIncludedCents: profile.supportIncludedCents ?? null,
              infrastructureAnnualCents: profile.infrastructureAnnualCents ?? null,
              softwareOnly: profile.softwareOnly ?? false,
            }
          : null,
      });
    }

    const rulesBySubject = new Map<string, EngineRule[]>();
    for (const r of rules) {
      const subjectId = r.subject.toString();
      const list = rulesBySubject.get(subjectId) ?? [];
      list.push({
        key: r.key,
        type: r.type,
        subjectId,
        packageCategories: [...r.packageCategories],
        targetIds: r.targets.map((t) => t.toString()),
        action: r.action,
        message: r.message,
      });
      rulesBySubject.set(subjectId, list);
    }

    return {
      components: engineComponents,
      componentsBySlug: new Map([...engineComponents.values()].map((c) => [c.slug, c])),
      packages: enginePackages,
      packagesBySlug: new Map([...enginePackages.values()].map((p) => [p.slug, p])),
      rulesBySubject,
      settings: {
        taxRateBp: settings.tax.rateBp,
        taxTreatment: settings.tax.treatment,
        taxConfirmed: settings.tax.confirmed,
        depositRateBp: settings.quote.depositRateBp,
        validityDays: settings.quote.validityDays,
        rentalPlans: planSettingsOf(settings.rental),
      },
    };
  }
}
