import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const CONTACT_INTERESTS = [
  'landing',
  'web',
  'ecommerce',
  'pos',
  'combo',
  'custom',
  'integrations',
  'support',
  'unsure',
] as const;

/** Versión vigente del texto de consentimiento del formulario de contacto. */
export const CONTACT_CONSENT_VERSION = 'contact-2026-10';

export class CreateContactDto {
  @ApiProperty({ example: 'María López' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ example: 'Abarrotes López' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;

  @ApiProperty({ example: 'maria@example.com' })
  @Transform(trim)
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ description: 'Teléfono con 10 a 15 dígitos; se permiten espacios, guiones y "+".' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^\+?[\d\s-]{10,20}$/, { message: 'El teléfono no es válido.' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Slug de la industria.' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^[a-z0-9-]{2,80}$/)
  industry?: string;

  @ApiPropertyOptional({ enum: CONTACT_INTERESTS })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(CONTACT_INTERESTS)
  interest?: (typeof CONTACT_INTERESTS)[number];

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @Length(10, 2000, { message: 'El mensaje debe tener entre 10 y 2000 caracteres.' })
  message!: string;

  @ApiProperty({ description: 'Consentimiento para usar los datos al responder la solicitud. Debe ser true.' })
  @IsBoolean()
  @Equals(true, { message: 'Se requiere el consentimiento para responder tu solicitud.' })
  consent!: boolean;

  /** Campo trampa para bots: los humanos no lo ven ni lo llenan. */
  @ApiPropertyOptional({ description: 'Debe enviarse vacío.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class ContactReceiptDto {
  @ApiProperty({ example: true })
  received!: true;

  @ApiProperty({ description: 'Referencia pública de la solicitud.', example: 'RS-7K2M9QXA' })
  reference!: string;
}
