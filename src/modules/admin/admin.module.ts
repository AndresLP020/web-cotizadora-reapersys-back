import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from '../audit/schemas/audit-log.schema';
import { CatalogDataModule } from '../catalog/catalog-data.module';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { LeadsModule } from '../leads/leads.module';
import { PricingModule } from '../pricing/pricing.module';
import { QuotesModule } from '../quotes/quotes.module';
import { Quote, QuoteSchema } from '../quotes/schemas/quote.schema';
import { QuoteVersion, QuoteVersionSchema } from '../quotes/schemas/quote-version.schema';
import { SettingsModule } from '../settings/settings.module';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { SalesAdminController } from './sales-admin.controller';
import { SalesAdminService } from './sales-admin.service';
import { SystemAdminController } from './system-admin.controller';
import { SystemAdminService } from './system-admin.service';

@Module({
  imports: [
    CatalogDataModule,
    PricingModule,
    SettingsModule,
    LeadsModule,
    QuotesModule,
    MongooseModule.forFeature([
      { name: Quote.name, schema: QuoteSchema },
      { name: QuoteVersion.name, schema: QuoteVersionSchema },
      { name: Client.name, schema: ClientSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [SystemAdminController, CatalogAdminController, SalesAdminController],
  providers: [CatalogAdminService, SalesAdminService, SystemAdminService],
})
export class AdminModule {}
