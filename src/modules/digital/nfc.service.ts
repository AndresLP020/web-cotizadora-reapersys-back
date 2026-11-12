import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { containsText, trusted } from '../../database/query-operators';
import { actorOf, type AuthenticatedUser } from '../../security/auth.types';
import { pageOf } from '../admin/admin.dto';
import { AuditService } from '../audit/audit.service';
import { NFC_QUANTITY_TIERS, NFC_QUOTE_ONLY_TIER, type NfcQuantityTier } from './digital.constants';
import type { CreateNfcDesignDto, ProductListQuery, UpdateNfcDesignDto, UpdateNfcPricingDto } from './digital.dto';
import { assertPublishable, slugify } from './digital.service';
import { assetPath, demoPathOf, ProductImagesService, type UploadedImage } from './product-images.service';
import { NfcDesign } from './schemas/nfc-design.schema';
import { NfcPriceTier } from './schemas/nfc-price-tier.schema';

type Doc<T> = T & { _id: Types.ObjectId };

const designBase = (slug: string) => `/nfc-designs/${slug}`;

function toPublic(d: Doc<NfcDesign>) {
  const base = designBase(d.slug);
  return {
    slug: d.slug,
    name: d.name,
    demoUrl: d.demoUrl,
    colors: { ...d.colors },
    frontImagePath: assetPath(base, 'front', d.frontImage),
    backImagePath: assetPath(base, 'back', d.backImage),
    preview: {
      title: d.preview?.title ?? null,
      description: d.preview?.description ?? null,
      domain: d.preview?.domain ?? null,
      path: demoPathOf(d.demoUrl),
      imagePath: assetPath(base, 'preview', d.preview?.image),
      faviconPath: assetPath(base, 'favicon', d.preview?.favicon),
    },
  };
}

function toAdmin(d: Doc<NfcDesign>) {
  const pub = toPublic(d);
  // El panel ve también las imágenes de los borradores (rutas protegidas).
  const base = `/admin/nfc-designs/${d._id.toString()}/assets`;
  return {
    ...pub,
    id: d._id.toString(),
    frontImagePath: assetPath(base, 'front', d.frontImage),
    backImagePath: assetPath(base, 'back', d.backImage),
    status: d.status,
    sortOrder: d.sortOrder,
    preview: {
      ...pub.preview,
      imagePath: assetPath(base, 'preview', d.preview?.image),
      faviconPath: assetPath(base, 'favicon', d.preview?.favicon),
      siteName: d.preview?.siteName ?? null,
      imageSource: d.preview?.imageSource ?? null,
      fetchedAt: d.preview?.fetchedAt ?? null,
      error: d.preview?.error ?? null,
    },
    updatedAt: d.updatedAt,
  };
}

/** Diseños de tarjeta NFC (con su página de contacto de demostración) y precios por cantidad. */
@Injectable()
export class NfcService {
  constructor(
    @InjectModel(NfcDesign.name) private readonly designs: Model<NfcDesign>,
    @InjectModel(NfcPriceTier.name) private readonly tiers: Model<NfcPriceTier>,
    private readonly images: ProductImagesService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ público

  async listPublic() {
    const items = await this.designs.find({ status: 'published', demoUrl: trusted({ $ne: '' }) }).sort({ sortOrder: 1, name: 1 }).lean<Doc<NfcDesign>[]>();
    return { items: items.map(toPublic) };
  }

  async pricing() {
    const docs = await this.tiers.find().lean<Doc<NfcPriceTier>[]>();
    const byQuantity = new Map(docs.map((t) => [t.quantity, t]));
    return {
      tiers: NFC_QUANTITY_TIERS.map((quantity) => {
        const tier = byQuantity.get(quantity);
        const quoteOnly = quantity === NFC_QUOTE_ONLY_TIER || (tier?.quoteOnly ?? false);
        return { quantity, unitPriceCents: quoteOnly ? null : (tier?.unitPriceCents ?? null), quoteOnly };
      }),
    };
  }

  /** Precio por tarjeta vigente de un tramo (null = «Por cotizar»). */
  async unitPriceFor(quantity: NfcQuantityTier): Promise<number | null> {
    const tier = (await this.pricing()).tiers.find((t) => t.quantity === quantity);
    return tier?.unitPriceCents ?? null;
  }

  async getAsset(slug: string, asset: 'preview' | 'favicon' | 'front' | 'back') {
    const design = await this.designs.findOne({ slug, status: 'published' }).lean<Doc<NfcDesign>>();
    const stored =
      asset === 'preview' ? design?.preview?.image : asset === 'favicon' ? design?.preview?.favicon : asset === 'front' ? design?.frontImage : design?.backImage;
    if (!stored) throw new NotFoundException('Imagen no encontrada.');
    return { content: await this.images.read(stored.fileId), contentType: stored.contentType };
  }

  /**
   * Diseño para un pedido. Se aceptan también los diseños en borrador: el configurador muestra
   * los diseños base (los del seed) mientras no haya diseños publicados con su demo.
   */
  async findForOrder(slug: string): Promise<Doc<NfcDesign>> {
    const design = await this.designs.findOne({ slug }).lean<Doc<NfcDesign>>();
    if (!design) throw new NotFoundException('El diseño ya no está disponible.');
    return design;
  }

  // ------------------------------------------------------------------ panel

  async getAdminAsset(id: string, asset: 'preview' | 'favicon' | 'front' | 'back') {
    const d = await this.findById(id);
    const stored = asset === 'preview' ? d.preview?.image : asset === 'favicon' ? d.preview?.favicon : asset === 'front' ? d.frontImage : d.backImage;
    if (!stored) throw new NotFoundException('Imagen no encontrada.');
    return { content: await this.images.read(stored.fileId), contentType: stored.contentType };
  }

  async listAdmin(query: ProductListQuery) {
    const { page, pageSize, skip } = pageOf({ ...query, pageSize: query.pageSize ?? 100 });
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.q) filter.$or = [{ name: containsText(query.q) }, { slug: containsText(query.q) }];
    const [items, total, published, draft] = await Promise.all([
      this.designs.find(filter).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(pageSize).lean<Doc<NfcDesign>[]>(),
      this.designs.countDocuments(filter),
      this.designs.countDocuments({ status: 'published' }),
      this.designs.countDocuments({ status: 'draft' }),
    ]);
    return { page, pageSize, total, items: items.map(toAdmin), counts: { all: published + draft, published, draft } };
  }

  async create(user: AuthenticatedUser, dto: CreateNfcDesignDto) {
    const slug = dto.slug ?? slugify(dto.name, 'diseno');
    if (await this.designs.exists({ slug })) throw new ConflictException('Ya existe un diseño con ese identificador.');
    const demoUrl = dto.demoUrl ?? '';
    const status = dto.status ?? 'draft';
    assertPublishable(status, demoUrl);
    const last = await this.designs.findOne().sort({ sortOrder: -1 }).select({ sortOrder: 1 }).lean<{ sortOrder: number }>();
    const created = await this.designs.create({
      slug,
      name: dto.name,
      demoUrl,
      ...(dto.colors ? { colors: dto.colors } : {}),
      status,
      sortOrder: dto.sortOrder ?? (last?.sortOrder ?? 0) + 10,
    });
    await this.audit.record({ action: 'nfc_design.created', entityType: 'nfc_design', entityId: created._id, actor: actorOf(user), after: { slug, name: dto.name, demoUrl, status } });
    return this.refreshPreview(created._id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateNfcDesignDto) {
    const before = await this.findById(id);
    const set: Record<string, unknown> = {};
    for (const key of ['name', 'demoUrl', 'colors', 'status', 'sortOrder'] as const) if (dto[key] !== undefined) set[key] = dto[key];
    if (Object.keys(set).length === 0) throw new BadRequestException('No hay cambios que aplicar.');
    assertPublishable((dto.status ?? before.status), dto.demoUrl ?? before.demoUrl);
    await this.designs.updateOne({ _id: before._id }, { $set: set });
    await this.audit.record({
      action: 'nfc_design.updated',
      entityType: 'nfc_design',
      entityId: before._id,
      actor: actorOf(user),
      before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k as keyof NfcDesign]])),
      after: set,
    });
    if (dto.demoUrl !== undefined && dto.demoUrl !== before.demoUrl) return this.refreshPreview(before._id);
    return toAdmin(await this.findById(id));
  }

  async refreshPreview(id: Types.ObjectId | string) {
    const design = await this.findById(id);
    const { preview, obsolete } = await this.images.readPreview(design.demoUrl, design.preview, design.slug);
    const updated = await this.designs.findByIdAndUpdate(design._id, { $set: { preview } }, { returnDocument: 'after' }).lean<Doc<NfcDesign>>();
    await this.images.remove(obsolete);
    return toAdmin(updated!);
  }

  /** Sube la portada de la vista previa del link o la imagen del frente o reverso de la tarjeta. */
  async uploadImage(user: AuthenticatedUser, id: string, which: 'preview' | 'front' | 'back', file: UploadedImage | undefined) {
    const design = await this.findById(id);
    const image = await this.images.storeUpload(file, `${design.slug}-${which}`);
    const path = which === 'preview' ? 'preview.image' : which === 'front' ? 'frontImage' : 'backImage';
    const previous = which === 'preview' ? design.preview?.image : which === 'front' ? design.frontImage : design.backImage;
    const set: Record<string, unknown> = { [path]: image, ...(which === 'preview' ? { 'preview.imageSource': 'upload' } : {}) };
    const updated = await this.designs
      .findByIdAndUpdate(design._id, { $set: set, ...(which === 'preview' ? { $unset: { 'preview.error': 1 } } : {}) }, { returnDocument: 'after' })
      .lean<Doc<NfcDesign>>();
    await this.images.remove([previous?.fileId]);
    await this.audit.record({ action: `nfc_design.${which}_uploaded`, entityType: 'nfc_design', entityId: design._id, actor: actorOf(user) });
    return toAdmin(updated!);
  }

  async removeImage(user: AuthenticatedUser, id: string, which: 'preview' | 'front' | 'back') {
    const design = await this.findById(id);
    if (which === 'preview') {
      if (design.preview?.imageSource !== 'upload') throw new BadRequestException('El diseño no tiene una portada subida.');
      await this.designs.updateOne({ _id: design._id }, { $unset: { 'preview.image': 1, 'preview.imageSource': 1 } });
      await this.images.remove([design.preview.image?.fileId]);
      await this.audit.record({ action: 'nfc_design.preview_removed', entityType: 'nfc_design', entityId: design._id, actor: actorOf(user) });
      return this.refreshPreview(design._id);
    }
    const previous = which === 'front' ? design.frontImage : design.backImage;
    if (!previous) throw new BadRequestException('No hay imagen que quitar.');
    await this.designs.updateOne({ _id: design._id }, { $unset: { [which === 'front' ? 'frontImage' : 'backImage']: 1 } });
    await this.images.remove([previous.fileId]);
    await this.audit.record({ action: `nfc_design.${which}_removed`, entityType: 'nfc_design', entityId: design._id, actor: actorOf(user) });
    return toAdmin(await this.findById(id));
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const design = await this.findById(id);
    await this.designs.deleteOne({ _id: design._id });
    await this.images.remove([design.preview?.image?.fileId, design.preview?.favicon?.fileId, design.frontImage?.fileId, design.backImage?.fileId]);
    await this.audit.record({ action: 'nfc_design.deleted', entityType: 'nfc_design', entityId: design._id, actor: actorOf(user), before: { slug: design.slug, name: design.name } });
  }

  async updatePricing(user: AuthenticatedUser, dto: UpdateNfcPricingDto) {
    const before = await this.pricing();
    for (const tier of dto.tiers) {
      const quoteOnly = tier.quantity === NFC_QUOTE_ONLY_TIER;
      await this.tiers.updateOne(
        { quantity: tier.quantity },
        { $set: { unitPriceCents: quoteOnly ? null : tier.unitPriceCents, quoteOnly } },
        { upsert: true, runValidators: true },
      );
    }
    const after = await this.pricing();
    await this.audit.record({ action: 'nfc_pricing.updated', entityType: 'nfc_pricing', entityId: new Types.ObjectId(), actor: actorOf(user), before, after });
    return after;
  }

  private async findById(id: Types.ObjectId | string): Promise<Doc<NfcDesign>> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Diseño no encontrado.');
    const design = await this.designs.findById(id).lean<Doc<NfcDesign>>();
    if (!design) throw new NotFoundException('Diseño no encontrado.');
    return design;
  }
}
