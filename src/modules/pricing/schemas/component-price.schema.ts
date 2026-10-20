import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import {
  centsValidator,
  PRICE_MODES,
  PRICE_VERSION_STATUSES,
  type PriceMode,
  type PriceVersionStatus,
} from '../../catalog/catalog.constants';

/**
 * Versión de precio de un componente. Nunca se edita una versión publicada:
 * cada cambio crea una versión nueva y la anterior pasa a `superseded`.
 * `costCents` es PRIVADO: jamás se expone en respuestas públicas.
 */
@Schema({ collection: 'component_prices', timestamps: true })
export class ComponentPrice {
  @Prop({ type: Types.ObjectId, ref: 'Component', required: true })
  component!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  version!: number;

  @Prop({ required: true, enum: PRICE_VERSION_STATUSES, default: 'draft' })
  status!: PriceVersionStatus;

  @Prop({ required: true, enum: PRICE_MODES })
  mode!: PriceMode;

  /** Precio de venta en centavos; null solo cuando mode = pending. */
  @Prop({ type: Number, default: null, validate: centsValidator })
  saleCents!: number | null;

  /** Costo de adquisición en centavos (privado). */
  @Prop({ type: Number, default: null, validate: centsValidator })
  costCents!: number | null;

  @Prop({ required: true, default: 'MXN' })
  currency!: 'MXN';

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;

  /** Versión de la que se restauró este precio, si aplica. */
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

export type ComponentPriceDocument = HydratedDocument<ComponentPrice>;
export const ComponentPriceSchema = SchemaFactory.createForClass(ComponentPrice);

ComponentPriceSchema.index({ component: 1, version: 1 }, { unique: true });
// Como máximo UNA versión publicada por componente.
ComponentPriceSchema.index(
  { component: 1 },
  { unique: true, partialFilterExpression: { status: 'published' }, name: 'one_published_per_component' },
);

ComponentPriceSchema.pre('validate', function () {
  if (this.mode === 'pending' && this.saleCents !== null) {
    throw new Error('Un precio pendiente no puede tener importe de venta.');
  }
  if (this.mode !== 'pending' && this.saleCents === null) {
    throw new Error('Un precio fijo o "desde" requiere importe de venta.');
  }
});
