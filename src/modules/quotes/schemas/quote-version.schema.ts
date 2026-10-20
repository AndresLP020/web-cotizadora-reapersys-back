import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { QuoteCalculation, QuoteSelection } from '../engine/engine.types';

/**
 * Snapshot INMUTABLE de una versión de cotización: selección del cliente y cálculo completo
 * con las referencias a las versiones de precio usadas. Publicar precios nuevos no la altera;
 * cualquier modificación crea una versión nueva.
 *
 * Las partidas (quote_items) se guardan embebidas en `calculation.lines`: siempre se leen
 * junto con su versión y nunca se modifican por separado.
 */
@Schema({ collection: 'quote_versions', timestamps: { createdAt: true, updatedAt: false } })
export class QuoteVersion {
  @Prop({ type: Types.ObjectId, ref: 'Quote', required: true })
  quote!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  version!: number;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  selection!: QuoteSelection;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  calculation!: QuoteCalculation;

  /** Motivo de la versión: "Solicitud del cliente", "Ajuste del asesor"... */
  @Prop({ required: true, maxlength: 300 })
  reason!: string;

  @Prop({ required: true })
  createdBy!: string;

  createdAt!: Date;
}

export type QuoteVersionDocument = HydratedDocument<QuoteVersion>;
export const QuoteVersionSchema = SchemaFactory.createForClass(QuoteVersion);
QuoteVersionSchema.index({ quote: 1, version: 1 }, { unique: true });
