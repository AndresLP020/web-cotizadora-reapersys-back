import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

/**
 * Sesión de servidor. El token de la cookie nunca se guarda: solo su SHA-256.
 * MongoDB elimina las sesiones vencidas automáticamente (índice TTL sobre expiresAt).
 */
@Schema({ collection: 'sessions', timestamps: { createdAt: true, updatedAt: false } })
export class Session {
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user!: Types.ObjectId;

  /** Token anti-CSRF ligado a la sesión; se envía en el encabezado X-CSRF-Token. */
  @Prop({ required: true })
  csrfToken!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ required: true })
  lastSeenAt!: Date;

  /** HMAC de la IP de inicio (no se guarda la IP en claro). */
  @Prop()
  ipHash?: string;

  @Prop({ maxlength: 300 })
  userAgent?: string;

  createdAt!: Date;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
