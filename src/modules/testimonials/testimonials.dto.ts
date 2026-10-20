import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../admin/admin.dto';
import { TESTIMONIAL_STATUSES, type TestimonialStatus } from './schemas/testimonial.schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};
const toInt = ({ value }: { value: unknown }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);

export class CreateTestimonialDto {
  @ApiProperty({ example: 'María López' })
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'El nombre debe tener entre 2 y 80 caracteres.' })
  name!: string;

  @ApiPropertyOptional({ example: 'Abarrotes López' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @ApiPropertyOptional({ description: 'Cargo.', example: 'Propietaria' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  role?: string;

  @ApiPropertyOptional({ description: 'Privado: nunca se publica.' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  @MaxLength(254)
  email?: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt({ message: 'Elige una calificación de 1 a 5.' })
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ minLength: 20, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @Length(20, 1000, { message: 'El comentario debe tener entre 20 y 1000 caracteres.' })
  message!: string;

  @ApiProperty({ description: 'Autoriza publicar nombre, empresa y comentario. Debe ser true.' })
  @IsBoolean()
  @Equals(true, { message: 'Se requiere tu autorización para publicar el comentario.' })
  consent!: boolean;

  /** Campo trampa para bots. */
  @ApiPropertyOptional({ description: 'Debe enviarse vacío.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class PublicTestimonialsQuery {
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(24) limit?: number;
}

export class TestimonialListQuery extends PageQuery {
  @IsOptional() @IsIn(TESTIMONIAL_STATUSES) status?: TestimonialStatus;
}

export class UpdateTestimonialDto {
  @IsOptional() @IsIn(TESTIMONIAL_STATUSES) status?: TestimonialStatus;
  @IsOptional() @IsBoolean() featured?: boolean;
}
