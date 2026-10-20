import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { Model, Types } from 'mongoose';
import { formatMXN } from '../../common/money/money';
import { open } from '../../common/security/secret-box';
import { AppConfigService } from '../../config/app-config.service';
import { inValues, trusted } from '../../database/query-operators';
import { type Actor, AuditService } from '../audit/audit.service';
import { addDays, daysBetween, localToday, parseDay, toDay } from '../billing/billing-dates';
import { chargeOf } from '../billing/contract-view';
import { Contract } from '../billing/schemas/contract.schema';
import { Client } from '../clients/schemas/client.schema';
import { DocumentsService } from '../documents/documents.service';
import { Lead } from '../leads/schemas/lead.schema';
import { Quote } from '../quotes/schemas/quote.schema';
import { QuoteVersion } from '../quotes/schemas/quote-version.schema';
import { BusinessSettings } from '../settings/schemas/business-settings.schema';
import { Testimonial } from '../testimonials/schemas/testimonial.schema';
import {
  adminBillingDigestEmail,
  adminNewLeadEmail,
  adminNewQuoteEmail,
  adminNewTestimonialEmail,
  type DigestRow,
  monthlyLabel,
  paymentReminderEmail,
  quoteIssuedEmail,
  quoteReceivedEmail,
} from './email-templates';
import {
  DeliveryError,
  DeliverySkipped,
  EMAIL_PROVIDER,
  type EmailProvider,
  maskRecipient,
  type SendResult,
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from './providers/provider.types';
import {
  type DeliveryChannel,
  type DeliveryKind,
  type DeliveryStatus,
  NotificationDelivery,
} from './schemas/notification-delivery.schema';

type Doc<T> = T & { _id: Types.ObjectId };

export const QUOTE_TOKEN_CONTEXT = 'quote-access-token';
const LOCK_MS = 2 * 60_000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;
/** Orden de los estados confirmados por webhook: un evento tardío nunca retrocede el estado. */
const PROGRESS: Partial<Record<DeliveryStatus, number>> = { sent: 1, delivered: 2, read: 3 };

export interface EnqueueInput {
  channel: DeliveryChannel;
  kind: DeliveryKind;
  recipient: string;
  idempotencyKey: string;
  requestedBy: string;
  quote?: Types.ObjectId;
  quoteVersion?: number;
  lead?: Types.ObjectId;
  contract?: Types.ObjectId;
  /** Vencimiento al que se refiere un recordatorio de pago. */
  dueDate?: Date;
  testimonial?: Types.ObjectId;
}

/** Días hacia adelante que cubre el resumen diario de cobranza. */
export const DIGEST_WINDOW_DAYS = 7;

/** Estado de un envío tal como se informa al cliente (sin datos internos). */
export interface PublicDeliveryState {
  status: 'not_requested' | 'not_available' | 'available' | 'queued' | 'simulated' | 'deferred' | 'sent' | 'failed';
  message: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  /** Se invoca tras encolar (el worker lo registra) para enviar sin esperar al siguiente sondeo. */
  onEnqueued: (() => void) | null = null;

  constructor(
    @InjectModel(NotificationDelivery.name) private readonly deliveries: Model<NotificationDelivery>,
    @InjectModel(Quote.name) private readonly quotes: Model<Quote>,
    @InjectModel(QuoteVersion.name) private readonly versions: Model<QuoteVersion>,
    @InjectModel(Client.name) private readonly clients: Model<Client>,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(BusinessSettings.name) private readonly settings: Model<BusinessSettings>,
    @InjectModel(Contract.name) private readonly contracts: Model<Contract>,
    @InjectModel(Testimonial.name) private readonly testimonials: Model<Testimonial>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
    private readonly documents: DocumentsService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  get emailSimulated() {
    return this.email.simulated;
  }

  get whatsappSimulated() {
    return this.whatsapp.simulated;
  }

  // ------------------------------------------------------------------ encolar

  /** Idempotente: la misma clave nunca crea dos envíos. */
  async enqueue(input: EnqueueInput): Promise<Doc<NotificationDelivery>> {
    const now = new Date();
    await this.deliveries.updateOne(
      { idempotencyKey: input.idempotencyKey },
      {
        $setOnInsert: {
          ...input,
          status: 'queued',
          attempts: 0,
          maxAttempts: this.config.get('NOTIFICATIONS_MAX_ATTEMPTS'),
          nextAttemptAt: now,
          lockedUntil: null,
          events: [{ status: 'queued', at: now }],
        },
      },
      { upsert: true },
    );
    this.onEnqueued?.();
    return (await this.deliveries.findOne({ idempotencyKey: input.idempotencyKey }).lean<Doc<NotificationDelivery>>())!;
  }

  /**
   * Envíos automáticos al registrar una cotización. Emitida: correo con PDF y WhatsApp (si se pidieron).
   * En revisión: solo un acuse por correo; WhatsApp se pospone hasta que se emita.
   */
  async scheduleForNewQuote(quoteId: Types.ObjectId): Promise<{ email: PublicDeliveryState; whatsapp: PublicDeliveryState }> {
    const quote = await this.quotes.findById(quoteId).lean<Doc<Quote>>();
    const client = quote ? await this.clients.findById(quote.client).lean<Doc<Client>>() : null;
    if (!quote || !client) throw new NotFoundException('Cotización no encontrada.');
    // Enviada o aprobada también es una cotización emitida (con importes definitivos).
    const issued = ['issued', 'sent', 'approved'].includes(quote.status);
    const key = (channel: string, kind: string) => `auto:${quote._id.toString()}:v${quote.currentVersion}:${channel}:${kind}`;

    let email: PublicDeliveryState = { status: 'not_requested', message: 'No solicitado.' };
    if (quote.channels.email) {
      const kind: DeliveryKind = issued ? 'quote_issued' : 'quote_received';
      await this.enqueue({ channel: 'email', kind, recipient: client.email, quote: quote._id, quoteVersion: quote.currentVersion, idempotencyKey: key('email', kind), requestedBy: 'system' });
      email = this.email.simulated
        ? { status: 'simulated', message: 'Modo simulado: el correo no se envía hasta configurar el proveedor de correo.' }
        : { status: 'queued', message: `Se enviará a ${maskRecipient(client.email)} en unos momentos.` };
    }

    let whatsapp: PublicDeliveryState = { status: 'not_requested', message: 'No solicitado.' };
    if (quote.channels.whatsapp) {
      if (!issued) {
        whatsapp = { status: 'deferred', message: 'Se enviará por WhatsApp cuando la cotización sea emitida.' };
      } else if (client.whatsapp && this.hasWhatsAppConsent(client)) {
        await this.enqueue({ channel: 'whatsapp', kind: 'quote_issued', recipient: client.whatsapp, quote: quote._id, quoteVersion: quote.currentVersion, idempotencyKey: key('whatsapp', 'quote_issued'), requestedBy: 'system' });
        whatsapp = this.whatsapp.simulated
          ? { status: 'simulated', message: 'Modo simulado: WhatsApp no se envía hasta configurar la API de WhatsApp Business.' }
          : { status: 'queued', message: `Se enviará a ${maskRecipient(client.whatsapp)} en unos momentos.` };
      } else {
        whatsapp = { status: 'not_available', message: 'Falta el número o la autorización para WhatsApp.' };
      }
    }

    const adminEmail = this.config.get('EMAIL_ADMIN_NOTIFY');
    if (adminEmail) {
      await this.enqueue({ channel: 'email', kind: 'admin_new_quote', recipient: adminEmail, quote: quote._id, quoteVersion: quote.currentVersion, idempotencyKey: key('admin', 'new_quote'), requestedBy: 'system' });
    }
    return { email, whatsapp };
  }

  async scheduleForNewLead(leadId: Types.ObjectId): Promise<void> {
    const adminEmail = this.config.get('EMAIL_ADMIN_NOTIFY');
    if (!adminEmail) return;
    await this.enqueue({ channel: 'email', kind: 'admin_new_lead', recipient: adminEmail, lead: leadId, idempotencyKey: `auto:lead:${leadId.toString()}`, requestedBy: 'system' });
  }

  async scheduleForNewTestimonial(testimonialId: Types.ObjectId): Promise<void> {
    const adminEmail = this.config.get('EMAIL_ADMIN_NOTIFY');
    if (!adminEmail) return;
    await this.enqueue({ channel: 'email', kind: 'admin_new_testimonial', recipient: adminEmail, testimonial: testimonialId, idempotencyKey: `auto:testimonial:${testimonialId.toString()}`, requestedBy: 'system' });
  }

  async listForContract(contractId: Types.ObjectId) {
    const items = await this.deliveries.find({ contract: contractId }).sort({ createdAt: -1 }).limit(50).lean<Doc<NotificationDelivery>[]>();
    return items.map((d) => ({
      id: d._id.toString(),
      channel: d.channel,
      kind: d.kind,
      recipient: maskRecipient(d.recipient),
      status: d.status,
      dueDate: d.dueDate ?? null,
      lastError: d.lastError ?? null,
      requestedBy: d.requestedBy,
      createdAt: d.createdAt,
    }));
  }

  /** Envío manual desde el panel de la versión vigente (solo cotizaciones emitidas o enviadas). */
  async requestQuoteSend(quoteId: Types.ObjectId, channels: DeliveryChannel[], actor: Actor) {
    const quote = await this.quotes.findById(quoteId).lean<Doc<Quote>>();
    const client = quote ? await this.clients.findById(quote.client).lean<Doc<Client>>() : null;
    if (!quote || !client) throw new NotFoundException('Cotización no encontrada.');
    if (!['issued', 'sent'].includes(quote.status)) {
      throw new BadRequestException('Solo se pueden enviar cotizaciones emitidas. Recalcúlala cuando los pendientes estén resueltos.');
    }
    if (quote.validUntil && quote.validUntil.getTime() < Date.now()) throw new BadRequestException('La cotización está vencida; crea una nueva versión.');

    const created = [];
    for (const channel of new Set(channels)) {
      let recipient: string;
      if (channel === 'whatsapp') {
        if (!client.whatsapp) throw new BadRequestException('El cliente no registró un número de WhatsApp.');
        if (!this.hasWhatsAppConsent(client)) throw new BadRequestException('El cliente no autorizó recibir la cotización por WhatsApp.');
        recipient = client.whatsapp;
      } else {
        recipient = client.email;
      }
      const delivery = await this.enqueue({
        channel,
        kind: 'quote_issued',
        recipient,
        quote: quote._id,
        quoteVersion: quote.currentVersion,
        idempotencyKey: `manual:${randomUUID()}`,
        requestedBy: actor.label,
      });
      await this.audit.record({ action: 'quote.send_requested', entityType: 'quote', entityId: quote._id, actor, after: { channel, version: quote.currentVersion, recipient: maskRecipient(recipient) } });
      created.push(delivery);
    }
    return created.map(toDeliveryView);
  }

  async retry(deliveryId: Types.ObjectId, actor: Actor) {
    const now = new Date();
    const delivery = await this.deliveries.findOneAndUpdate(
      { _id: deliveryId, status: 'failed' },
      { $set: { status: 'queued', attempts: 0, nextAttemptAt: now, lockedUntil: null }, $push: { events: { status: 'queued', at: now, detail: `Reintento solicitado por ${actor.label}` } } },
      { returnDocument: 'after' },
    );
    if (!delivery) throw new BadRequestException('Solo se pueden reintentar envíos fallidos.');
    if (delivery.quote) await this.audit.record({ action: 'delivery.retried', entityType: 'quote', entityId: delivery.quote, actor, after: { channel: delivery.channel } });
    this.onEnqueued?.();
    return toDeliveryView(delivery.toObject());
  }

  async listForQuote(quoteId: Types.ObjectId) {
    const items = await this.deliveries.find({ quote: quoteId }).sort({ createdAt: -1 }).lean<Doc<NotificationDelivery>[]>();
    return items.map(toDeliveryView);
  }

  // ------------------------------------------------------------------ procesamiento

  /** Procesa los envíos pendientes. Devuelve cuántos procesó. Seguro con varios procesos (bloqueo por documento). */
  async processDue(limit = 20): Promise<number> {
    let processed = 0;
    while (processed < limit) {
      const delivery = await this.claimNext();
      if (!delivery) break;
      await this.process(delivery);
      processed += 1;
    }
    return processed;
  }

  private claimNext() {
    const now = new Date();
    return this.deliveries
      .findOneAndUpdate(
        {
          $or: [
            { status: 'queued', nextAttemptAt: trusted({ $lte: now }) },
            // Un worker que cayó a mitad de un envío libera el bloqueo al vencer.
            { status: 'sending', lockedUntil: trusted({ $lt: now }) },
          ],
        },
        { $set: { status: 'sending', lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
        { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
      )
      .lean<Doc<NotificationDelivery>>();
  }

  private async process(delivery: Doc<NotificationDelivery>): Promise<void> {
    try {
      // Comprobación previa: un recordatorio que ya no aplica se omite sin llamar al proveedor.
      await this.assertStillApplies(delivery);
      const result = await this.dispatch(delivery);
      const status: DeliveryStatus = result.simulated ? 'simulated' : 'sent';
      await this.deliveries.updateOne(
        { _id: delivery._id },
        {
          $set: { status, provider: delivery.channel === 'email' ? this.email.name : this.whatsapp.name, providerMessageId: result.providerMessageId, lockedUntil: null, lastError: undefined },
          $push: { events: { status, at: new Date() } },
        },
      );
      // Solo un envío REAL al cliente marca la cotización como enviada.
      if (!result.simulated && delivery.kind === 'quote_issued' && delivery.quote) {
        const updated = await this.quotes.updateOne({ _id: delivery.quote, status: 'issued' }, { $set: { status: 'sent' } });
        if (updated.modifiedCount > 0) {
          await this.audit.record({ action: 'quote.status_changed', entityType: 'quote', entityId: delivery.quote, actor: { type: 'system', label: 'notifications' }, before: { status: 'issued' }, after: { status: 'sent', channel: delivery.channel } });
        }
      }
    } catch (error) {
      if (error instanceof DeliverySkipped) {
        await this.deliveries.updateOne(
          { _id: delivery._id },
          { $set: { status: 'skipped', lockedUntil: null, lastError: error.message }, $push: { events: { status: 'skipped', at: new Date(), detail: error.message.slice(0, 500) } } },
        );
        return;
      }
      const permanent = error instanceof DeliveryError ? error.permanent : false;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const exhausted = permanent || delivery.attempts >= delivery.maxAttempts;
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (delivery.attempts - 1), MAX_BACKOFF_MS);
      await this.deliveries.updateOne(
        { _id: delivery._id },
        {
          $set: exhausted
            ? { status: 'failed', lockedUntil: null, lastError: message }
            : { status: 'queued', lockedUntil: null, lastError: message, nextAttemptAt: new Date(Date.now() + backoff) },
          $push: { events: { status: exhausted ? 'failed' : 'queued', at: new Date(), detail: message.slice(0, 500) } },
        },
      );
      this.logger.warn(`Envío ${delivery._id.toString()} (${delivery.channel}/${delivery.kind}) ${exhausted ? 'falló definitivamente' : 'se reintentará'}: ${message}`);
    }
  }

  private async dispatch(delivery: Doc<NotificationDelivery>): Promise<SendResult> {
    const settings = await this.settings.findOne({ key: 'default' }).lean<BusinessSettings>();
    const tradeName = settings?.tradeName ?? 'ReaperSys';
    const appUrl = this.config.get('PUBLIC_APP_URL');

    if (delivery.kind === 'payment_reminder') return this.dispatchPaymentReminder(delivery, tradeName, settings);
    if (delivery.kind === 'admin_billing_digest') return this.dispatchBillingDigest(delivery, tradeName, `${appUrl}/admin/cobranza`);
    if (delivery.kind === 'admin_new_testimonial') {
      const testimonial = await this.testimonials.findById(delivery.testimonial).lean<Doc<Testimonial>>();
      if (!testimonial) throw new DeliverySkipped('El comentario ya no existe.');
      const mail = adminNewTestimonialEmail({ tradeName, name: testimonial.name, company: testimonial.company, rating: testimonial.rating, message: testimonial.message, adminLink: `${appUrl}/admin/testimonios` });
      return this.email.send({ to: delivery.recipient, ...mail, idempotencyKey: delivery.idempotencyKey });
    }

    if (delivery.kind === 'admin_new_lead') {
      const lead = await this.leads.findById(delivery.lead).lean<Doc<Lead>>();
      if (!lead) throw new DeliveryError('El prospecto ya no existe.', true);
      const mail = adminNewLeadEmail({ tradeName, reference: lead.reference, name: lead.name, email: lead.email, phone: lead.phone, company: lead.company, message: lead.message, adminLink: `${appUrl}/admin/prospectos` });
      return this.email.send({ to: delivery.recipient, ...mail, idempotencyKey: delivery.idempotencyKey });
    }

    const quote = await this.quotes.findById(delivery.quote).lean<Doc<Quote>>();
    const client = quote ? await this.clients.findById(quote.client).lean<Doc<Client>>() : null;
    const version = quote ? await this.versions.findOne({ quote: quote._id, version: delivery.quoteVersion ?? quote.currentVersion }).lean<Doc<QuoteVersion>>() : null;
    if (!quote || !client || !version) throw new DeliveryError('La cotización ya no existe.', true);

    const calc = version.calculation;
    const token = quote.access.tokenCiphertext ? open(quote.access.tokenCiphertext, this.config.get('SESSION_SECRET'), QUOTE_TOKEN_CONTEXT) : null;
    const link = token && quote.access.expiresAt > new Date() ? `${appUrl}/cotizacion/${token}` : null;
    const data = {
      tradeName,
      clientName: client.name,
      folio: quote.folio,
      solution: calc.package?.name ?? 'Solución personalizada',
      totalCents: calc.totals.totalCents,
      hasPendingAmounts: calc.totals.hasPendingAmounts,
      validUntil: quote.validUntil,
      link,
      // Las versiones anteriores a la suscripción no guardan estos campos.
      subscription:
        calc.paymentMode === 'subscription' && calc.subscription
          ? {
              monthlyCents: calc.subscription.monthlyCents,
              termMonths: calc.subscription.termMonths,
              planLabel: calc.subscription.planLabel,
              billingMonths: calc.subscription.billingMonths ?? 1,
              budgetCents: calc.subscription.commitmentCents,
              hostingChargeCents: calc.subscription.hostingCharge?.chargeCents ?? null,
              hostingUpfront: calc.subscription.hostingCharge?.upfront === true,
              firstPaymentCents: calc.subscription.firstPaymentCents ?? null,
              subsequentPaymentCents: calc.subscription.subsequentPaymentCents ?? calc.subscription.paymentCents ?? null,
            }
          : null,
    };

    if (delivery.kind === 'admin_new_quote') {
      const mail = adminNewQuoteEmail({ ...data, status: quote.status, clientEmail: client.email, adminLink: `${appUrl}/admin/cotizaciones/${quote._id.toString()}` });
      return this.email.send({ to: delivery.recipient, ...mail, idempotencyKey: delivery.idempotencyKey });
    }
    if (delivery.kind === 'quote_received') {
      return this.email.send({ to: delivery.recipient, ...quoteReceivedEmail(data), idempotencyKey: delivery.idempotencyKey });
    }

    // quote_issued: siempre con el PDF de la versión enviada.
    const pdf = await this.documents.getQuotePdf(quote._id, version.version);
    if (delivery.channel === 'email') {
      return this.email.send({
        to: delivery.recipient,
        ...quoteIssuedEmail(data),
        attachments: [{ filename: pdf.filename, content: pdf.content }],
        idempotencyKey: delivery.idempotencyKey,
      });
    }
    return this.whatsapp.sendQuoteTemplate({
      to: delivery.recipient,
      document: { filename: pdf.filename, content: pdf.content },
      // Parámetros de la plantilla: {{1}} nombre, {{2}} folio, {{3}} total.
      bodyParams: [
        client.name,
        quote.folio,
        data.subscription ? `${formatMXN(calc.totals.totalCents)} MXN de pago inicial + ${monthlyLabel(data.subscription)}` : `${formatMXN(calc.totals.totalCents)} MXN`,
      ],
    });
  }

  // ------------------------------------------------------------------ cobranza

  /** Un recordatorio al cliente solo se envía si el contrato sigue activo y con el mismo vencimiento pendiente. */
  private async assertStillApplies(delivery: Doc<NotificationDelivery>): Promise<void> {
    if (delivery.kind !== 'payment_reminder') return;
    const contract = await this.contracts.findById(delivery.contract).lean<Doc<Contract>>();
    if (!contract) throw new DeliverySkipped('El contrato ya no existe.');
    if (contract.status !== 'active') throw new DeliverySkipped('El contrato ya no está activo.');
    // Los envíos manuales desde el panel se respetan aunque los automáticos estén desactivados.
    if (!contract.remindersEnabled && delivery.requestedBy === 'system') throw new DeliverySkipped('Los recordatorios del contrato están desactivados.');
    if (!contract.nextDueDate || (delivery.dueDate && toDay(contract.nextDueDate) !== toDay(delivery.dueDate))) {
      throw new DeliverySkipped('El pago ya se registró o el vencimiento cambió.');
    }
  }

  private async dispatchPaymentReminder(delivery: Doc<NotificationDelivery>, tradeName: string, settings: BusinessSettings | null): Promise<SendResult> {
    const contract = await this.contracts.findById(delivery.contract).lean<Doc<Contract>>();
    const client = contract ? await this.clients.findById(contract.client).lean<Doc<Client>>() : null;
    if (!contract?.nextDueDate || !client) throw new DeliverySkipped('El contrato o el cliente ya no existen.');
    const whatsapp = settings?.contact?.whatsapp?.replace(/\D/g, '');
    const mail = paymentReminderEmail({
      tradeName,
      clientName: client.name,
      reference: contract.reference,
      packageName: contract.packageName,
      type: contract.type,
      amountCents: chargeOf(contract),
      dueDate: contract.nextDueDate,
      daysUntilDue: daysBetween(localToday(), toDay(contract.nextDueDate)),
      billingMonths: contract.billingMonths,
      contactEmail: settings?.contact?.email,
      whatsappUrl: whatsapp ? `https://wa.me/${whatsapp}` : null,
    });
    return this.email.send({ to: delivery.recipient, ...mail, idempotencyKey: delivery.idempotencyKey });
  }

  /** El resumen se arma al enviarse (refleja los pagos registrados entre el encolado y el envío). */
  private async dispatchBillingDigest(delivery: Doc<NotificationDelivery>, tradeName: string, adminLink: string): Promise<SendResult> {
    const today = localToday();
    const contracts = await this.contracts
      .find({ status: 'active', nextDueDate: trusted({ $ne: null, $lte: parseDay(addDays(today, DIGEST_WINDOW_DAYS)) }) })
      .sort({ nextDueDate: 1 })
      .limit(200)
      .lean<Doc<Contract>[]>();
    if (contracts.length === 0) throw new DeliverySkipped('No hay cobros pendientes.');
    const clients = await this.clients.find({ _id: inValues(contracts.map((c) => c.client)) }).lean<Doc<Client>[]>();
    const clientById = new Map(clients.map((c) => [c._id.toString(), c]));
    const rows: DigestRow[] = contracts.map((c) => {
      const client = clientById.get(c.client.toString());
      return {
        reference: c.reference,
        clientName: client?.name ?? '—',
        clientEmail: client?.email ?? '—',
        packageName: c.packageName,
        amountCents: chargeOf(c),
        dueDate: c.nextDueDate!,
        daysUntilDue: daysBetween(today, toDay(c.nextDueDate!)),
      };
    });
    const mail = adminBillingDigestEmail({ tradeName, overdue: rows.filter((r) => r.daysUntilDue < 0), upcoming: rows.filter((r) => r.daysUntilDue >= 0), adminLink });
    return this.email.send({ to: delivery.recipient, ...mail, idempotencyKey: delivery.idempotencyKey });
  }

  // ------------------------------------------------------------------ webhook de WhatsApp

  /** Aplica un estado reportado por Meta. Ignora retrocesos (p. ej. "delivered" después de "read"). */
  async applyProviderStatus(providerMessageId: string, status: string, at: Date, detail?: string): Promise<boolean> {
    const delivery = await this.deliveries.findOne({ providerMessageId, channel: 'whatsapp' }).lean<Doc<NotificationDelivery>>();
    if (!delivery) return false;
    const next: DeliveryStatus | null = status === 'failed' ? 'failed' : status in PROGRESS ? (status as DeliveryStatus) : null;
    if (!next) return false;
    const advances = next === 'failed' || (PROGRESS[next] ?? 0) > (PROGRESS[delivery.status] ?? 0);
    await this.deliveries.updateOne(
      { _id: delivery._id },
      {
        ...(advances ? { $set: { status: next, ...(detail ? { lastError: detail.slice(0, 1000) } : {}) } } : {}),
        $push: { events: { status: next, at, detail: detail?.slice(0, 500) } },
      },
    );
    return advances;
  }

  private hasWhatsAppConsent(client: Client): boolean {
    const latest = [...client.consents].reverse().find((c) => c.channel === 'whatsapp');
    return latest?.granted === true;
  }
}

export function toDeliveryView(d: Doc<NotificationDelivery>) {
  return {
    id: d._id.toString(),
    channel: d.channel,
    kind: d.kind,
    recipient: maskRecipient(d.recipient),
    status: d.status,
    attempts: d.attempts,
    maxAttempts: d.maxAttempts,
    quoteVersion: d.quoteVersion ?? null,
    lastError: d.lastError ?? null,
    requestedBy: d.requestedBy,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    events: d.events.map((e) => ({ status: e.status, at: e.at, detail: e.detail })),
  };
}
