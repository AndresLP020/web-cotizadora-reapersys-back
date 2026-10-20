import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PAYMENT_MODES, type PaymentMode } from '../engine/engine.types';
import { type HydratedDocument, Types } from 'mongoose';

export const QUOTE_STATUSES = [
  /** Recibida; requiere valoración antes de presentarse como presupuesto final. */
  'needs_review',
  /** Cotización formal emitida con importes definitivos y vigencia. */
  'issued',
  'sent',
  'approved',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

@Schema({ _id: false })
export class QuoteAccess {
  /** SHA-256 del token de acceso público. El token en claro nunca se almacena. */
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  /** Token cifrado (AES-256-GCM) para incluir el enlace en correos posteriores. Nunca se expone. */
  @Prop()
  tokenCiphertext?: string;
}
const QuoteAccessSchema = SchemaFactory.createForClass(QuoteAccess);

@Schema({ _id: false })
export class QuoteChannels {
  @Prop({ required: true, default: true })
  email!: boolean;

  @Prop({ required: true, default: false })
  whatsapp!: boolean;
}
const QuoteChannelsSchema = SchemaFactory.createForClass(QuoteChannels);

/** Resumen desnormalizado de la versión vigente, para listados y panel. */
@Schema({ _id: false })
export class QuoteSummary {
  @Prop({ required: true })
  packageName!: string;

  @Prop({ required: true })
  totalCents!: number;

  @Prop({ required: true })
  hasPendingAmounts!: boolean;

  @Prop({ type: [String], default: [] })
  reviewReasonCodes!: string[];

  /** En suscripción, totalCents es el pago inicial y monthlyCents la mensualidad (sin impuesto). */
  @Prop({ type: String, enum: PAYMENT_MODES, default: 'purchase' })
  paymentMode!: PaymentMode;

  @Prop({ type: Number, default: null })
  monthlyCents!: number | null;

  @Prop({ type: String, default: null })
  subscriptionPlan!: string | null;
}
const QuoteSummarySchema = SchemaFactory.createForClass(QuoteSummary);

@Schema({ collection: 'quotes', timestamps: true })
export class Quote {
  /** Folio legible (no autoriza acceso: para eso se usa el token). */
  @Prop({ required: true, unique: true })
  folio!: string;

  @Prop({ required: true, enum: QUOTE_STATUSES, index: true })
  status!: QuoteStatus;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true, index: true })
  client!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  lead?: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  currentVersion!: number;

  @Prop({ trim: true, maxlength: 80 })
  industry?: string;

  @Prop({ trim: true, maxlength: 40 })
  solution?: string;

  @Prop({ trim: true, maxlength: 2000 })
  comments?: string;

  @Prop({ type: QuoteChannelsSchema, required: true })
  channels!: QuoteChannels;

  @Prop({ type: QuoteAccessSchema, required: true })
  access!: QuoteAccess;

  /** Vigencia; solo existe para cotizaciones emitidas. */
  @Prop({ type: Date, default: null })
  validUntil!: Date | null;

  @Prop({ type: QuoteSummarySchema, required: true })
  summary!: QuoteSummary;

  createdAt!: Date;
  updatedAt!: Date;
}

export type QuoteDocument = HydratedDocument<Quote>;
export const QuoteSchema = SchemaFactory.createForClass(Quote);
QuoteSchema.index({ status: 1, createdAt: -1 });
