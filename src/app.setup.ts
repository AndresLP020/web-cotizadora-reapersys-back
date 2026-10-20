import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfigService } from './config/app-config.service';

export const API_PREFIX = 'api';
export const API_DEFAULT_VERSION = '1';

/**
 * Configuración HTTP compartida por main.ts y las pruebas e2e,
 * para que ambas ejerciten exactamente las mismas protecciones.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);

  const proxyHops = config.get('TRUST_PROXY');
  if (proxyHops > 0) app.set('trust proxy', proxyHops);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser(config.get('SESSION_SECRET')));

  const allowedOrigins = new Set(config.get('CORS_ORIGINS'));
  app.enableCors({
    origin: (origin, callback) => {
      // Peticiones sin Origin (curl, server-to-server, health checks) no son CORS.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED')) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ReaperSys API')
        .setDescription('API REST de la plataforma comercial y administrativa ReaperSys.')
        .setVersion('1.0')
        .addCookieAuth('reapersys_session')
        .build(),
    );
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, document, {
      jsonDocumentUrl: `${API_PREFIX}/docs/openapi.json`,
    });
  }
}
