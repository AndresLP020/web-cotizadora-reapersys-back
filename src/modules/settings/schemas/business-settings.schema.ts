import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class TaxSettings {
  /** IVA en puntos base (1600 = 16 %). */
  @Prop({ required: true, min: 0, max: 10_000 })
  rateBp!: number;

  /** exclusive = el IVA se agrega a los precios; inclusive = los precios ya lo incluyen. */
  @Prop({ required: true, enum: ['exclusive', 'inclusive'] })
  treatment!: 'exclusive' | 'inclusive';

  /** false mientras el tratamiento no esté confirmado por la empresa. */
  @Prop({ required: true, default: false })
  confirmed!: boolean;
}
const TaxSettingsSchema = SchemaFactory.createForClass(TaxSettings);

@Schema({ _id: false })
export class QuoteSettings {
  /** Anticipo sugerido en puntos base (5000 = 50 %). */
  @Prop({ required: true, min: 0, max: 10_000 })
  depositRateBp!: number;

  /** Vigencia de cotizaciones en días. null = pendiente: no se emiten cotizaciones formales. */
  @Prop({ type: Number, default: null, min: 1 })
  validityDays!: number | null;

  @Prop({ required: true, default: 'RS' })
  folioPrefix!: string;
}
const QuoteSettingsSchema = SchemaFactory.createForClass(QuoteSettings);

/** Parámetros de la suscripción mensual (modelo: ReaperSys conserva la propiedad). */
@Schema({ _id: false })
export class RentalSettings {
  /** Plazo mínimo de contratación en meses. */
  @Prop({ required: true, default: 12, min: 1, max: 60 })
  minimumTermMonths!: number;

  /** Recargo sobre el valor recuperado por financiamiento y riesgo (puntos base). 0 = sin recargo. */
  @Prop({ required: true, default: 0, min: 0, max: 10_000 })
  financingBp!: number;

  /** Recargo del plan mes con mes (sin plazo forzoso), en puntos base. */
  @Prop({ required: true, default: 1_500, min: 0, max: 10_000 })
  monthToMonthSurchargeBp!: number;

  /** Descuento del plan semestral (plazo y cobro de 6 meses), en puntos base. */
  @Prop({ required: true, default: 500, min: 0, max: 5_000 })
  semiannualDiscountBp!: number;

  /** Descuento del plan anual (plazo y cobro de 12 meses), en puntos base. */
  @Prop({ required: true, default: 1_000, min: 0, max: 5_000 })
  annualDiscountBp!: number;
}
const RentalSettingsSchema = SchemaFactory.createForClass(RentalSettings);

@Schema({ _id: false })
export class WarrantySettings {
  @Prop({ type: Number, default: null, min: 0 })
  referenceDays!: number | null;

  @Prop({ required: true, default: false })
  confirmed!: boolean;
}
const WarrantySettingsSchema = SchemaFactory.createForClass(WarrantySettings);

@Schema({ _id: false })
export class ContactSettings {
  @Prop() email?: string;
  @Prop() whatsapp?: string;
  @Prop() facebook?: string;
  @Prop() instagram?: string;
  @Prop() tiktok?: string;
}
const ContactSettingsSchema = SchemaFactory.createForClass(ContactSettings);

/**
 * Publicación del aviso de privacidad. Solo se muestra cuando alguien lo marca como publicado
 * tras revisarlo con su asesor legal y con los datos del responsable completos.
 */
@Schema({ _id: false })
export class PrivacyNoticeSettings {
  @Prop({ required: true, default: false })
  published!: boolean;

  /** Fecha de la versión vigente del aviso (se actualiza al publicarlo o modificar sus datos). */
  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;
}
const PrivacyNoticeSettingsSchema = SchemaFactory.createForClass(PrivacyNoticeSettings);

/** Configuración comercial (documento único con key = "default"). */
@Schema({ collection: 'business_settings', timestamps: true })
export class BusinessSettings {
  @Prop({ required: true, unique: true, default: 'default' })
  key!: string;

  @Prop({ required: true, default: 'ReaperSys' })
  tradeName!: string;

  @Prop()
  legalName?: string;

  /** Domicilio del responsable (requerido por el aviso de privacidad). */
  @Prop({ trim: true, maxlength: 400 })
  legalAddress?: string;

  @Prop({ type: PrivacyNoticeSettingsSchema, default: () => ({ published: false, publishedAt: null }) })
  privacyNotice!: PrivacyNoticeSettings;

  @Prop({ required: true, default: 'MXN' })
  currency!: 'MXN';

  @Prop({ type: TaxSettingsSchema, required: true })
  tax!: TaxSettings;

  @Prop({ type: QuoteSettingsSchema, required: true })
  quote!: QuoteSettings;

  @Prop({
    type: RentalSettingsSchema,
    default: () => ({ minimumTermMonths: 12, financingBp: 0, monthToMonthSurchargeBp: 1_500, semiannualDiscountBp: 500, annualDiscountBp: 1_000 }),
  })
  rental!: RentalSettings;

  @Prop({ type: WarrantySettingsSchema, required: true })
  warranty!: WarrantySettings;

  @Prop({ type: ContactSettingsSchema, default: {} })
  contact!: ContactSettings;

  /** Condiciones comerciales generales incluidas en las cotizaciones. */
  @Prop({ type: [String], default: [] })
  commercialTerms!: string[];
}

export type BusinessSettingsDocument = HydratedDocument<BusinessSettings>;
export const BusinessSettingsSchema = SchemaFactory.createForClass(BusinessSettings);
