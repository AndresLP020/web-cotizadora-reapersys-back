import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { CatalogDataModule } from './catalog-data.module';
import { CatalogService } from './catalog.service';
import { PublicCatalogController } from './public/public-catalog.controller';

@Module({
  imports: [CatalogDataModule, PricingModule],
  controllers: [PublicCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
