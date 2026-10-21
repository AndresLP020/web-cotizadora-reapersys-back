import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createTransport, type Transporter } from 'nodemailer';
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

export interface SmtpOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/**
 * SMTP genérico (p. ej. Gmail con contraseña de aplicación). El puerto 465 usa TLS directo;
 * los demás negocian STARTTLS. SMTP no deduplica: el Message-ID derivado de la clave de
 * idempotencia permite al menos identificar reenvíos en el buzón.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly simulated = false;
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
      requireTLS: options.port !== 465,
      auth: { user: options.user, pass: options.password },
      connectionTimeout: REQUEST_TIMEOUT_MS,
      greetingTimeout: REQUEST_TIMEOUT_MS,
      socketTimeout: REQUEST_TIMEOUT_MS,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const domain = this.options.user.split('@')[1] ?? 'localhost';
    const messageId = `<${createHash('sha256').update(message.idempotencyKey).digest('hex').slice(0, 32)}@${domain}>`;
    try {
      const info = await this.transport.sendMail({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId,
        attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
      });
      return { providerMessageId: info.messageId || messageId, simulated: false };
    } catch (error) {
      throw smtpDeliveryError(error);
    }
  }
}

/** 5xx (credenciales, destinatario rechazado) es permanente; 4xx y fallas de conexión se reintentan. */
function smtpDeliveryError(error: unknown): DeliveryError {
  const { responseCode, code, message } = error as { responseCode?: number; code?: string; message?: string };
  const permanent = code === 'EAUTH' || (typeof responseCode === 'number' && responseCode >= 500);
  return new DeliveryError(`SMTP falló${responseCode ? ` (${responseCode})` : ''}: ${(message ?? String(error)).slice(0, 300)}`, permanent);
}
