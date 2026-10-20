import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../admin/admin.dto';
import { BILLING_MONTHS, type BillingMonths, CONTRACT_STATUSES, CONTRACT_TYPES, type ContractStatus, type ContractType } from './schemas/contract.schema';
import { PAYMENT_METHODS, type PaymentMethod } from './schemas/contract-payment.schema';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = { message: 'La fecha debe tener el formato AAAA-MM-DD.' };
const MAX_CENTS = 100_000_000_00; // 100 millones de pesos
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : trim({ value }));
const toInt = ({ value }: { value: unknown }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);

export class ContractListQuery extends PageQuery {
  @IsOptional() @IsIn(CONTRACT_STATUSES) status?: ContractStatus;
  @IsOptional() @IsIn(CONTRACT_TYPES) type?: ContractType;
  @IsOptional() @IsIn(['overdue', 'due_soon']) due?: 'overdue' | 'due_soon';
}

export class NewClientDto {
  @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @Transform(trim) @IsEmail({}, { message: 'El correo del cliente no es válido.' }) @MaxLength(254) email!: string;
  @Transform(emptyToUndefined) @IsOptional() @Matches(/^\+?[\d\s-]{10,20}$/, { message: 'El teléfono no es válido.' }) phone?: string;
  @Transform(emptyToUndefined) @IsOptional() @IsString() @MaxLength(160) company?: string;
}

export class CreateContractDto {
  @IsIn(CONTRACT_TYPES) type!: ContractType;

  @ValidateIf((o: CreateContractDto) => !o.newClient)
  @IsMongoId({ message: 'Selecciona un cliente o captura uno nuevo.' })
  clientId?: string;

  @IsOptional() @ValidateNested() @Type(() => NewClientDto) newClient?: NewClientDto;

  @IsOptional() @IsMongoId() packageId?: string;
  @Transform(trim) @IsString() @Length(2, 160) packageName!: string;
  @Matches(DAY, DAY_MESSAGE) startDate!: string;

  @ValidateIf((o: CreateContractDto) => o.type === 'rental')
  @IsInt({ message: 'La mensualidad es obligatoria en una renta.' })
  @Min(1)
  @Max(MAX_CENTS)
  monthlyCents?: number;

  @IsOptional() @IsIn(BILLING_MONTHS) billingMonths?: BillingMonths;
  @IsOptional() @Matches(DAY, DAY_MESSAGE) firstDueDate?: string;
  @IsOptional() @IsInt() @Min(0) @Max(120) termMonths?: number;

  @ValidateIf((o: CreateContractDto) => o.type === 'purchase')
  @IsInt({ message: 'El precio total es obligatorio en una compra.' })
  @Min(1)
  @Max(MAX_CENTS)
  totalCents?: number;

  @IsOptional() @Matches(DAY, DAY_MESSAGE) balanceDueDate?: string;
  @IsOptional() @IsMongoId() quoteId?: string;
  @IsOptional() @IsBoolean() remindersEnabled?: boolean;
  @Transform(emptyToUndefined) @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateContractDto {
  @IsOptional() @IsIn(CONTRACT_STATUSES) status?: ContractStatus;
  @Transform(trim) @IsOptional() @IsString() @Length(2, 160) packageName?: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_CENTS) monthlyCents?: number;
  @IsOptional() @IsIn(BILLING_MONTHS) billingMonths?: BillingMonths;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_CENTS) totalCents?: number;
  /** null quita el próximo cobro. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DAY, DAY_MESSAGE) nextDueDate?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(120) termMonths?: number;
  @IsOptional() @IsBoolean() remindersEnabled?: boolean;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RegisterPaymentDto {
  @IsInt({ message: 'El importe debe estar en centavos enteros.' }) @Min(1) @Max(MAX_CENTS) amountCents!: number;
  @Matches(DAY, DAY_MESSAGE) paidAt!: string;
  @IsIn(PAYMENT_METHODS) method!: PaymentMethod;
  @Transform(emptyToUndefined) @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @Transform(emptyToUndefined) @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsInt() @Min(1) @Max(24) periods?: number;
}

export class VoidPaymentDto {
  @Transform(trim) @IsString() @Length(3, 300, { message: 'Indica el motivo (3 a 300 caracteres).' }) reason!: string;
}

export class PaymentParam {
  @IsMongoId({ message: 'Identificador inválido.' }) id!: string;
  @IsMongoId({ message: 'Identificador inválido.' }) paymentId!: string;
}

export class SummaryQuery {
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(24) months?: number;
}
