import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import {
  centsValidator,
  PRICE_MODES,
  PRICE_VERSION_STATUSES,
  type PriceMode,
  type PriceVersionStatus,
  signedCentsValidator,
} from '../../catalog/catalog.constants';

/** Diferencia de precio de una opción de variante respecto a la opción por defecto. */
@Schema({ _id: false })
export class VariantPrice {
  @Prop({ required: true })
  groupKey!: string;

  @Prop({ required: true })
  optionKey!: string;

  /** fixed = delta aprobado; pending = diferencia aún no definida. */
  @Prop({ required: true, enum: ['fixed', 'pending'] })
  mode!: 'fixed' | 'pending';

  @Prop({ type: Number, default: null, validate: signedCentsValidator })
  deltaCents!: number | null;
}
const VariantPriceSchema = SchemaFactory.createForClass(VariantPrice);

/**
 * Crédito aprobado por retirar un componente incluido. NO equivale al precio individual.
 * pending = sin crédito aprobado: retirar el componente envía la cotización a revisión.
 */
@Schema({ _id: false })
export class RemovalCredit {
  @Prop({ type: Types.ObjectId, ref: 'Component', required: true })
  component!: Types.ObjectId;

  @Prop({ required: true, enum: ['fixed', 'pending'] })
  mode!: 'fixed' | 'pending';

  @Prop({ type: Number, default: null, validate: centsValidator })
  creditCents!: number | null;
}
const RemovalCreditSchema = SchemaFactory.createForClass(RemovalCredit);

/**
 * Precio de la suscripción mensual del paquete. Se versiona junto con el precio de compra.
 * pending = sin mensualidad aprobada; starting_at = sugerida con costos por confirmar.
 */
@Schema({ _id: false })
export class RentalPrice {
  @Prop({ required: true, enum: PRICE_MODES, default: 'pending' })
  mode!: PriceMode;

  @Prop({ type: Number, default: null, validate: centsValidator })
  monthlyCents!: number | null;

  /** Cuota de alta (pago único al contratar). null o 0 = sin cuota. */
  @Prop({ type: Number, default: null, validate: centsValidator })
  setupFeeCents!: number | null;
}
const RentalPriceSchema = SchemaFactory.createForClass(RentalPrice);

@Schema({ collection: 'package_prices', timestamps: true })
export class PackagePrice {
  @Prop({ type: Types.ObjectId, ref: 'Package', required: true })
  package!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  version!: number;

  @Prop({ required: true, enum: PRICE_VERSION_STATUSES, default: 'draft' })
  status!: PriceVersionStatus;

  /** Modo del precio base (con las variantes por defecto). */
  @Prop({ required: true, enum: PRICE_MODES })
  mode!: PriceMode;

  @Prop({ type: Number, default: null, validate: centsValidator })
  baseCents!: number | null;

  @Prop({ type: [VariantPriceSchema], default: [] })
  variantPrices!: VariantPrice[];

  @Prop({ type: [RemovalCreditSchema], default: [] })
  removalCredits!: RemovalCredit[];

  @Prop({ type: RentalPriceSchema, default: () => ({ mode: 'pending', monthlyCents: null, setupFeeCents: null }) })
  rental!: RentalPrice;

  @Prop({ required: true, default: 'MXN' })
  currency!: 'MXN';

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;

  @Prop({ min: 1 })
  restoredFromVersion?: number;

  @Prop({ required: true })
  createdBy!: string;

  @Prop()
  publishedBy?: string;

  @Prop()
  publishedAt?: Date;

  @Prop()
  supersededAt?: Date;
}

export type PackagePriceDocument = HydratedDocument<PackagePrice>;
export const PackagePriceSchema = SchemaFactory.createForClass(PackagePrice);

PackagePriceSchema.index({ package: 1, version: 1 }, { unique: true });
PackagePriceSchema.index(
  { package: 1 },
  { unique: true, partialFilterExpression: { status: 'published' }, name: 'one_published_per_package' },
);

PackagePriceSchema.pre('validate', function () {
  const rental = this.rental;
  if (rental && (rental.mode === 'pending') !== (rental.monthlyCents === null || rental.monthlyCents === undefined)) {
    throw new Error('La mensualidad solo puede omitirse si la suscripción queda pendiente.');
  }
  if (this.mode === 'pending' && this.baseCents !== null) {
    throw new Error('Un precio pendiente no puede tener importe base.');
  }
  if (this.mode !== 'pending' && this.baseCents === null) {
    throw new Error('Un precio fijo o "desde" requiere importe base.');
  }
  for (const v of this.variantPrices) {
    if ((v.mode === 'pending') !== (v.deltaCents === null)) {
      throw new Error(`Variante ${v.groupKey}/${v.optionKey}: el delta debe ser null solo si está pendiente.`);
    }
  }
  for (const c of this.removalCredits) {
    if ((c.mode === 'pending') !== (c.creditCents === null)) {
      throw new Error('Crédito de retiro: el importe debe ser null solo si está pendiente.');
    }
  }
});
