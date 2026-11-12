import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
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
import {
  FIELD_KEYS,
  type FieldKey,
  FULFILLMENT_STATUSES,
  type FulfillmentStatus,
  HEX_COLOR,
  NFC_AUDIENCES,
  NFC_INCLUDES,
  NFC_QUANTITY_TIERS,
  type NfcAudience,
  type NfcInclude,
  type NfcQuantityTier,
  PRODUCT_STATUSES,
  type ProductStatus,
  SLUG_PATTERN,
} from './digital.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};
/** Una URL vacía se guarda como '' (la plantilla queda sin demo y no se puede publicar). */
const trimOrEmpty = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Precio máximo razonable por unidad: $1,000,000 MXN. */
const MAX_PRICE_CENTS = 100_000_000;
const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;

/** Versión vigente del texto de consentimiento del formulario de pedido. */
export const DIGITAL_ORDER_CONSENT_VERSION = 'digital-order-2026-11';

export class SlugParam {
  @Matches(SLUG_PATTERN)
  slug!: string;
}

export class NfcAssetParam extends SlugParam {
  @IsIn(['preview', 'favicon', 'front', 'back'])
  asset!: 'preview' | 'favicon' | 'front' | 'back';
}

export class TemplateAssetParam extends SlugParam {
  @IsIn(['image', 'favicon'])
  asset!: 'image' | 'favicon';
}

export class OrderPhotoParam {
  @Matches(/^[a-f0-9]{24}$/)
  id!: string;

  @Matches(/^[a-f0-9]{24}$/)
  fileId!: string;
}

// ---------------------------------------------------------------- consultas

export class PublicTemplatesQuery {
  @ApiPropertyOptional({ description: 'Slug de la ocasión.' })
  @IsOptional()
  @Matches(SLUG_PATTERN)
  ocasion?: string;
}

export class ProductListQuery extends PageQuery {
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
}

export class OrderListQuery extends PageQuery {
  @IsOptional() @IsIn(FULFILLMENT_STATUSES) fulfillment?: FulfillmentStatus;
  @IsOptional() @IsIn(['digital_gift', 'nfc_card']) kind?: 'digital_gift' | 'nfc_card';
}

// ---------------------------------------------------------------- vista previa

export class LinkPreviewRequestDto {
  @ApiProperty({ example: 'https://demo.example.com/carta' })
  @Transform(trim)
  @Matches(HTTPS_URL, { message: 'La URL debe empezar con https://' })
  @MaxLength(500)
  url!: string;
}

// ---------------------------------------------------------------- plantillas de detalles

export class TemplateFieldDto {
  @ApiProperty({ enum: FIELD_KEYS })
  @IsIn(FIELD_KEYS)
  key!: FieldKey;

  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional({ description: 'Fotos: cuántas como máximo. Texto: largo máximo.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  max?: number;
}

export class TemplateColorsDto {
  @Matches(HEX_COLOR) bg!: string;
  @Matches(HEX_COLOR) accent!: string;
  @Matches(HEX_COLOR) ink!: string;
  @Matches(HEX_COLOR) stage!: string;
}

class TemplateBaseDto {
  @ApiPropertyOptional({ maxLength: 400 })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @ApiPropertyOptional({ description: 'https; vacía = sin demo (no se puede publicar).' })
  @IsOptional()
  @Transform(trimOrEmpty)
  @ValidateIf((o: TemplateBaseDto) => o.demoUrl !== '')
  @Matches(HTTPS_URL, { message: 'La URL de la demo debe empezar con https://' })
  @MaxLength(500)
  demoUrl?: string;

  @ApiPropertyOptional({ description: 'Precio en centavos. null = «Por cotizar».', nullable: true })
  @IsOptional()
  @ValidateIf((o: TemplateBaseDto) => o.priceCents !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  priceCents?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @Matches(SLUG_PATTERN, { each: true })
  occasions?: string[];

  @ApiPropertyOptional({ type: [TemplateFieldDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FIELD_KEYS.length)
  @ArrayUnique((f: TemplateFieldDto) => f.key, { message: 'Cada dato se pide una sola vez.' })
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDto)
  fields?: TemplateFieldDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateColorsDto)
  colors?: TemplateColorsDto;

  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateTemplateDto extends TemplateBaseDto {
  @ApiProperty({ example: 'Carta que se abre' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ description: 'Se genera a partir del nombre si no se indica.' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'El identificador solo admite minúsculas, números y guiones.' })
  slug?: string;
}

export class UpdateTemplateDto extends TemplateBaseDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
}

// ---------------------------------------------------------------- ocasiones

export class CreateOccasionDto {
  @Transform(trim) @IsString() @Length(2, 60) label!: string;
  @Transform(emptyToUndefined) @IsOptional() @Matches(SLUG_PATTERN) slug?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class UpdateOccasionDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 60) label?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

// ---------------------------------------------------------------- diseños NFC

export class NfcColorsDto {
  @Matches(HEX_COLOR) card!: string;
  @Matches(HEX_COLOR) line!: string;
  @Matches(HEX_COLOR) ink!: string;
  @Matches(HEX_COLOR) muted!: string;
  @Matches(HEX_COLOR) accent!: string;
  @Matches(HEX_COLOR) onAccent!: string;
  @Matches(HEX_COLOR) btn!: string;
  @Matches(HEX_COLOR) onBtn!: string;
}

class NfcDesignBaseDto {
  @IsOptional()
  @Transform(trimOrEmpty)
  @ValidateIf((o: NfcDesignBaseDto) => o.demoUrl !== '')
  @Matches(HTTPS_URL, { message: 'La URL de la demo debe empezar con https://' })
  @MaxLength(500)
  demoUrl?: string;

  @IsOptional() @ValidateNested() @Type(() => NfcColorsDto) colors?: NfcColorsDto;
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateNfcDesignDto extends NfcDesignBaseDto {
  @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @Transform(emptyToUndefined) @IsOptional() @Matches(SLUG_PATTERN) slug?: string;
}

export class UpdateNfcDesignDto extends NfcDesignBaseDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 80) name?: string;
}

export class NfcPriceTierDto {
  @IsIn(NFC_QUANTITY_TIERS)
  quantity!: NfcQuantityTier;

  @ValidateIf((o: NfcPriceTierDto) => o.unitPriceCents !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  unitPriceCents!: number | null;
}

export class UpdateNfcPricingDto {
  @IsArray()
  @ArrayMaxSize(NFC_QUANTITY_TIERS.length)
  @ArrayUnique((t: NfcPriceTierDto) => t.quantity)
  @ValidateNested({ each: true })
  @Type(() => NfcPriceTierDto)
  tiers!: NfcPriceTierDto[];
}

// ---------------------------------------------------------------- pedidos

/**
 * Pedido desde el sitio (multipart: campo `payload` con este JSON y hasta 6 archivos `photos`).
 * Los datos personalizados se validan contra los campos de la plantilla en el servicio.
 */
export class CreateDigitalOrderDto {
  @ApiProperty({ enum: ['detail', 'nfc'] })
  @IsIn(['detail', 'nfc'])
  type!: 'detail' | 'nfc';

  @ValidateIf((o: CreateDigitalOrderDto) => o.type === 'detail')
  @Matches(SLUG_PATTERN)
  templateSlug?: string;

  @ValidateIf((o: CreateDigitalOrderDto) => o.type === 'nfc')
  @Matches(SLUG_PATTERN)
  designSlug?: string;

  @ApiPropertyOptional({ description: 'Detalles: { recipientName: "Sofía", message: "…" }.' })
  @IsOptional()
  @IsObject()
  personalization?: Record<string, unknown>;

  @IsOptional() @IsIn(NFC_AUDIENCES) audience?: NfcAudience;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NFC_INCLUDES.length)
  @ArrayUnique()
  @IsIn(NFC_INCLUDES, { each: true })
  includes?: NfcInclude[];

  @ValidateIf((o: CreateDigitalOrderDto) => o.type === 'nfc')
  @IsIn(NFC_QUANTITY_TIERS)
  quantity?: NfcQuantityTier;

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

  @ApiProperty({ description: 'WhatsApp, 10 a 15 dígitos.' })
  @Transform(trim)
  @Matches(/^\+?[\d\s-]{10,20}$/, { message: 'El WhatsApp no es válido.' })
  phone!: string;

  @Transform(emptyToUndefined) @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  @ApiProperty({ description: 'Consentimiento para usar los datos al atender el pedido. Debe ser true.' })
  @IsBoolean()
  @Equals(true, { message: 'Se requiere el consentimiento para atender tu pedido.' })
  consent!: boolean;

  /** Campo trampa para bots. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class UpdateDigitalOrderDto {
  @IsOptional() @IsIn(FULFILLMENT_STATUSES) fulfillment?: FulfillmentStatus;

  @ApiPropertyOptional({ description: 'Link final entregado (https). Vacío lo quita.' })
  @IsOptional()
  @Transform(trimOrEmpty)
  @ValidateIf((o: UpdateDigitalOrderDto) => o.deliveredUrl !== '')
  @Matches(HTTPS_URL, { message: 'El link entregado debe empezar con https://' })
  @MaxLength(500)
  deliveredUrl?: string;
}
