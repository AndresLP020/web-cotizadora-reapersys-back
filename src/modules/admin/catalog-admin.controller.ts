import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsUrl,
  Length,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AdminRoute, CurrentUser, RequirePermissions } from '../../security/admin.guard';
import type { AuthenticatedUser } from '../../security/auth.types';
import { LIFECYCLE_STATUSES, type LifecycleStatus, PRICE_MODES, type PriceMode } from '../catalog/catalog.constants';
import { IdParam } from './admin.dto';
import { CatalogAdminService } from './catalog-admin.service';

/** Importe máximo aceptado: $100,000,000.00 en centavos (evita errores de captura). */
const MAX_CENTS = 10_000_000_000;

class ComponentListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Matches(/^[a-z0-9-]{1,80}$/) category?: string;
  @IsOptional() @IsIn(['pending', 'priced']) pricing?: string;
}

class ComponentPriceDto {
  @IsIn(PRICE_MODES) mode!: PriceMode;

  @ValidateIf((o: ComponentPriceDto) => o.saleCents !== null)
  @IsInt({ message: 'El precio debe expresarse en centavos enteros.' })
  @Min(0)
  @Max(MAX_CENTS)
  saleCents!: number | null;

  @IsOptional()
  @ValidateIf((o: ComponentPriceDto) => o.costCents !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  costCents?: number | null;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class UpdateComponentDto {
  @IsOptional() @IsIn(LIFECYCLE_STATUSES) status?: LifecycleStatus;
  @IsOptional() @IsBoolean() publicVisible?: boolean;
  @IsOptional() @IsBoolean() requiresEvaluation?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

class VariantPriceDto {
  @Matches(/^[a-z0-9-]{1,80}$/) groupKey!: string;
  @Matches(/^[a-z0-9-]{1,80}$/) optionKey!: string;
  @IsIn(['fixed', 'pending']) mode!: 'fixed' | 'pending';

  @ValidateIf((o: VariantPriceDto) => o.deltaCents !== null)
  @IsInt()
  @Min(-MAX_CENTS)
  @Max(MAX_CENTS)
  deltaCents!: number | null;
}

class RemovalCreditDto {
  @IsMongoId() componentId!: string;
  @IsIn(['fixed', 'pending']) mode!: 'fixed' | 'pending';

  @ValidateIf((o: RemovalCreditDto) => o.creditCents !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  creditCents!: number | null;
}

class RentalPriceDto {
  @IsIn(PRICE_MODES) mode!: PriceMode;

  @ValidateIf((o: RentalPriceDto) => o.monthlyCents !== null)
  @IsInt({ message: 'La mensualidad debe expresarse en centavos enteros.' })
  @Min(0)
  @Max(MAX_CENTS)
  monthlyCents!: number | null;

  @ValidateIf((o: RentalPriceDto) => o.setupFeeCents !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  setupFeeCents!: number | null;
}

class PackagePriceDto {
  @IsIn(PRICE_MODES) mode!: PriceMode;

  @ValidateIf((o: PackagePriceDto) => o.baseCents !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  baseCents!: number | null;

  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => VariantPriceDto) variantPrices!: VariantPriceDto[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RemovalCreditDto) removalCredits!: RemovalCreditDto[];
  @IsOptional() @ValidateNested() @Type(() => RentalPriceDto) rental?: RentalPriceDto;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class RentalProfileDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @ValidateIf((o: RentalProfileDto) => o.hostingCostKey !== null) @Matches(/^[a-z0-9-]{1,80}$/) hostingCostKey?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) storageGb?: number;
  @IsOptional() @IsBoolean() includesDomain?: boolean;
  @IsOptional() @IsIn(['package_price', 'manual', 'combo_parts']) recoverableMode?: 'package_price' | 'manual' | 'combo_parts';
  @IsOptional() @ValidateIf((o: RentalProfileDto) => o.recoverableCents !== null) @IsInt() @Min(0) @Max(MAX_CENTS) recoverableCents?: number | null;
  @IsOptional() @IsBoolean() hardwareUpfront?: boolean;
}

class UpdatePackageDto {
  @IsOptional() @IsIn(LIFECYCLE_STATUSES) status?: LifecycleStatus;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @ValidateNested() @Type(() => RentalProfileDto) rentalProfile?: RentalProfileDto;
}

class OperatingCostDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) costCents?: number;
  @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
  @IsOptional() @ValidateIf((o: OperatingCostDto) => o.sourceUrl !== '') @IsUrl({ protocols: ['https'], require_protocol: true }) sourceUrl?: string;
  @IsOptional() @IsBoolean() confirmed?: boolean;
}

@Controller('admin')
@AdminRoute('catalog:read')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogAdminService) {}

  @Get('components')
  @ApiOperation({ summary: 'Componentes con su precio vigente (costos y márgenes solo con permiso costs:read).' })
  listComponents(@CurrentUser() user: AuthenticatedUser, @Query() query: ComponentListQuery) {
    return this.catalog.listComponents(user, query);
  }

  @Patch('components/:id')
  @RequirePermissions('catalog:write')
  updateComponent(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdateComponentDto) {
    return this.catalog.updateComponent(user, id, dto);
  }

  @Get('components/:id/prices')
  @ApiOperation({ summary: 'Historial de versiones de precio de un componente.' })
  componentHistory(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.catalog.componentPriceHistory(user, id);
  }

  @Post('components/:id/prices')
  @RequirePermissions('prices:write')
  @ApiOperation({ summary: 'Crea un borrador de precio (no afecta precios públicos hasta publicarse).' })
  createComponentDraft(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: ComponentPriceDto) {
    return this.catalog.createComponentDraft(user, id, dto);
  }

  @Post('component-prices/:id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('prices:publish')
  publishComponentPrice(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.catalog.publishComponentPrice(user, id);
  }

  @Post('component-prices/:id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('prices:publish')
  @ApiOperation({ summary: 'Restaura una versión anterior creando y publicando una versión nueva.' })
  restoreComponentPrice(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.catalog.restoreComponentPrice(user, id);
  }

  @Delete('component-prices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('prices:write')
  discardComponentDraft(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.catalog.discardComponentDraft(user, id);
  }

  @Get('packages')
  listPackages() {
    return this.catalog.listPackages();
  }

  @Get('packages/:id')
  @ApiOperation({ summary: 'Estructura, perfil de suscripción e historial de precios (la mensualidad sugerida solo con costs:read).' })
  packageDetail(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.catalog.packageDetail(user, id);
  }

  @Get('operating-costs')
  @RequirePermissions('costs:read')
  @ApiOperation({ summary: 'Costos de operación (hosting, almacenamiento, dominio) usados para la mensualidad sugerida.' })
  listOperatingCosts() {
    return this.catalog.listOperatingCosts();
  }

  @Patch('operating-costs/:id')
  @RequirePermissions('costs:read', 'prices:write')
  updateOperatingCost(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: OperatingCostDto) {
    return this.catalog.updateOperatingCost(user, id, dto);
  }

  @Patch('packages/:id')
  @RequirePermissions('catalog:write')
  updatePackage(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdatePackageDto) {
    return this.catalog.updatePackage(user, id, dto);
  }

  @Post('packages/:id/prices')
  @RequirePermissions('prices:write')
  createPackageDraft(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: PackagePriceDto) {
    return this.catalog.createPackageDraft(user, id, dto);
  }

  @Post('package-prices/:id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('prices:publish')
  publishPackagePrice(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.catalog.publishPackagePrice(user, id);
  }

  @Post('package-prices/:id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('prices:publish')
  restorePackagePrice(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.catalog.restorePackagePrice(user, id);
  }

  @Delete('package-prices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('prices:write')
  discardPackageDraft(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.catalog.discardPackageDraft(user, id);
  }
}
