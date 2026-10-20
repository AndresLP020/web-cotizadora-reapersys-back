import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { AdminRoute, CurrentUser } from './admin.guard';
import { AuthService } from './auth.service';
import { type AuthenticatedUser, SESSION_COOKIE, type SessionView } from './auth.types';
import { PASSWORD_MAX_LENGTH } from './password';

class LoginDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'Correo electrónico inválido.' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 5 * 60_000 } })
  @ApiOperation({ summary: 'Inicia sesión y establece la cookie de sesión (httpOnly).' })
  @ApiOkResponse({ description: 'SessionView con el token CSRF.' })
  @ApiUnauthorizedResponse({ description: 'Credenciales inválidas o cuenta bloqueada temporalmente.' })
  @ApiTooManyRequestsResponse()
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionView> {
    const { token, view } = await this.auth.login(dto.email, dto.password, { ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(SESSION_COOKIE, token, this.cookieOptions());
    res.setHeader('Cache-Control', 'no-store');
    return view;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute()
  @ApiOperation({ summary: 'Cierra la sesión actual.' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(user);
    res.clearCookie(SESSION_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
  }

  @Get('me')
  @AdminRoute()
  @ApiOperation({ summary: 'Usuario de la sesión actual, permisos y token CSRF.' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<SessionView> {
    return this.auth.view(user);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @AdminRoute()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ApiOperation({ summary: 'Cambia la contraseña; cierra las demás sesiones.' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionView> {
    const { token, view } = await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.cookie(SESSION_COOKIE, token, this.cookieOptions());
    return view;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/api',
      domain: this.config.get('COOKIE_DOMAIN'),
      maxAge: this.auth.sessionTtlMs,
    };
  }
}
