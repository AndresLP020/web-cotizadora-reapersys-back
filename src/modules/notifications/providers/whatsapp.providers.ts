import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DeliveryError, deliveryErrorFrom, maskRecipient, type SendResult, type WhatsAppProvider, type WhatsAppTemplateMessage } from './provider.types';

const REQUEST_TIMEOUT_MS = 30_000;

/** Sin credenciales: registra el intento y NO envía nada. */
export class SimulatedWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'simulated';
  readonly simulated = true;
  private readonly logger = new Logger('WhatsApp (simulado)');

  sendQuoteTemplate(message: WhatsAppTemplateMessage): Promise<SendResult> {
    this.logger.warn(`No enviado (modo simulado): ${message.document.filename} → ${maskRecipient(message.to)}`);
    return Promise.resolve({ providerMessageId: `sim_${randomUUID()}`, simulated: true });
  }
}

export interface MetaCloudConfig {
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
}

/**
 * WhatsApp Business Platform (Cloud API). Mensaje de plantilla aprobada con el PDF como
 * documento de encabezado: 1) se sube el PDF como media, 2) se envía la plantilla con su id.
 * Así el documento no necesita una URL pública.
 */
export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta_cloud';
  readonly simulated = false;

  constructor(private readonly config: MetaCloudConfig) {}

  private url(path: string) {
    return `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/${path}`;
  }

  private async call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        ...init,
        headers: { Authorization: `Bearer ${this.config.accessToken}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DeliveryError(`WhatsApp Cloud API no respondió: ${(error as Error).message}`, false);
    }
    if (!response.ok) throw await deliveryErrorFrom(response, 'WhatsApp Cloud API');
    return (await response.json()) as Record<string, unknown>;
  }

  async sendQuoteTemplate(message: WhatsAppTemplateMessage): Promise<SendResult> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([new Uint8Array(message.document.content)], { type: 'application/pdf' }), message.document.filename);
    const media = await this.call('media', { method: 'POST', body: form });
    if (typeof media.id !== 'string') throw new DeliveryError('WhatsApp no devolvió el id del documento.', false);

    const sent = await this.call('messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'template',
        template: {
          name: this.config.templateName,
          language: { code: this.config.templateLanguage },
          components: [
            { type: 'header', parameters: [{ type: 'document', document: { id: media.id, filename: message.document.filename } }] },
            { type: 'body', parameters: message.bodyParams.map((text) => ({ type: 'text', text })) },
          ],
        },
      }),
    });
    const id = (sent.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (!id) throw new DeliveryError('WhatsApp no devolvió el id del mensaje.', false);
    return { providerMessageId: id, simulated: false };
  }
}
