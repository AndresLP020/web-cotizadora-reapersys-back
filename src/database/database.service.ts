import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';

interface HelloResponse {
  setName?: string;
  msg?: string;
}

@Injectable()
export class DatabaseService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseService.name);
  private transactionsSupported = false;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onApplicationBootstrap(): Promise<void> {
    this.transactionsSupported = await this.detectTransactionSupport();
    if (this.transactionsSupported) {
      this.logger.log(`MongoDB conectado (${this.connection.name}); transacciones disponibles.`);
    } else {
      this.logger.warn(
        'MongoDB standalone detectado: las transacciones multi-documento NO están disponibles. ' +
          'Use un replica set (docker compose) o MongoDB Atlas.',
      );
    }
  }

  get supportsTransactions(): boolean {
    return this.transactionsSupported;
  }

  /**
   * Ejecuta `work` dentro de una transacción si el despliegue la soporta.
   * Las operaciones que exigen consistencia estricta deben usar `requireTransaction: true`
   * para fallar explícitamente en lugar de ejecutarse sin garantías.
   */
  async withTransaction<T>(
    work: (session: ClientSession | null) => Promise<T>,
    options: { requireTransaction?: boolean } = {},
  ): Promise<T> {
    if (!this.transactionsSupported) {
      if (options.requireTransaction) {
        throw new Error('Esta operación requiere transacciones y MongoDB no las soporta en este despliegue.');
      }
      return work(null);
    }
    return this.connection.transaction((session) => work(session));
  }

  async ping(): Promise<boolean> {
    const db = this.connection.db;
    if (!db) return false;
    const result = await db.admin().ping();
    return result.ok === 1;
  }

  private async detectTransactionSupport(): Promise<boolean> {
    const db = this.connection.db;
    if (!db) return false;
    const hello = (await db.admin().command({ hello: 1 })) as HelloResponse;
    // Replica sets reportan setName; mongos (clúster fragmentado) reporta msg = 'isdbgrid'.
    return Boolean(hello.setName) || hello.msg === 'isdbgrid';
  }
}
