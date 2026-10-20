import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const CONSENT_CHANNELS = ['contact', 'email', 'whatsapp'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/** Registro inmutable de un consentimiento otorgado (o revocado). */
@Schema({ _id: false })
export class ConsentRecord {
  @Prop({ required: true, enum: CONSENT_CHANNELS })
  channel!: ConsentChannel;

  @Prop({ required: true })
  granted!: boolean;

  /** Versión del texto mostrado al usuario. */
  @Prop({ required: true })
  textVersion!: string;

  @Prop({ required: true })
  at!: Date;

  /** Origen: quote_builder, contact_form, admin... */
  @Prop({ required: true })
  source!: string;
}
const ConsentRecordSchema = SchemaFactory.createForClass(ConsentRecord);

@Schema({ collection: 'clients', timestamps: true })
export class Client {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, maxlength: 254 })
  email!: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ trim: true, maxlength: 160 })
  company?: string;

  @Prop({ trim: true, maxlength: 20 })
  phone?: string;

  /** Número en formato internacional (solo dígitos), p. ej. 5215512345678. */
  @Prop({ trim: true, maxlength: 15 })
  whatsapp?: string;

  @Prop({ trim: true, maxlength: 2, uppercase: true })
  country?: string;

  /** Historial de consentimientos; el vigente por canal es el más reciente. */
  @Prop({ type: [ConsentRecordSchema], default: [] })
  consents!: ConsentRecord[];

  @Prop()
  lastRequestAt?: Date;
}

export type ClientDocument = HydratedDocument<Client>;
export const ClientSchema = SchemaFactory.createForClass(Client);
ClientSchema.index({ name: 'text', company: 'text', email: 'text' });
