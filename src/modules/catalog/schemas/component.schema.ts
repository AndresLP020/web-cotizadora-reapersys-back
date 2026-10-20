import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import {
  BILLING_TYPES,
  type BillingType,
  COMPONENT_CONDITIONS,
  COMPONENT_KINDS,
  COMPONENT_PRICING_STATUSES,
  type ComponentCondition,
  type ComponentKind,
  type ComponentPricingStatus,
  LIFECYCLE_STATUSES,
  type LifecycleStatus,
} from '../catalog.constants';

/**
 * Cualquier elemento vendible o incluible: funcionalidades web, hardware, software,
 * licencias y servicios recurrentes. Los PRECIOS viven en `component_prices` (versionados).
 */
@Schema({ collection: 'components', timestamps: true })
export class Component {
  @Prop({ required: true, unique: true, trim: true, uppercase: true, match: /^[A-Z0-9-]{3,40}$/ })
  sku!: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9-]+$/ })
  slug!: string;

  @Prop({ required: true, trim: true, maxlength: 160 })
  name!: string;

  @Prop({ trim: true, maxlength: 1000 })
  description?: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true, index: true })
  category!: Types.ObjectId;

  @Prop({ required: true, enum: COMPONENT_KINDS })
  kind!: ComponentKind;

  @Prop({ required: true, enum: BILLING_TYPES, default: 'one_time' })
  billing!: BillingType;

  /** Unidad de venta mostrada al cliente: "sección", "página", "producto", "equipo"... */
  @Prop({ required: true, trim: true, maxlength: 40, default: 'unidad' })
  unit!: string;

  @Prop({ trim: true, maxlength: 80 })
  brand?: string;

  @Prop({ trim: true, maxlength: 120 })
  model?: string;

  @Prop({ enum: COMPONENT_CONDITIONS })
  condition?: ComponentCondition;

  @Prop({ type: Types.ObjectId, ref: 'Supplier' })
  supplier?: Types.ObjectId;

  @Prop({ min: 0 })
  warrantyDays?: number;

  /** Existencias; null = no se controla inventario. */
  @Prop({ type: Number, default: null, min: 0 })
  stock!: number | null;

  @Prop({ required: true, enum: LIFECYCLE_STATUSES, default: 'active' })
  status!: LifecycleStatus;

  @Prop({ required: true, enum: COMPONENT_PRICING_STATUSES, default: 'pending_pricing' })
  pricingStatus!: ComponentPricingStatus;

  /** Se ofrece como complemento independiente en el catálogo público y el cotizador. */
  @Prop({ default: false })
  publicVisible!: boolean;

  /** Requiere valoración técnica: aunque tenga precio "desde", no genera total definitivo. */
  @Prop({ default: false })
  requiresEvaluation!: boolean;

  @Prop({ default: true })
  taxable!: boolean;

  @Prop({ default: 1, min: 1 })
  maxQuantity!: number;

  /** Componentes con el mismo grupo son mutuamente excluyentes (p. ej. planes de mantenimiento). */
  @Prop({ trim: true, maxlength: 60 })
  exclusiveGroup?: string;

  @Prop({ default: 0 })
  sortOrder!: number;
}

export type ComponentDocument = HydratedDocument<Component>;
export const ComponentSchema = SchemaFactory.createForClass(Component);

ComponentSchema.index({ status: 1, publicVisible: 1, sortOrder: 1 });
ComponentSchema.index({ pricingStatus: 1 });
