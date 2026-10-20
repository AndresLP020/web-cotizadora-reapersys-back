import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class AuditActor {
  @Prop({ required: true, enum: ['system', 'user'] })
  type!: 'system' | 'user';

  @Prop({ type: Types.ObjectId })
  userId?: Types.ObjectId;

  /** Etiqueta legible: correo del usuario o nombre del proceso (p. ej. "seed"). */
  @Prop({ required: true })
  label!: string;
}
const AuditActorSchema = SchemaFactory.createForClass(AuditActor);

/** Registro de auditoría inmutable. Solo se inserta; nunca se actualiza ni se borra desde la app. */
@Schema({ collection: 'audit_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  /** p. ej. "component_price.published", "package_price.restored". */
  @Prop({ required: true, index: true })
  action!: string;

  @Prop({ required: true })
  entityType!: string;

  @Prop({ type: Types.ObjectId, required: true })
  entityId!: Types.ObjectId;

  @Prop({ type: AuditActorSchema, required: true })
  actor!: AuditActor;

  @Prop({ type: MongooseSchema.Types.Mixed })
  before?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  after?: unknown;

  createdAt!: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
