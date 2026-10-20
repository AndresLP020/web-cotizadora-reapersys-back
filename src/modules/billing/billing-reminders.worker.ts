import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { BillingService } from './billing.service';

const HOUR_MS = 60 * 60_000;
const FIRST_RUN_DELAY_MS = 30_000;

/**
 * Revisa cada hora los cobros pendientes y encola los recordatorios del día. Las claves de
 * idempotencia evitan duplicados aunque corra varias veces al día o en varios procesos.
 */
@Injectable()
export class BillingRemindersWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BillingRemindersWorker.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly billing: BillingService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('BILLING_REMINDERS_ENABLED')) return;
    const first = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    const hourly = setInterval(() => void this.tick(), HOUR_MS);
    first.unref();
    hourly.unref();
    this.timers = [first, hourly];
    this.logger.log(`Recordatorios de cobranza activos (cada hora, desde las ${this.config.get('BILLING_REMINDER_HOUR')}:00 de la Ciudad de México).`);
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.billing.runReminders();
    } catch (error) {
      this.logger.error(`Error al generar recordatorios: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
