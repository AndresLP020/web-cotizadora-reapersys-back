import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const TESTIMONIAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

/** Versión vigente del texto de autorización para publicar el comentario. */
export const TESTIMONIAL_CONSENT_VERSION = 'testimonial-2026-10';

/** Comentario enviado por un cliente desde el sitio. Solo se publica una vez aprobado en el panel. */
@Schema({ collection: 'testimonials', timestamps: true })
export class Testimonial {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ trim: true, maxlength: 120 })
  company?: string;

  /** Cargo de quien comenta. */
  @Prop({ trim: true, maxlength: 80 })
  role?: string;

  /** Privado: nunca se publica. */
  @Prop({ trim: true, lowercase: true, maxlength: 254 })
  email?: string;

  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ required: true, trim: true, maxlength: 1000 })
  message!: string;

  @Prop({ required: true, enum: TESTIMONIAL_STATUSES, default: 'pending' })
  status!: TestimonialStatus;

  /** Destacado: se muestra primero en el sitio. */
  @Prop({ required: true, default: false })
  featured!: boolean;

  @Prop({ type: { textVersion: String, acceptedAt: Date }, required: true, _id: false })
  consent!: { textVersion: string; acceptedAt: Date };

  /** HMAC de la IP (detección de abuso sin guardar la IP en claro). */
  @Prop()
  ipHash?: string;

  @Prop()
  reviewedBy?: string;

  @Prop()
  reviewedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type TestimonialDocument = HydratedDocument<Testimonial>;
export const TestimonialSchema = SchemaFactory.createForClass(Testimonial);
TestimonialSchema.index({ status: 1, featured: -1, createdAt: -1 });
