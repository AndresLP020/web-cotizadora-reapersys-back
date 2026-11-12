import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { DigitalDataModule } from './digital-data.module';
import { DigitalOrdersService } from './digital-orders.service';
import {
  DigitalAdminController,
  DigitalOrdersAdminController,
  DigitalOrdersController,
  LinkPreviewAdminController,
  NfcDesignsAdminController,
  NfcPricingAdminController,
  OccasionsAdminController,
  PublicDigitalController,
  PublicNfcController,
  PublicOccasionsController,
} from './digital.controller';
import { DigitalService } from './digital.service';
import { NfcService } from './nfc.service';
import { ProductImagesService } from './product-images.service';

/**
 * Productos digitales: detalles personalizables (plantillas con demo) y tarjetas NFC (diseños y
 * precios por cantidad). Los pedidos llegan al flujo de prospectos existente.
 */
@Module({
  imports: [DigitalDataModule, LeadsModule],
  controllers: [
    PublicDigitalController,
    PublicOccasionsController,
    PublicNfcController,
    DigitalOrdersController,
    DigitalAdminController,
    OccasionsAdminController,
    NfcDesignsAdminController,
    NfcPricingAdminController,
    LinkPreviewAdminController,
    DigitalOrdersAdminController,
  ],
  providers: [ProductImagesService, DigitalService, NfcService, DigitalOrdersService],
})
export class DigitalModule {}
