import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfigService } from '../../config/app-config.service';
import { Contract, ContractSchema } from '../billing/schemas/contract.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { Quote, QuoteSchema } from '../quotes/schemas/quote.schema';
import { QuoteVersion, QuoteVersionSchema } from '../quotes/schemas/quote-version.schema';
import { BusinessSettings, BusinessSettingsSchema } from '../settings/schemas/business-settings.schema';
import { Testimonial, TestimonialSchema } from '../testimonials/schemas/testimonial.schema';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';
import { ResendEmailProvider, SimulatedEmailProvider } from './providers/email.providers';
import { EMAIL_PROVIDER, WHATSAPP_PROVIDER } from './providers/provider.types';
import { MetaCloudWhatsAppProvider, SimulatedWhatsAppProvider } from './providers/whatsapp.providers';
import { NotificationDelivery, NotificationDeliverySchema } from './schemas/notification-delivery.schema';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

/**
 * Proveedores elegidos por configuración. La validación del entorno garantiza que un proveedor
 * real solo se activa con todas sus credenciales; sin ellas se usa el modo simulado.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NotificationDelivery.name, schema: NotificationDeliverySchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: QuoteVersion.name, schema: QuoteVersionSchema },
      { name: Client.name, schema: ClientSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: BusinessSettings.name, schema: BusinessSettingsSchema },
      { name: Contract.name, schema: ContractSchema },
      { name: Testimonial.name, schema: TestimonialSchema },
    ]),
  ],
  controllers: [WhatsAppWebhookController],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.get('EMAIL_PROVIDER') === 'resend'
          ? new ResendEmailProvider(config.get('RESEND_API_KEY')!, config.get('EMAIL_FROM'))
          : new SimulatedEmailProvider(),
    },
    {
      provide: WHATSAPP_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.get('WHATSAPP_PROVIDER') === 'meta_cloud'
          ? new MetaCloudWhatsAppProvider({
              apiVersion: config.get('WHATSAPP_API_VERSION'),
              phoneNumberId: config.get('WHATSAPP_PHONE_NUMBER_ID')!,
              accessToken: config.get('WHATSAPP_ACCESS_TOKEN')!,
              templateName: config.get('WHATSAPP_QUOTE_TEMPLATE')!,
              templateLanguage: config.get('WHATSAPP_TEMPLATE_LANGUAGE'),
            })
          : new SimulatedWhatsAppProvider(),
    },
    NotificationsService,
    NotificationsWorker,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
