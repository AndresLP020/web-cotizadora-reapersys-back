import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { containsText, inValues, trusted } from '../../database/query-operators';
import { actorOf, type AuthenticatedUser } from '../../security/auth.types';
import { AuditLog } from '../audit/schemas/audit-log.schema';
import { AuditService } from '../audit/audit.service';
import { Client } from '../clients/schemas/client.schema';
import { Lead, type LeadStatus } from '../leads/schemas/lead.schema';
import type { QuoteSelectionDto } from '../quotes/dto/quote.dto';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { DeliveryChannel } from '../notifications/schemas/notification-delivery.schema';
import { QuotesService } from '../quotes/quotes.service';
import { Quote, type QuoteStatus } from '../quotes/schemas/quote.schema';
import { QuoteVersion } from '../quotes/schemas/quote-version.schema';
import { type PageQuery, pageOf, type Paged } from './admin.dto';

type Doc<T> = T & { _id: Types.ObjectId };

/** Transiciones manuales permitidas. "issued" solo se alcanza con un cálculo completo (revisión). */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  needs_review: ['rejected', 'cancelled'],
  issued: ['sent', 'approved', 'rejected', 'cancelled'],
  sent: ['approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: [],
  expired: ['cancelled'],
  cancelled: [],
};

/** "Vencida" es un estado derivado: emitida/enviada con vigencia pasada. */
function effectiveStatus(quote: Pick<Quote, 'status' | 'validUntil'>, now = Date.now()): QuoteStatus {
  return (quote.status === 'issued' || quote.status === 'sent') && quote.validUntil !== null && quote.validUntil.getTime() < now
    ? 'expired'
    : quote.status;
}

@Injectable()
export class SalesAdminService {
  constructor(
    @InjectModel(Quote.name) private readonly quotes: Model<Quote>,
    @InjectModel(QuoteVersion.name) private readonly versions: Model<QuoteVersion>,
    @InjectModel(Client.name) private readonly clients: Model<Client>,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(AuditLog.name) private readonly auditLogs: Model<AuditLog>,
    private readonly quotesService: QuotesService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ cotizaciones

  async listQuotes(query: PageQuery & { status?: string }): Promise<Paged<unknown>> {
    const { page, pageSize, skip } = pageOf(query);
    const filter: Record<string, unknown> = {};
    if (query.status === 'expired') {
      filter.status = inValues(['issued', 'sent']);
      filter.validUntil = trusted({ $lt: new Date() });
    } else if (query.status) {
      filter.status = query.status;
    }
    if (query.q) {
      const matching = await this.clients
        .find({ $or: [{ name: containsText(query.q) }, { email: containsText(query.q) }, { company: containsText(query.q) }] })
        .select({ _id: 1 })
        .limit(200)
        .lean<{ _id: Types.ObjectId }[]>();
      filter.$or = [{ folio: containsText(query.q) }, { client: inValues(matching.map((c) => c._id)) }];
    }

    const [quotes, total] = await Promise.all([
      this.quotes.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean<Doc<Quote>[]>(),
      this.quotes.countDocuments(filter),
    ]);
    const clients = await this.clients.find({ _id: inValues(quotes.map((q) => q.client)) }).lean<Doc<Client>[]>();
    const clientById = new Map(clients.map((c) => [c._id.toString(), c]));

    return {
      page,
      pageSize,
      total,
      items: quotes.map((q) => {
        const client = clientById.get(q.client.toString());
        return {
          id: q._id.toString(),
          folio: q.folio,
          status: effectiveStatus(q),
          client: client ? { id: client._id.toString(), name: client.name, company: client.company, email: client.email } : null,
          packageName: q.summary.packageName,
          totalCents: q.summary.totalCents,
          hasPendingAmounts: q.summary.hasPendingAmounts,
          reviewReasonCodes: q.summary.reviewReasonCodes,
          paymentMode: q.summary.paymentMode ?? 'purchase',
          monthlyCents: q.summary.monthlyCents ?? null,
          version: q.currentVersion,
          createdAt: q.createdAt,
          validUntil: q.validUntil,
        };
      }),
    };
  }

  async quoteDetail(id: string) {
    const quote = await this.quotes.findById(id).lean<Doc<Quote>>();
    if (!quote) throw new NotFoundException('Cotización no encontrada.');
    const [client, lead, versions, history, deliveries] = await Promise.all([
      this.clients.findById(quote.client).lean<Doc<Client>>(),
      quote.lead ? this.leads.findById(quote.lead).lean<Doc<Lead>>() : null,
      this.versions.find({ quote: quote._id }).sort({ version: -1 }).lean<Doc<QuoteVersion>[]>(),
      this.auditLogs.find({ entityType: 'quote', entityId: quote._id }).sort({ createdAt: -1 }).limit(100).lean<Doc<AuditLog>[]>(),
      this.notifications.listForQuote(quote._id),
    ]);
    const status = effectiveStatus(quote);
    return {
      id: quote._id.toString(),
      folio: quote.folio,
      status,
      allowedTransitions: QUOTE_TRANSITIONS[status],
      industry: quote.industry,
      solution: quote.solution,
      comments: quote.comments,
      channels: quote.channels,
      validUntil: quote.validUntil,
      accessExpiresAt: quote.access.expiresAt,
      createdAt: quote.createdAt,
      currentVersion: quote.currentVersion,
      client: client
        ? { id: client._id.toString(), name: client.name, company: client.company, email: client.email, phone: client.phone, whatsapp: client.whatsapp, country: client.country }
        : null,
      lead: lead ? { id: lead._id.toString(), status: lead.status, reference: lead.reference } : null,
      versions: versions.map((v) => ({ version: v.version, reason: v.reason, createdBy: v.createdBy, createdAt: v.createdAt, selection: v.selection, calculation: v.calculation })),
      deliveries,
      integrations: { emailSimulated: this.notifications.emailSimulated, whatsappSimulated: this.notifications.whatsappSimulated },
      history: history.map((h) => ({ action: h.action, actor: h.actor.label, at: h.createdAt, after: h.after })),
    };
  }

  async changeQuoteStatus(user: AuthenticatedUser, id: string, next: QuoteStatus, note?: string) {
    const quote = await this.quotes.findById(id);
    if (!quote) throw new NotFoundException('Cotización no encontrada.');
    const current = effectiveStatus(quote);
    if (!QUOTE_TRANSITIONS[current].includes(next)) {
      throw new BadRequestException(`No se puede cambiar una cotización de "${current}" a "${next}".`);
    }
    quote.status = next;
    await quote.save();
    await this.audit.record({ action: 'quote.status_changed', entityType: 'quote', entityId: quote._id, actor: actorOf(user), before: { status: current }, after: { status: next, note } });
    if (next === 'approved' && quote.lead) {
      await this.leads.updateOne({ _id: quote.lead }, { $set: { status: 'converted' } });
    }
    return { status: next };
  }

  reviseQuote(user: AuthenticatedUser, id: string, selection: QuoteSelectionDto, reason: string) {
    return this.quotesService.revise(new Types.ObjectId(id), selection, actorOf(user), reason);
  }

  sendQuote(user: AuthenticatedUser, id: string, channels: DeliveryChannel[]) {
    return this.notifications.requestQuoteSend(new Types.ObjectId(id), channels, actorOf(user));
  }

  retryDelivery(user: AuthenticatedUser, deliveryId: string) {
    return this.notifications.retry(new Types.ObjectId(deliveryId), actorOf(user));
  }

  quotePdf(id: string, version?: number) {
    return this.documents.getQuotePdf(new Types.ObjectId(id), version);
  }

  // ------------------------------------------------------------------ clientes

  async listClients(query: PageQuery): Promise<Paged<unknown>> {
    const { page, pageSize, skip } = pageOf(query);
    const filter = query.q ? { $or: [{ name: containsText(query.q) }, { email: containsText(query.q) }, { company: containsText(query.q) }] } : {};
    const [clients, total] = await Promise.all([
      this.clients.find(filter).sort({ lastRequestAt: -1, createdAt: -1 }).skip(skip).limit(pageSize).lean<Doc<Client>[]>(),
      this.clients.countDocuments(filter),
    ]);
    const counts = await this.quotes.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { client: { $in: clients.map((c) => c._id) } } },
      { $group: { _id: '$client', count: { $sum: 1 } } },
    ]);
    const countById = new Map(counts.map((c) => [c._id.toString(), c.count]));
    return {
      page,
      pageSize,
      total,
      items: clients.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        company: c.company,
        email: c.email,
        phone: c.phone,
        whatsapp: c.whatsapp,
        quotes: countById.get(c._id.toString()) ?? 0,
        lastRequestAt: c.lastRequestAt,
      })),
    };
  }

  async clientDetail(id: string) {
    const client = await this.clients.findById(id).lean<Doc<Client>>();
    if (!client) throw new NotFoundException('Cliente no encontrado.');
    const quotes = await this.quotes.find({ client: client._id }).sort({ createdAt: -1 }).lean<Doc<Quote>[]>();
    return {
      id: client._id.toString(),
      name: client.name,
      company: client.company,
      email: client.email,
      phone: client.phone,
      whatsapp: client.whatsapp,
      country: client.country,
      consents: client.consents,
      quotes: quotes.map((q) => ({ id: q._id.toString(), folio: q.folio, status: effectiveStatus(q), packageName: q.summary.packageName, totalCents: q.summary.totalCents, createdAt: q.createdAt })),
    };
  }

  // ------------------------------------------------------------------ prospectos

  async listLeads(query: PageQuery & { status?: string; source?: string }): Promise<Paged<unknown>> {
    const { page, pageSize, skip } = pageOf(query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.source) filter.source = query.source;
    if (query.q) filter.$or = [{ name: containsText(query.q) }, { email: containsText(query.q) }, { company: containsText(query.q) }, { reference: containsText(query.q) }];
    const [leads, total] = await Promise.all([
      this.leads.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean<Doc<Lead>[]>(),
      this.leads.countDocuments(filter),
    ]);
    return {
      page,
      pageSize,
      total,
      items: leads.map((l) => ({
        id: l._id.toString(),
        reference: l.reference,
        name: l.name,
        company: l.company,
        email: l.email,
        phone: l.phone,
        industry: l.industry,
        interest: l.interest,
        message: l.message,
        source: l.source,
        status: l.status,
        quoteId: l.quote?.toString() ?? null,
        createdAt: l.createdAt,
      })),
    };
  }

  async updateLeadStatus(user: AuthenticatedUser, id: string, status: LeadStatus) {
    const lead = await this.leads.findById(id);
    if (!lead) throw new NotFoundException('Prospecto no encontrado.');
    if (lead.status === status) return { status };
    const before = lead.status;
    lead.status = status;
    await lead.save();
    await this.audit.record({ action: 'lead.status_changed', entityType: 'lead', entityId: lead._id, actor: actorOf(user), before: { status: before }, after: { status } });
    return { status };
  }

}
