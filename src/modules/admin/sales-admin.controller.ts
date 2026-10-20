import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AdminRoute, CurrentUser, RequirePermissions } from '../../security/admin.guard';
import type { AuthenticatedUser } from '../../security/auth.types';
import { LEAD_SOURCES, LEAD_STATUSES, type LeadStatus } from '../leads/schemas/lead.schema';
import { DELIVERY_CHANNELS, type DeliveryChannel } from '../notifications/schemas/notification-delivery.schema';
import { QuoteSelectionDto } from '../quotes/dto/quote.dto';
import { QUOTE_STATUSES, type QuoteStatus } from '../quotes/schemas/quote.schema';
import { IdParam, PageQuery } from './admin.dto';
import { SalesAdminService } from './sales-admin.service';

class QuoteListQuery extends PageQuery {
  @IsOptional() @IsIn(QUOTE_STATUSES) status?: QuoteStatus;
}

class LeadListQuery extends PageQuery {
  @IsOptional() @IsIn(LEAD_STATUSES) status?: LeadStatus;
  @IsOptional() @IsIn(LEAD_SOURCES) source?: string;
}

class QuoteStatusDto {
  @IsIn(QUOTE_STATUSES) status!: QuoteStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class ReviseQuoteDto {
  @ValidateNested() @Type(() => QuoteSelectionDto) selection!: QuoteSelectionDto;
  @IsString() @Length(3, 300) reason!: string;
}

class SendQuoteDto {
  @IsArray() @ArrayMinSize(1) @IsIn(DELIVERY_CHANNELS, { each: true }) channels!: DeliveryChannel[];
}

class PdfQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value))
  @IsInt()
  @Min(1)
  @Max(1000)
  version?: number;
}

class LeadStatusDto {
  @IsIn(LEAD_STATUSES) status!: LeadStatus;
}

@Controller('admin')
@AdminRoute('quotes:read')
export class SalesAdminController {
  constructor(private readonly sales: SalesAdminService) {}

  @Get('quotes')
  listQuotes(@Query() query: QuoteListQuery) {
    return this.sales.listQuotes(query);
  }

  @Get('quotes/:id')
  @ApiOperation({ summary: 'Detalle con todas las versiones, cliente, prospecto e historial.' })
  quoteDetail(@Param() { id }: IdParam) {
    return this.sales.quoteDetail(id);
  }

  @Patch('quotes/:id/status')
  @RequirePermissions('quotes:write')
  changeStatus(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: QuoteStatusDto) {
    return this.sales.changeQuoteStatus(user, id, dto.status, dto.note);
  }

  @Post('quotes/:id/revise')
  @RequirePermissions('quotes:write')
  @ApiOperation({ summary: 'Crea una versión nueva con los precios vigentes (la anterior queda intacta).' })
  revise(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: ReviseQuoteDto) {
    return this.sales.reviseQuote(user, id, dto.selection, dto.reason);
  }

  @Post('quotes/:id/send')
  @RequirePermissions('quotes:write')
  @ApiOperation({ summary: 'Envía la versión vigente (con PDF) por correo y/o WhatsApp. Solo cotizaciones emitidas.' })
  send(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: SendQuoteDto) {
    return this.sales.sendQuote(user, id, dto.channels);
  }

  @Post('deliveries/:id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotes:write')
  retry(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.sales.retryDelivery(user, id);
  }

  @Get('quotes/:id/pdf')
  @ApiOperation({ summary: 'PDF de una versión (por defecto la vigente).' })
  async pdf(@Param() { id }: IdParam, @Query() query: PdfQuery): Promise<StreamableFile> {
    const pdf = await this.sales.quotePdf(id, query.version);
    return new StreamableFile(pdf.content, { type: 'application/pdf', disposition: `inline; filename="${pdf.filename}"`, length: pdf.content.length });
  }

  @Get('clients')
  @RequirePermissions('clients:read')
  listClients(@Query() query: PageQuery) {
    return this.sales.listClients(query);
  }

  @Get('clients/:id')
  @RequirePermissions('clients:read')
  clientDetail(@Param() { id }: IdParam) {
    return this.sales.clientDetail(id);
  }

  @Get('leads')
  @RequirePermissions('leads:read')
  listLeads(@Query() query: LeadListQuery) {
    return this.sales.listLeads(query);
  }

  @Patch('leads/:id/status')
  @RequirePermissions('leads:write')
  updateLead(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: LeadStatusDto) {
    return this.sales.updateLeadStatus(user, id, dto.status);
  }
}
