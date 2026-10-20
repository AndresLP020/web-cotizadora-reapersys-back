import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export const DELIVERY_CHANNELS = ['email', 'whatsapp'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_KINDS = [
  /** Cotización emitida al cliente (con PDF). */
  'quote_issued',
  /** Acuse de recepción al cliente para solicitudes en revisión (sin PDF final). */
  'quote_received',
  /** Aviso interno de nueva cotización. */
  'admin_new_quote',
  /** Aviso interno de nuevo prospecto del formulario de contacto. */
  'admin_new_lead',
  /** Recordatorio de pago al cliente (renta o saldo de compra). */
  'payment_reminder',
  /** Resumen diario interno de cobros vencidos y por vencer. */
  'admin_billing_digest',
  /** Aviso interno de un comentario de cliente pendiente de moderar. */
  'admin_new_testimonial',
] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

export const DELIVERY_STATUSES = [
  'queued',
  'sending',
  /** Aceptado por el proveedor. */
  'sent',
  /** Confirmado por webhook (WhatsApp). */
  'delivered',
  'read',
  'failed',
  /** Proveedor sin credenciales: no se entregó nada. */
  'simulated',
  /** Ya no aplicaba al momento de enviarse (p. ej. el pago se registró antes): no se envió. */
  'skipped',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

@Schema({ _id: false })
export class DeliveryEvent {
  @Prop({ required: true, enum: DELIVERY_STATUSES })
  status!: DeliveryStatus;

  @Prop({ required: true })
  at!: Date;

  @Prop({ maxlength: 500 })
  detail?: string;
}
const DeliveryEventSchema = SchemaFactory.createForClass(DeliveryEvent);

/** Cola persistente de envíos con reintentos e idempotencia. */
@Schema({ collection: 'notification_deliveries', timestamps: true })
export class NotificationDelivery {
  @Prop({ required: true, enum: DELIVERY_CHANNELS })
  channel!: DeliveryChannel;

  @Prop({ required: true, enum: DELIVERY_KINDS })
  kind!: DeliveryKind;

  @Prop({ type: Types.ObjectId, ref: 'Quote', index: true })
  quote?: Types.ObjectId;

  /** Versión de la cotización que se envía (el PDF corresponde a esa versión). */
  @Prop({ min: 1 })
  quoteVersion?: number;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  lead?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contract', index: true, sparse: true })
  contract?: Types.ObjectId;

  /** Vencimiento al que se refiere un recordatorio de pago. */
  @Prop()
  dueDate?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Testimonial' })
  testimonial?: Types.ObjectId;

  @Prop({ required: true, maxlength: 254 })
  recipient!: string;

  @Prop({ required: true, enum: DELIVERY_STATUSES, default: 'queued' })
  status!: DeliveryStatus;

  @Prop({ required: true, default: 0 })
  attempts!: number;

  @Prop({ required: true })
  maxAttempts!: number;

  @Prop({ required: true })
  nextAttemptAt!: Date;

  /** Bloqueo mientras un worker procesa el envío (se recupera si el proceso cae). */
  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  @Prop({ maxlength: 1000 })
  lastError?: string;

  @Prop()
  provider?: string;

  @Prop({ index: true, sparse: true })
  providerMessageId?: string;

  /** Evita duplicados: el mismo envío automático nunca se encola dos veces. */
  @Prop({ required: true, unique: true })
  idempotencyKey!: string;

  @Prop({ required: true })
  requestedBy!: string;

  @Prop({ type: [DeliveryEventSchema], default: [] })
  events!: DeliveryEvent[];

  createdAt!: Date;
  updatedAt!: Date;
}

export type NotificationDeliveryDocument = HydratedDocument<NotificationDelivery>;
export const NotificationDeliverySchema = SchemaFactory.createForClass(NotificationDelivery);
NotificationDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
