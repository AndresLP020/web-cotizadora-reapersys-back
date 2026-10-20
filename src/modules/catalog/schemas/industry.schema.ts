import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { SOLUTION_KINDS, type SolutionKind } from '../catalog.constants';

@Schema({ collection: 'industries', timestamps: true })
export class Industry {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9-]+$/ })
  slug!: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  /** Ejemplos de soluciones posibles (no implementaciones realizadas). */
  @Prop({ type: [String], default: [] })
  exampleSolutions!: string[];

  /** Punto de partida que el cotizador sugiere. Nunca modifica precios. */
  @Prop({ type: [String], enum: SOLUTION_KINDS, default: [] })
  suggestedSolutions!: SolutionKind[];

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ default: true })
  active!: boolean;
}

export type IndustryDocument = HydratedDocument<Industry>;
export const IndustrySchema = SchemaFactory.createForClass(Industry);
