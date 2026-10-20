import type { Types } from 'mongoose';
import type { Actor } from '../modules/audit/audit.service';
import type { Permission, Role } from './roles';

export const SESSION_COOKIE = 'reapersys_session';
export const CSRF_HEADER = 'x-csrf-token';

/** Usuario autenticado adjuntado a la petición por el AdminGuard. */
export interface AuthenticatedUser {
  id: Types.ObjectId;
  email: string;
  name: string;
  role: Role;
  sessionId: Types.ObjectId;
  csrfToken: string;
}

export interface SessionView {
  user: { id: string; email: string; name: string; role: Role; permissions: Permission[] };
  csrfToken: string;
  expiresAt: string;
}

export function actorOf(user: AuthenticatedUser): Actor {
  return { type: 'user', userId: user.id, label: user.email };
}

declare module 'express' {
  interface Request {
    adminUser?: AuthenticatedUser;
  }
}
