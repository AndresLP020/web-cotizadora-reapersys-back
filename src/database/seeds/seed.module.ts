import { Module } from '@nestjs/common';
import { CatalogDataModule } from '../../modules/catalog/catalog-data.module';
import { PricingModule } from '../../modules/pricing/pricing.module';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SeedService } from './seed.service';

@Module({
  imports: [CatalogDataModule, PricingModule, SettingsModule],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
