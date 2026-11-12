import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { FIELD_KEYS, type FieldKey, HEX_COLOR, PRODUCT_STATUSES, type ProductStatus, SLUG_PATTERN } from '../digital.constants';
import { LinkPreview, LinkPreviewSchema } from './link-preview.schema';

/** Dato que la plantilla pide al cliente. `max` = máximo de fotos, o largo máximo en los de texto. */
@Schema({ _id: false })
export class TemplateField {
  @Prop({ required: true, enum: FIELD_KEYS })
  key!: FieldKey;

  @Prop({ default: false })
  required!: boolean;

  @Prop({ min: 1, max: 1000 })
  max?: number;
}
const TemplateFieldSchema = SchemaFactory.createForClass(TemplateField);

/** Colores de la miniatura dibujada cuando la plantilla no tiene imagen. */
@Schema({ _id: false })
export class TemplateColors {
  @Prop({ required: true, match: HEX_COLOR }) bg!: string;
  @Prop({ required: true, match: HEX_COLOR }) accent!: string;
  @Prop({ required: true, match: HEX_COLOR }) ink!: string;
  /** Fondo tenue de la zona de vista previa de la tarjeta del catálogo. */
  @Prop({ required: true, match: HEX_COLOR }) stage!: string;
}
const TemplateColorsSchema = SchemaFactory.createForClass(TemplateColors);

export const DEFAULT_TEMPLATE_COLORS: TemplateColors = { bg: '#3B1424', accent: '#F4A6B8', ink: '#FFE4EA', stage: '#FCE7EC' };

/** Plantilla de detalle digital: una página de demostración que el cliente personaliza. */
@Schema({ collection: 'digital_templates', timestamps: true })
export class DigitalTemplate {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, match: SLUG_PATTERN })
  slug!: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ trim: true, maxlength: 400 })
  description?: string;

  /** Página de demostración (https). Vacía = aún no se puede publicar. */
  @Prop({ trim: true, maxlength: 500, default: '' })
  demoUrl!: string;

  /** Slugs de las ocasiones (colección digital_occasions). */
  @Prop({ type: [String], default: [] })
  occasions!: string[];

  @Prop({ type: [TemplateFieldSchema], default: [] })
  fields!: TemplateField[];

  /** Precio en centavos. null = «Por cotizar». */
  @Prop({ type: Number, default: null, min: 0 })
  priceCents!: number | null;

  @Prop({ type: TemplateColorsSchema, default: () => ({ ...DEFAULT_TEMPLATE_COLORS }) })
  colors!: TemplateColors;

  @Prop({ type: LinkPreviewSchema, default: () => ({}) })
  preview!: LinkPreview;

  @Prop({ required: true, enum: PRODUCT_STATUSES, default: 'draft' })
  status!: ProductStatus;

  @Prop({ default: false })
  featured!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type DigitalTemplateDocument = HydratedDocument<DigitalTemplate>;
export const DigitalTemplateSchema = SchemaFactory.createForClass(DigitalTemplate);

DigitalTemplateSchema.index({ status: 1, sortOrder: 1 });
DigitalTemplateSchema.index({ status: 1, occasions: 1 });
