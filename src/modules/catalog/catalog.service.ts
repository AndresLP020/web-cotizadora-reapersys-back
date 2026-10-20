import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { inValues } from '../../database/query-operators';
import { PricingService } from '../pricing/pricing.service';
import type { PackageCategory } from './catalog.constants';
import {
  toPublicCategory,
  toPublicComponent,
  toPublicIndustry,
  toPublicPackage,
  toPublicPackageDetail,
} from './public/public-catalog.mapper';
import type {
  ListResponse,
  PublicCategory,
  PublicComponent,
  PublicIndustry,
  PublicPackage,
  PublicPackageDetail,
} from './public/public-catalog.types';
import { Category } from './schemas/category.schema';
import { CompatibilityRule } from './schemas/compatibility-rule.schema';
import { Component } from './schemas/component.schema';
import { Industry } from './schemas/industry.schema';
import { Package } from './schemas/package.schema';

type Doc<T> = T & { _id: Types.ObjectId };

@Injectable()
export class CatalogService {
  constructor(
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(Industry.name) private readonly industries: Model<Industry>,
    @InjectModel(Component.name) private readonly components: Model<Component>,
    @InjectModel(Package.name) private readonly packages: Model<Package>,
    @InjectModel(CompatibilityRule.name) private readonly rules: Model<CompatibilityRule>,
    private readonly pricing: PricingService,
  ) {}

  async listPublicPackages(filter: { category?: PackageCategory; featured?: boolean }): Promise<ListResponse<PublicPackage>> {
    const query: Record<string, unknown> = { status: 'active' };
    if (filter.category) query.category = filter.category;
    if (filter.featured) query.featured = true;

    const packages = await this.packages.find(query).sort({ sortOrder: 1, name: 1 }).lean<Doc<Package>[]>();
    const [prices, packagesById] = await Promise.all([
      this.pricing.getPublishedPackagePrices(packages.map((p) => p._id)),
      this.loadIncludedPackages(packages),
    ]);

    return {
      items: packages.map((pkg) => toPublicPackage(pkg, { price: prices.get(pkg._id.toString()), packagesById })),
    };
  }

  async getPublicPackage(slug: string): Promise<PublicPackageDetail> {
    const pkg = await this.packages.findOne({ slug, status: 'active' }).lean<Doc<Package>>();
    if (!pkg) throw new NotFoundException('Paquete no encontrado.');

    const componentIds = [
      ...pkg.items.map((item) => item.component),
      ...pkg.variantGroups.flatMap((group) => group.options.flatMap((option) => option.items.map((item) => item.component))),
      ...(pkg.rentalProfile?.services ?? []),
      ...(pkg.rentalProfile?.coveredComponents ?? []),
    ];
    const [prices, packagesById, components, recommendedRecurring, addOns] = await Promise.all([
      this.pricing.getPublishedPackagePrices([pkg._id]),
      this.loadIncludedPackages([pkg]),
      this.components.find({ _id: inValues(componentIds) }).lean<Doc<Component>[]>(),
      this.loadPublicComponents({ _id: inValues(pkg.recommendedRecurring), status: 'active' }),
      this.loadAddOns(pkg.addOns ?? []),
    ]);

    return toPublicPackageDetail(pkg, {
      price: prices.get(pkg._id.toString()),
      packagesById,
      componentsById: new Map(components.map((c) => [c._id.toString(), c])),
      recommendedRecurring,
      addOns,
    });
  }

  /** Complementos del paquete con los módulos que requieren (reglas requires_component activas). */
  private async loadAddOns(ids: Types.ObjectId[]): Promise<PublicComponent[]> {
    if (ids.length === 0) return [];
    const [addOns, rules] = await Promise.all([
      this.loadPublicComponents({ _id: inValues(ids), status: 'active', publicVisible: true }),
      this.rules.find({ subject: inValues(ids), type: 'requires_component', active: true }).lean<Doc<CompatibilityRule>[]>(),
    ]);
    const targets = await this.components
      .find({ _id: inValues([...new Set(rules.flatMap((r) => r.targets.map(String)))]) }, { slug: 1, name: 1 })
      .lean<Doc<Pick<Component, 'slug' | 'name'>>[]>();
    const targetsById = new Map(targets.map((t) => [t._id.toString(), t]));
    const slugById = new Map(
      (await this.components.find({ _id: inValues(ids) }, { slug: 1 }).lean<Doc<Pick<Component, 'slug'>>[]>()).map((c) => [c._id.toString(), c.slug]),
    );
    const requiresBySlug = new Map<string, { slug: string; name: string; message: string }[]>();
    for (const rule of rules) {
      const slug = slugById.get(rule.subject.toString());
      if (!slug) continue;
      const list = requiresBySlug.get(slug) ?? [];
      for (const id of rule.targets) {
        const target = targetsById.get(id.toString());
        if (target) list.push({ slug: target.slug, name: target.name, message: rule.message });
      }
      requiresBySlug.set(slug, list);
    }
    // Mismo orden que el paquete define.
    const order = new Map(ids.map((id, index) => [slugById.get(id.toString()), index]));
    return addOns
      .map((addOn) => (requiresBySlug.has(addOn.slug) ? { ...addOn, requires: requiresBySlug.get(addOn.slug) } : addOn))
      .sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
  }

  async listPublicComponents(filter: { category?: string }): Promise<ListResponse<PublicComponent>> {
    const query: Record<string, unknown> = { status: 'active', publicVisible: true };
    if (filter.category) {
      const category = await this.categories.findOne({ slug: filter.category, active: true }).select({ _id: 1 }).lean();
      if (!category) return { items: [] };
      query.category = category._id;
    }
    return { items: await this.loadPublicComponents(query) };
  }

  async listCategories(): Promise<ListResponse<PublicCategory>> {
    const categories = await this.categories.find({ active: true }).sort({ sortOrder: 1 }).lean<Category[]>();
    return { items: categories.map(toPublicCategory) };
  }

  async listIndustries(): Promise<ListResponse<PublicIndustry>> {
    const industries = await this.industries.find({ active: true }).sort({ sortOrder: 1 }).lean<Industry[]>();
    return { items: industries.map(toPublicIndustry) };
  }

  private async loadPublicComponents(query: Record<string, unknown>): Promise<PublicComponent[]> {
    const components = await this.components.find(query).sort({ sortOrder: 1, name: 1 }).lean<Doc<Component>[]>();
    const [prices, categories] = await Promise.all([
      this.pricing.getPublishedComponentPrices(components.map((c) => c._id)),
      this.categories.find({ _id: inValues([...new Set(components.map((c) => c.category))]) }).lean<Doc<Category>[]>(),
    ]);
    const categoriesById = new Map(categories.map((c) => [c._id.toString(), c]));

    return components.flatMap((component) => {
      const category = categoriesById.get(component.category.toString());
      if (!category) return [];
      return [toPublicComponent(component, category, prices.get(component._id.toString()))];
    });
  }

  private async loadIncludedPackages(packages: Doc<Package>[]): Promise<Map<string, Doc<Package>>> {
    const ids = packages.flatMap((pkg) => pkg.includesPackages.map((included) => included.package));
    if (ids.length === 0) return new Map();
    const included = await this.packages.find({ _id: inValues(ids) }).lean<Doc<Package>[]>();
    return new Map(included.map((pkg) => [pkg._id.toString(), pkg]));
  }
}
