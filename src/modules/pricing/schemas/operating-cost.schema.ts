import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { centsValidator } from '../../catalog/catalog.constants';

export const OPERATING_COST_UNITS = ['month', 'year', 'gb_month'] as const;
export type OperatingCostUnit = (typeof OPERATING_COST_UNITS)[number];

/**
 * Costo de operación que absorbe ReaperSys en las suscripciones (hosting, almacenamiento, dominio).
 * Información PRIVADA: solo se usa para calcular la mensualidad sugerida; nunca se expone al público.
 */
@Schema({ collection: 'operating_costs', timestamps: true })
export class OperatingCost {
  @Prop({ required: true, unique: true, match: /^[a-z0-9-]+$/ })
  key!: string;

  @Prop({ required: true, maxlength: 120 })
  name!: string;

  @Prop({ required: true, enum: OPERATING_COST_UNITS })
  unit!: OperatingCostUnit;

  /** Costo en centavos de MXN por unidad (mes, año o GB-mes). */
  @Prop({ required: true, validate: centsValidator })
  costCents!: number;

  /** De dónde sale el costo (proveedor, plan, tipo de cambio, fecha de consulta). */
  @Prop({ maxlength: 500 })
  sourceNote?: string;

  @Prop({ maxlength: 500 })
  sourceUrl?: string;

  /** false = referencia de mercado por confirmar con el proveedor real. */
  @Prop({ required: true, default: false })
  confirmed!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;
}

export type OperatingCostDocument = HydratedDocument<OperatingCost>;
export const OperatingCostSchema = SchemaFactory.createForClass(OperatingCost);
