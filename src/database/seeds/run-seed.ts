import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../../config/config.module';
import { AuditModule } from '../../modules/audit/audit.module';
import { DatabaseModule } from '../database.module';
import { SeedModule } from './seed.module';
import { SeedService } from './seed.service';

@Module({ imports: [AppConfigModule, DatabaseModule, AuditModule, SeedModule] })
class SeedRootModule {}

/** `npm run seed` — carga el catálogo inicial sin sobrescribir datos existentes. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedRootModule, { logger: ['log', 'warn', 'error'] });
  try {
    await app.init();
    await app.get(SeedService).run();
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('Seed').error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
