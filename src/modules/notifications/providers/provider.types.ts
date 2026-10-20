/** Contratos de los proveedores de mensajería. Las implementaciones son intercambiables. */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
  /** Evita envíos duplicados si un reintento llega después de un éxito no confirmado. */
  idempotencyKey: string;
}

export interface WhatsAppTemplateMessage {
  /** Número en formato internacional, solo dígitos. */
  to: string;
  document: { filename: string; content: Buffer };
  /** Parámetros del cuerpo de la plantilla, en orden. */
  bodyParams: string[];
}

export interface SendResult {
  providerMessageId: string;
  /** true = no se entregó nada (modo simulado). Nunca se reporta como enviado. */
  simulated: boolean;
}

export interface EmailProvider {
  readonly name: string;
  readonly simulated: boolean;
  send(message: EmailMessage): Promise<SendResult>;
}

export interface WhatsAppProvider {
  readonly name: string;
  readonly simulated: boolean;
  sendQuoteTemplate(message: WhatsAppTemplateMessage): Promise<SendResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/**
 * Error de entrega. `permanent` = no tiene caso reintentar (destinatario inválido, plantilla
 * rechazada, credenciales incorrectas); los demás se reintentan con espera creciente.
 */
export class DeliveryError extends Error {
  override name = 'DeliveryError';
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/** El envío ya no aplica (p. ej. el pago se registró antes del recordatorio): se marca como omitido, no como fallido. */
export class DeliverySkipped extends Error {
  override name = 'DeliverySkipped';
}

/** Clasifica una respuesta HTTP fallida de un proveedor. 408/429/5xx son temporales. */
export async function deliveryErrorFrom(response: Response, provider: string): Promise<DeliveryError> {
  const body = await response.text().catch(() => '');
  const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
  return new DeliveryError(`${provider} respondió ${response.status}: ${body.slice(0, 300)}`, !temporary);
}

/** Enmascara un destinatario para logs y respuestas públicas: l***@example.com, ***5678. */
export function maskRecipient(recipient: string): string {
  if (recipient.includes('@')) {
    const [user, domain] = recipient.split('@');
    return `${user!.slice(0, 1)}***@${domain}`;
  }
  return `***${recipient.slice(-4)}`;
}
