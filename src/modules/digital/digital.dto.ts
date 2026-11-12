import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../admin/admin.dto';
import { DIGITAL_KINDS, DIGITAL_OCCASIONS, type DigitalKind, TEMPLATE_STATUSES, type TemplateStatus } from './schemas/digital-template.schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};
const trimList = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? (value as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '') : value;

/** Precio máximo razonable por unidad: $1,000,000 MXN. */
const MAX_PRICE_CENTS = 100_000_000;
/** Tarjetas NFC por pedido. */
export const MAX_NFC_QUANTITY = 500;

/** Versión vigente del texto de consentimiento del formulario de pedido. */
export const DIGITAL_ORDER_CONSENT_VERSION = 'digital-order-2026-11';

export class PublicTemplatesQuery {
  @ApiPropertyOptional({ enum: DIGITAL_KINDS })
  @IsOptional()
  @IsIn(DIGITAL_KINDS)
  kind?: DigitalKind;
}

export class TemplateListQuery extends PageQuery {
  @IsOptional() @IsIn(DIGITAL_KINDS) kind?: DigitalKind;
  @IsOptional() @IsIn(TEMPLATE_STATUSES) status?: TemplateStatus;
}

export class SlugParam {
  @Matches(/^[a-z0-9-]{2,80}$/)
  slug!: string;
}

class TemplateFieldsDto {
  @ApiPropertyOptional({ maxLength: 400 })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @ApiPropertyOptional({ description: 'Precio por plantilla o por tarjeta, en centavos. null = «Por cotizar».', nullable: true })
  @IsOptional()
  @ValidateIf((o: TemplateFieldsDto) => o.priceCents !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  priceCents?: number | null;

  @ApiPropertyOptional({ description: 'Datos que el cliente llena al pedirla («Nombre de ella», «Mensaje especial»).', type: [String] })
  @IsOptional()
  @Transform(trimList)
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  customizableFields?: string[];

  @IsOptional() @IsIn(TEMPLATE_STATUSES) status?: TemplateStatus;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateTemplateDto extends TemplateFieldsDto {
  @ApiProperty({ enum: DIGITAL_KINDS })
  @IsIn(DIGITAL_KINDS)
  kind!: DigitalKind;

  @ApiProperty({ example: 'Cumpleaños Estrellas' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ description: 'Se genera a partir del nombre si no se indica.' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^[a-z0-9-]{2,80}$/, { message: 'El identificador solo admite minúsculas, números y guiones.' })
  slug?: string;

  @ApiProperty({ enum: DIGITAL_OCCASIONS })
  @IsIn(DIGITAL_OCCASIONS)
  occasion!: string;

  @ApiProperty({ example: 'https://demo.example.com/cumple-estrellas' })
  @Transform(trim)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'La URL de la demo no es válida.' })
  @MaxLength(500)
  demoUrl!: string;
}

export class UpdateTemplateDto extends TemplateFieldsDto {
  @IsOptional() @IsIn(DIGITAL_KINDS) kind?: DigitalKind;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsIn(DIGITAL_OCCASIONS) occasion?: string;

  @IsOptional()
  @Transform(trim)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'La URL de la demo no es válida.' })
  @MaxLength(500)
  demoUrl?: string;
}

class OrderFieldDto {
  @Transform(trim) @IsString() @Length(1, 60) label!: string;
  @Transform(trim) @IsString() @MaxLength(500) value!: string;
}

export class CreateDigitalOrderDto {
  @ApiProperty({ example: 'cumple-estrellas' })
  @Matches(/^[a-z0-9-]{2,80}$/)
  templateSlug!: string;

  @ApiPropertyOptional({ description: 'Tarjetas NFC: cantidad de tarjetas. Detalles digitales: siempre 1.', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_NFC_QUANTITY)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Valores de los datos personalizables de la plantilla.', type: [OrderFieldDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => OrderFieldDto)
  fields?: OrderFieldDto[];

  @ApiProperty({ example: 'Juan Pérez' })
  @Transform(trim)
  @IsString()
  @Length(2, 120, { message: 'Escribe tu nombre (2 a 120 caracteres).' })
  name!: string;

  @ApiProperty({ example: 'juan@example.com' })
  @Transform(trim)
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'WhatsApp o teléfono, 10 a 15 dígitos.' })
  @Transform(trim)
  @Matches(/^\+?[\d\s-]{10,20}$/, { message: 'El teléfono no es válido.' })
  phone!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ description: 'Consentimiento para usar los datos al atender el pedido. Debe ser true.' })
  @IsBoolean()
  @Equals(true, { message: 'Se requiere el consentimiento para atender tu pedido.' })
  consent!: boolean;

  /** Campo trampa para bots. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
