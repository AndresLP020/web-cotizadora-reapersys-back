import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { type Model, type PipelineStage, Types } from 'mongoose';
import { generatePublicReference } from '../../common/security/public-reference';
import { AppConfigService } from '../../config/app-config.service';
import { containsText, inValues, trusted } from '../../database/query-operators';
import { actorOf, type AuthenticatedUser } from '../../security/auth.types';
import { pageOf, type Paged } from '../admin/admin.dto';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/schemas/audit-log.schema';
import { Client } from '../clients/schemas/client.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { addDays, addMonths, daysBetween, DUE_SOON_DAYS, isValidDay, lastMonths, localHour, localToday, monthOf, parseDay, toDay } from './billing-dates';
import type { ContractListQuery, CreateContractDto, RegisterPaymentDto, UpdateContractDto } from './billing.dto';
import { balanceOf, type ContractListItem, toContractListItem } from './contract-view';
import { Contract, type ContractStatus } from './schemas/contract.schema';
import { ContractPayment } from './schemas/contract-payment.schema';

type Doc<T> = T & { _id: Types.ObjectId };

/** Ventana de "próximos cobros" del reporte. */
const UPCOMING_DAYS = 30;

function day(value: string, label: string): Date {
  if (!isValidDay(value)) throw new BadRequestException(`${label}: la fecha no existe.`);
  return parseDay(value);
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(Contract.name) private readonly contracts: Model<Contract>,
    @InjectModel(ContractPayment.name) private readonly payments: Model<ContractPayment>,
    @InjectModel(Client.name) private readonly clients: Model<Client>,
    @InjectModel(AuditLog.name) private readonly auditLogs: Model<AuditLog>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  // ------------------------------------------------------------------ consultas

  async list(query: ContractListQuery): Promise<Paged<ContractListItem>> {
    const { page, pageSize, skip } = pageOf(query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    if (query.due) {
      const today = localToday();
      filter.status = 'active';
      filter.nextDueDate =
        query.due === 'overdue'
          ? trusted({ $ne: null, $lt: parseDay(today) })
          : trusted({ $gte: parseDay(today), $lte: parseDay(addDays(today, DUE_SOON_DAYS)) });
    }
    if (query.q) {
      const matching = await this.clients
        .find({ $or: [{ name: containsText(query.q) }, { email: containsText(query.q) }, { company: containsText(query.q) }] })
        .select({ _id: 1 })
        .limit(200)
        .lean<{ _id: Types.ObjectId }[]>();
      filter.$or = [{ reference: containsText(query.q) }, { packageName: containsText(query.q) }, { client: inValues(matching.map((c) => c._id)) }];
    }

    // Próximo cobro primero; los contratos sin cobro pendiente, al final.
    const pipeline: PipelineStage[] = [
      { $match: filter },
      { $addFields: { noDue: { $cond: [{ $eq: [{ $ifNull: ['$nextDueDate', null] }, null] }, 1, 0] } } },
      { $sort: { noDue: 1, nextDueDate: 1, createdAt: -1 } },
      { $skip: skip },
      { $limit: pageSize },
    ];
    const [items, total] = await Promise.all([this.contracts.aggregate<Doc<Contract>>(pipeline), this.contracts.countDocuments(filter)]);
    return { page, pageSize, total, items: await this.withClients(items) };
  }

  async detail(id: string) {
    const contract = await this.contracts.findById(id).lean<Doc<Contract>>();
    if (!contract) throw new NotFoundException('Contrato no encontrado.');
    const [client, payments, reminders, history] = await Promise.all([
      this.clients.findById(contract.client).lean<Doc<Client>>(),
      this.payments.find({ contract: contract._id }).sort({ paidAt: -1, createdAt: -1 }).lean<Doc<ContractPayment>[]>(),
      this.notifications.listForContract(contract._id),
      this.auditLogs.find({ entityType: 'contract', entityId: contract._id }).sort({ createdAt: -1 }).limit(100).lean<Doc<AuditLog>[]>(),
    ]);
    return {
      ...toContractListItem(contract, client),
      client: client
        ? { id: client._id.toString(), name: client.name, company: client.company, email: client.email, phone: client.phone }
        : null,
      packageId: contract.package?.toString() ?? null,
      quoteId: contract.quote?.toString() ?? null,
      termMonths: contract.termMonths,
      remindersEnabled: contract.remindersEnabled,
      notes: contract.notes,
      payments: payments.map((p) => ({
        id: p._id.toString(),
        amountCents: p.amountCents,
        paidAt: p.paidAt,
        method: p.method,
        reference: p.reference,
        note: p.note,
        periods: p.periods,
        coveredDueDate: p.coveredDueDate,
        voided: p.voided,
        voidReason: p.voidReason,
        recordedBy: p.recordedBy,
        createdAt: p.createdAt,
      })),
      reminders,
      history: history.map((h) => ({ action: h.action, actor: h.actor.label, at: h.createdAt, after: h.after })),
      emailSimulated: this.notifications.emailSimulated,
    };
  }

  // ------------------------------------------------------------------ altas y cambios

  async create(user: AuthenticatedUser, dto: CreateContractDto) {
    const client = await this.resolveClient(dto);
    const startDate = day(dto.startDate, 'Fecha de inicio');
    const base = {
      reference: generatePublicReference('CT'),
      type: dto.type,
      status: 'active' as ContractStatus,
      client: client._id,
      package: dto.packageId ? new Types.ObjectId(dto.packageId) : undefined,
      packageName: dto.packageName,
      quote: dto.quoteId ? new Types.ObjectId(dto.quoteId) : undefined,
      startDate,
      remindersEnabled: dto.remindersEnabled ?? true,
      notes: dto.notes,
      createdBy: user.email,
    };

    let doc;
    if (dto.type === 'rental') {
      const firstDue = dto.firstDueDate ? day(dto.firstDueDate, 'Primer vencimiento') : startDate;
      doc = await this.contracts.create({
        ...base,
        monthlyCents: dto.monthlyCents,
        billingMonths: dto.billingMonths ?? 1,
        billingDay: firstDue.getUTCDate(),
        termMonths: dto.termMonths ?? 0,
        nextDueDate: firstDue,
      });
    } else {
      const balanceDue = dto.balanceDueDate ? day(dto.balanceDueDate, 'Fecha límite del saldo') : null;
      doc = await this.contracts.create({ ...base, totalCents: dto.totalCents, billingMonths: 1, balanceDueDate: balanceDue, nextDueDate: balanceDue });
    }

    await this.audit.record({
      action: 'contract.created',
      entityType: 'contract',
      entityId: doc._id,
      actor: actorOf(user),
      after: { reference: doc.reference, type: doc.type, client: client.email, packageName: doc.packageName, monthlyCents: doc.monthlyCents, totalCents: doc.totalCents },
    });
    return this.detail(doc._id.toString());
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateContractDto) {
    const contract = await this.contracts.findById(id).lean<Doc<Contract>>();
    if (!contract) throw new NotFoundException('Contrato no encontrado.');
    const isRental = contract.type === 'rental';
    if (!isRental && (dto.monthlyCents !== undefined || dto.billingMonths !== undefined)) {
      throw new BadRequestException('La mensualidad y la periodicidad solo aplican a rentas.');
    }
    if (isRental && dto.totalCents !== undefined) throw new BadRequestException('El precio total solo aplica a compras.');

    const set: Record<string, unknown> = {};
    for (const key of ['status', 'packageName', 'monthlyCents', 'billingMonths', 'totalCents', 'termMonths', 'remindersEnabled', 'notes'] as const) {
      if (dto[key] !== undefined) set[key] = dto[key];
    }
    if (dto.nextDueDate !== undefined) {
      const next = dto.nextDueDate === null ? null : day(dto.nextDueDate, 'Próximo cobro');
      set.nextDueDate = next;
      if (next && isRental) set.billingDay = next.getUTCDate();
      if (!isRental) set.balanceDueDate = next;
    }
    // Compra: cambiar el total puede liquidarla o reabrirla.
    if (!isRental && dto.totalCents !== undefined && dto.status === undefined) {
      const balance = dto.totalCents - contract.paidCents;
      if (balance <= 0 && contract.status === 'active') Object.assign(set, { status: 'completed', nextDueDate: null });
      if (balance > 0 && contract.status === 'completed') Object.assign(set, { status: 'active', nextDueDate: contract.balanceDueDate });
    }
    if (Object.keys(set).length === 0) return this.detail(id);

    await this.contracts.updateOne({ _id: contract._id }, { $set: set });
    // El cambio de estado se audita por separado (contract.status_changed) del resto de los campos.
    const current = contract as unknown as Record<string, unknown>;
    const { status, ...fields } = set;
    if (status !== undefined && status !== contract.status) {
      await this.audit.record({ action: 'contract.status_changed', entityType: 'contract', entityId: contract._id, actor: actorOf(user), before: { status: contract.status }, after: { status } });
    }
    if (Object.keys(fields).length > 0) {
      const before = Object.fromEntries(Object.keys(fields).map((k) => [k, current[k]]));
      await this.audit.record({ action: 'contract.updated', entityType: 'contract', entityId: contract._id, actor: actorOf(user), before, after: fields });
    }
    return this.detail(id);
  }

  // ------------------------------------------------------------------ pagos

  async registerPayment(user: AuthenticatedUser, id: string, dto: RegisterPaymentDto) {
    const contract = await this.contracts.findById(id).lean<Doc<Contract>>();
    if (!contract) throw new NotFoundException('Contrato no encontrado.');
    if (contract.status === 'cancelled') throw new BadRequestException('No se pueden registrar pagos en un contrato cancelado.');
    const paidAt = day(dto.paidAt, 'Fecha de pago');
    const isRental = contract.type === 'rental';
    const periods = isRental ? (dto.periods ?? 1) : 0;
    if (!isRental && dto.periods !== undefined) throw new BadRequestException('Los periodos solo aplican a rentas.');

    const payment = await this.payments.create({
      contract: contract._id,
      client: contract.client,
      contractType: contract.type,
      amountCents: dto.amountCents,
      paidAt,
      method: dto.method,
      reference: dto.reference,
      note: dto.note,
      periods,
      coveredDueDate: isRental ? contract.nextDueDate : null,
      recordedBy: user.email,
    });

    const paidCents = await this.recalculatePaid(contract._id);
    const set: Record<string, unknown> = { paidCents };
    if (isRental && contract.nextDueDate) {
      set.nextDueDate = addMonths(contract.nextDueDate, periods * contract.billingMonths, contract.billingDay);
    }
    if (!isRental && (contract.totalCents ?? 0) - paidCents <= 0) Object.assign(set, { status: 'completed', nextDueDate: null });
    await this.contracts.updateOne({ _id: contract._id }, { $set: set });

    await this.audit.record({
      action: 'contract.payment_registered',
      entityType: 'contract',
      entityId: contract._id,
      actor: actorOf(user),
      after: { paymentId: payment._id.toString(), amountCents: dto.amountCents, paidAt: dto.paidAt, method: dto.method, periods, nextDueDate: set.nextDueDate ?? contract.nextDueDate },
    });
    return this.detail(id);
  }

  /** Anula un pago. Si era el último de una renta, el vencimiento vuelve al que había cubierto. */
  async voidPayment(user: AuthenticatedUser, id: string, paymentId: string, reason: string) {
    const contract = await this.contracts.findById(id).lean<Doc<Contract>>();
    if (!contract) throw new NotFoundException('Contrato no encontrado.');
    const payment = await this.payments.findOneAndUpdate(
      { _id: paymentId, contract: contract._id, voided: false },
      { $set: { voided: true, voidReason: reason, voidedBy: user.email, voidedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!payment) throw new BadRequestException('El pago no existe o ya estaba anulado.');

    const paidCents = await this.recalculatePaid(contract._id);
    const set: Record<string, unknown> = { paidCents };
    if (contract.type === 'rental' && payment.coveredDueDate && contract.nextDueDate) {
      const advanced = addMonths(payment.coveredDueDate, payment.periods * contract.billingMonths, contract.billingDay);
      if (toDay(advanced) === toDay(contract.nextDueDate)) set.nextDueDate = payment.coveredDueDate;
    }
    if (contract.type === 'purchase' && (contract.totalCents ?? 0) - paidCents > 0 && contract.status === 'completed') {
      Object.assign(set, { status: 'active', nextDueDate: contract.balanceDueDate });
    }
    await this.contracts.updateOne({ _id: contract._id }, { $set: set });
    await this.audit.record({
      action: 'contract.payment_voided',
      entityType: 'contract',
      entityId: contract._id,
      actor: actorOf(user),
      after: { paymentId, amountCents: payment.amountCents, reason },
    });
    return this.detail(id);
  }

  private async recalculatePaid(contractId: Types.ObjectId): Promise<number> {
    const [row] = await this.payments.aggregate<{ total: number }>([
      { $match: { contract: contractId, voided: false } },
      { $group: { _id: null, total: { $sum: '$amountCents' } } },
    ]);
    return row?.total ?? 0;
  }

  // ------------------------------------------------------------------ recordatorios

  /** Recordatorio inmediato al cliente, solicitado desde el panel. */
  async remindNow(user: AuthenticatedUser, id: string) {
    const contract = await this.contracts.findById(id).lean<Doc<Contract>>();
    if (!contract) throw new NotFoundException('Contrato no encontrado.');
    if (contract.status !== 'active' || !contract.nextDueDate) throw new BadRequestException('El contrato no tiene un cobro pendiente.');
    const client = await this.clients.findById(contract.client).lean<Doc<Client>>();
    if (!client) throw new BadRequestException('El contrato no tiene un cliente válido.');
    // El envío manual se respeta aunque los recordatorios automáticos estén desactivados (no los reactiva).
    await this.notifications.enqueue({
      channel: 'email',
      kind: 'payment_reminder',
      recipient: client.email,
      contract: contract._id,
      dueDate: contract.nextDueDate,
      idempotencyKey: `manual:reminder:${randomUUID()}`,
      requestedBy: user.email,
    });
    await this.audit.record({ action: 'contract.reminder_requested', entityType: 'contract', entityId: contract._id, actor: actorOf(user), after: { dueDate: toDay(contract.nextDueDate) } });
    return this.detail(id);
  }

  /**
   * Encola los recordatorios del día (idempotente: se puede ejecutar cada hora). No hace nada antes
   * de BILLING_REMINDER_HOUR. Devuelve cuántos recordatorios a clientes encoló (incluye ya existentes).
   */
  async runReminders(now = new Date()): Promise<{ clientReminders: number; digest: boolean }> {
    if (localHour(now) < this.config.get('BILLING_REMINDER_HOUR')) return { clientReminders: 0, digest: false };
    const today = localToday(now);
    const before = this.config.get('BILLING_REMINDER_DAYS_BEFORE');
    const after = this.config.get('BILLING_REMINDER_DAYS_AFTER');
    const contracts = await this.contracts
      .find({ status: 'active', remindersEnabled: true, nextDueDate: trusted({ $ne: null }) })
      .lean<Doc<Contract>[]>();
    const clients = await this.clients.find({ _id: inValues(contracts.map((c) => c.client)) }).lean<Doc<Client>[]>();
    const clientById = new Map(clients.map((c) => [c._id.toString(), c]));

    let clientReminders = 0;
    let pendingForAdmin = false;
    for (const contract of contracts) {
      const dueDay = toDay(contract.nextDueDate!);
      const days = daysBetween(today, dueDay);
      if (days <= DUE_SOON_DAYS) pendingForAdmin = true;
      const applies = days >= 0 ? before.includes(days) : after.includes(-days);
      const client = clientById.get(contract.client.toString());
      if (!applies || !client) continue;
      await this.notifications.enqueue({
        channel: 'email',
        kind: 'payment_reminder',
        recipient: client.email,
        contract: contract._id,
        dueDate: contract.nextDueDate!,
        idempotencyKey: `reminder:${contract._id.toString()}:${dueDay}:${days}`,
        requestedBy: 'system',
      });
      clientReminders += 1;
    }

    const adminEmail = this.config.get('EMAIL_ADMIN_NOTIFY');
    const digest = Boolean(adminEmail && pendingForAdmin);
    if (digest) {
      await this.notifications.enqueue({ channel: 'email', kind: 'admin_billing_digest', recipient: adminEmail!, idempotencyKey: `billing-digest:${today}`, requestedBy: 'system' });
    }
    if (clientReminders > 0 || digest) this.logger.log(`Recordatorios de cobranza del ${today}: ${clientReminders} a clientes${digest ? ' + resumen al administrador' : ''}.`);
    return { clientReminders, digest };
  }

  // ------------------------------------------------------------------ reportes

  async summary(months = 12) {
    const now = new Date();
    const today = localToday(now);
    const monthKeys = lastMonths(today, months);
    const thisMonth = monthKeys.at(-1)!;
    const lastMonth = lastMonths(today, 2)[0]!;
    const firstMonth = months >= 2 ? monthKeys[0]! : lastMonth;

    const [active, payments] = await Promise.all([
      this.contracts.find({ status: 'active' }).lean<Doc<Contract>[]>(),
      this.payments.find({ voided: false, paidAt: trusted({ $gte: parseDay(`${firstMonth}-01`) }) }).select({ amountCents: 1, paidAt: 1, contractType: 1 }).lean<Doc<ContractPayment>[]>(),
    ]);
    const items = await this.withClients(active, now);

    const income = new Map(monthKeys.map((m) => [m, { month: m, rentalCents: 0, purchaseCents: 0 }]));
    const collected = new Map<string, number>();
    for (const p of payments) {
      const key = monthOf(p.paidAt);
      collected.set(key, (collected.get(key) ?? 0) + p.amountCents);
      const bucket = income.get(key);
      if (bucket) bucket[p.contractType === 'rental' ? 'rentalCents' : 'purchaseCents'] += p.amountCents;
    }

    const sum = (list: ContractListItem[]) => list.reduce((acc, c) => acc + (c.chargeCents ?? 0), 0);
    const overdue = items.filter((c) => c.dueState === 'overdue').sort((a, b) => a.daysUntilDue! - b.daysUntilDue!);
    const dueSoon = items.filter((c) => c.dueState === 'due_soon');
    const upcoming = items.filter((c) => c.daysUntilDue !== null && c.daysUntilDue >= 0 && c.daysUntilDue <= UPCOMING_DAYS).sort((a, b) => a.daysUntilDue! - b.daysUntilDue!);
    const rentals = active.filter((c) => c.type === 'rental');
    const purchases = active.filter((c) => c.type === 'purchase');

    return {
      activeRentals: rentals.length,
      monthlyRecurringCents: rentals.reduce((acc, c) => acc + (c.monthlyCents ?? 0), 0),
      overdue: { count: overdue.length, amountCents: sum(overdue) },
      dueSoon: { count: dueSoon.length, amountCents: sum(dueSoon) },
      collectedThisMonthCents: collected.get(thisMonth) ?? 0,
      collectedLastMonthCents: collected.get(lastMonth) ?? 0,
      outstandingPurchasesCents: purchases.reduce((acc, c) => acc + (balanceOf(c) ?? 0), 0),
      activePurchases: purchases.length,
      incomeByMonth: [...income.values()],
      overdueContracts: overdue.slice(0, 10),
      upcomingContracts: upcoming.slice(0, 10),
    };
  }

  // ------------------------------------------------------------------ auxiliares

  private async withClients(contracts: Doc<Contract>[], now = new Date()): Promise<ContractListItem[]> {
    const clients = await this.clients.find({ _id: inValues(contracts.map((c) => c.client)) }).lean<Doc<Client>[]>();
    const byId = new Map(clients.map((c) => [c._id.toString(), c]));
    return contracts.map((c) => toContractListItem(c, byId.get(c.client.toString()), now));
  }

  /** Cliente existente o nuevo; un correo ya registrado reutiliza el cliente (sin sobrescribir sus datos). */
  private async resolveClient(dto: CreateContractDto): Promise<Doc<Client>> {
    if (dto.newClient) {
      const email = dto.newClient.email.toLowerCase();
      const existing = await this.clients.findOne({ email }).lean<Doc<Client>>();
      if (existing) return existing;
      const created = await this.clients.create({ email, name: dto.newClient.name, phone: dto.newClient.phone, company: dto.newClient.company });
      return created.toObject();
    }
    const client = await this.clients.findById(dto.clientId).lean<Doc<Client>>();
    if (!client) throw new BadRequestException('El cliente no existe.');
    return client;
  }
}

