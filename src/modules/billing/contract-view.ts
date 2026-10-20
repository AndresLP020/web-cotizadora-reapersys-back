import type { Types } from 'mongoose';
import type { Client } from '../clients/schemas/client.schema';
import { type DueState, daysUntil, dueStateOf } from './billing-dates';
import type { Contract } from './schemas/contract.schema';

type Doc<T> = T & { _id: Types.ObjectId };

/** Saldo pendiente de una compra (nunca negativo). */
export function balanceOf(contract: Pick<Contract, 'type' | 'totalCents' | 'paidCents'>): number | null {
  return contract.type === 'purchase' ? Math.max((contract.totalCents ?? 0) - contract.paidCents, 0) : null;
}

/** Importe del próximo cobro: renta = mensualidad × meses por pago; compra = saldo. */
export function chargeOf(contract: Pick<Contract, 'type' | 'totalCents' | 'paidCents' | 'monthlyCents' | 'billingMonths'>): number | null {
  if (contract.type === 'purchase') return balanceOf(contract);
  return contract.monthlyCents === null ? null : contract.monthlyCents * contract.billingMonths;
}

export interface ContractListItem {
  id: string;
  reference: string;
  type: Contract['type'];
  status: Contract['status'];
  client: { id: string; name: string; company?: string; email: string } | null;
  packageName: string;
  monthlyCents: number | null;
  billingMonths: number;
  chargeCents: number | null;
  totalCents: number | null;
  paidCents: number;
  balanceCents: number | null;
  nextDueDate: Date | null;
  dueState: DueState;
  daysUntilDue: number | null;
  startDate: Date;
  createdAt: Date;
}

/** Vista de listado; el estado del vencimiento solo aplica a contratos activos. */
export function toContractListItem(contract: Doc<Contract>, client: Doc<Client> | null | undefined, now = new Date()): ContractListItem {
  const days = contract.status === 'active' ? daysUntil(contract.nextDueDate, now) : null;
  return {
    id: contract._id.toString(),
    reference: contract.reference,
    type: contract.type,
    status: contract.status,
    client: client ? { id: client._id.toString(), name: client.name, company: client.company, email: client.email } : null,
    packageName: contract.packageName,
    monthlyCents: contract.type === 'rental' ? contract.monthlyCents : null,
    billingMonths: contract.type === 'rental' ? contract.billingMonths : 1,
    chargeCents: chargeOf(contract),
    totalCents: contract.type === 'purchase' ? contract.totalCents : null,
    paidCents: contract.paidCents,
    balanceCents: balanceOf(contract),
    nextDueDate: contract.nextDueDate,
    dueState: dueStateOf(days),
    daysUntilDue: days,
    startDate: contract.startDate,
    createdAt: contract.createdAt,
  };
}
