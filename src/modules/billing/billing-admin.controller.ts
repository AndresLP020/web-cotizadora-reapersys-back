import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { AdminRoute, CurrentUser, RequirePermissions } from '../../security/admin.guard';
import type { AuthenticatedUser } from '../../security/auth.types';
import { IdParam } from '../admin/admin.dto';
import { ContractListQuery, CreateContractDto, PaymentParam, RegisterPaymentDto, SummaryQuery, UpdateContractDto, VoidPaymentDto } from './billing.dto';
import { BillingService } from './billing.service';

@Controller('admin')
@AdminRoute('billing:read')
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  @Get('contracts')
  @ApiOperation({ summary: 'Rentas y compras, ordenadas por el próximo cobro.' })
  list(@Query() query: ContractListQuery) {
    return this.billing.list(query);
  }

  @Post('contracts')
  @RequirePermissions('billing:write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContractDto) {
    return this.billing.create(user, dto);
  }

  @Get('contracts/:id')
  detail(@Param() { id }: IdParam) {
    return this.billing.detail(id);
  }

  @Patch('contracts/:id')
  @RequirePermissions('billing:write')
  update(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdateContractDto) {
    return this.billing.update(user, id, dto);
  }

  @Post('contracts/:id/payments')
  @RequirePermissions('billing:write')
  @ApiOperation({ summary: 'Registra un pago. En rentas avanza el próximo cobro; en compras puede liquidarla.' })
  registerPayment(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: RegisterPaymentDto) {
    return this.billing.registerPayment(user, id, dto);
  }

  @Post('contracts/:id/payments/:paymentId/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('billing:write')
  voidPayment(@CurrentUser() user: AuthenticatedUser, @Param() { id, paymentId }: PaymentParam, @Body() dto: VoidPaymentDto) {
    return this.billing.voidPayment(user, id, paymentId, dto.reason);
  }

  @Post('contracts/:id/remind')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('billing:write')
  @ApiOperation({ summary: 'Envía ahora un recordatorio de pago al cliente.' })
  remind(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.billing.remindNow(user, id);
  }

  @Get('billing/summary')
  @ApiOperation({ summary: 'Reporte de cobranza: ingresos por mes, vencidos y próximos cobros.' })
  summary(@Query() query: SummaryQuery) {
    return this.billing.summary(query.months ?? 12);
  }
}
