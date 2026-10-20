import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Contadores atómicos (p. ej. folios por año). */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 0 })
  seq!: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
