import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { BusinessSettings } from './schemas/business-settings.schema';

@Injectable()
export class SettingsService {
  constructor(@InjectModel(BusinessSettings.name) private readonly settingsModel: Model<BusinessSettings>) {}

  async get(): Promise<BusinessSettings> {
    const settings = await this.settingsModel.findOne({ key: 'default' }).lean<BusinessSettings>();
    if (!settings) throw new NotFoundException('La configuración comercial no se ha inicializado (ejecute npm run seed).');
    return settings;
  }
}
