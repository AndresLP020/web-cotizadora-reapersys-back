import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { ROLES, type Role } from '../roles';

/** Usuario del panel administrativo. `passwordHash` nunca sale de este módulo. */
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, maxlength: 254 })
  email!: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ required: true, enum: ROLES })
  role!: Role;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, default: true })
  active!: boolean;

  @Prop({ required: true, default: 0 })
  failedLogins!: number;

  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  @Prop()
  lastLoginAt?: Date;

  @Prop({ required: true })
  passwordChangedAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
