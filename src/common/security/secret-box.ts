import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifrado autenticado (AES-256-GCM) para guardar secretos que el servidor necesita recuperar,
 * como el token de acceso de una cotización para incluir su enlace en correos posteriores.
 * La llave se deriva de SESSION_SECRET (obligatorio en producción) con HKDF y un contexto propio.
 */
const DEV_SECRET = 'reapersys-dev-only-secret-not-for-production';
const VERSION = 'v1';

function keyFor(secret: string | undefined, context: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret ?? DEV_SECRET, 'reapersys', context, 32));
}

export function seal(plaintext: string, secret: string | undefined, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, context), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Devuelve null si el texto fue alterado o se cifró con otra llave. */
export function open(sealed: string, secret: string | undefined, context: string): string | null {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret, context), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
