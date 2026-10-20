import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogDataModule } from '../catalog/catalog-data.module';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { LeadsModule } from '../leads/leads.module';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';
import { CatalogSnapshotLoader } from './catalog-snapshot.loader';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { Quote, QuoteSchema } from './schemas/quote.schema';
import { QuoteVersion, QuoteVersionSchema } from './schemas/quote-version.schema';

@Module({
  imports: [
    CatalogDataModule,
    PricingModule,
    SettingsModule,
    LeadsModule,
    MongooseModule.forFeature([
      { name: Quote.name, schema: QuoteSchema },
      { name: QuoteVersion.name, schema: QuoteVersionSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
  ],
  controllers: [QuotesController],
  providers: [CatalogSnapshotLoader, QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
