import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import {
  COMBO_REMOVAL_POLICIES,
  type ComboRemovalPolicy,
  LIFECYCLE_STATUSES,
  type LifecycleStatus,
  PACKAGE_CATEGORIES,
  PACKAGE_PRICING_TYPES,
  type PackageCategory,
  type PackagePricingType,
} from '../catalog.constants';

/**
 * Componente incluido en un paquete. `quantity` es la cantidad YA INCLUIDA:
 * el motor solo cobra las unidades que la excedan (regla: no cobrar dos veces).
 */
@Schema({ _id: false })
export class PackageItem {
  @Prop({ type: Types.ObjectId, ref: 'Component', required: true })
  component!: Types.ObjectId;

  @Prop({ required: true, min: 1, default: 1 })
  quantity!: number;

  /** El cliente puede retirarlo; se aplica solo el crédito de retiro aprobado. */
  @Prop({ default: false })
  removable!: boolean;

  /** Retirarlo afecta el descuento del combo según la política configurada. */
  @Prop({ default: false })
  essential!: boolean;
}
const PackageItemSchema = SchemaFactory.createForClass(PackageItem);

@Schema({ _id: false })
export class VariantOption {
  @Prop({ required: true, match: /^[a-z0-9-]+$/ })
  key!: string;

  @Prop({ required: true, maxlength: 120 })
  name!: string;

  @Prop({ maxlength: 300 })
  description?: string;

  /** Componentes que aporta esta opción (p. ej. RAM 16 GB + HDD 500 GB). */
  @Prop({ type: [PackageItemSchema], default: [] })
  items!: PackageItem[];
}
const VariantOptionSchema = SchemaFactory.createForClass(VariantOption);

/** Grupo de variantes excluyentes: se elige exactamente una opción. */
@Schema({ _id: false })
export class VariantGroup {
  @Prop({ required: true, match: /^[a-z0-9-]+$/ })
  key!: string;

  @Prop({ required: true, maxlength: 120 })
  name!: string;

  @Prop({ required: true })
  defaultOption!: string;

  @Prop({ type: [VariantOptionSchema], default: [] })
  options!: VariantOption[];
}
const VariantGroupSchema = SchemaFactory.createForClass(VariantGroup);

/** Paquete contenido en un combo, con sus variantes fijadas. */
@Schema({ _id: false })
export class IncludedPackage {
  @Prop({ type: Types.ObjectId, ref: 'Package', required: true })
  package!: Types.ObjectId;

  /** groupKey → optionKey */
  @Prop({ type: Map, of: String, default: {} })
  variants!: Map<string, string>;
}
const IncludedPackageSchema = SchemaFactory.createForClass(IncludedPackage);

/** Reglas explícitas del descuento de un paquete combinado. */
@Schema({ _id: false })
export class ComboPolicy {
  /** Al retirar un elemento esencial: recalcular sin descuento o enviar a revisión. */
  @Prop({ required: true, enum: COMBO_REMOVAL_POLICIES, default: 'review' })
  onEssentialRemoval!: ComboRemovalPolicy;

  /** Al cambiar la variante de un paquete contenido. */
  @Prop({ required: true, enum: COMBO_REMOVAL_POLICIES, default: 'review' })
  onVariantChange!: ComboRemovalPolicy;
}
const ComboPolicySchema = SchemaFactory.createForClass(ComboPolicy);

/**
 * package_price = se recupera el precio del paquete; manual = importe capturado (POS: solo el software);
 * combo_parts = suma de las mensualidades de los paquetes contenidos con el mismo descuento del combo.
 */
export const RECOVERABLE_MODES = ['package_price', 'manual', 'combo_parts'] as const;
export type RecoverableMode = (typeof RECOVERABLE_MODES)[number];

/**
 * Qué incluye la suscripción mensual de un paquete y cómo se calcula su mensualidad sugerida.
 * ReaperSys conserva la propiedad del sistema; el cliente paga mientras esté suscrito.
 */
@Schema({ _id: false })
export class RentalProfile {
  @Prop({ required: true, default: false })
  enabled!: boolean;

  /** Clave del costo de hosting (operating_costs). null = sin hosting (p. ej. POS local). */
  @Prop({ type: String, default: null })
  hostingCostKey!: string | null;

  /** GB de almacenamiento estimados (imágenes, archivos o respaldos en la nube). */
  @Prop({ required: true, default: 0, min: 0 })
  storageGb!: number;

  @Prop({ required: true, default: false })
  includesDomain!: boolean;

  /** Servicios incluidos cuyo precio de venta se suma a la mensualidad (mantenimiento, soporte). */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Component' }], default: [] })
  services!: Types.ObjectId[];

  /** Servicios incluidos que se cubren con los costos de operación (hosting administrado, dominio). */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Component' }], default: [] })
  coveredComponents!: Types.ObjectId[];

  /**
   * Valor que se recupera en el plazo: el precio del paquete, o un importe manual cuando solo
   * una parte se renta (POS: solo el software; el equipo se paga de contado). null = pendiente.
   */
  @Prop({ required: true, enum: RECOVERABLE_MODES, default: 'package_price' })
  recoverableMode!: RecoverableMode;

  @Prop({ type: Number, default: null, min: 0 })
  recoverableCents!: number | null;

  /** El equipo físico se paga de contado al contratar la suscripción (POS). */
  @Prop({ required: true, default: false })
  hardwareUpfront!: boolean;

  /** El hosting no entra en la mensualidad: se cobra en el primer pago. */
  @Prop({ default: false })
  hostingOnFirstPayment!: boolean;

  /** Porcentaje de la mensualidad calculada que se cobra. 10 000 = 100 %; 5 000 = la tienda a la mitad. */
  @Prop({ required: true, default: 10_000, min: 0, max: 10_000 })
  monthlyRateBp!: number;

  /** Mensualidad de venta. Si está definida, reemplaza la sugerencia de costos. */
  @Prop({ type: Number, default: null, min: 0 })
  saleMonthlyCents!: number | null;

  /** Soporte al usuario durante el mes, ya incluido en la mensualidad. No se suma aparte. */
  @Prop({ type: Number, default: null, min: 0 })
  supportIncludedCents!: number | null;

  /** Dominio y hosting, cobrados una vez al año y aparte de la mensualidad. */
  @Prop({ type: Number, default: null, min: 0 })
  infrastructureAnnualCents!: number | null;

  /** La renta cubre solo el software; no incluye equipo. */
  @Prop({ default: false })
  softwareOnly!: boolean;
}
const RentalProfileSchema = SchemaFactory.createForClass(RentalProfile);

@Schema({ collection: 'packages', timestamps: true })
export class Package {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9-]+$/ })
  slug!: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ required: true, enum: PACKAGE_CATEGORIES, index: true })
  category!: PackageCategory;

  @Prop({ required: true, trim: true, maxlength: 400 })
  summary!: string;

  /** Características comerciales mostradas al cliente. */
  @Prop({ type: [String], default: [] })
  features!: string[];

  /** Aclaraciones comerciales (alcance, exclusiones). */
  @Prop({ type: [String], default: [] })
  notes!: string[];

  @Prop({ required: true, enum: PACKAGE_PRICING_TYPES, default: 'fixed' })
  pricingType!: PackagePricingType;

  @Prop({ type: [PackageItemSchema], default: [] })
  items!: PackageItem[];

  @Prop({ type: [VariantGroupSchema], default: [] })
  variantGroups!: VariantGroup[];

  @Prop({ type: [IncludedPackageSchema], default: [] })
  includesPackages!: IncludedPackage[];

  @Prop({ type: ComboPolicySchema })
  comboPolicy?: ComboPolicy;

  /** Servicios recurrentes sugeridos (se muestran aparte, nunca se suman al total inicial). */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Component' }], default: [] })
  recommendedRecurring!: Types.ObjectId[];

  /**
   * Complementos opcionales compatibles. Si la lista tiene elementos, SOLO esos se ofrecen
   * (y se aceptan) como adicionales del paquete; vacía = cualquier complemento público compatible.
   */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Component' }], default: [] })
  addOns!: Types.ObjectId[];

  @Prop({ type: RentalProfileSchema, default: () => ({ enabled: false }) })
  rentalProfile!: RentalProfile;

  @Prop({ required: true, enum: LIFECYCLE_STATUSES, default: 'active' })
  status!: LifecycleStatus;

  @Prop({ default: false })
  featured!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;
}

export type PackageDocument = HydratedDocument<Package>;
export const PackageSchema = SchemaFactory.createForClass(Package);

PackageSchema.index({ status: 1, category: 1, sortOrder: 1 });
PackageSchema.index({ status: 1, featured: 1 });
