import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_DEFAULT_VERSION, API_PREFIX, configureApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    // Cuerpo crudo disponible para verificar firmas de webhooks (WhatsApp).
    rawBody: true,
  });
  configureApp(app);

  const config = app.get(AppConfigService);
  const port = config.get('PORT');
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  const base = `http://localhost:${port}/${API_PREFIX}/v${API_DEFAULT_VERSION}`;
  logger.log(`API disponible en ${base}`);
  if (config.get('SWAGGER_ENABLED')) logger.log(`Swagger en http://localhost:${port}/${API_PREFIX}/docs`);

  const { email, whatsapp } = config.integrationsStatus;
  if (email.simulated) logger.warn('Correo en modo SIMULADO: no se entregan correos reales.');
  if (whatsapp.simulated) logger.warn('WhatsApp en modo SIMULADO: no se envían mensajes reales.');
}

void bootstrap();
