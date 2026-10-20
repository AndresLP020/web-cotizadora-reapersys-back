import { createHmac } from 'node:crypto';

const DEV_PEPPER = 'reapersys-dev-ip-pepper';

/** HMAC-SHA256 de una IP: permite correlacionar abuso sin almacenar la IP en claro. */
export function hashIp(ip: string, secret: string | undefined): string {
  return createHmac('sha256', secret ?? DEV_PEPPER).update(ip).digest('hex');
}
