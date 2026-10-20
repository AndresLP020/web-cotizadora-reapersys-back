import { Body, Controller, ForbiddenException, Get, Header, HttpCode, HttpStatus, NotFoundException, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { NotificationsService } from './notifications.service';

interface StatusEvent {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}
interface WebhookPayload {
  entry?: { changes?: { value?: { statuses?: StatusEvent[] } }[] }[];
}

/**
 * Webhook de WhatsApp Cloud API: verificación de suscripción (GET) y estados de mensajes (POST).
 * Cada POST se autentica con la firma X-Hub-Signature-256 (HMAC-SHA256 del cuerpo crudo con el
 * App Secret). Sin proveedor real configurado, el webhook no existe (404).
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly config: AppConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertEnabled() {
    if (this.config.get('WHATSAPP_PROVIDER') !== 'meta_cloud') throw new NotFoundException();
  }

  @Get()
  @Header('Content-Type', 'text/plain')
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string): string {
    this.assertEnabled();
    const expected = this.config.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN') ?? '';
    if (mode !== 'subscribe' || !token || !safeEqual(token, expected) || !/^[\w-]{1,200}$/.test(challenge ?? '')) {
      throw new ForbiddenException();
    }
    return challenge;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest<Request>, @Body() body: WebhookPayload): Promise<{ received: true; updated: number }> {
    this.assertEnabled();
    const secret = this.config.get('WHATSAPP_APP_SECRET') ?? '';
    const signature = req.get('x-hub-signature-256') ?? '';
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody ?? Buffer.alloc(0)).digest('hex')}`;
    if (!req.rawBody || !safeEqual(signature, expected)) throw new ForbiddenException('Firma inválida.');

    let updated = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const event of change.value?.statuses ?? []) {
          if (typeof event.id !== 'string' || typeof event.status !== 'string') continue;
          const at = event.timestamp && /^\d+$/.test(event.timestamp) ? new Date(Number(event.timestamp) * 1000) : new Date();
          const detail = event.errors?.map((e) => `${e.code ?? ''} ${e.title ?? e.message ?? ''}`.trim()).join('; ');
          if (await this.notifications.applyProviderStatus(event.id, event.status, at, detail || undefined)) updated += 1;
        }
      }
    }
    // Meta espera 200 siempre que la firma sea válida, aunque el mensaje no sea nuestro.
    return { received: true, updated };
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
