import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, Matches } from 'class-validator';
import { PACKAGE_CATEGORIES, type PackageCategory } from '../catalog.constants';
import { CatalogService } from '../catalog.service';

class PackageListQuery {
  @IsOptional()
  @IsIn(PACKAGE_CATEGORIES)
  category?: PackageCategory;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  featured?: boolean;
}

class ComponentListQuery {
  @IsOptional()
  @Matches(/^[a-z0-9-]{1,80}$/)
  category?: string;
}

class SlugParam {
  @Matches(/^[a-z0-9-]{1,80}$/)
  slug!: string;
}

/** Catálogo público: solo datos comerciales autorizados (sin costos ni márgenes). */
@ApiTags('Público')
@Controller()
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('packages')
  @ApiOperation({ summary: 'Paquetes activos con precio vigente publicado.' })
  @ApiOkResponse({ description: '{ items: PublicPackage[] }' })
  listPackages(@Query() query: PackageListQuery) {
    return this.catalog.listPublicPackages(query);
  }

  @Get('packages/:slug')
  @ApiOperation({ summary: 'Detalle de un paquete: componentes incluidos, variantes y recurrentes sugeridos.' })
  @ApiNotFoundResponse()
  getPackage(@Param() params: SlugParam) {
    return this.catalog.getPublicPackage(params.slug);
  }

  @Get('components/public')
  @ApiOperation({ summary: 'Complementos que se pueden agregar a una cotización.' })
  listComponents(@Query() query: ComponentListQuery) {
    return this.catalog.listPublicComponents(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categorías activas del catálogo.' })
  listCategories() {
    return this.catalog.listCategories();
  }

  @Get('industries')
  @ApiOperation({ summary: 'Industrias atendidas y soluciones sugeridas.' })
  listIndustries() {
    return this.catalog.listIndustries();
  }
}
