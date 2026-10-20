import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AuthService } from './auth.service';
import { type AuthenticatedUser, CSRF_HEADER, SESSION_COOKIE } from './auth.types';
import { hasPermission, type Permission } from './roles';

const PERMISSIONS_KEY = 'reapersys:permissions';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Protege rutas administrativas:
 *  1. Sesión válida (cookie httpOnly) → 401 si no.
 *  2. En métodos que modifican datos, token anti-CSRF ligado a la sesión → 403 si no coincide.
 *  3. Permisos del rol → 403 si faltan.
 * Las respuestas administrativas nunca se cachean.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');

    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const user = await this.auth.authenticate(cookies?.[SESSION_COOKIE]);
    if (!user) throw new UnauthorizedException('Inicia sesión para continuar.');

    if (!SAFE_METHODS.has(request.method)) {
      const header = request.get(CSRF_HEADER);
      if (!header || !safeEqual(header, user.csrfToken)) throw new ForbiddenException('Token CSRF inválido o ausente.');
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const missing = required.filter((permission) => !hasPermission(user.role, permission));
    if (missing.length > 0) throw new ForbiddenException('No tienes permiso para realizar esta acción.');

    request.adminUser = user;
    return true;
  }
}

/** Permisos de una ruta concreta dentro de un controlador @AdminRoute (sustituyen a los del controlador). */
export function RequirePermissions(...permissions: Permission[]) {
  return SetMetadata(PERMISSIONS_KEY, permissions);
}

/** Marca un controlador o ruta como administrativa y declara los permisos requeridos. */
export function AdminRoute(...permissions: Permission[]) {
  return applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(AdminGuard),
    ApiTags('Administración'),
    ApiCookieAuth(SESSION_COOKIE),
    ApiHeader({ name: 'X-CSRF-Token', required: false, description: 'Obligatorio en POST/PATCH/PUT/DELETE.' }),
    ApiUnauthorizedResponse({ description: 'Sin sesión.' }),
    ApiForbiddenResponse({ description: 'Sin permiso o CSRF inválido.' }),
  );
}

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser => {
  const user = context.switchToHttp().getRequest<Request>().adminUser;
  if (!user) throw new UnauthorizedException();
  return user;
});
