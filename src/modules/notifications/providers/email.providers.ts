import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DeliveryError, deliveryErrorFrom, type EmailMessage, type EmailProvider, maskRecipient, type SendResult } from './provider.types';

const REQUEST_TIMEOUT_MS = 20_000;

/** Sin credenciales: registra el intento y NO entrega nada. */
export class SimulatedEmailProvider implements EmailProvider {
  readonly name = 'simulated';
  readonly simulated = true;
  private readonly logger = new Logger('Correo (simulado)');

  send(message: EmailMessage): Promise<SendResult> {
    this.logger.warn(`No enviado (modo simulado): "${message.subject}" → ${maskRecipient(message.to)}`);
    return Promise.resolve({ providerMessageId: `sim_${randomUUID()}`, simulated: true });
  }
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  readonly simulated = false;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DeliveryError(`Resend no respondió: ${(error as Error).message}`, false);
    }
    if (!response.ok) throw await deliveryErrorFrom(response, 'Resend');
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new DeliveryError('Resend no devolvió un identificador de mensaje.', false);
    return { providerMessageId: body.id, simulated: false };
  }
}
