import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';
import { DatabaseService } from '../../database/database.service';
import { inValues } from '../../database/query-operators';
import { type Actor, AuditService } from '../audit/audit.service';
import type { PriceMode } from '../catalog/catalog.constants';
import { Component } from '../catalog/schemas/component.schema';
import { Package } from '../catalog/schemas/package.schema';
import { ComponentPrice } from './schemas/component-price.schema';
import { PackagePrice, type RemovalCredit, type VariantPrice } from './schemas/package-price.schema';

export interface ComponentPriceInput {
  mode: PriceMode;
  saleCents: number | null;
  costCents?: number | null;
  notes?: string;
}

export interface PackagePriceInput {
  mode: PriceMode;
  baseCents: number | null;
  variantPrices?: VariantPrice[];
  removalCredits?: RemovalCredit[];
  /** Suscripción mensual; si se omite queda pendiente. */
  rental?: { mode: PriceMode; monthlyCents: number | null; setupFeeCents: number | null };
  notes?: string;
}

type WithId<T> = T & { _id: Types.ObjectId };

/**
 * Precios versionados. Reglas:
 * - Una versión publicada nunca se modifica: se crea un borrador y se publica.
 * - Publicar reemplaza a la versión vigente dentro de una TRANSACCIÓN y queda auditado.
 * - Restaurar una versión anterior crea una versión nueva (no reactiva la antigua).
 * - Las cotizaciones guardan snapshots; publicar precios no las altera.
 */
@Injectable()
export class PricingService {
  constructor(
    @InjectModel(ComponentPrice.name) private readonly componentPrices: Model<ComponentPrice>,
    @InjectModel(PackagePrice.name) private readonly packagePrices: Model<PackagePrice>,
    @InjectModel(Component.name) private readonly components: Model<Component>,
    @InjectModel(Package.name) private readonly packages: Model<Package>,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- lecturas

  async getPublishedComponentPrices(componentIds: Types.ObjectId[]): Promise<Map<string, WithId<ComponentPrice>>> {
    const prices = await this.componentPrices
      .find({ component: inValues(componentIds), status: 'published' })
      .lean<WithId<ComponentPrice>[]>();
    return new Map(prices.map((price) => [price.component.toString(), price]));
  }

  async getPublishedPackagePrices(packageIds: Types.ObjectId[]): Promise<Map<string, WithId<PackagePrice>>> {
    const prices = await this.packagePrices
      .find({ package: inValues(packageIds), status: 'published' })
      .lean<WithId<PackagePrice>[]>();
    return new Map(prices.map((price) => [price.package.toString(), price]));
  }

  listComponentPriceHistory(componentId: Types.ObjectId) {
    return this.componentPrices.find({ component: componentId }).sort({ version: -1 }).lean<WithId<ComponentPrice>[]>();
  }

  listPackagePriceHistory(packageId: Types.ObjectId) {
    return this.packagePrices.find({ package: packageId }).sort({ version: -1 }).lean<WithId<PackagePrice>[]>();
  }

  // ---------------------------------------------------------------- componentes

  async createComponentPriceDraft(
    componentId: Types.ObjectId,
    input: ComponentPriceInput,
    actor: Actor,
    options: { restoredFromVersion?: number; session?: ClientSession | null } = {},
  ): Promise<WithId<ComponentPrice>> {
    const exists = await this.components.exists({ _id: componentId }).session(options.session ?? null);
    if (!exists) throw new NotFoundException('Componente no encontrado.');

    const last = await this.componentPrices
      .findOne({ component: componentId })
      .sort({ version: -1 })
      .select({ version: 1 })
      .session(options.session ?? null)
      .lean<{ version: number }>();

    const [draft] = await this.componentPrices.create(
      [
        {
          component: componentId,
          version: (last?.version ?? 0) + 1,
          status: 'draft',
          mode: input.mode,
          saleCents: input.saleCents,
          costCents: input.costCents ?? null,
          notes: input.notes,
          restoredFromVersion: options.restoredFromVersion,
          createdBy: actor.label,
        },
      ],
      { session: options.session ?? undefined },
    );
    return draft!.toObject();
  }

  async publishComponentPrice(priceId: Types.ObjectId, actor: Actor): Promise<WithId<ComponentPrice>> {
    return this.database.withTransaction((session) => this.publishComponentPriceInSession(priceId, actor, session, 'published'), {
      requireTransaction: true,
    });
  }

  async restoreComponentPrice(versionId: Types.ObjectId, actor: Actor): Promise<WithId<ComponentPrice>> {
    return this.database.withTransaction(
      async (session) => {
        const source = await this.componentPrices.findById(versionId).session(session).lean<WithId<ComponentPrice>>();
        if (!source) throw new NotFoundException('Versión de precio no encontrada.');
        if (source.status === 'published') throw new ConflictException('Esa versión ya es la vigente.');
        const draft = await this.createComponentPriceDraft(
          source.component,
          { mode: source.mode, saleCents: source.saleCents, costCents: source.costCents, notes: source.notes },
          actor,
          { restoredFromVersion: source.version, session },
        );
        return this.publishComponentPriceInSession(draft._id, actor, session, 'restored');
      },
      { requireTransaction: true },
    );
  }

  private async publishComponentPriceInSession(
    priceId: Types.ObjectId,
    actor: Actor,
    session: ClientSession | null,
    auditVerb: 'published' | 'restored',
  ): Promise<WithId<ComponentPrice>> {
    const draft = await this.componentPrices.findById(priceId).session(session);
    if (!draft) throw new NotFoundException('Versión de precio no encontrada.');
    if (draft.status !== 'draft') throw new ConflictException('Solo se pueden publicar borradores.');

    const previous = await this.componentPrices
      .findOneAndUpdate(
        { component: draft.component, status: 'published' },
        { $set: { status: 'superseded', supersededAt: new Date() } },
        { session, returnDocument: 'before' },
      )
      .lean<WithId<ComponentPrice>>();

    draft.status = 'published';
    draft.publishedAt = new Date();
    draft.publishedBy = actor.label;
    await draft.save({ session });

    await this.components.updateOne(
      { _id: draft.component },
      { $set: { pricingStatus: draft.mode === 'pending' ? 'pending_pricing' : 'priced' } },
      { session: session ?? undefined },
    );

    await this.audit.record(
      {
        action: `component_price.${auditVerb}`,
        entityType: 'component',
        entityId: draft.component,
        actor,
        before: previous ? summarizeComponentPrice(previous) : null,
        after: summarizeComponentPrice(draft.toObject()),
      },
      session,
    );
    return draft.toObject();
  }

  // ---------------------------------------------------------------- paquetes

  async createPackagePriceDraft(
    packageId: Types.ObjectId,
    input: PackagePriceInput,
    actor: Actor,
    options: { restoredFromVersion?: number; session?: ClientSession | null } = {},
  ): Promise<WithId<PackagePrice>> {
    const exists = await this.packages.exists({ _id: packageId }).session(options.session ?? null);
    if (!exists) throw new NotFoundException('Paquete no encontrado.');

    const last = await this.packagePrices
      .findOne({ package: packageId })
      .sort({ version: -1 })
      .select({ version: 1 })
      .session(options.session ?? null)
      .lean<{ version: number }>();

    const [draft] = await this.packagePrices.create(
      [
        {
          package: packageId,
          version: (last?.version ?? 0) + 1,
          status: 'draft',
          mode: input.mode,
          baseCents: input.baseCents,
          variantPrices: input.variantPrices ?? [],
          removalCredits: input.removalCredits ?? [],
          rental: input.rental ?? { mode: 'pending', monthlyCents: null, setupFeeCents: null },
          notes: input.notes,
          restoredFromVersion: options.restoredFromVersion,
          createdBy: actor.label,
        },
      ],
      { session: options.session ?? undefined },
    );
    return draft!.toObject();
  }

  async publishPackagePrice(priceId: Types.ObjectId, actor: Actor): Promise<WithId<PackagePrice>> {
    return this.database.withTransaction((session) => this.publishPackagePriceInSession(priceId, actor, session, 'published'), {
      requireTransaction: true,
    });
  }

  async restorePackagePrice(versionId: Types.ObjectId, actor: Actor): Promise<WithId<PackagePrice>> {
    return this.database.withTransaction(
      async (session) => {
        const source = await this.packagePrices.findById(versionId).session(session).lean<WithId<PackagePrice>>();
        if (!source) throw new NotFoundException('Versión de precio no encontrada.');
        if (source.status === 'published') throw new ConflictException('Esa versión ya es la vigente.');
        const draft = await this.createPackagePriceDraft(
          source.package,
          {
            mode: source.mode,
            baseCents: source.baseCents,
            variantPrices: source.variantPrices,
            removalCredits: source.removalCredits,
            rental: source.rental,
            notes: source.notes,
          },
          actor,
          { restoredFromVersion: source.version, session },
        );
        return this.publishPackagePriceInSession(draft._id, actor, session, 'restored');
      },
      { requireTransaction: true },
    );
  }

  private async publishPackagePriceInSession(
    priceId: Types.ObjectId,
    actor: Actor,
    session: ClientSession | null,
    auditVerb: 'published' | 'restored',
  ): Promise<WithId<PackagePrice>> {
    const draft = await this.packagePrices.findById(priceId).session(session);
    if (!draft) throw new NotFoundException('Versión de precio no encontrada.');
    if (draft.status !== 'draft') throw new ConflictException('Solo se pueden publicar borradores.');

    const previous = await this.packagePrices
      .findOneAndUpdate(
        { package: draft.package, status: 'published' },
        { $set: { status: 'superseded', supersededAt: new Date() } },
        { session, returnDocument: 'before' },
      )
      .lean<WithId<PackagePrice>>();

    draft.status = 'published';
    draft.publishedAt = new Date();
    draft.publishedBy = actor.label;
    await draft.save({ session });

    await this.audit.record(
      {
        action: `package_price.${auditVerb}`,
        entityType: 'package',
        entityId: draft.package,
        actor,
        before: previous ? summarizePackagePrice(previous) : null,
        after: summarizePackagePrice(draft.toObject()),
      },
      session,
    );
    return draft.toObject();
  }
}

function summarizeComponentPrice(price: WithId<ComponentPrice>) {
  return {
    priceId: price._id,
    version: price.version,
    mode: price.mode,
    saleCents: price.saleCents,
    costCents: price.costCents,
  };
}

function summarizePackagePrice(price: WithId<PackagePrice>) {
  return {
    priceId: price._id,
    version: price.version,
    mode: price.mode,
    baseCents: price.baseCents,
    variantPrices: price.variantPrices,
    removalCredits: price.removalCredits,
    rental: price.rental,
  };
}
