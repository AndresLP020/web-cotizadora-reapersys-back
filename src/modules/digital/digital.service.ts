import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { containsText, inValues, trusted } from '../../database/query-operators';
import { actorOf, type AuthenticatedUser } from '../../security/auth.types';
import { pageOf, type Paged } from '../admin/admin.dto';
import { AuditService } from '../audit/audit.service';
import type { CreateOccasionDto, CreateTemplateDto, ProductListQuery, UpdateOccasionDto, UpdateTemplateDto } from './digital.dto';
import { assetPath, demoPathOf, ProductImagesService, type UploadedImage } from './product-images.service';
import { DigitalTemplate } from './schemas/digital-template.schema';
import { Occasion } from './schemas/occasion.schema';

type Doc<T> = T & { _id: Types.ObjectId };

export function slugify(text: string, fallback = 'plantilla'): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || fallback
  );
}

const templateBase = (slug: string) => `/digital-templates/${slug}`;

function publicPreview(t: Doc<DigitalTemplate>) {
  return {
    title: t.preview?.title ?? null,
    description: t.preview?.description ?? null,
    domain: t.preview?.domain ?? null,
    path: demoPathOf(t.demoUrl),
    imagePath: assetPath(templateBase(t.slug), 'image', t.preview?.image),
    /** upload = portada vertical subida desde el panel (va dentro del celular); og = imagen horizontal de la página. */
    imageSource: t.preview?.image ? (t.preview.imageSource ?? 'og') : null,
    faviconPath: assetPath(templateBase(t.slug), 'favicon', t.preview?.favicon),
  };
}

function toPublic(t: Doc<DigitalTemplate>) {
  return {
    slug: t.slug,
    name: t.name,
    description: t.description ?? t.preview?.description ?? null,
    demoUrl: t.demoUrl,
    occasions: [...t.occasions],
    fields: t.fields.map((f) => ({ key: f.key, required: f.required, max: f.max ?? null })),
    priceCents: t.priceCents,
    colors: { bg: t.colors.bg, accent: t.colors.accent, ink: t.colors.ink, stage: t.colors.stage },
    featured: t.featured,
    preview: publicPreview(t),
  };
}

function toAdmin(t: Doc<DigitalTemplate>) {
  // El panel ve también las imágenes de los borradores (rutas protegidas).
  const base = `/admin/digital-templates/${t._id.toString()}/assets`;
  return {
    ...toPublic(t),
    id: t._id.toString(),
    description: t.description ?? null,
    status: t.status,
    sortOrder: t.sortOrder,
    preview: {
      ...publicPreview(t),
      imagePath: assetPath(base, 'image', t.preview?.image),
      faviconPath: assetPath(base, 'favicon', t.preview?.favicon),
      siteName: t.preview?.siteName ?? null,
      imageSource: t.preview?.imageSource ?? null,
      fetchedAt: t.preview?.fetchedAt ?? null,
      error: t.preview?.error ?? null,
    },
    updatedAt: t.updatedAt,
  };
}

export type AdminTemplate = ReturnType<typeof toAdmin>;

/**
 * Catálogo de detalles digitales: plantillas con su página de demostración (y la vista previa de su
 * link) y las ocasiones con que se filtran. Solo se publican plantillas con demo.
 */
@Injectable()
export class DigitalService {
  constructor(
    @InjectModel(DigitalTemplate.name) private readonly templates: Model<DigitalTemplate>,
    @InjectModel(Occasion.name) private readonly occasions: Model<Occasion>,
    private readonly images: ProductImagesService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ público

  async listPublic(occasion?: string) {
    const filter: Record<string, unknown> = { status: 'published', demoUrl: trusted({ $ne: '' }) };
    if (occasion) filter.occasions = occasion;
    const items = await this.templates.find(filter).sort({ sortOrder: 1, name: 1 }).lean<Doc<DigitalTemplate>[]>();
    return { items: items.map(toPublic) };
  }

  async listOccasions() {
    const items = await this.occasions.find().sort({ sortOrder: 1, label: 1 }).lean<Doc<Occasion>[]>();
    return { items: items.map((o) => ({ slug: o.slug, label: o.label })) };
  }

  async getAsset(slug: string, asset: 'image' | 'favicon'): Promise<{ content: Buffer; contentType: string }> {
    const template = await this.templates.findOne({ slug, status: 'published' }).lean<Doc<DigitalTemplate>>();
    const stored = asset === 'image' ? template?.preview?.image : template?.preview?.favicon;
    if (!stored) throw new NotFoundException('Imagen no encontrada.');
    return { content: await this.images.read(stored.fileId), contentType: stored.contentType };
  }

  // ------------------------------------------------------------------ plantillas (panel)

  async getAdminAsset(id: string, asset: 'image' | 'favicon') {
    const template = await this.findById(id);
    const stored = asset === 'image' ? template.preview?.image : template.preview?.favicon;
    if (!stored) throw new NotFoundException('Imagen no encontrada.');
    return { content: await this.images.read(stored.fileId), contentType: stored.contentType };
  }

  async listAdmin(query: ProductListQuery): Promise<Paged<AdminTemplate> & { counts: { all: number; published: number; draft: number } }> {
    const { page, pageSize, skip } = pageOf({ ...query, pageSize: query.pageSize ?? 100 });
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.q) filter.$or = [{ name: containsText(query.q) }, { slug: containsText(query.q) }, { demoUrl: containsText(query.q) }];
    const [items, total, published, draft] = await Promise.all([
      this.templates.find(filter).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(pageSize).lean<Doc<DigitalTemplate>[]>(),
      this.templates.countDocuments(filter),
      this.templates.countDocuments({ status: 'published' }),
      this.templates.countDocuments({ status: 'draft' }),
    ]);
    return { page, pageSize, total, items: items.map(toAdmin), counts: { all: published + draft, published, draft } };
  }

  async create(user: AuthenticatedUser, dto: CreateTemplateDto) {
    const slug = dto.slug ?? (await this.freeSlug(slugify(dto.name)));
    if (await this.templates.exists({ slug })) throw new ConflictException('Ya existe una plantilla con ese identificador.');
    const demoUrl = dto.demoUrl ?? '';
    const status = dto.status ?? 'draft';
    assertPublishable(status, demoUrl);
    await this.assertOccasions(dto.occasions);
    const last = await this.templates.findOne().sort({ sortOrder: -1 }).select({ sortOrder: 1 }).lean<{ sortOrder: number }>();
    const created = await this.templates.create({
      slug,
      name: dto.name,
      description: dto.description,
      demoUrl,
      occasions: dto.occasions ?? [],
      fields: dto.fields ?? [],
      priceCents: dto.priceCents ?? null,
      ...(dto.colors ? { colors: dto.colors } : {}),
      status,
      featured: false,
      sortOrder: dto.sortOrder ?? (last?.sortOrder ?? 0) + 10,
    });
    if (dto.featured) await this.setFeatured(created._id);
    await this.audit.record({
      action: 'digital_template.created',
      entityType: 'digital_template',
      entityId: created._id,
      actor: actorOf(user),
      after: { slug, name: dto.name, demoUrl, priceCents: created.priceCents, status },
    });
    return this.refreshPreview(created._id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTemplateDto) {
    const before = await this.findById(id);
    const set: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'demoUrl', 'priceCents', 'occasions', 'fields', 'colors', 'status', 'sortOrder'] as const) {
      if (dto[key] !== undefined) set[key] = dto[key];
    }
    if (Object.keys(set).length === 0 && dto.featured === undefined) throw new BadRequestException('No hay cambios que aplicar.');
    assertPublishable((dto.status ?? before.status), dto.demoUrl ?? before.demoUrl);
    await this.assertOccasions(dto.occasions);
    if (Object.keys(set).length > 0) await this.templates.updateOne({ _id: before._id }, { $set: set });
    if (dto.featured === true) await this.setFeatured(before._id);
    if (dto.featured === false) await this.templates.updateOne({ _id: before._id }, { $set: { featured: false } });
    await this.audit.record({
      action: 'digital_template.updated',
      entityType: 'digital_template',
      entityId: before._id,
      actor: actorOf(user),
      before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k as keyof DigitalTemplate]])),
      after: { ...set, ...(dto.featured !== undefined ? { featured: dto.featured } : {}) },
    });
    // Otra demo: se vuelve a leer su vista previa (la portada subida se conserva).
    if (dto.demoUrl !== undefined && dto.demoUrl !== before.demoUrl) return this.refreshPreview(before._id);
    return toAdmin(await this.findById(id));
  }

  /** Vuelve a leer la vista previa de la demo. Si falla, se guarda el motivo y la plantilla sigue igual. */
  async refreshPreview(id: Types.ObjectId | string) {
    const template = await this.findById(id);
    const { preview, obsolete } = await this.images.readPreview(template.demoUrl, template.preview, template.slug);
    const updated = await this.templates.findByIdAndUpdate(template._id, { $set: { preview } }, { returnDocument: 'after' }).lean<Doc<DigitalTemplate>>();
    await this.images.remove(obsolete);
    return toAdmin(updated!);
  }

  /** Sube una portada: reemplaza a la imagen de la página en la vista previa. */
  async uploadCover(user: AuthenticatedUser, id: string, file: UploadedImage | undefined) {
    const template = await this.findById(id);
    const image = await this.images.storeUpload(file, `${template.slug}-cover`);
    const updated = await this.templates
      .findByIdAndUpdate(
        template._id,
        { $set: { 'preview.image': image, 'preview.imageSource': 'upload' }, $unset: { 'preview.error': 1 } },
        { returnDocument: 'after' },
      )
      .lean<Doc<DigitalTemplate>>();
    await this.images.remove([template.preview?.image?.fileId]);
    await this.audit.record({ action: 'digital_template.cover_uploaded', entityType: 'digital_template', entityId: template._id, actor: actorOf(user) });
    return toAdmin(updated!);
  }

  /** Quita la portada subida y vuelve a la imagen de la página. */
  async removeCover(user: AuthenticatedUser, id: string) {
    const template = await this.findById(id);
    if (template.preview?.imageSource !== 'upload') throw new BadRequestException('La plantilla no tiene una portada subida.');
    await this.templates.updateOne({ _id: template._id }, { $unset: { 'preview.image': 1, 'preview.imageSource': 1 } });
    await this.images.remove([template.preview.image?.fileId]);
    await this.audit.record({ action: 'digital_template.cover_removed', entityType: 'digital_template', entityId: template._id, actor: actorOf(user) });
    return this.refreshPreview(template._id);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const template = await this.findById(id);
    await this.templates.deleteOne({ _id: template._id });
    await this.images.remove([template.preview?.image?.fileId, template.preview?.favicon?.fileId]);
    await this.audit.record({
      action: 'digital_template.deleted',
      entityType: 'digital_template',
      entityId: template._id,
      actor: actorOf(user),
      before: { slug: template.slug, name: template.name, demoUrl: template.demoUrl },
    });
  }

  // ------------------------------------------------------------------ ocasiones (panel)

  async createOccasion(user: AuthenticatedUser, dto: CreateOccasionDto) {
    const slug = dto.slug ?? slugify(dto.label, 'ocasion');
    if (await this.occasions.exists({ slug })) throw new ConflictException('Ya existe una ocasión con ese identificador.');
    const last = await this.occasions.findOne().sort({ sortOrder: -1 }).select({ sortOrder: 1 }).lean<{ sortOrder: number }>();
    const created = await this.occasions.create({ slug, label: dto.label, sortOrder: dto.sortOrder ?? (last?.sortOrder ?? 0) + 10 });
    await this.audit.record({ action: 'digital_occasion.created', entityType: 'digital_occasion', entityId: created._id, actor: actorOf(user), after: { slug, label: dto.label } });
    return this.listOccasions();
  }

  async updateOccasion(user: AuthenticatedUser, id: string, dto: UpdateOccasionDto) {
    const occasion = await this.occasionById(id);
    const set = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length === 0) throw new BadRequestException('No hay cambios que aplicar.');
    await this.occasions.updateOne({ _id: occasion._id }, { $set: set });
    await this.audit.record({ action: 'digital_occasion.updated', entityType: 'digital_occasion', entityId: occasion._id, actor: actorOf(user), after: set });
    return this.listOccasions();
  }

  /** Borra la ocasión y la quita de las plantillas que la usaban. */
  async removeOccasion(user: AuthenticatedUser, id: string) {
    const occasion = await this.occasionById(id);
    await this.occasions.deleteOne({ _id: occasion._id });
    await this.templates.updateMany({ occasions: occasion.slug }, { $pull: { occasions: occasion.slug } });
    await this.audit.record({ action: 'digital_occasion.deleted', entityType: 'digital_occasion', entityId: occasion._id, actor: actorOf(user), before: { slug: occasion.slug } });
    return this.listOccasions();
  }

  async listOccasionsAdmin() {
    const items = await this.occasions.find().sort({ sortOrder: 1, label: 1 }).lean<Doc<Occasion>[]>();
    return { items: items.map((o) => ({ id: o._id.toString(), slug: o.slug, label: o.label, sortOrder: o.sortOrder })) };
  }

  // ------------------------------------------------------------------ apoyo

  /** Plantilla publicada para un pedido. */
  async findPublished(slug: string): Promise<Doc<DigitalTemplate>> {
    const template = await this.templates.findOne({ slug, status: 'published', demoUrl: trusted({ $ne: '' }) }).lean<Doc<DigitalTemplate>>();
    if (!template) throw new NotFoundException('La plantilla ya no está disponible.');
    return template;
  }

  private async findById(id: Types.ObjectId | string): Promise<Doc<DigitalTemplate>> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Plantilla no encontrada.');
    const template = await this.templates.findById(id).lean<Doc<DigitalTemplate>>();
    if (!template) throw new NotFoundException('Plantilla no encontrada.');
    return template;
  }

  private async occasionById(id: string): Promise<Doc<Occasion>> {
    const occasion = Types.ObjectId.isValid(id) ? await this.occasions.findById(id).lean<Doc<Occasion>>() : null;
    if (!occasion) throw new NotFoundException('Ocasión no encontrada.');
    return occasion;
  }

  private async assertOccasions(slugs: string[] | undefined) {
    if (!slugs || slugs.length === 0) return;
    const found = await this.occasions.countDocuments({ slug: inValues(slugs) });
    if (found !== slugs.length) throw new BadRequestException('Alguna ocasión no existe.');
  }

  /** Solo una plantilla destacada (la que abre «Ver una demo» del inicio). */
  private async setFeatured(id: Types.ObjectId) {
    await this.templates.updateMany({ _id: trusted({ $ne: id }), featured: true }, { $set: { featured: false } });
    await this.templates.updateOne({ _id: id }, { $set: { featured: true } });
  }

  private async freeSlug(base: string): Promise<string> {
    for (let n = 1; n < 100; n += 1) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!(await this.templates.exists({ slug: candidate }))) return candidate;
    }
    throw new ConflictException('No se pudo generar un identificador libre; indica uno.');
  }
}

/** No se publica nada sin página de demostración. */
export function assertPublishable(status: string, demoUrl: string) {
  if (status === 'published' && !demoUrl) throw new BadRequestException('Agrega la URL de la demo antes de publicar.');
}
