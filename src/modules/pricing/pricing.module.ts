import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogDataModule } from '../catalog/catalog-data.module';
import { BusinessSettings, BusinessSettingsSchema } from '../settings/schemas/business-settings.schema';
import { PricingService } from './pricing.service';
import { RentalService } from './rental.service';

@Module({
  imports: [CatalogDataModule, MongooseModule.forFeature([{ name: BusinessSettings.name, schema: BusinessSettingsSchema }])],
  providers: [PricingService, RentalService],
  exports: [PricingService, RentalService],
})
export class PricingModule {}
