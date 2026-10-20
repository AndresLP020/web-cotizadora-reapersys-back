import { randomBytes } from 'node:crypto';

// Alfabeto Crockford base32 sin caracteres ambiguos (I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Genera una referencia pública aleatoria y no secuencial, p. ej. "RS-7K2M9QXA".
 * 8 caracteres base32 = 40 bits de entropía: suficiente para referencias legibles,
 * NO para autorizar acceso (para eso se usan tokens de 256 bits).
 */
export function generatePublicReference(prefix = 'RS', length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}-${out}`;
}

/** Token aleatorio de alta entropía para URLs de acceso (p. ej. /cotizacion/[token]). */
export function generateAccessToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
