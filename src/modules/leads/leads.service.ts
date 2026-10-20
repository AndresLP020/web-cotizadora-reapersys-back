import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { hashIp } from '../../common/security/ip-hash';
import { generatePublicReference } from '../../common/security/public-reference';
import { AppConfigService } from '../../config/app-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CONTACT_CONSENT_VERSION, type CreateContactDto } from './dto/create-contact.dto';
import { Lead } from './schemas/lead.schema';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    private readonly config: AppConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Registra una solicitud de contacto. Si el honeypot viene lleno, se responde
   * igual que a un humano (para no dar pistas al bot) pero no se guarda nada.
   */
  async createFromContactForm(dto: CreateContactDto, context: RequestContext): Promise<{ reference: string }> {
    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn('Solicitud de contacto descartada por honeypot.');
      return { reference: generatePublicReference() };
    }

    const lead = await this.leadModel.create({
      reference: generatePublicReference(),
      name: dto.name,
      company: dto.company,
      email: dto.email,
      phone: dto.phone,
      industry: dto.industry,
      interest: dto.interest,
      message: dto.message,
      source: 'contact_form',
      status: 'new',
      consent: {
        contact: true,
        textVersion: CONTACT_CONSENT_VERSION,
        acceptedAt: new Date(),
      },
      requestMeta: {
        ipHash: context.ip ? hashIp(context.ip, this.config.get('SESSION_SECRET')) : undefined,
        userAgent: context.userAgent?.slice(0, 300),
      },
    });

    await this.notifications.scheduleForNewLead(lead._id);
    this.logger.log(`Nuevo prospecto ${lead.reference} desde formulario de contacto.`);
    return { reference: lead.reference };
  }
}
