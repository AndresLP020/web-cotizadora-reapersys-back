import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { formatMXN } from '../../common/money/money';
import { containsText } from '../../database/query-operators';
import { actorOf, type AuthenticatedUser } from '../../security/auth.types';
import { pageOf } from '../admin/admin.dto';
import { AuditService } from '../audit/audit.service';
import { LeadsService, type RequestContext } from '../leads/leads.service';
import { type DigitalOrder, type DigitalOrderField, type DigitalOrderPhoto, Lead } from '../leads/schemas/lead.schema';
import {
  FIELD_LABELS,
  FIELD_MAX_LENGTH,
  MAX_ORDER_PHOTO_BYTES,
  MAX_ORDER_PHOTOS,
  NFC_AUDIENCE_LABELS,
  NFC_INCLUDE_LABELS,
  NFC_QUOTE_ONLY_TIER,
  ORDER_PHOTO_TYPES,
  ORDER_PHOTOS_BUCKET,
} from './digital.constants';
import { type CreateDigitalOrderDto, DIGITAL_ORDER_CONSENT_VERSION, type OrderListQuery, type UpdateDigitalOrderDto } from './digital.dto';
import { DigitalService } from './digital.service';
import { sniffImageType } from './link-preview';
import { NfcService } from './nfc.service';
import { ProductImagesService, type UploadedImage } from './product-images.service';
import type { TemplateField } from './schemas/digital-template.schema';

type Doc<T> = T & { _id: Types.ObjectId };

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PHONE = /^\+?[\d\s-]{10,20}$/;
const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * Valida los datos personalizados contra los campos de la plantilla: solo se guardan los que la
 * plantilla pide, en su orden; los obligatorios deben venir; se respetan largos y formatos.
 * Lanza BadRequestException con todos los problemas juntos.
 */
export function validatePersonalization(fields: TemplateField[], input: Record<string, unknown> | undefined, photoCount: number): DigitalOrderField[] {
  const values = input ?? {};
  const errors: string[] = [];
  const result: DigitalOrderField[] = [];
  const photosField = fields.find((f) => f.key === 'photos');
  if (!photosField && photoCount > 0) errors.push('Esta plantilla no lleva fotos.');
  if (photosField) {
    const max = Math.min(photosField.max ?? MAX_ORDER_PHOTOS, MAX_ORDER_PHOTOS);
    if (photoCount > max) errors.push(`Puedes subir hasta ${max} fotos.`);
    if (photosField.required && photoCount === 0) errors.push('Sube al menos una foto.');
  }
  for (const field of fields) {
    if (field.key === 'photos') continue;
    const key = field.key;
    const label = FIELD_LABELS[key];
    const raw = values[key];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      errors.push(`«${label}» no es válido.`);
      continue;
    }
    const value = (raw ?? '').replace(/\s+$/g, '').replace(/^\s+/g, '');
    if (!value) {
      if (field.required) errors.push(`Falta «${label}».`);
      continue;
    }
    const max = Math.min(field.max ?? FIELD_MAX_LENGTH[key], FIELD_MAX_LENGTH[key]);
    if (value.length > max) errors.push(`«${label}» admite hasta ${max} caracteres.`);
    else if (key === 'date' && !DATE.test(value)) errors.push(`«${label}» debe ser una fecha válida.`);
    else if (key === 'song' && !HTTPS_URL.test(value)) errors.push(`«${label}» debe ser un enlace https.`);
    else if (key === 'rsvp' && !PHONE.test(value)) errors.push(`«${label}» debe ser un número de WhatsApp.`);
    else result.push({ key, label, value });
  }
  if (errors.length > 0) throw new BadRequestException(errors);
  return result;
}

/** Valida las fotos (cantidad, peso y tipo real por sus bytes). Devuelve su tipo detectado. */
export function validatePhotos(files: UploadedImage[]): string[] {
  if (files.length > MAX_ORDER_PHOTOS) throw new BadRequestException(`Puedes subir hasta ${MAX_ORDER_PHOTOS} fotos.`);
  return files.map((file, index) => {
    if (file.size > MAX_ORDER_PHOTO_BYTES) throw new BadRequestException(`La foto ${index + 1} pesa más de 5 MB.`);
    const type = sniffImageType(file.buffer);
    if (!type || !ORDER_PHOTO_TYPES.includes(type)) throw new BadRequestException(`La foto ${index + 1} debe ser JPEG, PNG o WebP.`);
    return type;
  });
}

function priceText(unitPriceCents: number | null, quantity: number): string {
  if (unitPriceCents === null) return 'Por cotizar';
  return quantity > 1 ? `${formatMXN(unitPriceCents)} por tarjeta · total ${formatMXN(unitPriceCents * quantity)}` : formatMXN(unitPriceCents);
}

/**
 * Pedidos de detalles digitales y tarjetas NFC. Se guardan en el flujo existente de prospectos
 * (colección leads, source = digital_order): así llegan las notificaciones y el seguimiento comercial
 * de siempre, y el panel de «Pedidos» lleva aparte el estado de entrega y el link final.
 */
@Injectable()
export class DigitalOrdersService {
  private readonly logger = new Logger(DigitalOrdersService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    private readonly leads: LeadsService,
    private readonly digital: DigitalService,
    private readonly nfc: NfcService,
    private readonly images: ProductImagesService,
    private readonly audit: AuditService,
  ) {}

  /** Pedido desde el sitio. Con el honeypot lleno se responde igual pero no se guarda nada. No se cobra en línea. */
  async create(dto: CreateDigitalOrderDto, files: UploadedImage[], context: RequestContext): Promise<{ received: true; reference: string }> {
    const photoTypes = validatePhotos(files);
    let order: DigitalOrder;
    let summary: string[];
    if (dto.type === 'detail') {
      const template = await this.digital.findPublished(dto.templateSlug!);
      const fields = validatePersonalization(template.fields, dto.personalization, files.length);
      order = {
        kind: 'digital_gift',
        templateSlug: template.slug,
        templateName: template.name,
        demoUrl: template.demoUrl,
        quantity: 1,
        unitPriceCents: template.priceCents,
        fields,
        photos: [],
        includes: [],
        fulfillment: 'new',
      };
      summary = [
        `Detalle digital: ${template.name}`,
        `Demo: ${template.demoUrl}`,
        `Precio publicado: ${priceText(template.priceCents, 1)}`,
        ...fields.map((f) => `${f.label}: ${f.value}`),
        ...(files.length > 0 ? [`Fotos: ${files.length}`] : []),
      ];
    } else {
      if (files.length > 0) throw new BadRequestException('Las tarjetas NFC no llevan fotos en el pedido.');
      const design = await this.nfc.findForOrder(dto.designSlug!);
      const quantity = dto.quantity!;
      const unitPriceCents = quantity === NFC_QUOTE_ONLY_TIER ? null : await this.nfc.unitPriceFor(quantity);
      const includes = dto.includes ?? [];
      order = {
        kind: 'nfc_card',
        templateSlug: design.slug,
        templateName: design.name,
        demoUrl: design.demoUrl,
        quantity,
        unitPriceCents,
        fields: [],
        photos: [],
        audience: dto.audience,
        includes,
        fulfillment: 'new',
      };
      summary = [
        `Tarjetas NFC: diseño ${design.name}`,
        `Cantidad: ${quantity === NFC_QUOTE_ONLY_TIER ? '50 o más (cotizar)' : quantity}`,
        ...(dto.audience ? [`Para: ${NFC_AUDIENCE_LABELS[dto.audience]}`] : []),
        ...(includes.length > 0 ? [`Su página lleva: ${includes.map((i) => NFC_INCLUDE_LABELS[i]).join(', ')}`] : []),
        `Precio: ${priceText(unitPriceCents, quantity)}`,
      ];
    }

    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn('Pedido digital descartado por honeypot.');
      return { received: true, reference: 'RS-00000000' };
    }

    // Las fotos se guardan privadas; si el prospecto no se crea, se borran.
    const photos: DigitalOrderPhoto[] = [];
    try {
      for (const [index, file] of files.entries()) {
        const stored = await this.images.store(file.buffer, photoTypes[index]!, `pedido-${order.templateSlug}-${index + 1}`, ORDER_PHOTOS_BUCKET);
        photos.push({ fileId: stored.fileId, contentType: stored.contentType, size: file.size });
      }
      order.photos = photos;
      const { reference } = await this.leads.createFromDigitalOrder(
        {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          message: [...summary, ...(dto.notes ? [`Notas: ${dto.notes}`] : [])].join('\n').slice(0, 2000),
          consentVersion: DIGITAL_ORDER_CONSENT_VERSION,
          digitalOrder: order,
        },
        context,
      );
      return { received: true, reference };
    } catch (error) {
      await this.images.remove(
        photos.map((p) => p.fileId),
        ORDER_PHOTOS_BUCKET,
      );
      throw error;
    }
  }

  // ------------------------------------------------------------------ panel

  async list(query: OrderListQuery) {
    const { page, pageSize, skip } = pageOf(query);
    const filter: Record<string, unknown> = { source: 'digital_order' };
    if (query.fulfillment) filter['digitalOrder.fulfillment'] = query.fulfillment;
    if (query.kind) filter['digitalOrder.kind'] = query.kind;
    if (query.q) filter.$or = [{ name: containsText(query.q) }, { email: containsText(query.q) }, { reference: containsText(query.q) }, { phone: containsText(query.q) }];
    const [items, total, counts] = await Promise.all([
      this.leadModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean<Doc<Lead>[]>(),
      this.leadModel.countDocuments(filter),
      this.leadModel.aggregate<{ _id: string; n: number }>([
        { $match: { source: 'digital_order' } },
        { $group: { _id: { $ifNull: ['$digitalOrder.fulfillment', 'new'] }, n: { $sum: 1 } } },
      ]),
    ]);
    const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    return {
      page,
      pageSize,
      total,
      counts: { new: byStatus.new ?? 0, in_progress: byStatus.in_progress ?? 0, delivered: byStatus.delivered ?? 0 },
      items: items.map((l) => this.toAdmin(l)),
    };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateDigitalOrderDto) {
    const lead = await this.findOrder(id);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (dto.fulfillment !== undefined) {
      set['digitalOrder.fulfillment'] = dto.fulfillment;
      if (dto.fulfillment === 'delivered' && lead.digitalOrder?.fulfillment !== 'delivered') set['digitalOrder.deliveredAt'] = new Date();
    }
    if (dto.deliveredUrl !== undefined) {
      if (dto.deliveredUrl === '') unset['digitalOrder.deliveredUrl'] = 1;
      else set['digitalOrder.deliveredUrl'] = dto.deliveredUrl;
    }
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) throw new BadRequestException('No hay cambios que aplicar.');
    const updated = await this.leadModel
      .findByIdAndUpdate(lead._id, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { returnDocument: 'after' })
      .lean<Doc<Lead>>();
    await this.audit.record({
      action: 'digital_order.updated',
      entityType: 'lead',
      entityId: lead._id,
      actor: actorOf(user),
      before: { fulfillment: lead.digitalOrder?.fulfillment ?? 'new', deliveredUrl: lead.digitalOrder?.deliveredUrl ?? null },
      after: { ...dto },
    });
    return this.toAdmin(updated!);
  }

  /** Foto subida por el cliente (solo el panel; nunca pública). */
  async photo(id: string, fileId: string): Promise<{ content: Buffer; contentType: string }> {
    const lead = await this.findOrder(id);
    const photo = lead.digitalOrder?.photos?.find((p) => p.fileId.toString() === fileId);
    if (!photo) throw new NotFoundException('Foto no encontrada.');
    return { content: await this.images.read(photo.fileId, ORDER_PHOTOS_BUCKET), contentType: photo.contentType };
  }

  private async findOrder(id: string): Promise<Doc<Lead>> {
    const lead = Types.ObjectId.isValid(id) ? await this.leadModel.findOne({ _id: new Types.ObjectId(id), source: 'digital_order' }).lean<Doc<Lead>>() : null;
    if (!lead?.digitalOrder) throw new NotFoundException('Pedido no encontrado.');
    return lead;
  }

  private toAdmin(l: Doc<Lead>) {
    const o = l.digitalOrder!;
    const id = l._id.toString();
    return {
      id,
      reference: l.reference,
      createdAt: l.createdAt,
      leadStatus: l.status,
      contact: { name: l.name, email: l.email, phone: l.phone ?? null },
      message: l.message,
      order: {
        kind: o.kind,
        slug: o.templateSlug,
        name: o.templateName,
        demoUrl: o.demoUrl || null,
        quantity: o.quantity,
        unitPriceCents: o.unitPriceCents,
        fields: (o.fields ?? []).map((f) => ({ key: f.key ?? null, label: f.label, value: f.value })),
        photos: (o.photos ?? []).map((p) => ({ fileId: p.fileId.toString(), contentType: p.contentType, size: p.size, path: `/admin/digital-orders/${id}/photos/${p.fileId.toString()}` })),
        audience: o.audience ?? null,
        includes: o.includes ?? [],
        fulfillment: o.fulfillment ?? 'new',
        deliveredUrl: o.deliveredUrl ?? null,
        deliveredAt: o.deliveredAt ?? null,
      },
    };
  }
}
