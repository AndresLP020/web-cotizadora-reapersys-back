import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types, type UpdateQuery } from 'mongoose';
import { fromWholePesos } from '../../common/money/money';
import { seedNfcDesigns, seedNfcPriceTiers, seedOccasions, seedTemplates } from '../../modules/digital/digital.seed-data';
import { DigitalTemplate } from '../../modules/digital/schemas/digital-template.schema';
import { NfcDesign } from '../../modules/digital/schemas/nfc-design.schema';
import { NfcPriceTier } from '../../modules/digital/schemas/nfc-price-tier.schema';
import { Occasion } from '../../modules/digital/schemas/occasion.schema';
import { SYSTEM_ACTOR } from '../../modules/audit/audit.service';
import { Category } from '../../modules/catalog/schemas/category.schema';
import { CompatibilityRule } from '../../modules/catalog/schemas/compatibility-rule.schema';
import { Component } from '../../modules/catalog/schemas/component.schema';
import { Industry } from '../../modules/catalog/schemas/industry.schema';
import { Package } from '../../modules/catalog/schemas/package.schema';
import { PricingService } from '../../modules/pricing/pricing.service';
import { OperatingCost } from '../../modules/pricing/schemas/operating-cost.schema';
import { inValues, trusted } from '../query-operators';
import { ComponentPrice } from '../../modules/pricing/schemas/component-price.schema';
import { PackagePrice } from '../../modules/pricing/schemas/package-price.schema';
import { BusinessSettings } from '../../modules/settings/schemas/business-settings.schema';
import {
  type SeedPackage,
  type SeedPackageItem,
  CORPORATE_SOCIAL_FEATURE,
  CORPORATE_SOCIAL_ITEMS,
  RETIRED_PACKAGE_SLUGS,
  seedCategories,
  seedComponents,
  seedIndustries,
  seedOperatingCosts,
  seedPackages,
  seedRules,
  seedPackageTaglines,
  seedSettings,
} from './catalog.seed-data';

export interface SeedReport {
  categories: number;
  industries: number;
  components: number;
  componentPrices: number;
  packages: number;
  packagePrices: number;
  rules: number;
  settings: number;
  operatingCosts: number;
  /** Paquetes, precios o configuración existentes a los que se agregó la suscripción. */
  rentalBackfill: number;
  /** Paquetes de catálogos anteriores eliminados (con sus versiones de precio). */
  retiredPackages: number;
  /** Cambios aplicados una sola vez al introducir dominio y hosting anuales. */
  infrastructureUpgrade: number;
  /** Paquetes, componentes y reglas existentes alineados con el contenido vigente de cada paquete. */
  catalogSync: number;
  /** Catálogo digital: ocasiones, plantillas (en borrador), diseños NFC (en borrador) y tramos de precio NFC. */
  digitalOccasions: number;
  digitalTemplates: number;
  nfcDesigns: number;
  nfcPriceTiers: number;
  /** Paquetes a los que se cargó su promesa de una línea (solo si no tenían). */
  packageTaglines: number;
}

/** Servicios que «Hosting» y «Dominio» anuales reemplazan. */
const LEGACY_INFRASTRUCTURE_SLUGS = ['managed-hosting', 'domain'];

/** Complementos retirados del catálogo: se desactivan (las cotizaciones emitidas conservan su snapshot). */
const RETIRED_COMPONENT_SLUGS = [
  // Cobraba por producto: el catálogo de tienda, POS y combo no tiene límite de productos.
  'ecommerce-product',
];

/** Descripciones anteriores que el seed corrige solo si nadie las editó desde el panel. */
const OUTDATED_DESCRIPTIONS = [{ slug: 'pos-csv-import-export', description: 'Hasta 2,000 productos por archivo en la referencia.' }];

const SEED_ACTOR = SYSTEM_ACTOR('seed');

/**
 * Carga el catálogo inicial. Idempotente y NO destructivo:
 * - Inserta las entidades que no existen (por slug/clave).
 * - Solo crea la versión 1 de un precio si el elemento no tiene ninguna versión.
 * - Sincroniza el CONTENIDO de los paquetes (items, características, complementos, equivalentes),
 *   las etiquetas de los componentes y las reglas: nada de eso se edita desde el panel.
 * Así, volver a ejecutarlo nunca revierte precios ni cambios hechos por el administrador.
 */
@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(Industry.name) private readonly industries: Model<Industry>,
    @InjectModel(Component.name) private readonly components: Model<Component>,
    @InjectModel(Package.name) private readonly packages: Model<Package>,
    @InjectModel(CompatibilityRule.name) private readonly rules: Model<CompatibilityRule>,
    @InjectModel(ComponentPrice.name) private readonly componentPrices: Model<ComponentPrice>,
    @InjectModel(PackagePrice.name) private readonly packagePrices: Model<PackagePrice>,
    @InjectModel(BusinessSettings.name) private readonly settings: Model<BusinessSettings>,
    @InjectModel(OperatingCost.name) private readonly operatingCosts: Model<OperatingCost>,
    private readonly pricing: PricingService,
    @InjectModel(Occasion.name) private readonly occasions: Model<Occasion>,
    @InjectModel(DigitalTemplate.name) private readonly digitalTemplates: Model<DigitalTemplate>,
    @InjectModel(NfcDesign.name) private readonly nfcDesigns: Model<NfcDesign>,
    @InjectModel(NfcPriceTier.name) private readonly nfcPriceTiers: Model<NfcPriceTier>,
  ) {}

  async run(): Promise<SeedReport> {
    const report: SeedReport = {
      categories: 0,
      industries: 0,
      components: 0,
      componentPrices: 0,
      packages: 0,
      packagePrices: 0,
      rules: 0,
      settings: 0,
      operatingCosts: 0,
      rentalBackfill: 0,
      retiredPackages: 0,
      infrastructureUpgrade: 0,
      catalogSync: 0,
      digitalOccasions: 0,
      digitalTemplates: 0,
      nfcDesigns: 0,
      nfcPriceTiers: 0,
      packageTaglines: 0,
    };
    const missing = trusted({ $exists: false });

    // Configuración comercial
    report.settings = await this.insertIfAbsent(this.settings, { key: seedSettings.key }, seedSettings);
    // Bases creadas antes de la suscripción: solo se agrega lo que falta.
    report.rentalBackfill += (await this.settings.updateOne({ key: seedSettings.key, rental: missing }, { $set: { rental: seedSettings.rental } })).modifiedCount;
    const { monthToMonthSurchargeBp, semiannualDiscountBp, annualDiscountBp } = seedSettings.rental;
    report.rentalBackfill += (
      await this.settings.updateOne(
        { key: seedSettings.key, 'rental.monthToMonthSurchargeBp': missing },
        { $set: { 'rental.monthToMonthSurchargeBp': monthToMonthSurchargeBp, 'rental.semiannualDiscountBp': semiannualDiscountBp, 'rental.annualDiscountBp': annualDiscountBp } },
      )
    ).modifiedCount;
    // Bases sin ningún dato de contacto capturado: se cargan los de la empresa; lo editado en el panel se respeta.
    await this.settings.updateOne(
      { key: seedSettings.key, 'contact.email': missing, 'contact.whatsapp': missing, 'contact.instagram': missing, 'contact.tiktok': missing },
      { $set: { contact: seedSettings.contact } },
    );

    // Costos de operación de referencia (para la mensualidad sugerida)
    for (const [index, cost] of seedOperatingCosts.entries()) {
      report.operatingCosts += await this.insertIfAbsent(this.operatingCosts, { key: cost.key }, { ...cost, confirmed: false, sortOrder: (index + 1) * 10 });
    }

    // Categorías e industrias
    for (const [index, category] of seedCategories.entries()) {
      report.categories += await this.insertIfAbsent(this.categories, { slug: category.slug }, { ...category, sortOrder: category.sortOrder ?? index });
    }
    for (const [index, industry] of seedIndustries.entries()) {
      report.industries += await this.insertIfAbsent(this.industries, { slug: industry.slug }, { ...industry, sortOrder: (index + 1) * 10 });
    }

    // Componentes
    // Antes de insertarlos: si el hosting anual aún no existe, esta ejecución aplica la actualización única de abajo.
    const upgradeInfrastructure = !(await this.components.exists({ slug: 'hosting-annual' }));
    const categoryIds = await this.idsBySlug(this.categories);
    for (const [index, seed] of seedComponents.entries()) {
      const categoryId = categoryIds.get(seed.category);
      if (!categoryId) throw new Error(`Categoría inexistente en seed: ${seed.category}`);
      const { price: _price, category: _category, ...data } = seed;
      report.components += await this.insertIfAbsent(
        this.components,
        { slug: seed.slug },
        {
          ...data,
          category: categoryId,
          billing: seed.billing ?? 'one_time',
          unit: seed.unit ?? 'unidad',
          publicVisible: seed.publicVisible ?? false,
          requiresEvaluation: seed.requiresEvaluation ?? false,
          maxQuantity: seed.maxQuantity ?? 1,
          status: 'active',
          pricingStatus: 'pending_pricing',
          sortOrder: (index + 1) * 10,
        },
      );
    }
    const componentIds = await this.idsBySlug(this.components);
    const componentId = (slug: string): Types.ObjectId => {
      const id = componentIds.get(slug);
      if (!id) throw new Error(`Componente inexistente en seed: ${slug}`);
      return id;
    };

    // Precios de componentes (v1 publicada solo si no hay historial)
    for (const seed of seedComponents) {
      const id = componentId(seed.slug);
      if (await this.componentPrices.exists({ component: id })) continue;
      const draft = await this.pricing.createComponentPriceDraft(
        id,
        {
          mode: seed.price.mode,
          saleCents: seed.price.mode === 'pending' ? null : fromWholePesos(seed.price.pesos!),
          notes: 'Precio inicial del brief comercial.',
        },
        SEED_ACTOR,
      );
      await this.pricing.publishComponentPrice(draft._id, SEED_ACTOR);
      report.componentPrices += 1;
    }

    // Paquetes de catálogos anteriores: se eliminan con sus versiones de precio.
    report.retiredPackages = await this.retirePackages();

    // Paquetes (los combos referencian paquetes, por eso se insertan después de los simples)
    const toItem = (item: SeedPackageItem) => ({
      component: componentId(item.component),
      quantity: item.quantity ?? 1,
      removable: item.removable ?? false,
      essential: item.essential ?? false,
    });
    const rentalProfileOf = (seed: SeedPackage) =>
      seed.rental
        ? {
            enabled: true,
            hostingCostKey: seed.rental.hostingCostKey,
            storageGb: seed.rental.storageGb,
            includesDomain: seed.rental.includesDomain,
            services: seed.rental.services.map(componentId),
            coveredComponents: seed.rental.covered.map(componentId),
            recoverableMode: seed.rental.recoverableMode,
            recoverableCents: null,
            hardwareUpfront: seed.rental.hardwareUpfront,
            hostingOnFirstPayment: true,
            monthlyRateBp: seed.rental.monthlyRateBp ?? 10_000,
            saleMonthlyCents: seed.rental.saleMonthlyCents ?? null,
            supportIncludedCents: seed.rental.supportIncludedCents ?? null,
            infrastructureAnnualCents: seed.rental.infrastructureAnnualCents ?? null,
            softwareOnly: seed.rental.softwareOnly ?? false,
          }
        : { enabled: false };
    /** Lo que el paquete incluye y ofrece: se inserta y, en bases existentes, se sincroniza. */
    const packageContent = (seed: SeedPackage) => ({
      features: seed.features.map((f) => f.text),
      notes: seed.notes ?? [],
      items: (seed.items ?? []).map(toItem),
      recommendedRecurring: (seed.recommendedRecurring ?? []).map(componentId),
      addOns: (seed.addOns ?? []).map(componentId),
      equivalents: (seed.equivalents ?? []).map(componentId),
    });
    const ordered = [...seedPackages.filter((p) => p.category !== 'combo'), ...seedPackages.filter((p) => p.category === 'combo')];
    for (const seed of ordered) {
      const packageIds = await this.idsBySlug(this.packages);
      report.packages += await this.insertIfAbsent(
        this.packages,
        { slug: seed.slug },
        {
          slug: seed.slug,
          name: seed.name,
          category: seed.category,
          summary: seed.summary,
          ...packageContent(seed),
          pricingType: seed.pricingType ?? 'fixed',
          variantGroups: (seed.variantGroups ?? []).map((group) => ({
            ...group,
            options: group.options.map((option) => ({ ...option, items: option.items.map(toItem) })),
          })),
          includesPackages: (seed.includesPackages ?? []).map((included) => {
            const id = packageIds.get(included.package);
            if (!id) throw new Error(`Paquete inexistente en seed: ${included.package}`);
            return { package: id, variants: included.variants ?? {} };
          }),
          comboPolicy: seed.comboPolicy,
          rentalProfile: rentalProfileOf(seed),
          status: 'active',
          featured: seed.featured ?? false,
          sortOrder: (seedPackages.indexOf(seed) + 1) * 10,
        },
      );
    }

    // Precios de paquetes
    const packageIds = await this.idsBySlug(this.packages);
    for (const seed of seedPackages) {
      const id = packageIds.get(seed.slug)!;

      if (await this.packagePrices.exists({ package: id })) continue;

      const removable = [
        ...(seed.items ?? []),
        ...(seed.variantGroups ?? []).flatMap((g) => g.options.flatMap((o) => o.items)),
      ].filter((item) => item.removable);

      const draft = await this.pricing.createPackagePriceDraft(
        id,
        {
          mode: seed.price.mode,
          baseCents: seed.price.mode === 'pending' ? null : fromWholePesos(seed.price.basePesos!),
          variantPrices: (seed.price.variantDeltas ?? []).map((delta) => ({
            groupKey: delta.group,
            optionKey: delta.option,
            mode: delta.pesos === null ? 'pending' : 'fixed',
            deltaCents: delta.pesos === null ? null : fromWholePesos(delta.pesos),
          })),
          // Créditos de retiro: el brief no los define → pendientes (retirar envía a revisión).
          removalCredits: removable.map((item) => ({ component: componentId(item.component), mode: 'pending', creditCents: null })),
          rental: await this.rentalFor(id),
          notes: 'Precio base aprobado (REAPERSYS_CATALOGO_COTIZADOR.md).',
        },
        SEED_ACTOR,
      );
      await this.pricing.publishPackagePrice(draft._id, SEED_ACTOR);
      report.packagePrices += 1;
    }

    // Reglas de compatibilidad
    for (const rule of seedRules) {
      report.rules += await this.insertIfAbsent(
        this.rules,
        { key: rule.key },
        {
          key: rule.key,
          type: rule.type,
          subject: componentId(rule.subject),
          packageCategories: rule.packageCategories ?? [],
          targets: (rule.targets ?? []).map(componentId),
          action: rule.action,
          message: rule.message,
          active: true,
        },
      );
    }

    if (upgradeInfrastructure) report.infrastructureUpgrade = await this.upgradeInfrastructure(componentId);
    report.catalogSync = await this.syncCatalog(packageContent, componentId);

    // Promesa de una línea de cada paquete: solo donde no existe (lo editado en el panel se respeta).
    for (const [slug, tagline] of Object.entries(seedPackageTaglines)) {
      report.packageTaglines += (await this.packages.updateOne({ slug, tagline: missing }, { $set: { tagline } })).modifiedCount;
    }

    // Catálogo digital: solo se crea lo que falta; nada queda publicado (no tienen demo).
    for (const [index, occasion] of seedOccasions.entries()) {
      report.digitalOccasions += await this.insertIfAbsent(this.occasions, { slug: occasion.slug }, { ...occasion, sortOrder: (index + 1) * 10 });
    }
    for (const [index, template] of seedTemplates.entries()) {
      report.digitalTemplates += await this.insertIfAbsent(
        this.digitalTemplates,
        { slug: template.slug },
        { ...template, demoUrl: '', priceCents: null, status: 'draft', featured: false, sortOrder: (index + 1) * 10, preview: {} },
      );
    }
    for (const [index, design] of seedNfcDesigns.entries()) {
      report.nfcDesigns += await this.insertIfAbsent(this.nfcDesigns, { slug: design.slug }, { ...design, demoUrl: '', status: 'draft', sortOrder: (index + 1) * 10, preview: {} });
    }
    for (const tier of seedNfcPriceTiers) {
      report.nfcPriceTiers += await this.insertIfAbsent(this.nfcPriceTiers, { quantity: tier.quantity }, tier);
    }

    this.logger.log(`Seed completado: ${JSON.stringify(report)}`);
    return report;
  }

  /**
   * Actualización única (al crear el hosting anual), para bases ya pobladas:
   * - desactiva el hosting mensual y el dominio «según proveedor», que el dominio y hosting anuales reemplazan;
   * - agrega a la Web Corporativa sus botones de redes sociales incluidos.
   * Las cotizaciones emitidas conservan su snapshot.
   */
  private async upgradeInfrastructure(componentId: (slug: string) => Types.ObjectId): Promise<number> {
    let changes = (await this.components.updateMany({ slug: inValues(LEGACY_INFRASTRUCTURE_SLUGS), status: 'active' }, { $set: { status: 'inactive' } })).modifiedCount;
    for (const slug of CORPORATE_SOCIAL_ITEMS) {
      const component = componentId(slug);
      changes += (
        await this.packages.updateOne(
          { slug: 'web-corporativa', 'items.component': trusted({ $ne: component }) },
          { $push: { items: { component, quantity: 1, removable: false, essential: false } } },
        )
      ).modifiedCount;
    }
    changes += (await this.packages.updateOne({ slug: 'web-corporativa', features: trusted({ $ne: CORPORATE_SOCIAL_FEATURE }) }, { $push: { features: CORPORATE_SOCIAL_FEATURE } })).modifiedCount;
    return changes;
  }

  /**
   * Alinea una base ya poblada con el catálogo vigente. Solo toca lo que el panel no edita
   * (contenido de paquetes, etiquetas de componentes y reglas); nunca precios, renta ni cotizaciones.
   * Idempotente: una segunda ejecución no modifica nada.
   */
  private async syncCatalog(
    packageContent: (seed: SeedPackage) => object,
    componentId: (slug: string) => Types.ObjectId,
  ): Promise<number> {
    let changes = 0;
    // Se compara antes de escribir: con timestamps, todo updateOne cuenta como modificación.
    const sync = async <T>(model: Model<T>, filter: Record<string, unknown>, target: Record<string, unknown>, unset: string[] = []) => {
      const current = await model.findOne(filter, Object.fromEntries([...Object.keys(target), ...unset].map((k) => [k, 1]))).lean<Record<string, unknown>>();
      if (!current) return;
      const stale = Object.entries(target).some(([key, value]) => !sameValue(current[key], value)) || unset.some((key) => current[key] !== undefined);
      if (!stale) return;
      const update: UpdateQuery<T> = { $set: target, ...(unset.length > 0 ? { $unset: Object.fromEntries(unset.map((k) => [k, 1])) } : {}) } as UpdateQuery<T>;
      await model.updateOne(filter, update);
      changes += 1;
    };

    for (const seed of seedComponents) {
      const highlights = seed.highlights ?? [];
      if (seed.includedLabel) await sync(this.components, { slug: seed.slug }, { includedLabel: seed.includedLabel, highlights });
      else await sync(this.components, { slug: seed.slug }, { highlights }, ['includedLabel']);
    }
    for (const { slug, description } of OUTDATED_DESCRIPTIONS) {
      const current = seedComponents.find((c) => c.slug === slug)!.description;
      changes += (await this.components.updateOne({ slug, description }, { $set: { description: current } })).modifiedCount;
    }
    changes += (await this.components.updateMany({ slug: inValues(RETIRED_COMPONENT_SLUGS), status: 'active' }, { $set: { status: 'inactive' } })).modifiedCount;
    for (const seed of seedPackages) {
      await sync(this.packages, { slug: seed.slug }, packageContent(seed) as Record<string, unknown>);
    }
    for (const rule of seedRules) {
      await sync(this.rules, { key: rule.key }, { packageCategories: rule.packageCategories ?? [], targets: (rule.targets ?? []).map(componentId), message: rule.message });
    }
    return changes;
  }

  /** Elimina los paquetes retirados del catálogo y sus versiones de precio. */
  private async retirePackages(): Promise<number> {
    const retired = await this.packages.find({ slug: inValues(RETIRED_PACKAGE_SLUGS) }, { _id: 1 }).lean<{ _id: Types.ObjectId }[]>();
    if (retired.length === 0) return 0;
    const ids = retired.map((pkg) => pkg._id);
    await this.packagePrices.deleteMany({ package: inValues(ids) });
    const { deletedCount } = await this.packages.deleteMany({ _id: inValues(ids) });
    this.logger.log(`Paquetes retirados: ${deletedCount}`);
    return deletedCount;
  }

  /**
   * Mensualidad inicial = la de venta aprobada del paquete. Sin ella, la renta queda pendiente
   * («a cotizar»): no se calcula una mensualidad a partir del precio de compra.
   */
  private async rentalFor(packageId: Types.ObjectId) {
    const pkg = await this.packages.findById(packageId).lean<Package>();
    const sale = pkg?.rentalProfile?.enabled ? pkg.rentalProfile.saleMonthlyCents : null;
    if (sale != null) return { mode: 'fixed' as const, monthlyCents: sale, setupFeeCents: null };
    return { mode: 'pending' as const, monthlyCents: null, setupFeeCents: null };
  }

  /** Inserta solo si no existe. Devuelve 1 si insertó, 0 si ya existía. */
  private async insertIfAbsent<T>(model: Model<T>, filter: Record<string, unknown>, data: object): Promise<number> {
    const result = await model.updateOne(filter, { $setOnInsert: data }, { upsert: true, runValidators: true });
    return result.upsertedCount;
  }

  private async idsBySlug(model: Model<{ slug: string }> | Model<Category> | Model<Component> | Model<Package>) {
    const docs = await (model as Model<{ slug: string }>).find({}, { slug: 1 }).lean<{ _id: Types.ObjectId; slug: string }[]>();
    return new Map(docs.map((doc) => [doc.slug, doc._id]));
  }
}

/** Igualdad por valor (ObjectId como texto, sin depender del orden de las claves). */
function sameValue(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (value instanceof Types.ObjectId) return value.toString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, v]) => [k, normalize(v)]),
      );
    }
    return value;
  };
  return JSON.stringify(normalize(a ?? null)) === JSON.stringify(normalize(b ?? null));
}
