import { BadRequestException, ConflictException, GoneException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import type { ClientSession, Model, Types } from 'mongoose';
import { generateAccessToken } from '../../common/security/public-reference';
import { seal } from '../../common/security/secret-box';
import { AppConfigService } from '../../config/app-config.service';
import { DocumentsService, type StoredPdf } from '../documents/documents.service';
import { NotificationsService, QUOTE_TOKEN_CONTEXT } from '../notifications/notifications.service';
import { DatabaseService } from '../../database/database.service';
import { type Actor, AuditService } from '../audit/audit.service';
import { Client } from '../clients/schemas/client.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { SettingsService } from '../settings/settings.service';
import { CatalogSnapshotLoader } from './catalog-snapshot.loader';
import type { CreateQuoteDto, QuoteSelectionDto } from './dto/quote.dto';
import { type QuoteCalculation, type QuoteSelection, QuoteSelectionError } from './engine/engine.types';
import { calculateQuote } from './engine/quote-engine';
import { type CreateQuoteResult, type PublicCalculation, type PublicQuoteView, toPublicCalculation } from './public-quote.mapper';
import { Counter } from './schemas/counter.schema';
import { Quote, type QuoteStatus } from './schemas/quote.schema';
import { QuoteVersion } from './schemas/quote-version.schema';

/** Versión vigente del texto de consentimiento del cotizador. */
export const QUOTE_CONSENT_VERSION = 'quote-2026-10';
/** Días que el enlace sigue activo cuando la cotización no tiene vigencia (pendiente de revisión). */
const PENDING_ACCESS_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Estados finales: ya no admiten nuevas versiones. */
export const CLOSED_STATUSES: readonly QuoteStatus[] = ['approved', 'rejected', 'cancelled'];

type Doc<T> = T & { _id: Types.ObjectId };

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @InjectModel(Quote.name) private readonly quotes: Model<Quote>,
    @InjectModel(QuoteVersion.name) private readonly versions: Model<QuoteVersion>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    @InjectModel(Client.name) private readonly clients: Model<Client>,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    private readonly loader: CatalogSnapshotLoader,
    private readonly settings: SettingsService,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly config: AppConfigService,
  ) {}

  /** Cálculo autoritativo con los precios vigentes. Nada se persiste. */
  async preview(selection: QuoteSelectionDto): Promise<PublicCalculation> {
    return toPublicCalculation(await this.calculate(normalizeSelection(selection)));
  }

  async create(dto: CreateQuoteDto): Promise<CreateQuoteResult> {
    if (dto.website && dto.website.trim().length > 0) throw new BadRequestException('Solicitud inválida.');
    if (dto.channels.whatsapp && (!dto.consents.whatsapp || !dto.client.whatsapp)) {
      throw new BadRequestException('Para recibir la cotización por WhatsApp indica tu número y autoriza el envío.');
    }

    const selection = normalizeSelection(dto.selection);
    const calculation = await this.calculate(selection);
    if (calculation.status === 'blocked' && !dto.requestEvaluation) {
      throw new UnprocessableEntityException({
        message: 'La selección incluye componentes incompatibles. Ajústala o solicita una valoración personalizada.',
        blockingIssues: calculation.blockingIssues,
      });
    }

    const settings = await this.settings.get();
    const status: QuoteStatus = calculation.status === 'priced' ? 'issued' : 'needs_review';
    const now = new Date();
    const validUntil = status === 'issued' && settings.quote.validityDays ? new Date(now.getTime() + settings.quote.validityDays * DAY_MS) : null;
    const accessExpiresAt = validUntil ?? new Date(now.getTime() + PENDING_ACCESS_DAYS * DAY_MS);
    const accessToken = generateAccessToken();
    const actor: Actor = { type: 'system', label: 'quote_builder' };

    const quote = await this.database.withTransaction(
      async (session) => {
        const folio = await this.nextFolio(settings.quote.folioPrefix, now, session);
        const client = await this.upsertClient(dto, now, session);

        const [quote] = await this.quotes.create(
          [
            {
              folio,
              status,
              client: client._id,
              currentVersion: 1,
              industry: dto.industry,
              solution: dto.solution,
              comments: dto.comments,
              channels: { email: dto.channels.email, whatsapp: dto.channels.whatsapp },
              access: {
                tokenHash: hashAccessToken(accessToken),
                expiresAt: accessExpiresAt,
                tokenCiphertext: seal(accessToken, this.config.get('SESSION_SECRET'), QUOTE_TOKEN_CONTEXT),
              },
              validUntil,
              summary: summarize(calculation),
            },
          ],
          { session: session ?? undefined },
        );

        await this.versions.create(
          [{ quote: quote!._id, version: 1, selection, calculation, reason: 'Solicitud del cliente', createdBy: actor.label }],
          { session: session ?? undefined },
        );

        const [lead] = await this.leads.create(
          [
            {
              reference: folio,
              name: dto.client.name,
              company: dto.client.company,
              email: dto.client.email,
              phone: dto.client.phone,
              industry: dto.industry,
              interest: dto.solution,
              message: dto.comments ?? `Solicitud de cotización ${folio}`,
              source: 'quote_builder',
              status: 'new',
              consent: { contact: true, textVersion: QUOTE_CONSENT_VERSION, acceptedAt: now },
              client: client._id,
              quote: quote!._id,
            },
          ],
          { session: session ?? undefined },
        );
        await this.quotes.updateOne({ _id: quote!._id }, { $set: { lead: lead!._id } }, { session: session ?? undefined });

        await this.audit.record(
          { action: 'quote.created', entityType: 'quote', entityId: quote!._id, actor, after: { folio, status, version: 1, summary: summarize(calculation) } },
          session,
        );
        return quote!;
      },
      { requireTransaction: true },
    );

    this.logger.log(`Cotización ${quote.folio} registrada (${status}).`);
    // Los envíos se encolan después de confirmar la transacción: nunca se envía algo que no quedó guardado.
    const scheduled = await this.notifications.scheduleForNewQuote(quote._id);

    return {
      folio: quote.folio,
      status,
      validUntil: validUntil?.toISOString() ?? null,
      accessToken,
      accessPath: `/cotizacion/${accessToken}`,
      accessExpiresAt: accessExpiresAt.toISOString(),
      calculation: toPublicCalculation(calculation),
      // Las entregas se implementan en la Fase 6. Se informa el estado real: no se envió nada.
      deliveries: {
        pdf: { status: 'available', message: status === 'issued' ? 'Descárgalo desde el enlace de tu cotización.' : 'Disponible como documento preliminar desde el enlace.' },
        ...scheduled,
      },
    };
  }

  /** PDF de la versión vigente mediante el enlace seguro. */
  async getPdfByAccessToken(token: string): Promise<StoredPdf> {
    const quote = await this.findByAccessToken(token);
    return this.documents.getQuotePdf(quote._id);
  }

  private async findByAccessToken(token: string): Promise<Doc<Quote>> {
    const quote = await this.quotes.findOne({ 'access.tokenHash': hashAccessToken(token) }).lean<Doc<Quote>>();
    if (!quote) throw new NotFoundException('Cotización no encontrada.');
    if (quote.access.expiresAt.getTime() < Date.now()) throw new GoneException('El enlace de esta cotización ha vencido.');
    return quote;
  }

  /** Vista pública mediante token. El token se compara por su hash; los enlaces vencidos responden 410. */
  async getByAccessToken(token: string): Promise<PublicQuoteView> {
    const quote = await this.findByAccessToken(token);

    const [version, client, settings] = await Promise.all([
      this.versions.findOne({ quote: quote._id, version: quote.currentVersion }).lean<Doc<QuoteVersion>>(),
      this.clients.findById(quote.client).lean<Doc<Client>>(),
      this.settings.get(),
    ]);
    if (!version || !client) throw new NotFoundException('Cotización no encontrada.');

    const expired = quote.status === 'issued' && quote.validUntil !== null && quote.validUntil.getTime() < Date.now();
    return {
      folio: quote.folio,
      status: expired ? 'expired' : quote.status,
      version: quote.currentVersion,
      createdAt: quote.createdAt.toISOString(),
      validUntil: quote.validUntil?.toISOString() ?? null,
      client: { name: client.name, company: client.company },
      industry: quote.industry,
      calculation: toPublicCalculation(version.calculation),
      terms: [...settings.commercialTerms],
      business: { tradeName: settings.tradeName },
    };
  }

  /**
   * Nueva versión con los precios VIGENTES (modificación posterior). La versión anterior
   * conserva intactos sus importes. Lo usará el panel administrativo (Fase 5).
   */
  async revise(quoteId: Types.ObjectId, selectionDto: QuoteSelectionDto, actor: Actor, reason: string) {
    const selection = normalizeSelection(selectionDto);
    const calculation = await this.calculate(selection);
    const settings = await this.settings.get();

    return this.database.withTransaction(
      async (session) => {
        const quote = await this.quotes.findById(quoteId).session(session);
        if (!quote) throw new NotFoundException('Cotización no encontrada.');
        if (CLOSED_STATUSES.includes(quote.status)) {
          throw new ConflictException('La cotización está cerrada (aprobada, rechazada o cancelada); crea una nueva solicitud.');
        }
        const version = quote.currentVersion + 1;
        await this.versions.create([{ quote: quote._id, version, selection, calculation, reason, createdBy: actor.label }], {
          session: session ?? undefined,
        });

        const status: QuoteStatus = calculation.status === 'priced' ? 'issued' : 'needs_review';
        const validUntil = status === 'issued' && settings.quote.validityDays ? new Date(Date.now() + settings.quote.validityDays * DAY_MS) : null;
        const before = { version: quote.currentVersion, status: quote.status, summary: quote.summary };
        quote.currentVersion = version;
        quote.status = status;
        quote.validUntil = validUntil;
        if (validUntil && validUntil > quote.access.expiresAt) quote.access.expiresAt = validUntil;
        quote.summary = summarize(calculation);
        await quote.save({ session });

        await this.audit.record(
          { action: 'quote.revised', entityType: 'quote', entityId: quote._id, actor, before, after: { version, status, summary: quote.summary, reason } },
          session,
        );
        return { folio: quote.folio, version, status, calculation: toPublicCalculation(calculation) };
      },
      { requireTransaction: true },
    );
  }

  listVersions(quoteId: Types.ObjectId) {
    return this.versions.find({ quote: quoteId }).sort({ version: 1 }).lean<Doc<QuoteVersion>[]>();
  }

  private async calculate(selection: QuoteSelection): Promise<QuoteCalculation> {
    const snapshot = await this.loader.load();
    try {
      return calculateQuote(snapshot, selection);
    } catch (error) {
      if (error instanceof QuoteSelectionError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Folio por año: RS-2026-00001. El contador es atómico ($inc) dentro de la transacción. */
  private async nextFolio(prefix: string, now: Date, session: ClientSession | null): Promise<string> {
    const year = now.getUTCFullYear();
    const counter = await this.counters.findOneAndUpdate(
      { _id: `quote-folio-${year}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', session },
    );
    return `${prefix}-${year}-${String(counter.seq).padStart(5, '0')}`;
  }

  /** Alta o actualización del cliente por correo, agregando los consentimientos otorgados. */
  private async upsertClient(dto: CreateQuoteDto, now: Date, session: ClientSession | null) {
    const consents = [
      { channel: 'contact', granted: true, textVersion: QUOTE_CONSENT_VERSION, at: now, source: 'quote_builder' },
      ...(dto.channels.email ? [{ channel: 'email', granted: true, textVersion: QUOTE_CONSENT_VERSION, at: now, source: 'quote_builder' }] : []),
      ...(dto.consents.whatsapp ? [{ channel: 'whatsapp', granted: true, textVersion: QUOTE_CONSENT_VERSION, at: now, source: 'quote_builder' }] : []),
    ];
    const client = await this.clients.findOneAndUpdate(
      { email: dto.client.email.toLowerCase() },
      {
        $set: {
          name: dto.client.name,
          ...(dto.client.company ? { company: dto.client.company } : {}),
          ...(dto.client.phone ? { phone: dto.client.phone } : {}),
          ...(dto.client.whatsapp ? { whatsapp: dto.client.whatsapp } : {}),
          ...(dto.client.country ? { country: dto.client.country.toUpperCase() } : {}),
          lastRequestAt: now,
        },
        $push: { consents: { $each: consents } },
        $setOnInsert: { email: dto.client.email.toLowerCase() },
      },
      { upsert: true, returnDocument: 'after', session, runValidators: true },
    );
    return client;
  }
}

function normalizeSelection(dto: QuoteSelectionDto): QuoteSelection {
  return {
    paymentMode: dto.paymentMode ?? 'purchase',
    ...(dto.paymentMode === 'subscription' ? { subscriptionPlan: dto.subscriptionPlan ?? 'monthly' } : {}),
    packageSlug: dto.packageSlug ?? null,
    variants: { ...(dto.variants ?? {}) },
    removedComponents: [...(dto.removedComponents ?? [])],
    components: (dto.components ?? []).map((c) => ({ slug: c.slug, quantity: c.quantity })),
    recurring: [...(dto.recurring ?? [])],
    clientProvided: [...(dto.clientProvided ?? [])],
  };
}

function summarize(calculation: QuoteCalculation) {
  return {
    packageName: calculation.package?.name ?? 'Solución personalizada',
    totalCents: calculation.totals.totalCents,
    hasPendingAmounts: calculation.totals.hasPendingAmounts,
    reviewReasonCodes: calculation.reviewReasons.map((r) => r.code),
    paymentMode: calculation.paymentMode,
    monthlyCents: calculation.subscription?.monthlyCents ?? null,
    subscriptionPlan: calculation.subscription?.plan ?? null,
  };
}
