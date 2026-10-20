import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';

@ApiTags('Sistema')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estado del servicio, la base de datos y las integraciones (sin secretos).' })
  async check(@Res({ passthrough: true }) res: Response) {
    const databaseUp = await this.database.ping().catch(() => false);
    if (!databaseUp) res.status(HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: databaseUp ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      database: {
        up: databaseUp,
        transactions: this.database.supportsTransactions,
      },
      integrations: this.config.integrationsStatus,
    };
  }
}
