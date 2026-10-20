import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PublicSettingsController } from './public-settings.controller';
import { BusinessSettings, BusinessSettingsSchema } from './schemas/business-settings.schema';
import { SettingsService } from './settings.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: BusinessSettings.name, schema: BusinessSettingsSchema }])],
  controllers: [PublicSettingsController],
  providers: [SettingsService],
  exports: [SettingsService, MongooseModule],
})
export class SettingsModule {}
