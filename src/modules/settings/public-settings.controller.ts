import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { planSettingsOf } from '../pricing/subscription-plans';
import { SettingsService } from './settings.service';

/** Datos públicos del negocio para el sitio: contacto y aviso de privacidad. */
@ApiTags('Público')
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('public')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Contacto, plazo de la suscripción y estado del aviso de privacidad.' })
  async getPublic() {
    const s = await this.settings.get();
    const privacyReady = s.privacyNotice?.published === true && Boolean(s.legalName && s.legalAddress && s.contact.email);
    return {
      tradeName: s.tradeName,
      contact: {
        email: s.contact.email || null,
        whatsapp: s.contact.whatsapp || null,
        facebook: s.contact.facebook || null,
        instagram: s.contact.instagram || null,
        tiktok: s.contact.tiktok || null,
      },
      quote: { validityDays: s.quote.validityDays, depositRateBp: s.quote.depositRateBp },
      subscription: planSettingsOf(s.rental),
      // Los datos del responsable solo se exponen junto con el aviso publicado.
      privacyNotice: privacyReady
        ? { published: true, updatedAt: s.privacyNotice.publishedAt, legalName: s.legalName!, legalAddress: s.legalAddress!, contactEmail: s.contact.email! }
        : { published: false },
    };
  }
}
