import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';
import { AuditLog } from './schemas/audit-log.schema';

export interface Actor {
  type: 'system' | 'user';
  userId?: Types.ObjectId;
  label: string;
}

export const SYSTEM_ACTOR = (label: string): Actor => ({ type: 'system', label });

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: Types.ObjectId;
  actor: Actor;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLog>) {}

  /** Inserta un registro; si se pasa `session`, forma parte de la misma transacción. */
  async record(entry: AuditEntry, session?: ClientSession | null): Promise<void> {
    await this.auditModel.create([entry], { session: session ?? undefined });
  }

  findForEntity(entityType: string, entityId: Types.ObjectId) {
    return this.auditModel.find({ entityType, entityId }).sort({ createdAt: -1 }).lean();
  }
}
