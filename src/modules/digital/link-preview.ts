import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { BlockList, isIP } from 'node:net';

/**
 * Lectura de la vista previa de un enlace (etiquetas Open Graph), como hace WhatsApp.
 * Las URLs las captura un administrador, pero igual se protege el servidor contra SSRF:
 * - solo https, sin usuario ni contraseña en la URL;
 * - el DNS se resuelve y se rechazan IPs privadas, loopback, link-local y de metadata;
 *   la conexión se abre contra la IP ya validada (evita el «DNS rebinding»);
 * - cada redirección se revalida (máximo 3);
 * - 5 s de tiempo máximo y lectura acotada (1 MB de HTML).
 * Nunca se llama desde el sitio público: solo desde el panel.
 */

export interface PreviewMeta {
  title?: string;
  description?: string;
  siteName?: string;
  /** URL absoluta de la imagen de la página, si la declara. */
  imageUrl?: string;
  /** URL absoluta del ícono del sitio (declarado o /favicon.ico). */
  faviconUrl?: string;
  /** Dominio final de la página (tras redirecciones), sin «www.». */
  domain: string;
}

export interface DownloadedImage {
  content: Buffer;
  contentType: string;
}

export class LinkPreviewError extends Error {
  override name = 'LinkPreviewError';
}

export const TIMEOUT_MS = 5_000;
export const MAX_HTML_BYTES = 1_000_000;
export const MAX_IMAGE_BYTES = 3_000_000;
export const MAX_FAVICON_BYTES = 200_000;
export const MAX_REDIRECTS = 3;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const FAVICON_TYPES = [...IMAGE_TYPES, 'image/x-icon', 'image/vnd.microsoft.icon'];
const USER_AGENT = 'ReaperSysLinkPreview/1.0 (+vista previa del catálogo)';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

/** true si la IP es privada, local, reservada, de metadata o de multidifusión. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  // IPv4 mapeada en IPv6 (::ffff:10.0.0.1).
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

// ---------------------------------------------------------------- dependencias (inyectables en pruebas)

/** Resuelve un host a sus IPs. */
export type Resolver = (host: string) => Promise<string[]>;

export interface RawResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  /** Cierra la conexión sin leer el resto. */
  abort(): void;
}

/** Abre una petición GET contra una IP ya validada para el host de la URL. */
export type Transport = (url: URL, address: string, accept: string) => Promise<RawResponse>;

export interface PreviewDeps {
  resolve: Resolver;
  transport: Transport;
}

const systemResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** https.request fijado a la IP validada: el host se usa para SNI y el encabezado Host, nunca se vuelve a resolver. */
const httpsTransport: Transport = (url, address, accept) =>
  new Promise((resolve, reject) => {
    const family = isIP(address);
    const pinned: LookupFunction = (_host, options, callback) => {
      if (typeof options === 'object' && options && 'all' in options && options.all) {
        (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
      } else {
        callback(null, address, family);
      }
    };
    const req = httpsRequest(
      url,
      { method: 'GET', lookup: pinned, timeout: TIMEOUT_MS, headers: { 'User-Agent': USER_AGENT, Accept: accept } },
      (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(res.headers)) headers[key] = Array.isArray(value) ? value.join(', ') : value;
        resolve({ status: res.statusCode ?? 0, headers, body: res, abort: () => res.destroy() });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', reject);
    req.end();
  });

export const defaultDeps: PreviewDeps = { resolve: systemResolver, transport: httpsTransport };

// ---------------------------------------------------------------- validación y descarga

/** Valida que la URL sea https pública. Devuelve la URL y una IP pública ya verificada. */
export async function assertPublicUrl(raw: string, resolve: Resolver = defaultDeps.resolve): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkPreviewError('La URL no es válida.');
  }
  if (url.protocol !== 'https:') throw new LinkPreviewError('Solo se admiten URLs https.');
  if (url.username || url.password) throw new LinkPreviewError('La URL no debe incluir usuario ni contraseña.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
  if (addresses.length === 0) throw new LinkPreviewError('No se encontró el sitio de la URL.');
  // Si cualquiera de las IPs del host es privada se rechaza (no se elige «la buena»).
  if (addresses.some(isPrivateAddress)) throw new LinkPreviewError('La URL apunta a una dirección privada.');
  return { url, address: addresses[0]! };
}

/** GET con redirecciones manuales (cada destino se revalida) y lectura acotada. */
export async function safeGet(
  raw: string,
  accept: string,
  maxBytes: number,
  deps: PreviewDeps = defaultDeps,
): Promise<{ url: URL; contentType: string; body: Buffer }> {
  let target = await assertPublicUrl(raw, deps.resolve);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await withTimeout(deps.transport(target.url, target.address, accept)).catch((error: unknown) => {
      if (error instanceof LinkPreviewError) throw error;
      throw new LinkPreviewError(`No se pudo abrir la página (${(error as Error).name === 'TimeoutError' ? 'tiempo agotado' : 'sin conexión'}).`);
    });
    if (response.status >= 300 && response.status < 400) {
      response.abort();
      const location = response.headers.location;
      if (!location) throw new LinkPreviewError('Redirección sin destino.');
      if (hop === MAX_REDIRECTS) break;
      target = await assertPublicUrl(new URL(location, target.url).toString(), deps.resolve);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      response.abort();
      throw new LinkPreviewError(`La página respondió con error ${response.status}.`);
    }
    const declared = Number(response.headers['content-length'] ?? 0);
    if (declared > maxBytes) {
      response.abort();
      throw new LinkPreviewError('El contenido es demasiado grande.');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const deadline = Date.now() + TIMEOUT_MS;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        response.abort();
        throw new LinkPreviewError('El contenido es demasiado grande.');
      }
      if (Date.now() > deadline) {
        response.abort();
        throw new LinkPreviewError('No se pudo abrir la página (tiempo agotado).');
      }
      chunks.push(Buffer.from(chunk));
    }
    const contentType = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    return { url: target.url, contentType, body: Buffer.concat(chunks) };
  }
  throw new LinkPreviewError('Demasiadas redirecciones.');
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- lectura de metadatos

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z0-9#]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function clean(text: string | undefined, max: number): string | undefined {
  const value = text ? decodeEntities(text).replace(/\s+/g, ' ').trim() : '';
  return value ? value.slice(0, max) : undefined;
}

function attributesOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(/([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    attrs.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/** Convierte una URL relativa en absoluta; solo acepta https. */
function absoluteHttps(value: string | undefined, base: URL): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function domainOf(url: URL | string): string {
  try {
    return (typeof url === 'string' ? new URL(url) : url).hostname.replace(/^www\./, '');
  } catch {
    return String(url);
  }
}

/** Lee título, descripción, sitio, imagen e ícono de las etiquetas Open Graph / Twitter / HTML. */
export function parsePreviewMeta(html: string, pageUrl: URL): PreviewMeta {
  const head = html.slice(0, 300_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributesOf(tag);
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  let iconHref: string | undefined;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = attributesOf(tag);
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('icon') || rel.includes('apple-touch-icon')) {
      // Se prefiere el ícono normal; apple-touch-icon solo si no hay otro.
      if (!iconHref || rel.includes('icon')) iconHref = attrs.get('href');
      if (rel.includes('icon')) break;
    }
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const image = meta.get('og:image:secure_url') ?? meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? meta.get('twitter:image:src');
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag, 200),
    description: clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'), 400),
    siteName: clean(meta.get('og:site_name'), 120),
    imageUrl: absoluteHttps(image, pageUrl),
    faviconUrl: absoluteHttps(iconHref, pageUrl) ?? absoluteHttps('/favicon.ico', pageUrl),
    domain: domainOf(pageUrl),
  };
}

/** Descarga la página y lee su vista previa. */
export async function fetchPreviewMeta(url: string, deps: PreviewDeps = defaultDeps): Promise<PreviewMeta> {
  const page = await safeGet(url, 'text/html,application/xhtml+xml', MAX_HTML_BYTES, deps);
  if (page.contentType !== 'text/html' && page.contentType !== 'application/xhtml+xml') throw new LinkPreviewError('La URL no es una página web (HTML).');
  return parsePreviewMeta(page.body.toString('utf8'), page.url);
}

/** Tipo real de la imagen por sus primeros bytes (no se confía en el tipo declarado). */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0) return 'image/x-icon';
  return null;
}

/** Descarga una imagen con las mismas restricciones; el tipo se comprueba por sus bytes. */
export async function downloadImage(url: string, kind: 'image' | 'favicon' = 'image', deps: PreviewDeps = defaultDeps): Promise<DownloadedImage> {
  const allowed = kind === 'image' ? IMAGE_TYPES : FAVICON_TYPES;
  const image = await safeGet(url, allowed.join(','), kind === 'image' ? MAX_IMAGE_BYTES : MAX_FAVICON_BYTES, deps);
  const sniffed = sniffImageType(image.body);
  if (!sniffed || !allowed.includes(sniffed)) throw new LinkPreviewError('La imagen de la página no es PNG, JPEG, WebP ni GIF.');
  return { content: image.body, contentType: sniffed };
}
