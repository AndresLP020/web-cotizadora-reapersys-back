import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose, { type Connection, type Model, Types } from 'mongoose';
import { formatMXN } from '../../common/money/money';
import { containsText } from '../../database/query-operators';
import { actorOf, type AuthenticatedUser } from '../../security/auth.types';
import { pageOf, type Paged } from '../admin/admin.dto';
import { AuditService } from '../audit/audit.service';
import { LeadsService, type RequestContext } from '../leads/leads.service';
import {
  type CreateDigitalOrderDto,
  type CreateTemplateDto,
  DIGITAL_ORDER_CONSENT_VERSION,
  type TemplateListQuery,
  type UpdateTemplateDto,
} from './digital.dto';
import { downloadPreviewImage, fetchPreviewMeta, IMAGE_TYPES, LinkPreviewError, MAX_IMAGE_BYTES } from './link-preview';
import { DigitalTemplate, type DigitalKind, OCCASIONS_BY_KIND } from './schemas/digital-template.schema';

type Doc<T> = T & { _id: Types.ObjectId };

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const KIND_LABELS: Record<DigitalKind, string> = { digital_gift: 'Detalle digital', nfc_card: 'Tarjetas NFC' };

/** Tipo real de la imagen por sus primeros bytes (no se confía en el tipo declarado). */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'plantilla';
}

function imagePath(t: Doc<DigitalTemplate>): string | null {
  // El id del archivo cambia con cada imagen nueva: sirve para invalidar la caché del navegador.
  return t.preview?.imageFileId ? `/digital-templates/${t.slug}/image?v=${t.preview.imageFileId.toString()}` : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function toPublic(t: Doc<DigitalTemplate>) {
  return {
    slug: t.slug,
    kind: t.kind,
    name: t.name,
    description: t.description ?? t.preview?.description ?? null,
    occasion: t.occasion,
    demoUrl: t.demoUrl,
    domain: hostOf(t.demoUrl),
    priceCents: t.priceCents,
    customizableFields: [...t.customizableFields],
    imagePath: imagePath(t),
    previewTitle: t.preview?.title ?? null,
    featured: t.featured,
  };
}

function toAdmin(t: Doc<DigitalTemplate>) {
  return {
    ...toPublic(t),
    id: t._id.toString(),
    description: t.description ?? null,
    status: t.status,
    sortOrder: t.sortOrder,
    preview: {
      title: t.preview?.title ?? null,
      description: t.preview?.description ?? null,
      siteName: t.preview?.siteName ?? null,
      imageSource: t.preview?.imageSource ?? null,
      fetchedAt: t.preview?.fetchedAt ?? null,
      error: t.preview?.error ?? null,
    },
    updatedAt: t.updatedAt,
  };
}

/**
 * Catálogo de productos digitales: plantillas de detalles personalizables (invitaciones,
 * mensajes) y diseños de página de las tarjetas NFC. Cada plantilla muestra la vista previa
 * de su página de demostración y se pide con un formulario que llega como prospecto.
 */
@Injectable()
export class DigitalService {
  private readonly logger = new Logger(DigitalService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DigitalTemplate.name) private readonly templates: Model<DigitalTemplate>,
    private readonly leads: LeadsService,
    private readonly audit: AuditService,
  ) {}

  private get bucket() {
    return new mongoose.mongo.GridFSBucket(this.connection.db!, { bucketName: 'digital_template_images' });
  }

  // ------------------------------------------------------------------ público

  async listPublic(kind?: DigitalKind) {
    const filter: Record<string, unknown> = { status: 'active' };
    if (kind) filter.kind = kind;
    const items = await this.templates.find(filter).sort({ featured: -1, sortOrder: 1, name: 1 }).lean<Doc<DigitalTemplate>[]>();
    return { items: items.map(toPublic) };
  }

  async getImage(slug: string): Promise<{ content: Buffer; contentType: string }> {
    const template = await this.templates.findOne({ slug, status: 'active' }).lean<Doc<DigitalTemplate>>();
    const fileId = template?.preview?.imageFileId;
    if (!template || !fileId) throw new NotFoundException('Imagen no encontrada.');
    const chunks: Buffer[] = [];
    for await (const chunk of this.bucket.openDownloadStream(fileId)) chunks.push(chunk as Buffer);
    return { content: Buffer.concat(chunks), contentType: template.preview.imageContentType ?? 'application/octet-stream' };
  }

  /** Pedido desde el sitio. Con el honeypot lleno se responde igual pero no se guarda nada. */
  async createOrder(dto: CreateDigitalOrderDto, context: RequestContext): Promise<{ received: true; reference: string }> {
    const template = await this.templates.findOne({ slug: dto.templateSlug, status: 'active' }).lean<Doc<DigitalTemplate>>();
    if (!template) throw new NotFoundException('La plantilla ya no está disponible.');
    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn('Pedido digital descartado por honeypot.');
      return { received: true, reference: 'RS-00000000' };
    }
    // Un detalle digital es una sola página; las tarjetas NFC se piden por cantidad.
    const quantity = template.kind === 'nfc_card' ? (dto.quantity ?? 1) : 1;
    const values = new Map((dto.fields ?? []).filter((f) => f.value.length > 0).map((f) => [f.label, f.value]));
    // Solo se guardan los datos que la plantilla pide, en su orden.
    const fields = template.customizableFields.flatMap((label) => (values.has(label) ? [{ label, value: values.get(label)! }] : []));

    const price = template.priceCents === null ? 'Por cotizar' : `${formatMXN(template.priceCents)}${template.kind === 'nfc_card' ? ' por tarjeta' : ''}`;
    const message = [
      `${KIND_LABELS[template.kind]}: ${template.name}`,
      `Demo: ${template.demoUrl}`,
      ...(template.kind === 'nfc_card' ? [`Cantidad de tarjetas: ${quantity}`] : []),
      `Precio publicado: ${price}`,
      ...fields.map((f) => `${f.label}: ${f.value}`),
      ...(dto.notes ? [`Notas: ${dto.notes}`] : []),
    ].join('\n');

    const { reference } = await this.leads.createFromDigitalOrder(
      {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        message: message.slice(0, 2000),
        consentVersion: DIGITAL_ORDER_CONSENT_VERSION,
        digitalOrder: {
          kind: template.kind,
          templateSlug: template.slug,
          templateName: template.name,
          demoUrl: template.demoUrl,
          quantity,
          unitPriceCents: template.priceCents,
          fields,
        },
      },
      context,
    );
    return { received: true, reference };
  }

  // ------------------------------------------------------------------ administración

  async listAdmin(query: TemplateListQuery): Promise<Paged<ReturnType<typeof toAdmin>>> {
    const { page, pageSize, skip } = pageOf(query);
    const filter: Record<string, unknown> = {};
    if (query.kind) filter.kind = query.kind;
    if (query.status) filter.status = query.status;
    if (query.q) filter.$or = [{ name: containsText(query.q) }, { slug: containsText(query.q) }, { demoUrl: containsText(query.q) }];
    const [items, total] = await Promise.all([
      this.templates.find(filter).sort({ kind: 1, featured: -1, sortOrder: 1, name: 1 }).skip(skip).limit(pageSize).lean<Doc<DigitalTemplate>[]>(),
      this.templates.countDocuments(filter),
    ]);
    return { page, pageSize, total, items: items.map(toAdmin) };
  }

  async create(user: AuthenticatedUser, dto: CreateTemplateDto) {
    assertOccasion(dto.kind, dto.occasion);
    const slug = dto.slug ?? (await this.freeSlug(slugify(dto.name)));
    if (await this.templates.exists({ slug })) throw new ConflictException('Ya existe una plantilla con ese identificador.');
    const created = await this.templates.create({
      slug,
      kind: dto.kind,
      name: dto.name,
      description: dto.description,
      occasion: dto.occasion,
      demoUrl: dto.demoUrl,
      priceCents: dto.priceCents ?? null,
      customizableFields: dto.customizableFields ?? [],
      status: dto.status ?? 'active',
      featured: dto.featured ?? false,
      sortOrder: dto.sortOrder ?? 0,
    });
    await this.audit.record({
      action: 'digital_template.created',
      entityType: 'digital_template',
      entityId: created._id,
      actor: actorOf(user),
      after: { slug, kind: dto.kind, name: dto.name, demoUrl: dto.demoUrl, priceCents: created.priceCents },
    });
    return this.refreshPreview(created._id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTemplateDto) {
    const before = await this.findById(id);
    const kind = dto.kind ?? before.kind;
    const occasion = dto.occasion ?? before.occasion;
    assertOccasion(kind, occasion);
    const set: Record<string, unknown> = {};
    for (const key of ['kind', 'name', 'description', 'occasion', 'demoUrl', 'priceCents', 'customizableFields', 'status', 'featured', 'sortOrder'] as const) {
      if (dto[key] !== undefined) set[key] = dto[key];
    }
    if (Object.keys(set).length === 0) throw new BadRequestException('No hay cambios que aplicar.');
    await this.templates.updateOne({ _id: before._id }, { $set: set });
    await this.audit.record({
      action: 'digital_template.updated',
      entityType: 'digital_template',
      entityId: before._id,
      actor: actorOf(user),
      before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k as keyof DigitalTemplate]])),
      after: set,
    });
    // Otra demo: se vuelve a leer su vista previa (la captura subida se conserva).
    if (dto.demoUrl !== undefined && dto.demoUrl !== before.demoUrl) return this.refreshPreview(before._id);
    return toAdmin(await this.findById(id));
  }

  /** Vuelve a leer la vista previa de la demo. Si la lectura falla, se guarda el motivo y la plantilla sigue publicada. */
  async refreshPreview(id: Types.ObjectId | string) {
    const template = await this.findById(id);
    const set: Record<string, unknown> = { 'preview.fetchedAt': new Date() };
    const unset: Record<string, 1> = {};
    try {
      const meta = await fetchPreviewMeta(template.demoUrl);
      Object.assign(set, { 'preview.title': meta.title, 'preview.description': meta.description, 'preview.siteName': meta.siteName });
      for (const key of ['title', 'description', 'siteName'] as const) if (!meta[key]) unset[`preview.${key}`] = 1;
      unset['preview.error'] = 1;
      // Una captura subida desde el panel tiene prioridad sobre la imagen de la página.
      if (template.preview?.imageSource !== 'upload') {
        if (meta.imageUrl) {
          const image = await downloadPreviewImage(meta.imageUrl).catch((error: unknown) => {
            set['preview.error'] = `Imagen: ${messageOf(error)}`;
            delete unset['preview.error'];
            return null;
          });
          if (image) await this.replaceImage(template, image.content, image.contentType, 'og', set);
        } else {
          set['preview.error'] = 'La página no declara una imagen de vista previa: sube una captura.';
          delete unset['preview.error'];
        }
      }
    } catch (error) {
      set['preview.error'] = messageOf(error);
      this.logger.warn(`Vista previa de ${template.slug}: ${messageOf(error)}`);
    }
    const updated = await this.templates
      .findByIdAndUpdate(template._id, { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) }, { returnDocument: 'after' })
      .lean<Doc<DigitalTemplate>>();
    return toAdmin(updated!);
  }

  async uploadImage(user: AuthenticatedUser, id: string, file: UploadedImage | undefined) {
    if (!file) throw new BadRequestException('Adjunta una imagen.');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('La imagen no debe pasar de 3 MB.');
    const contentType = sniffImageType(file.buffer);
    if (!contentType || !IMAGE_TYPES.includes(contentType)) throw new BadRequestException('La imagen debe ser PNG, JPEG, WebP o GIF.');
    const template = await this.findById(id);
    const set: Record<string, unknown> = {};
    await this.replaceImage(template, file.buffer, contentType, 'upload', set);
    const updated = await this.templates
      .findByIdAndUpdate(template._id, { $set: set, $unset: { 'preview.error': 1 } }, { returnDocument: 'after' })
      .lean<Doc<DigitalTemplate>>();
    await this.audit.record({ action: 'digital_template.image_uploaded', entityType: 'digital_template', entityId: template._id, actor: actorOf(user) });
    return toAdmin(updated!);
  }

  /** Quita la captura subida y vuelve a la imagen de la página. */
  async removeUploadedImage(user: AuthenticatedUser, id: string) {
    const template = await this.findById(id);
    if (template.preview?.imageSource !== 'upload') throw new BadRequestException('La plantilla no tiene una captura subida.');
    await this.deleteFile(template.preview.imageFileId);
    await this.templates.updateOne(
      { _id: template._id },
      { $unset: { 'preview.imageFileId': 1, 'preview.imageContentType': 1, 'preview.imageSource': 1 } },
    );
    await this.audit.record({ action: 'digital_template.image_removed', entityType: 'digital_template', entityId: template._id, actor: actorOf(user) });
    return this.refreshPreview(template._id);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const template = await this.findById(id);
    await this.templates.deleteOne({ _id: template._id });
    await this.deleteFile(template.preview?.imageFileId);
    await this.audit.record({
      action: 'digital_template.deleted',
      entityType: 'digital_template',
      entityId: template._id,
      actor: actorOf(user),
      before: { slug: template.slug, name: template.name, demoUrl: template.demoUrl },
    });
  }

  // ------------------------------------------------------------------ apoyo

  private async findById(id: Types.ObjectId | string): Promise<Doc<DigitalTemplate>> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Plantilla no encontrada.');
    const template = await this.templates.findById(id).lean<Doc<DigitalTemplate>>();
    if (!template) throw new NotFoundException('Plantilla no encontrada.');
    return template;
  }

  private async freeSlug(base: string): Promise<string> {
    for (let n = 1; n < 100; n += 1) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!(await this.templates.exists({ slug: candidate }))) return candidate;
    }
    throw new ConflictException('No se pudo generar un identificador libre; indica uno.');
  }

  /** Guarda la imagen nueva, borra la anterior y deja en `set` los campos a actualizar. */
  private async replaceImage(template: Doc<DigitalTemplate>, content: Buffer, contentType: string, source: 'og' | 'upload', set: Record<string, unknown>) {
    const fileId = await new Promise<Types.ObjectId>((resolve, reject) => {
      const stream = this.bucket.openUploadStream(`${template.slug}-${source}`, { metadata: { template: template._id, source, contentType } });
      stream.once('finish', () => resolve(stream.id));
      stream.once('error', reject);
      stream.end(content);
    });
    await this.deleteFile(template.preview?.imageFileId);
    Object.assign(set, { 'preview.imageFileId': fileId, 'preview.imageContentType': contentType, 'preview.imageSource': source });
  }

  private async deleteFile(fileId: Types.ObjectId | undefined) {
    if (fileId) await this.bucket.delete(fileId).catch(() => undefined);
  }
}

function assertOccasion(kind: DigitalKind, occasion: string) {
  if (!OCCASIONS_BY_KIND[kind].includes(occasion)) throw new BadRequestException('La ocasión no corresponde al tipo de producto.');
}

function messageOf(error: unknown): string {
  return error instanceof LinkPreviewError ? error.message : 'No se pudo leer la vista previa.';
}
