import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const toInt = ({ value }: { value: unknown }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);

/** Paginación común de los listados administrativos. */
export class PageQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Texto de búsqueda.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class IdParam {
  @IsMongoId({ message: 'Identificador inválido.' })
  id!: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function pageOf(query: PageQuery) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

