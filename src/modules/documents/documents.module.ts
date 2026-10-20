import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { Quote, QuoteSchema } from '../quotes/schemas/quote.schema';
import { QuoteVersion, QuoteVersionSchema } from '../quotes/schemas/quote-version.schema';
import { BusinessSettings, BusinessSettingsSchema } from '../settings/schemas/business-settings.schema';
import { DocumentsService } from './documents.service';
import { QuoteDocument, QuoteDocumentSchema } from './schemas/quote-document.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: QuoteDocument.name, schema: QuoteDocumentSchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: QuoteVersion.name, schema: QuoteVersionSchema },
      { name: Client.name, schema: ClientSchema },
      { name: BusinessSettings.name, schema: BusinessSettingsSchema },
    ]),
  ],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
