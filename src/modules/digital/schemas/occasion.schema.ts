import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SLUG_PATTERN } from '../digital.constants';

/** Ocasión de los detalles digitales («Cumpleaños», «Para mi pareja»…), administrable desde el panel. */
@Schema({ collection: 'digital_occasions', timestamps: true })
export class Occasion {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, match: SLUG_PATTERN })
  slug!: string;

  @Prop({ required: true, trim: true, maxlength: 60 })
  label!: string;

  @Prop({ default: 0 })
  sortOrder!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const OccasionSchema = SchemaFactory.createForClass(Occasion);
OccasionSchema.index({ sortOrder: 1 });
