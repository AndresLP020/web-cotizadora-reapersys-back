import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import { CONTRACT_TYPES, type ContractType } from './contract.schema';

export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Pago registrado manualmente. Nunca se borra: un error se corrige anulándolo (queda en el historial). */
@Schema({ collection: 'contract_payments', timestamps: true })
export class ContractPayment {
  @Prop({ type: Types.ObjectId, ref: 'Contract', required: true, index: true })
  contract!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true })
  client!: Types.ObjectId;

  /** Tipo del contrato (copia para los reportes de ingresos). */
  @Prop({ required: true, enum: CONTRACT_TYPES })
  contractType!: ContractType;

  @Prop({ required: true, min: 1 })
  amountCents!: number;

  /** Día del pago (12:00 UTC). */
  @Prop({ required: true })
  paidAt!: Date;

  @Prop({ required: true, enum: PAYMENT_METHODS })
  method!: PaymentMethod;

  @Prop({ trim: true, maxlength: 120 })
  reference?: string;

  @Prop({ trim: true, maxlength: 500 })
  note?: string;

  /** Renta: periodos cubiertos (avanzan el vencimiento). Compra: 0. */
  @Prop({ required: true, min: 0, max: 24, default: 0 })
  periods!: number;

  /** Renta: vencimiento que liquidó este pago. */
  @Prop({ type: Date, default: null })
  coveredDueDate!: Date | null;

  @Prop({ required: true, default: false })
  voided!: boolean;

  @Prop({ trim: true, maxlength: 300 })
  voidReason?: string;

  @Prop()
  voidedBy?: string;

  @Prop()
  voidedAt?: Date;

  @Prop({ required: true })
  recordedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ContractPaymentDocument = HydratedDocument<ContractPayment>;
export const ContractPaymentSchema = SchemaFactory.createForClass(ContractPayment);
ContractPaymentSchema.index({ voided: 1, paidAt: 1 });
