import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export const CONTRACT_TYPES = ['rental', 'purchase'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_STATUSES = ['active', 'paused', 'cancelled', 'completed'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const BILLING_MONTHS = [1, 6, 12] as const;
export type BillingMonths = (typeof BILLING_MONTHS)[number];

/**
 * Renta (cobro periódico) o compra (pago único o en abonos) de un paquete por un cliente.
 * Los importes son centavos. `paidCents` es un acumulado de los pagos no anulados (se recalcula
 * en cada pago o anulación); `nextDueDate` es el próximo cobro (null si no hay nada pendiente).
 */
@Schema({ collection: 'contracts', timestamps: true })
export class Contract {
  @Prop({ required: true, unique: true })
  reference!: string;

  @Prop({ required: true, enum: CONTRACT_TYPES })
  type!: ContractType;

  @Prop({ required: true, enum: CONTRACT_STATUSES, default: 'active' })
  status!: ContractStatus;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true, index: true })
  client!: Types.ObjectId;

  /** Paquete del catálogo (solo referencia; el nombre se guarda como instantánea). */
  @Prop({ type: Types.ObjectId, ref: 'Package' })
  package?: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 160 })
  packageName!: string;

  @Prop({ type: Types.ObjectId, ref: 'Quote' })
  quote?: Types.ObjectId;

  @Prop({ required: true })
  startDate!: Date;

  // --- renta
  @Prop({ type: Number, default: null })
  monthlyCents!: number | null;

  /** Meses que cubre cada pago (1 en compras). */
  @Prop({ required: true, enum: BILLING_MONTHS, default: 1 })
  billingMonths!: BillingMonths;

  /** Día de cobro original: al sumar meses se conserva (31 → 28 feb → 31 mar). */
  @Prop({ min: 1, max: 31 })
  billingDay?: number;

  /** Plazo mínimo en meses; 0 = sin plazo forzoso. */
  @Prop({ required: true, min: 0, max: 120, default: 0 })
  termMonths!: number;

  // --- compra
  @Prop({ type: Number, default: null })
  totalCents!: number | null;

  /** Fecha límite del saldo de una compra (opcional). */
  @Prop({ type: Date, default: null })
  balanceDueDate!: Date | null;

  @Prop({ required: true, default: 0 })
  paidCents!: number;

  @Prop({ type: Date, default: null })
  nextDueDate!: Date | null;

  @Prop({ required: true, default: true })
  remindersEnabled!: boolean;

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;

  @Prop({ required: true })
  createdBy!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ContractDocument = HydratedDocument<Contract>;
export const ContractSchema = SchemaFactory.createForClass(Contract);
ContractSchema.index({ status: 1, nextDueDate: 1 });
ContractSchema.index({ type: 1, status: 1 });
