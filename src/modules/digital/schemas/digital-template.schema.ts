import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

/** Líneas de producto: detalles digitales personalizables y tarjetas NFC de presentación. */
export const DIGITAL_KINDS = ['digital_gift', 'nfc_card'] as const;
export type DigitalKind = (typeof DIGITAL_KINDS)[number];

/** Ocasión o uso de cada plantilla; cada línea de producto admite las suyas. */
export const OCCASIONS_BY_KIND: Record<DigitalKind, readonly string[]> = {
  digital_gift: ['birthday', 'partner', 'friendship', 'anniversary', 'other'],
  nfc_card: ['business', 'professional', 'personal'],
};
export const DIGITAL_OCCASIONS = [...new Set(Object.values(OCCASIONS_BY_KIND).flat())];

export const TEMPLATE_STATUSES = ['active', 'inactive'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** Vista previa del enlace (como la que muestra WhatsApp), leída de las etiquetas Open Graph de la demo. */
@Schema({ _id: false })
export class LinkPreview {
  @Prop({ trim: true, maxlength: 200 })
  title?: string;

  @Prop({ trim: true, maxlength: 400 })
  description?: string;

  @Prop({ trim: true, maxlength: 120 })
  siteName?: string;

  /** Imagen en GridFS (bucket digital_template_images). */
  @Prop({ type: Types.ObjectId })
  imageFileId?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 40 })
  imageContentType?: string;

  /** og = leída de la página; upload = captura subida desde el panel (tiene prioridad). */
  @Prop({ enum: ['og', 'upload'] })
  imageSource?: 'og' | 'upload';

  @Prop()
  fetchedAt?: Date;

  /** Motivo si la última lectura falló (la plantilla se guarda igual). */
  @Prop({ trim: true, maxlength: 300 })
  error?: string;
}
const LinkPreviewSchema = SchemaFactory.createForClass(LinkPreview);

/**
 * Plantilla del catálogo de productos digitales: una página de demostración que el cliente
 * personaliza (nombres, mensajes) o, en NFC, el diseño de la página de contacto de la tarjeta.
 */
@Schema({ collection: 'digital_templates', timestamps: true })
export class DigitalTemplate {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9-]{2,80}$/ })
  slug!: string;

  @Prop({ required: true, enum: DIGITAL_KINDS, index: true })
  kind!: DigitalKind;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ trim: true, maxlength: 400 })
  description?: string;

  @Prop({ required: true, enum: DIGITAL_OCCASIONS })
  occasion!: string;

  /** Página de demostración (se abre en otra pestaña). */
  @Prop({ required: true, trim: true, maxlength: 500 })
  demoUrl!: string;

  /** Precio por plantilla (detalles) o por tarjeta (NFC), en centavos. null = «Por cotizar». */
  @Prop({ type: Number, default: null, min: 0 })
  priceCents!: number | null;

  /** Datos que el cliente llena al pedirla: «Nombre de ella», «Mensaje especial», «Puesto»… */
  @Prop({ type: [String], default: [] })
  customizableFields!: string[];

  @Prop({ type: LinkPreviewSchema, default: () => ({}) })
  preview!: LinkPreview;

  @Prop({ required: true, enum: TEMPLATE_STATUSES, default: 'active' })
  status!: TemplateStatus;

  @Prop({ default: false })
  featured!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type DigitalTemplateDocument = HydratedDocument<DigitalTemplate>;
export const DigitalTemplateSchema = SchemaFactory.createForClass(DigitalTemplate);

DigitalTemplateSchema.index({ status: 1, kind: 1, featured: -1, sortOrder: 1 });
