import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from '../audit/schemas/audit-log.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { BillingAdminController } from './billing-admin.controller';
import { BillingRemindersWorker } from './billing-reminders.worker';
import { BillingService } from './billing.service';
import { Contract, ContractSchema } from './schemas/contract.schema';
import { ContractPayment, ContractPaymentSchema } from './schemas/contract-payment.schema';

/** Cobranza: rentas y compras de paquetes, pagos, recordatorios y reportes. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contract.name, schema: ContractSchema },
      { name: ContractPayment.name, schema: ContractPaymentSchema },
      { name: Client.name, schema: ClientSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [BillingAdminController],
  providers: [BillingService, BillingRemindersWorker],
  exports: [BillingService],
})
export class BillingModule {}
