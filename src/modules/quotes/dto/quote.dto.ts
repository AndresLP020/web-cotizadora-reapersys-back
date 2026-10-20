import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { SUBSCRIPTION_PLANS, type SubscriptionPlan } from '../../pricing/subscription-plans';
import { PAYMENT_MODES, type PaymentMode } from '../engine/engine.types';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateIf,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator';
import { SOLUTION_KINDS } from '../../catalog/catalog.constants';

const SLUG = /^[a-z0-9-]{1,80}$/;
const VARIANT_KEY = /^[a-z0-9-]{1,80}(\/[a-z0-9-]{1,80})?$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/** Objeto plano { clave: opción } con claves y valores tipo slug (máx. 20 entradas). */
function IsVariantMap(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isVariantMap',
      target: object.constructor,
      propertyName,
      options: { message: 'variants debe ser un objeto { grupo: opción } con slugs válidos.', ...options },
      validator: {
        validate(value: unknown) {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          return (
            entries.length <= 20 &&
            entries.every(([key, option]) => VARIANT_KEY.test(key) && typeof option === 'string' && SLUG.test(option))
          );
        },
      },
    });
}

export class SelectedComponentDto {
  @ApiProperty({ example: 'web-section' })
  @Matches(SLUG)
  slug!: string;

  @ApiProperty({ description: 'Cantidad TOTAL deseada (incluye lo que ya trae el paquete).', example: 6 })
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;
}

export class QuoteSelectionDto {
  @ApiPropertyOptional({ enum: PAYMENT_MODES, default: 'purchase', description: 'subscription = renta mensual con plazo mínimo.' })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  paymentMode?: PaymentMode;

  @ApiPropertyOptional({ enum: SUBSCRIPTION_PLANS, default: 'monthly', description: 'Plan de la suscripción: mensual, semestral o anual.' })
  @IsOptional()
  @IsIn(SUBSCRIPTION_PLANS)
  subscriptionPlan?: SubscriptionPlan;

  @ApiPropertyOptional({ nullable: true, description: 'null = comenzar desde cero.', example: 'landing-start' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(SLUG)
  packageSlug?: string | null;

  @ApiPropertyOptional({ example: { equipo: 'b' }, description: 'Combos: { "slugIncluido/grupo": opción }.' })
  @IsOptional()
  @IsVariantMap()
  variants?: Record<string, string>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(SLUG, { each: true })
  removedComponents?: string[];

  @ApiPropertyOptional({ type: [SelectedComponentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SelectedComponentDto)
  components?: SelectedComponentDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(SLUG, { each: true })
  recurring?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Dominio u hosting con los que el cliente ya cuenta (no se cobran).', example: ['domain-annual'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(SLUG, { each: true })
  clientProvided?: string[];
}

export class PreviewQuoteDto {
  @ApiProperty({ type: QuoteSelectionDto })
  @ValidateNested()
  @Type(() => QuoteSelectionDto)
  selection!: QuoteSelectionDto;
}

export class QuoteClientDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional()
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;

  @ApiProperty()
  @Transform(trim)
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional()
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^\+?[\d\s-]{10,20}$/, { message: 'El teléfono no es válido.' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Número de WhatsApp con lada internacional, solo dígitos (10 a 15).' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s+-]/g, '') || undefined : value))
  @IsOptional()
  @Matches(/^\d{10,15}$/, { message: 'El número de WhatsApp no es válido.' })
  whatsapp?: string;

  @ApiPropertyOptional({ description: 'Código ISO de país, p. ej. MX.', example: 'MX' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  country?: string;
}

export class QuoteConsentsDto {
  @ApiProperty({ description: 'Uso de datos para preparar y dar seguimiento a la cotización. Debe ser true.' })
  @IsBoolean()
  @Equals(true, { message: 'Se requiere el consentimiento para preparar tu cotización.' })
  contact!: boolean;

  @ApiPropertyOptional({ description: 'Autoriza recibir la cotización por WhatsApp.' })
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;
}

export class QuoteChannelsDto {
  @ApiProperty()
  @IsBoolean()
  email!: boolean;

  @ApiProperty()
  @IsBoolean()
  whatsapp!: boolean;
}

export class CreateQuoteDto extends PreviewQuoteDto {
  @ApiPropertyOptional({ example: 'tiendas-abarrotes' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(SLUG)
  industry?: string;

  @ApiPropertyOptional({ enum: [...SOLUTION_KINDS, 'unsure'] })
  @IsOptional()
  @IsIn([...SOLUTION_KINDS, 'unsure'])
  solution?: string;

  @ApiProperty({ type: QuoteClientDto })
  @ValidateNested()
  @Type(() => QuoteClientDto)
  client!: QuoteClientDto;

  @ApiPropertyOptional({ maxLength: 2000 })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string;

  @ApiProperty({ type: QuoteConsentsDto })
  @ValidateNested()
  @Type(() => QuoteConsentsDto)
  consents!: QuoteConsentsDto;

  @ApiProperty({ type: QuoteChannelsDto })
  @ValidateNested()
  @Type(() => QuoteChannelsDto)
  channels!: QuoteChannelsDto;

  @ApiPropertyOptional({ description: 'Registrar la solicitud aunque haya componentes incompatibles, para valoración personalizada.' })
  @IsOptional()
  @IsBoolean()
  requestEvaluation?: boolean;

  /** Honeypot antibots: debe enviarse vacío. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class AccessTokenParam {
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Enlace de cotización inválido.' })
  token!: string;
}
