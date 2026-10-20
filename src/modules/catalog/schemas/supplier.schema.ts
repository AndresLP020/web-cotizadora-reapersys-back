import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Proveedores de hardware y licencias. Información privada (solo administración). */
@Schema({ collection: 'suppliers', timestamps: true })
export class Supplier {
  @Prop({ required: true, trim: true, maxlength: 160 })
  name!: string;

  @Prop({ trim: true, maxlength: 120 })
  contactName?: string;

  @Prop({ trim: true, lowercase: true, maxlength: 254 })
  email?: string;

  @Prop({ trim: true, maxlength: 30 })
  phone?: string;

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;

  @Prop({ default: true })
  active!: boolean;
}

export type SupplierDocument = HydratedDocument<Supplier>;
export const SupplierSchema = SchemaFactory.createForClass(Supplier);
SupplierSchema.index({ name: 1 }, { unique: true });
