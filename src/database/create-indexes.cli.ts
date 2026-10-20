import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * `npm run db:indexes` — crea los índices declarados en los esquemas (únicos, TTL, parciales).
 * En producción la API no los crea al arrancar (MONGODB_AUTO_INDEX=false): se ejecuta este comando
 * en cada despliegue. Solo CREA los que faltan; nunca elimina índices existentes.
 */
async function main(): Promise<void> {
  process.env.NOTIFICATIONS_WORKER_ENABLED = 'false';
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const connection = app.get<Connection>(getConnectionToken());
    for (const name of connection.modelNames().sort()) {
      const model = connection.model(name);
      await model.createIndexes();
      const indexes = await model.listIndexes();
      process.stdout.write(`${model.collection.collectionName.padEnd(26)} ${indexes.length} índices\n`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('db:indexes').error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
