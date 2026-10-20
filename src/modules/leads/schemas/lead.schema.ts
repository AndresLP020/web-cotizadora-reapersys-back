import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'discarded'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['contact_form', 'quote_builder'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

@Schema({ _id: false })
export class LeadConsent {
  /** Aceptó que se usen sus datos para responder a la solicitud. */
  @Prop({ required: true })
  contact!: boolean;

  /** Versión del texto de consentimiento mostrado al usuario. */
  @Prop({ required: true })
  textVersion!: string;

  @Prop({ required: true })
  acceptedAt!: Date;
}

@Schema({ _id: false })
export class LeadRequestMeta {
  /** HMAC-SHA256 de la IP: permite detectar abuso sin almacenar la IP en claro. */
  @Prop()
  ipHash?: string;

  @Prop({ maxlength: 300 })
  userAgent?: string;
}

@Schema({ collection: 'leads', timestamps: true })
export class Lead {
  /** Referencia pública no secuencial (se entrega al usuario; nunca el ObjectId). */
  @Prop({ required: true, unique: true })
  reference!: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ trim: true, maxlength: 160 })
  company?: string;

  @Prop({ required: true, trim: true, lowercase: true, maxlength: 254 })
  email!: string;

  @Prop({ trim: true, maxlength: 20 })
  phone?: string;

  @Prop({ trim: true, maxlength: 80 })
  industry?: string;

  @Prop({ trim: true, maxlength: 40 })
  interest?: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  message!: string;

  @Prop({ required: true, enum: LEAD_SOURCES })
  source!: LeadSource;

  @Prop({ required: true, enum: LEAD_STATUSES, default: 'new' })
  status!: LeadStatus;

  @Prop({ type: LeadConsent, required: true })
  consent!: LeadConsent;

  @Prop({ type: LeadRequestMeta, default: {} })
  requestMeta!: LeadRequestMeta;

  /** Cliente asociado (prospectos del cotizador). */
  @Prop({ type: Types.ObjectId, ref: 'Client', index: true })
  client?: Types.ObjectId;

  /** Cotización que originó el prospecto. */
  @Prop({ type: Types.ObjectId, ref: 'Quote' })
  quote?: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type LeadDocument = HydratedDocument<Lead>;
export const LeadSchema = SchemaFactory.createForClass(Lead);

LeadSchema.index({ status: 1, createdAt: -1 });
LeadSchema.index({ email: 1, createdAt: -1 });
LeadSchema.index({ 'requestMeta.ipHash': 1, createdAt: -1 });
