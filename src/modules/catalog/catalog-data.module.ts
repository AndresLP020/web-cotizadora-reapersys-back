import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ComponentPrice, ComponentPriceSchema } from '../pricing/schemas/component-price.schema';
import { OperatingCost, OperatingCostSchema } from '../pricing/schemas/operating-cost.schema';
import { PackagePrice, PackagePriceSchema } from '../pricing/schemas/package-price.schema';
import { Category, CategorySchema } from './schemas/category.schema';
import { CompatibilityRule, CompatibilityRuleSchema } from './schemas/compatibility-rule.schema';
import { Component, ComponentSchema } from './schemas/component.schema';
import { Industry, IndustrySchema } from './schemas/industry.schema';
import { Package, PackageSchema } from './schemas/package.schema';
import { Supplier, SupplierSchema } from './schemas/supplier.schema';

/** Registra los modelos del catálogo y precios una sola vez para los módulos que los usan. */
const models = MongooseModule.forFeature([
  { name: Category.name, schema: CategorySchema },
  { name: Industry.name, schema: IndustrySchema },
  { name: Supplier.name, schema: SupplierSchema },
  { name: Component.name, schema: ComponentSchema },
  { name: Package.name, schema: PackageSchema },
  { name: CompatibilityRule.name, schema: CompatibilityRuleSchema },
  { name: ComponentPrice.name, schema: ComponentPriceSchema },
  { name: PackagePrice.name, schema: PackagePriceSchema },
  { name: OperatingCost.name, schema: OperatingCostSchema },
]);

@Module({
  imports: [models],
  exports: [models],
})
export class CatalogDataModule {}
