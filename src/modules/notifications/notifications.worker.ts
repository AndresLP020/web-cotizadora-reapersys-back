import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { NotificationsService } from './notifications.service';

/**
 * Procesa la cola de notificaciones dentro del proceso de la API: sondeo periódico y,
 * además, un ciclo inmediato después de cada envío encolado. Nunca hay dos ciclos simultáneos
 * en el mismo proceso; entre procesos, el bloqueo por documento evita envíos dobles.
 */
@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rerun = false;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('NOTIFICATIONS_WORKER_ENABLED')) return;
    const intervalMs = this.config.get('NOTIFICATIONS_POLL_SECONDS') * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    this.notifications.onEnqueued = () => setImmediate(() => void this.tick());
    this.logger.log(`Cola de notificaciones activa (cada ${intervalMs / 1000} s).`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.notifications.onEnqueued = null;
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.notifications.processDue();
      } while (this.rerun);
    } catch (error) {
      this.logger.error(`Error procesando la cola: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
