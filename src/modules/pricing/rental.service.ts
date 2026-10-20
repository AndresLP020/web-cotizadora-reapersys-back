import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { inValues } from '../../database/query-operators';
import { Component } from '../catalog/schemas/component.schema';
import { Package } from '../catalog/schemas/package.schema';
import { BusinessSettings } from '../settings/schemas/business-settings.schema';
import { PricingService } from './pricing.service';
import { combineRentals, type RentalSuggestion, suggestRental } from './rental-calculator';
import { OperatingCost } from './schemas/operating-cost.schema';

type Doc<T> = T & { _id: Types.ObjectId };

export const STORAGE_COST_KEY = 'storage-gb';
export const DOMAIN_COST_KEY = 'domain-com-mx';

export interface RentalSuggestionView extends RentalSuggestion {
  termMonths: number;
  financingBp: number;
  enabled: boolean;
}

/** Arma los datos de la calculadora de suscripción de un paquete a partir de la base. */
@Injectable()
export class RentalService {
  constructor(
    @InjectModel(Package.name) private readonly packages: Model<Package>,
    @InjectModel(Component.name) private readonly components: Model<Component>,
    @InjectModel(OperatingCost.name) private readonly costs: Model<OperatingCost>,
    @InjectModel(BusinessSettings.name) private readonly settings: Model<BusinessSettings>,
    private readonly pricing: PricingService,
  ) {}

  /**
   * @param baseCentsOverride precio base a usar en lugar del publicado (p. ej. el del seed al crearlo).
   */
  async suggestForPackage(packageId: Types.ObjectId, baseCentsOverride?: number | null): Promise<RentalSuggestionView> {
    const pkg = await this.packages.findById(packageId).lean<Doc<Package>>();
    if (!pkg) throw new NotFoundException('Paquete no encontrado.');
    const profile = pkg.rentalProfile;
    const settings = await this.settings.findOne({ key: 'default' }).lean<BusinessSettings>();
    const termMonths = settings?.rental?.minimumTermMonths ?? 12;
    const financingBp = settings?.rental?.financingBp ?? 0;

    if (profile?.recoverableMode === 'combo_parts') {
      return { ...(await this.suggestForCombo(pkg, baseCentsOverride)), termMonths, financingBp, enabled: profile.enabled };
    }

    const costs = new Map((await this.costs.find().lean<Doc<OperatingCost>[]>()).map((c) => [c.key, c]));
    const hosting = profile?.hostingCostKey ? costs.get(profile.hostingCostKey) : undefined;
    const storage = costs.get(STORAGE_COST_KEY);
    const domain = costs.get(DOMAIN_COST_KEY);

    let recoverableCents: number | null = null;
    if (profile?.recoverableMode === 'manual') {
      recoverableCents = profile.recoverableCents;
    } else if (baseCentsOverride !== undefined) {
      recoverableCents = baseCentsOverride;
    } else {
      const price = (await this.pricing.getPublishedPackagePrices([pkg._id])).get(pkg._id.toString());
      recoverableCents = price && price.mode !== 'pending' ? price.baseCents : null;
    }

    const serviceIds = profile?.services ?? [];
    const [serviceDocs, servicePrices] = await Promise.all([
      this.components.find({ _id: inValues(serviceIds) }).lean<Doc<Component>[]>(),
      this.pricing.getPublishedComponentPrices(serviceIds),
    ]);

    const suggestion = suggestRental({
      recoverableCents,
      termMonths,
      financingBp,
      hosting: hosting ? { name: hosting.name, monthlyCents: hosting.costCents, confirmed: hosting.confirmed } : null,
      storage: profile && profile.storageGb > 0 && storage ? { gb: profile.storageGb, perGbMonthCents: storage.costCents, confirmed: storage.confirmed } : null,
      domain: profile?.includesDomain && domain ? { yearCents: domain.costCents, confirmed: domain.confirmed } : null,
      services: serviceDocs.map((c) => {
        const price = servicePrices.get(c._id.toString());
        return { name: c.name, mode: price?.mode ?? 'pending', monthlyCents: price?.saleCents ?? null };
      }),
      monthlyRateBp: profile?.monthlyRateBp ?? 10_000,
    });
    // Un costo de hosting declarado pero no registrado deja la sugerencia pendiente (no se suma un cero).
    if (profile?.hostingCostKey && !hosting) {
      suggestion.missing.push(`Costo de operación «${profile.hostingCostKey}»`);
      suggestion.mode = 'pending';
      suggestion.rawMonthlyCents = null;
      suggestion.suggestedMonthlyCents = null;
    }
    return { ...suggestion, termMonths, financingBp, enabled: profile?.enabled ?? false };
  }

  /** Combo: mensualidades de sus paquetes con el mismo descuento que su precio de compra. */
  private async suggestForCombo(combo: Doc<Package>, baseCentsOverride?: number | null): Promise<RentalSuggestion> {
    const partIds = combo.includesPackages.map((i) => i.package);
    const [parts, prices] = await Promise.all([
      this.packages.find({ _id: inValues(partIds) }).lean<Doc<Package>[]>(),
      this.pricing.getPublishedPackagePrices([combo._id, ...partIds]),
    ]);
    const priceOf = (id: Types.ObjectId) => {
      const price = prices.get(id.toString());
      return price && price.mode !== 'pending' ? price.baseCents : null;
    };
    const suggestions = await Promise.all(parts.map(async (p) => ({ name: p.name, suggestion: await this.suggestForPackage(p._id) })));
    const partPrices = parts.map((p) => priceOf(p._id));
    return combineRentals(suggestions, {
      comboCents: baseCentsOverride !== undefined ? baseCentsOverride : priceOf(combo._id),
      partsCents: partPrices.some((c) => c === null) || parts.length === 0 ? null : partPrices.reduce<number>((a, b) => a + b!, 0),
    });
  }
}
