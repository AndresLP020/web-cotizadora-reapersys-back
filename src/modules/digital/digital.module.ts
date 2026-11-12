import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadsModule } from '../leads/leads.module';
import { DigitalAdminController, DigitalOrdersController, PublicDigitalController } from './digital.controller';
import { DigitalService } from './digital.service';
import { DigitalTemplate, DigitalTemplateSchema } from './schemas/digital-template.schema';

/** Productos digitales: detalles personalizables y tarjetas NFC, con catálogo de plantillas y pedidos. */
@Module({
  imports: [MongooseModule.forFeature([{ name: DigitalTemplate.name, schema: DigitalTemplateSchema }]), LeadsModule],
  controllers: [PublicDigitalController, DigitalOrdersController, DigitalAdminController],
  providers: [DigitalService],
})
export class DigitalModule {}
