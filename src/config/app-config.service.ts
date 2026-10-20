import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** Acceso tipado a la configuración validada. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  /** Estado de integraciones externas sin exponer secretos. */
  get integrationsStatus() {
    return {
      email: {
        provider: this.get('EMAIL_PROVIDER'),
        simulated: this.get('EMAIL_PROVIDER') === 'simulated',
      },
      whatsapp: {
        provider: this.get('WHATSAPP_PROVIDER'),
        simulated: this.get('WHATSAPP_PROVIDER') === 'simulated',
      },
      documentStorage: { driver: this.get('DOCUMENT_STORAGE') },
    } as const;
  }
}
