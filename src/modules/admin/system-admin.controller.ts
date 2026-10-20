import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { AdminRoute, CurrentUser, RequirePermissions } from '../../security/admin.guard';
import type { AuthenticatedUser } from '../../security/auth.types';
import { PASSWORD_MAX_LENGTH } from '../../security/password';
import { ROLES, type Role } from '../../security/roles';
import { IdParam, PageQuery } from './admin.dto';
import { SystemAdminService } from './system-admin.service';

const emptyToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

class TaxDto {
  @IsInt() @Min(0) @Max(10_000) rateBp!: number;
  @IsIn(['exclusive', 'inclusive']) treatment!: 'exclusive' | 'inclusive';
  @IsBoolean() confirmed!: boolean;
}

class QuoteSettingsDto {
  @IsInt() @Min(0) @Max(10_000) depositRateBp!: number;
  @ValidateIf((o: QuoteSettingsDto) => o.validityDays !== null)
  @IsInt()
  @Min(1)
  @Max(365)
  validityDays!: number | null;
}

class RentalSettingsDto {
  @IsInt() @Min(1) @Max(60) minimumTermMonths!: number;
  @IsInt() @Min(0) @Max(10_000) financingBp!: number;
  @IsInt() @Min(0) @Max(10_000) monthToMonthSurchargeBp!: number;
  @IsInt() @Min(0) @Max(5_000) semiannualDiscountBp!: number;
  @IsInt() @Min(0) @Max(5_000) annualDiscountBp!: number;
}

class WarrantyDto {
  @ValidateIf((o: WarrantyDto) => o.referenceDays !== null)
  @IsInt()
  @Min(0)
  @Max(3650)
  referenceDays!: number | null;
  @IsBoolean() confirmed!: boolean;
}

class ContactDto {
  @IsOptional() @Transform(emptyToUndefined) @IsEmail() email?: string;
  @IsOptional() @Transform(emptyToUndefined) @Matches(/^\d{10,15}$/) whatsapp?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsUrl({ protocols: ['https'], require_protocol: true }) facebook?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsUrl({ protocols: ['https'], require_protocol: true }) instagram?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsUrl({ protocols: ['https'], require_protocol: true }) tiktok?: string;
}

class SettingsDto {
  @IsOptional() @IsString() @Length(1, 120) tradeName?: string;
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(400) legalAddress?: string;
  @IsOptional() @IsBoolean() privacyNoticePublished?: boolean;
  @IsOptional() @ValidateNested() @Type(() => TaxDto) tax?: TaxDto;
  @IsOptional() @ValidateNested() @Type(() => QuoteSettingsDto) quote?: QuoteSettingsDto;
  @IsOptional() @ValidateNested() @Type(() => WarrantyDto) warranty?: WarrantyDto;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(500, { each: true }) commercialTerms?: string[];
  @IsOptional() @ValidateNested() @Type(() => ContactDto) contact?: ContactDto;
  @IsOptional() @ValidateNested() @Type(() => RentalSettingsDto) rental?: RentalSettingsDto;
}

class CreateUserDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @IsString() @Length(2, 120) name!: string;
  @IsIn(ROLES) role!: Role;
  @IsString() @MaxLength(PASSWORD_MAX_LENGTH) password!: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsIn(ROLES) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(PASSWORD_MAX_LENGTH) password?: string;
}

class AuditQuery extends PageQuery {
  @IsOptional() @Matches(/^[a-z_]{1,40}$/) entityType?: string;
}

@Controller('admin')
@AdminRoute('dashboard:read')
export class SystemAdminController {
  constructor(private readonly system: SystemAdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Indicadores del panel calculados con datos reales.' })
  dashboard() {
    return this.system.dashboard();
  }

  @Get('settings')
  @RequirePermissions('settings:read')
  getSettings() {
    return this.system.getSettings();
  }

  @Patch('settings')
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Actualiza IVA, anticipo, vigencia, garantía, condiciones y contacto (auditado).' })
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: SettingsDto) {
    return this.system.updateSettings(user, dto);
  }

  @Get('users')
  @RequirePermissions('users:manage')
  listUsers() {
    return this.system.listUsers();
  }

  @Post('users')
  @RequirePermissions('users:manage')
  createUser(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.system.createUser(user, dto);
  }

  @Patch('users/:id')
  @RequirePermissions('users:manage')
  updateUser(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdateUserDto) {
    return this.system.updateUser(user, id, dto);
  }

  @Get('audit')
  @RequirePermissions('audit:read')
  listAudit(@Query() query: AuditQuery) {
    return this.system.listAudit(query);
  }
}
