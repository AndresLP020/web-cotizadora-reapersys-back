import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import type { Model, Types } from 'mongoose';
import { hashIp } from '../common/security/ip-hash';
import { AppConfigService } from '../config/app-config.service';
import { AuditService } from '../modules/audit/audit.service';
import type { AuthenticatedUser, SessionView } from './auth.types';
import { getDummyHash, hashPassword, passwordPolicyError, verifyPassword } from './password';
import { ROLE_PERMISSIONS } from './roles';
import { Session } from './schemas/session.schema';
import { User } from './schemas/user.schema';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const TOUCH_INTERVAL_MS = 5 * 60_000;
const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos, o la cuenta está bloqueada temporalmente.';

type Doc<T> = T & { _id: Types.ObjectId };

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Verifica credenciales y abre una sesión. Mismo mensaje y tiempo similar tanto si el usuario
   * no existe como si la contraseña es incorrecta o la cuenta está bloqueada (no revela cuentas).
   */
  async login(emailInput: string, password: string, meta: RequestMeta): Promise<{ token: string; view: SessionView }> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.users.findOne({ email }).select('+passwordHash');

    if (!user) {
      await verifyPassword(password, await getDummyHash());
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const now = new Date();
    const locked = user.lockedUntil !== null && user.lockedUntil > now;
    const valid = await verifyPassword(password, user.passwordHash);

    if (!valid || locked || !user.active) {
      if (!valid && !locked) {
        user.failedLogins += 1;
        if (user.failedLogins >= MAX_FAILED_LOGINS) {
          user.lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000);
          user.failedLogins = 0;
          this.logger.warn(`Cuenta ${user.email} bloqueada ${LOCK_MINUTES} min por intentos fallidos.`);
          await this.audit.record({
            action: 'auth.locked',
            entityType: 'user',
            entityId: user._id,
            actor: { type: 'system', label: 'auth' },
          });
        }
        await user.save();
      }
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    user.failedLogins = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now;
    await user.save();

    const result = await this.openSession(user, meta);
    await this.audit.record({
      action: 'auth.login',
      entityType: 'user',
      entityId: user._id,
      actor: { type: 'user', userId: user._id, label: user.email },
    });
    return result;
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.sessions.deleteOne({ _id: user.sessionId });
    await this.audit.record({ action: 'auth.logout', entityType: 'user', entityId: user.id, actor: { type: 'user', userId: user.id, label: user.email } });
  }

  /** Resuelve el token de la cookie a un usuario activo; null si la sesión no es válida. */
  async authenticate(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const now = new Date();
    const session = await this.sessions.findOne({ tokenHash: hashSessionToken(token) }).lean<Doc<Session>>();
    if (!session || session.expiresAt <= now) return null;

    const user = await this.users.findById(session.user).lean<Doc<User>>();
    // Cambiar la contraseña o desactivar la cuenta invalida las sesiones anteriores.
    if (!user || !user.active || user.passwordChangedAt > session.createdAt) {
      await this.sessions.deleteOne({ _id: session._id });
      return null;
    }

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: now } });
    }

    return { id: user._id, email: user.email, name: user.name, role: user.role, sessionId: session._id, csrfToken: session.csrfToken };
  }

  async view(user: AuthenticatedUser): Promise<SessionView> {
    const session = await this.sessions.findById(user.sessionId).lean<Doc<Session>>();
    return this.toView(user, session?.expiresAt ?? new Date());
  }

  /** Cambia la contraseña, cierra TODAS las sesiones y abre una nueva para la petición actual. */
  async changePassword(user: AuthenticatedUser, current: string, next: string, meta: RequestMeta) {
    const record = await this.users.findById(user.id).select('+passwordHash');
    if (!record || !(await verifyPassword(current, record.passwordHash))) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }
    const policy = passwordPolicyError(next);
    if (policy) throw new BadRequestException(policy);
    if (current === next) throw new BadRequestException('La nueva contraseña debe ser distinta de la actual.');

    record.passwordHash = await hashPassword(next);
    record.passwordChangedAt = new Date();
    await record.save();
    await this.sessions.deleteMany({ user: record._id });
    await this.audit.record({ action: 'auth.password_changed', entityType: 'user', entityId: record._id, actor: { type: 'user', userId: record._id, label: record.email } });
    // La nueva sesión debe ser posterior a passwordChangedAt (resolución de milisegundos).
    await new Promise((resolve) => setTimeout(resolve, 2));
    return this.openSession(record, meta);
  }

  get sessionTtlMs(): number {
    return this.config.get('SESSION_TTL_HOURS') * 60 * 60 * 1000;
  }

  private async openSession(user: Doc<User> | (User & { _id: Types.ObjectId }), meta: RequestMeta) {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    const csrfToken = randomBytes(32).toString('base64url');
    const session = await this.sessions.create({
      tokenHash: hashSessionToken(token),
      user: user._id,
      csrfToken,
      expiresAt,
      lastSeenAt: now,
      ipHash: meta.ip ? hashIp(meta.ip, this.config.get('SESSION_SECRET')) : undefined,
      userAgent: meta.userAgent?.slice(0, 300),
    });
    const authUser: AuthenticatedUser = {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionId: session._id,
      csrfToken,
    };
    return { token, view: this.toView(authUser, expiresAt) };
  }

  private toView(user: AuthenticatedUser, expiresAt: Date): SessionView {
    return {
      user: { id: user.id.toString(), email: user.email, name: user.name, role: user.role, permissions: [...ROLE_PERMISSIONS[user.role]] },
      csrfToken: user.csrfToken,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
