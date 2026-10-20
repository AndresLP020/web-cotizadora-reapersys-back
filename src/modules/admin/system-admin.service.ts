import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { inValues, trusted } from '../../database/query-operators';
import { actorOf, type AuthenticatedUser } from '../../security/auth.types';
import { hashPassword, passwordPolicyError } from '../../security/password';
import type { Role } from '../../security/roles';
import { Session } from '../../security/schemas/session.schema';
import { User } from '../../security/schemas/user.schema';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/schemas/audit-log.schema';
import { Component } from '../catalog/schemas/component.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { ComponentPrice } from '../pricing/schemas/component-price.schema';
import { PackagePrice } from '../pricing/schemas/package-price.schema';
import { planSettingsOf } from '../pricing/subscription-plans';
import { Quote, type QuoteStatus } from '../quotes/schemas/quote.schema';
import { BusinessSettings } from '../settings/schemas/business-settings.schema';
import { type PageQuery, pageOf } from './admin.dto';

type Doc<T> = T & { _id: Types.ObjectId };
const DAY_MS = 86_400_000;

export interface SettingsPatch {
  tradeName?: string;
  legalName?: string;
  legalAddress?: string;
  /** Publicar o retirar el aviso de privacidad. */
  privacyNoticePublished?: boolean;
  tax?: { rateBp: number; treatment: 'exclusive' | 'inclusive'; confirmed: boolean };
  quote?: { depositRateBp: number; validityDays: number | null };
  warranty?: { referenceDays: number | null; confirmed: boolean };
  commercialTerms?: string[];
  contact?: { email?: string; whatsapp?: string; facebook?: string; instagram?: string; tiktok?: string };
  /** Suscripción: plazo mínimo y recargo de financiamiento (puntos base) para la mensualidad sugerida. */
  rental?: { minimumTermMonths: number; financingBp: number; monthToMonthSurchargeBp: number; semiannualDiscountBp: number; annualDiscountBp: number };
}

@Injectable()
export class SystemAdminService {
  constructor(
    @InjectModel(BusinessSettings.name) private readonly settings: Model<BusinessSettings>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(AuditLog.name) private readonly auditLogs: Model<AuditLog>,
    @InjectModel(Quote.name) private readonly quotes: Model<Quote>,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(Component.name) private readonly components: Model<Component>,
    @InjectModel(ComponentPrice.name) private readonly componentPrices: Model<ComponentPrice>,
    @InjectModel(PackagePrice.name) private readonly packagePrices: Model<PackagePrice>,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ tablero

  /** Indicadores calculados con datos reales de la base. Nada es estimado ni de ejemplo. */
  async dashboard() {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [byStatus, expired, quotes30, monthIssued, newLeads, leads30, pendingPricing, componentDrafts, packageDrafts, perDay, recentQuotes, recentLeads, settings] =
      await Promise.all([
        this.quotes.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        this.quotes.countDocuments({ status: inValues<QuoteStatus>(['issued', 'sent']), validUntil: trusted({ $lt: now }) }),
        this.quotes.countDocuments({ createdAt: trusted({ $gte: since30 }) }),
        this.quotes.aggregate<{ count: number; totalCents: number }>([
          { $match: { createdAt: { $gte: monthStart }, status: { $in: ['issued', 'sent', 'approved'] }, 'summary.hasPendingAmounts': false } },
          { $group: { _id: null, count: { $sum: 1 }, totalCents: { $sum: '$summary.totalCents' } } },
        ]),
        this.leads.countDocuments({ status: 'new' }),
        this.leads.countDocuments({ createdAt: trusted({ $gte: since30 }) }),
        this.components.countDocuments({ status: 'active', pricingStatus: 'pending_pricing' }),
        this.componentPrices.countDocuments({ status: 'draft' }),
        this.packagePrices.countDocuments({ status: 'draft' }),
        this.quotes.aggregate<{ _id: string; count: number }>([
          { $match: { createdAt: { $gte: since30 } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Mexico_City' } }, count: { $sum: 1 } } },
        ]),
        this.quotes.find().sort({ createdAt: -1 }).limit(6).select({ folio: 1, status: 1, summary: 1, createdAt: 1 }).lean<Doc<Quote>[]>(),
        this.leads.find().sort({ createdAt: -1 }).limit(6).select({ reference: 1, name: 1, company: 1, source: 1, status: 1, createdAt: 1 }).lean<Doc<Lead>[]>(),
        this.settings.findOne({ key: 'default' }).lean<BusinessSettings>(),
      ]);

    const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count])) as Record<string, number>;
    const dayCounts = new Map(perDay.map((d) => [d._id, d.count]));
    const days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(now.getTime() - (29 - i) * DAY_MS).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
      return { date, count: dayCounts.get(date) ?? 0 };
    });

    const alerts: { code: string; message: string; href: string }[] = [];
    if (!settings?.quote.validityDays) alerts.push({ code: 'validity_missing', message: 'Define la vigencia de las cotizaciones para poder emitirlas.', href: '/admin/configuracion' });
    if (pendingPricing > 0) alerts.push({ code: 'pending_pricing', message: `${pendingPricing} componentes activos sin precio aprobado.`, href: '/admin/precios?pricing=pending' });
    if (componentDrafts + packageDrafts > 0) alerts.push({ code: 'drafts', message: `${componentDrafts + packageDrafts} borradores de precio sin publicar.`, href: '/admin/precios' });

    return {
      quotes: {
        byStatus: { ...counts, expired },
        needsReview: counts.needs_review ?? 0,
        last30Days: quotes30,
        issuedThisMonth: monthIssued[0]?.count ?? 0,
        issuedValueThisMonthCents: monthIssued[0]?.totalCents ?? 0,
        perDay: days,
      },
      leads: { new: newLeads, last30Days: leads30 },
      catalog: { pendingPricing, drafts: componentDrafts + packageDrafts },
      alerts,
      recentQuotes: recentQuotes.map((q) => ({ id: q._id.toString(), folio: q.folio, status: q.status, packageName: q.summary.packageName, totalCents: q.summary.totalCents, hasPendingAmounts: q.summary.hasPendingAmounts, createdAt: q.createdAt })),
      recentLeads: recentLeads.map((l) => ({ id: l._id.toString(), reference: l.reference, name: l.name, company: l.company, source: l.source, status: l.status, createdAt: l.createdAt })),
    };
  }

  // ------------------------------------------------------------------ configuración

  async getSettings() {
    const settings = await this.settings.findOne({ key: 'default' }).lean<BusinessSettings>();
    if (!settings) throw new NotFoundException('La configuración no se ha inicializado (ejecute npm run db:seed).');
    return pickSettings(settings);
  }

  async updateSettings(user: AuthenticatedUser, patch: SettingsPatch) {
    const current = await this.settings.findOne({ key: 'default' }).lean<BusinessSettings>();
    if (!current) throw new NotFoundException('La configuración no se ha inicializado.');
    if (patch.tax?.confirmed && patch.tax.rateBp === undefined) throw new BadRequestException('Indica la tasa de IVA.');

    const set: Record<string, unknown> = {};
    if (patch.tradeName !== undefined) set.tradeName = patch.tradeName;
    if (patch.legalName !== undefined) set.legalName = patch.legalName;
    if (patch.tax) set.tax = patch.tax;
    if (patch.quote) set.quote = { ...current.quote, ...patch.quote };
    if (patch.warranty) set.warranty = patch.warranty;
    if (patch.commercialTerms) set.commercialTerms = patch.commercialTerms.map((t) => t.trim()).filter(Boolean);
    if (patch.contact) set.contact = patch.contact;
    if (patch.legalAddress !== undefined) set.legalAddress = patch.legalAddress;
    if (patch.rental) set.rental = patch.rental;

    // Aviso de privacidad: solo se publica con los datos del responsable completos. Cambiar esos
    // datos mientras está publicado actualiza la fecha de la versión vigente del aviso.
    const wasPublished = current.privacyNotice?.published === true;
    const willPublish = patch.privacyNoticePublished ?? wasPublished;
    if (willPublish) {
      const legalName = (patch.legalName ?? current.legalName ?? '').trim();
      const legalAddress = (patch.legalAddress ?? current.legalAddress ?? '').trim();
      const email = (patch.contact ? patch.contact.email : current.contact.email) ?? '';
      if (!legalName || !legalAddress || !email) {
        throw new BadRequestException('Para publicar el aviso de privacidad se requieren razón social, domicilio y correo de contacto.');
      }
      const dataChanged =
        legalName !== (current.legalName ?? '') || legalAddress !== (current.legalAddress ?? '') || email !== (current.contact.email ?? '');
      if (!wasPublished || dataChanged) set.privacyNotice = { published: true, publishedAt: new Date() };
    } else if (wasPublished) {
      set.privacyNotice = { published: false, publishedAt: current.privacyNotice.publishedAt };
    }
    if (Object.keys(set).length === 0) return pickSettings(current);

    const updated = await this.settings.findOneAndUpdate({ key: 'default' }, { $set: set }, { returnDocument: 'after', runValidators: true }).lean<Doc<BusinessSettings>>();
    const before = Object.fromEntries(Object.keys(set).map((key) => [key, (current as unknown as Record<string, unknown>)[key]]));
    await this.audit.record({ action: 'settings.updated', entityType: 'settings', entityId: updated!._id, actor: actorOf(user), before, after: set });
    return pickSettings(updated!);
  }

  // ------------------------------------------------------------------ usuarios

  async listUsers() {
    const users = await this.users.find().sort({ createdAt: 1 }).lean<Doc<User>[]>();
    return { items: users.map(userView) };
  }

  async createUser(actor: AuthenticatedUser, input: { email: string; name: string; role: Role; password: string }) {
    const policy = passwordPolicyError(input.password);
    if (policy) throw new BadRequestException(policy);
    const email = input.email.trim().toLowerCase();
    if (await this.users.exists({ email })) throw new ConflictException('Ya existe un usuario con ese correo.');
    const user = await this.users.create({ email, name: input.name, role: input.role, passwordHash: await hashPassword(input.password), active: true, passwordChangedAt: new Date() });
    await this.audit.record({ action: 'user.created', entityType: 'user', entityId: user._id, actor: actorOf(actor), after: { email, role: input.role } });
    return userView(user.toObject());
  }

  async updateUser(actor: AuthenticatedUser, id: string, patch: { name?: string; role?: Role; active?: boolean; password?: string }) {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    const self = user._id.equals(actor.id);
    if (self && (patch.active === false || (patch.role && patch.role !== user.role))) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta ni cambiar tu propio rol.');
    }
    // Siempre debe quedar al menos un propietario activo.
    const losesOwner = user.role === 'owner' && user.active && (patch.active === false || (patch.role !== undefined && patch.role !== 'owner'));
    if (losesOwner && (await this.users.countDocuments({ role: 'owner', active: true })) <= 1) {
      throw new BadRequestException('Debe existir al menos un propietario activo.');
    }

    const before = { name: user.name, role: user.role, active: user.active };
    if (patch.name !== undefined) user.name = patch.name;
    if (patch.role !== undefined) user.role = patch.role;
    if (patch.active !== undefined) user.active = patch.active;
    if (patch.active === true) {
      user.failedLogins = 0;
      user.lockedUntil = null;
    }
    if (patch.password !== undefined) {
      const policy = passwordPolicyError(patch.password);
      if (policy) throw new BadRequestException(policy);
      user.passwordHash = await hashPassword(patch.password);
      user.passwordChangedAt = new Date();
    }
    await user.save();
    // Cambios de rol, desactivación o contraseña cierran sus sesiones abiertas.
    if (patch.role !== undefined || patch.active === false || patch.password !== undefined) await this.sessions.deleteMany({ user: user._id });

    await this.audit.record({
      action: 'user.updated',
      entityType: 'user',
      entityId: user._id,
      actor: actorOf(actor),
      before,
      after: { name: user.name, role: user.role, active: user.active, passwordReset: patch.password !== undefined },
    });
    return userView(user.toObject());
  }

  // ------------------------------------------------------------------ auditoría

  async listAudit(query: PageQuery & { entityType?: string }) {
    const { page, pageSize, skip } = pageOf(query);
    const filter: Record<string, unknown> = {};
    if (query.entityType) filter.entityType = query.entityType;
    const [items, total] = await Promise.all([
      this.auditLogs.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean<Doc<AuditLog>[]>(),
      this.auditLogs.countDocuments(filter),
    ]);
    return {
      page,
      pageSize,
      total,
      items: items.map((a) => ({ id: a._id.toString(), action: a.action, entityType: a.entityType, entityId: a.entityId.toString(), actor: a.actor.label, before: a.before, after: a.after, at: a.createdAt })),
    };
  }
}

function pickSettings(s: BusinessSettings) {
  return {
    tradeName: s.tradeName,
    legalName: s.legalName ?? '',
    legalAddress: s.legalAddress ?? '',
    privacyNotice: { published: s.privacyNotice?.published ?? false, publishedAt: s.privacyNotice?.publishedAt ?? null },
    currency: s.currency,
    tax: { rateBp: s.tax.rateBp, treatment: s.tax.treatment, confirmed: s.tax.confirmed },
    quote: { depositRateBp: s.quote.depositRateBp, validityDays: s.quote.validityDays, folioPrefix: s.quote.folioPrefix },
    warranty: { referenceDays: s.warranty.referenceDays, confirmed: s.warranty.confirmed },
    commercialTerms: [...s.commercialTerms],
    rental: { ...planSettingsOf(s.rental), financingBp: s.rental?.financingBp ?? 0 },
    contact: { ...s.contact },
  };
}

function userView(u: Doc<User>) {
  return {
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    locked: u.lockedUntil !== null && u.lockedUntil > new Date(),
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
  };
}
