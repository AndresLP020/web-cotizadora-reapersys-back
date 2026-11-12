import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DigitalTemplate, DigitalTemplateSchema } from './schemas/digital-template.schema';
import { NfcDesign, NfcDesignSchema } from './schemas/nfc-design.schema';
import { NfcPriceTier, NfcPriceTierSchema } from './schemas/nfc-price-tier.schema';
import { Occasion, OccasionSchema } from './schemas/occasion.schema';

/** Modelos del catálogo digital (los usan la API y el seed). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DigitalTemplate.name, schema: DigitalTemplateSchema },
      { name: Occasion.name, schema: OccasionSchema },
      { name: NfcDesign.name, schema: NfcDesignSchema },
      { name: NfcPriceTier.name, schema: NfcPriceTierSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DigitalDataModule {}
