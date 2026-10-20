import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { containsText, inValues } from '../../database/query-operators';
import type { AuthenticatedUser } from '../../security/auth.types';
import { actorOf } from '../../security/auth.types';
import { hasPermission } from '../../security/roles';
import { AuditService } from '../audit/audit.service';
import type { LifecycleStatus, PriceMode } from '../catalog/catalog.constants';
import { Category } from '../catalog/schemas/category.schema';
import { Component } from '../catalog/schemas/component.schema';
import { Package } from '../catalog/schemas/package.schema';
import { priceMetrics } from '../pricing/price-metrics';
import { PricingService } from '../pricing/pricing.service';
import { ComponentPrice } from '../pricing/schemas/component-price.schema';
import { RentalService } from '../pricing/rental.service';
import { OperatingCost } from '../pricing/schemas/operating-cost.schema';
import { PackagePrice } from '../pricing/schemas/package-price.schema';

type Doc<T> = T & { _id: Types.ObjectId };

export interface ComponentPriceInputDto {
  mode: PriceMode;
  saleCents: number | null;
  costCents?: number | null;
  notes?: string;
}

export interface PackagePriceInputDto {
  mode: PriceMode;
  baseCents: number | null;
  variantPrices: { groupKey: string; optionKey: string; mode: 'fixed' | 'pending'; deltaCents: number | null }[];
  removalCredits: { componentId: string; mode: 'fixed' | 'pending'; creditCents: number | null }[];
  /** Si se omite, se conserva la mensualidad de la versión publicada. */
  rental?: { mode: PriceMode; monthlyCents: number | null; setupFeeCents: number | null };
  notes?: string;
}

export interface RentalProfilePatch {
  enabled?: boolean;
  hostingCostKey?: string | null;
  storageGb?: number;
  includesDomain?: boolean;
  recoverableMode?: 'package_price' | 'manual' | 'combo_parts';
  recoverableCents?: number | null;
  hardwareUpfront?: boolean;
}

export interface OperatingCostPatch {
  name?: string;
  costCents?: number;
  sourceNote?: string;
  sourceUrl?: string;
  confirmed?: boolean;
}

/**
 * Catálogo y precios para el panel. Los costos, recargos y márgenes solo se incluyen
 * si el rol tiene el permiso `costs:read`.
 */
@Injectable()
export class CatalogAdminService {
  constructor(
    @InjectModel(Component.name) private readonly components: Model<Component>,
    @InjectModel(Package.name) private readonly packages: Model<Package>,
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(ComponentPrice.name) private readonly componentPrices: Model<ComponentPrice>,
    @InjectModel(PackagePrice.name) private readonly packagePrices: Model<PackagePrice>,
    @InjectModel(OperatingCost.name) private readonly operatingCosts: Model<OperatingCost>,
    private readonly pricing: PricingService,
    private readonly rental: RentalService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ componentes

  async listComponents(user: AuthenticatedUser, filter: { q?: string; category?: string; pricing?: string }) {
    const query: Record<string, unknown> = {};
    if (filter.q) query.$or = [{ name: containsText(filter.q) }, { sku: containsText(filter.q) }, { slug: containsText(filter.q) }];
    if (filter.pricing === 'pending' || filter.pricing === 'priced') query.pricingStatus = filter.pricing === 'pending' ? 'pending_pricing' : 'priced';
    if (filter.category) {
      const category = await this.categories.findOne({ slug: filter.category }).lean<Doc<Category>>();
      if (!category) return { items: [] };
      query.category = category._id;
    }

    const components = await this.components.find(query).sort({ sortOrder: 1 }).lean<Doc<Component>[]>();
    const ids = components.map((c) => c._id);
    const [published, drafts, categories] = await Promise.all([
      this.pricing.getPublishedComponentPrices(ids),
      this.componentPrices.find({ component: inValues(ids), status: 'draft' }).select({ component: 1 }).lean<{ component: Types.ObjectId }[]>(),
      this.categories.find().lean<Doc<Category>[]>(),
    ]);
    const draftSet = new Set(drafts.map((d) => d.component.toString()));
    const categoryById = new Map(categories.map((c) => [c._id.toString(), c]));
    const showCosts = hasPermission(user.role, 'costs:read');

    return {
      items: components.map((c) => {
        const price = published.get(c._id.toString());
        return {
          id: c._id.toString(),
          sku: c.sku,
          slug: c.slug,
          name: c.name,
          description: c.description,
          category: { slug: categoryById.get(c.category.toString())?.slug, name: categoryById.get(c.category.toString())?.name },
          kind: c.kind,
          billing: c.billing,
          unit: c.unit,
          status: c.status,
          pricingStatus: c.pricingStatus,
          publicVisible: c.publicVisible,
          requiresEvaluation: c.requiresEvaluation,
          hasDraft: draftSet.has(c._id.toString()),
          price: price ? this.priceView(price, showCosts) : null,
        };
      }),
    };
  }

  async componentPriceHistory(user: AuthenticatedUser, id: string) {
    const component = await this.findComponent(id);
    const history = await this.pricing.listComponentPriceHistory(component._id);
    const showCosts = hasPermission(user.role, 'costs:read');
    return { component: { id: component._id.toString(), name: component.name, sku: component.sku }, items: history.map((p) => this.priceView(p, showCosts)) };
  }

  async createComponentDraft(user: AuthenticatedUser, id: string, input: ComponentPriceInputDto) {
    const component = await this.findComponent(id);
    // Sin permiso de costos, el costo vigente se conserva (no se borra por omisión).
    let costCents = input.costCents ?? null;
    if (!hasPermission(user.role, 'costs:read')) {
      const current = (await this.pricing.getPublishedComponentPrices([component._id])).get(component._id.toString());
      costCents = current?.costCents ?? null;
    }
    const saleCents = input.mode === 'pending' ? null : input.saleCents;
    if (input.mode !== 'pending' && saleCents === null) throw new BadRequestException('Indica el precio de venta.');
    const draft = await this.pricing.createComponentPriceDraft(component._id, { mode: input.mode, saleCents, costCents, notes: input.notes }, actorOf(user));
    return this.priceView(draft, hasPermission(user.role, 'costs:read'));
  }

  async publishComponentPrice(user: AuthenticatedUser, priceId: string) {
    const price = await this.pricing.publishComponentPrice(new Types.ObjectId(priceId), actorOf(user));
    return this.priceView(price, hasPermission(user.role, 'costs:read'));
  }

  async restoreComponentPrice(user: AuthenticatedUser, priceId: string) {
    const price = await this.pricing.restoreComponentPrice(new Types.ObjectId(priceId), actorOf(user));
    return this.priceView(price, hasPermission(user.role, 'costs:read'));
  }

  async discardComponentDraft(user: AuthenticatedUser, priceId: string) {
    const draft = await this.componentPrices.findById(priceId).lean<Doc<ComponentPrice>>();
    if (!draft) throw new NotFoundException('Versión de precio no encontrada.');
    if (draft.status !== 'draft') throw new ConflictException('Solo se pueden descartar borradores.');
    await this.componentPrices.deleteOne({ _id: draft._id, status: 'draft' });
    await this.audit.record({ action: 'component_price.draft_discarded', entityType: 'component', entityId: draft.component, actor: actorOf(user), before: { version: draft.version } });
  }

  async updateComponent(user: AuthenticatedUser, id: string, patch: { status?: LifecycleStatus; publicVisible?: boolean; requiresEvaluation?: boolean; description?: string }) {
    const component = await this.findComponent(id);
    const keys = ['status', 'publicVisible', 'requiresEvaluation', 'description'] as const;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of keys) {
      if (patch[key] === undefined || patch[key] === component[key]) continue;
      before[key] = component[key];
      after[key] = patch[key];
    }
    if (Object.keys(after).length === 0) return { updated: false };
    await this.components.updateOne({ _id: component._id }, { $set: after });
    await this.audit.record({ action: 'component.updated', entityType: 'component', entityId: component._id, actor: actorOf(user), before, after });
    return { updated: true };
  }

  // ------------------------------------------------------------------ paquetes

  async listPackages() {
    const packages = await this.packages.find().sort({ sortOrder: 1 }).lean<Doc<Package>[]>();
    const ids = packages.map((p) => p._id);
    const [published, drafts] = await Promise.all([
      this.pricing.getPublishedPackagePrices(ids),
      this.packagePrices.find({ package: inValues(ids), status: 'draft' }).select({ package: 1 }).lean<{ package: Types.ObjectId }[]>(),
    ]);
    const draftSet = new Set(drafts.map((d) => d.package.toString()));
    return {
      items: packages.map((p) => {
        const price = published.get(p._id.toString());
        return {
          id: p._id.toString(),
          slug: p.slug,
          name: p.name,
          category: p.category,
          status: p.status,
          featured: p.featured,
          hasDraft: draftSet.has(p._id.toString()),
          pendingVariants: price?.variantPrices.filter((v) => v.mode === 'pending').length ?? 0,
          pendingCredits: price?.removalCredits.filter((c) => c.mode === 'pending').length ?? 0,
          price: price ? { id: price._id.toString(), version: price.version, mode: price.mode, baseCents: price.baseCents } : null,
          rentalEnabled: p.rentalProfile?.enabled ?? false,
          rental: price?.rental ? { mode: price.rental.mode, monthlyCents: price.rental.monthlyCents } : null,
        };
      }),
    };
  }

  /** Estructura del paquete (variantes y componentes retirables) más su historial de precios. */
  async packageDetail(user: AuthenticatedUser, id: string) {
    const pkg = await this.findPackage(id);
    const profile = pkg.rentalProfile;
    const itemIds = [
      ...[...pkg.items, ...pkg.variantGroups.flatMap((g) => g.options.flatMap((o) => o.items))].map((i) => i.component),
      ...(profile?.services ?? []),
      ...(profile?.coveredComponents ?? []),
    ];
    // La mensualidad sugerida revela costos de operación: solo con permiso de costos.
    const showCosts = hasPermission(user.role, 'costs:read');
    const [components, history, suggestion] = await Promise.all([
      this.components.find({ _id: inValues(itemIds) }).select({ name: 1, slug: 1 }).lean<Doc<Component>[]>(),
      this.pricing.listPackagePriceHistory(pkg._id),
      showCosts && profile?.enabled ? this.rental.suggestForPackage(pkg._id) : Promise.resolve(null),
    ]);
    const nameOf = new Map(components.map((c) => [c._id.toString(), c.name]));
    const removable = [...pkg.items, ...pkg.variantGroups.flatMap((g) => g.options.flatMap((o) => o.items))]
      .filter((i) => i.removable)
      .map((i) => ({ componentId: i.component.toString(), name: nameOf.get(i.component.toString()) ?? '—', essential: i.essential }));

    return {
      id: pkg._id.toString(),
      slug: pkg.slug,
      name: pkg.name,
      category: pkg.category,
      status: pkg.status,
      featured: pkg.featured,
      comboPolicy: pkg.comboPolicy ?? null,
      variantGroups: pkg.variantGroups.map((g) => ({
        key: g.key,
        name: g.name,
        defaultOption: g.defaultOption,
        options: g.options.map((o) => ({ key: o.key, name: o.name })),
      })),
      removableItems: uniqueBy(removable, (r) => r.componentId),
      rentalProfile: {
        enabled: profile?.enabled ?? false,
        hostingCostKey: profile?.hostingCostKey ?? null,
        storageGb: profile?.storageGb ?? 0,
        includesDomain: profile?.includesDomain ?? false,
        recoverableMode: profile?.recoverableMode ?? 'package_price',
        recoverableCents: profile?.recoverableCents ?? null,
        hardwareUpfront: profile?.hardwareUpfront ?? false,
        services: (profile?.services ?? []).map((c) => nameOf.get(c.toString()) ?? '—'),
        coveredComponents: (profile?.coveredComponents ?? []).map((c) => nameOf.get(c.toString()) ?? '—'),
      },
      rentalSuggestion: suggestion,
      history: history.map((p) => ({
        id: p._id.toString(),
        version: p.version,
        status: p.status,
        mode: p.mode,
        baseCents: p.baseCents,
        variantPrices: p.variantPrices.map((v) => ({ groupKey: v.groupKey, optionKey: v.optionKey, mode: v.mode, deltaCents: v.deltaCents })),
        removalCredits: p.removalCredits.map((c) => ({ componentId: c.component.toString(), mode: c.mode, creditCents: c.creditCents })),
        rental: p.rental ? { mode: p.rental.mode, monthlyCents: p.rental.monthlyCents, setupFeeCents: p.rental.setupFeeCents } : null,
        notes: p.notes,
        createdBy: p.createdBy,
        publishedBy: p.publishedBy,
        publishedAt: p.publishedAt,
        restoredFromVersion: p.restoredFromVersion,
        createdAt: (p as unknown as { createdAt: Date }).createdAt,
      })),
    };
  }

  async createPackageDraft(user: AuthenticatedUser, id: string, input: PackagePriceInputDto) {
    const pkg = await this.findPackage(id);
    const baseCents = input.mode === 'pending' ? null : input.baseCents;
    if (input.mode !== 'pending' && baseCents === null) throw new BadRequestException('Indica el precio base del paquete.');

    // Solo se aceptan variantes no predeterminadas y componentes realmente retirables de este paquete.
    const validVariants = new Set(pkg.variantGroups.flatMap((g) => g.options.filter((o) => o.key !== g.defaultOption).map((o) => `${g.key}/${o.key}`)));
    for (const v of input.variantPrices) {
      if (!validVariants.has(`${v.groupKey}/${v.optionKey}`)) throw new BadRequestException(`Variante inválida: ${v.groupKey}/${v.optionKey}.`);
      if ((v.mode === 'pending') !== (v.deltaCents === null)) throw new BadRequestException('La diferencia de una variante solo puede omitirse si queda pendiente.');
    }
    const removable = new Set(
      [...pkg.items, ...pkg.variantGroups.flatMap((g) => g.options.flatMap((o) => o.items))].filter((i) => i.removable).map((i) => i.component.toString()),
    );
    for (const c of input.removalCredits) {
      if (!removable.has(c.componentId)) throw new BadRequestException('Crédito de retiro para un componente no retirable.');
      if ((c.mode === 'pending') !== (c.creditCents === null)) throw new BadRequestException('El crédito solo puede omitirse si queda pendiente.');
    }
    assertUnique(input.variantPrices.map((v) => `${v.groupKey}/${v.optionKey}`), 'variante');
    assertUnique(input.removalCredits.map((c) => c.componentId), 'crédito de retiro');

    let rental = input.rental;
    if (rental) {
      if ((rental.mode === 'pending') !== (rental.monthlyCents === null)) throw new BadRequestException('La mensualidad solo puede omitirse si queda pendiente.');
    } else {
      const current = (await this.pricing.getPublishedPackagePrices([pkg._id])).get(pkg._id.toString());
      rental = current?.rental;
    }

    const draft = await this.pricing.createPackagePriceDraft(
      pkg._id,
      {
        mode: input.mode,
        baseCents,
        variantPrices: input.variantPrices,
        removalCredits: input.removalCredits.map((c) => ({ component: new Types.ObjectId(c.componentId), mode: c.mode, creditCents: c.creditCents })),
        rental: rental ? { mode: rental.mode, monthlyCents: rental.monthlyCents, setupFeeCents: rental.setupFeeCents } : undefined,
        notes: input.notes,
      },
      actorOf(user),
    );
    return { id: draft._id.toString(), version: draft.version, status: draft.status };
  }

  async publishPackagePrice(user: AuthenticatedUser, priceId: string) {
    const price = await this.pricing.publishPackagePrice(new Types.ObjectId(priceId), actorOf(user));
    return { id: price._id.toString(), version: price.version, status: price.status };
  }

  async restorePackagePrice(user: AuthenticatedUser, priceId: string) {
    const price = await this.pricing.restorePackagePrice(new Types.ObjectId(priceId), actorOf(user));
    return { id: price._id.toString(), version: price.version, status: price.status };
  }

  async discardPackageDraft(user: AuthenticatedUser, priceId: string) {
    const draft = await this.packagePrices.findById(priceId).lean<Doc<PackagePrice>>();
    if (!draft) throw new NotFoundException('Versión de precio no encontrada.');
    if (draft.status !== 'draft') throw new ConflictException('Solo se pueden descartar borradores.');
    await this.packagePrices.deleteOne({ _id: draft._id, status: 'draft' });
    await this.audit.record({ action: 'package_price.draft_discarded', entityType: 'package', entityId: draft.package, actor: actorOf(user), before: { version: draft.version } });
  }

  async updatePackage(user: AuthenticatedUser, id: string, patch: { status?: LifecycleStatus; featured?: boolean; rentalProfile?: RentalProfilePatch }) {
    const pkg = await this.findPackage(id);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['status', 'featured'] as const) {
      if (patch[key] === undefined || patch[key] === pkg[key]) continue;
      before[key] = pkg[key];
      after[key] = patch[key];
    }
    if (patch.rentalProfile) {
      const r = patch.rentalProfile;
      if (r.hostingCostKey && !(await this.operatingCosts.exists({ key: r.hostingCostKey }))) throw new BadRequestException('El costo de hosting indicado no existe.');
      const current: Partial<Package['rentalProfile']> = pkg.rentalProfile ?? {};
      const mode = r.recoverableMode ?? current.recoverableMode ?? 'package_price';
      const cents = r.recoverableCents !== undefined ? r.recoverableCents : (current.recoverableCents ?? null);
      if (mode === 'manual' && cents === null) throw new BadRequestException('Indica el valor a recuperar o usa el precio del paquete.');
      for (const key of ['enabled', 'hostingCostKey', 'storageGb', 'includesDomain', 'recoverableMode', 'recoverableCents', 'hardwareUpfront'] as const) {
        if (r[key] === undefined || r[key] === current[key]) continue;
        before[`rentalProfile.${key}`] = current[key] ?? null;
        after[`rentalProfile.${key}`] = r[key];
      }
    }
    if (Object.keys(after).length === 0) return { updated: false };
    await this.packages.updateOne({ _id: pkg._id }, { $set: after });
    await this.audit.record({ action: 'package.updated', entityType: 'package', entityId: pkg._id, actor: actorOf(user), before, after });
    return { updated: true };
  }

  // ------------------------------------------------------------------ costos de operación

  async listOperatingCosts() {
    const costs = await this.operatingCosts.find().sort({ sortOrder: 1, key: 1 }).lean<Doc<OperatingCost>[]>();
    return { items: costs.map(operatingCostView) };
  }

  async updateOperatingCost(user: AuthenticatedUser, id: string, patch: OperatingCostPatch) {
    const cost = await this.operatingCosts.findById(id).lean<Doc<OperatingCost>>();
    if (!cost) throw new NotFoundException('Costo de operación no encontrado.');
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['name', 'costCents', 'sourceNote', 'sourceUrl', 'confirmed'] as const) {
      if (patch[key] === undefined || patch[key] === cost[key]) continue;
      before[key] = cost[key] ?? null;
      after[key] = patch[key];
    }
    if (Object.keys(after).length === 0) return operatingCostView(cost);
    const updated = await this.operatingCosts
      .findOneAndUpdate({ _id: cost._id }, { $set: after }, { returnDocument: 'after', runValidators: true })
      .lean<Doc<OperatingCost>>();
    await this.audit.record({ action: 'operating_cost.updated', entityType: 'operating_cost', entityId: cost._id, actor: actorOf(user), before, after });
    return operatingCostView(updated!);
  }

  // ------------------------------------------------------------------ utilidades

  private priceView(price: Doc<ComponentPrice> | (ComponentPrice & { _id: Types.ObjectId }), showCosts: boolean) {
    const base = {
      id: price._id.toString(),
      version: price.version,
      status: price.status,
      mode: price.mode,
      saleCents: price.saleCents,
      notes: price.notes,
      createdBy: price.createdBy,
      publishedBy: price.publishedBy,
      publishedAt: price.publishedAt,
      restoredFromVersion: price.restoredFromVersion,
      createdAt: (price as unknown as { createdAt?: Date }).createdAt,
    };
    if (!showCosts) return base;
    return { ...base, costCents: price.costCents, ...priceMetrics(price.saleCents, price.costCents) };
  }

  private async findComponent(id: string) {
    const component = await this.components.findById(id).lean<Doc<Component>>();
    if (!component) throw new NotFoundException('Componente no encontrado.');
    return component;
  }

  private async findPackage(id: string) {
    const pkg = await this.packages.findById(id).lean<Doc<Package>>();
    if (!pkg) throw new NotFoundException('Paquete no encontrado.');
    return pkg;
  }
}

function operatingCostView(c: Doc<OperatingCost>) {
  return {
    id: c._id.toString(),
    key: c.key,
    name: c.name,
    unit: c.unit,
    costCents: c.costCents,
    sourceNote: c.sourceNote ?? '',
    sourceUrl: c.sourceUrl ?? '',
    confirmed: c.confirmed,
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(key(item)) ? false : (seen.add(key(item)), true)));
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new BadRequestException(`Hay un ${label} repetido.`);
}
