import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Lectura de la vista previa de un enlace (etiquetas Open Graph), como hace WhatsApp.
 * Las URLs las captura un administrador, pero igual se protege el servidor (SSRF):
 * solo http(s), nunca direcciones privadas o locales, redirecciones revalidadas,
 * tiempo y tamaño limitados.
 */

export interface PreviewMeta {
  title?: string;
  description?: string;
  siteName?: string;
  /** URL absoluta de la imagen de la página, si la declara. */
  imageUrl?: string;
}

export interface DownloadedImage {
  content: Buffer;
  contentType: string;
}

export class LinkPreviewError extends Error {
  override name = 'LinkPreviewError';
}

const TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 1_500_000;
export const MAX_IMAGE_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
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
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

/** true si la IP es privada, local, reservada o de multidifusión. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  // IPv4 mapeada en IPv6 (::ffff:10.0.0.1).
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** Valida que la URL sea http(s) pública. Devuelve la URL normalizada. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkPreviewError('La URL no es válida.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new LinkPreviewError('Solo se admiten URLs http o https.');
  if (url.username || url.password) throw new LinkPreviewError('La URL no debe incluir usuario ni contraseña.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new LinkPreviewError('No se encontró el sitio de la URL.');
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new LinkPreviewError('La URL apunta a una dirección privada.');
  return url;
}

/** GET con redirecciones manuales (cada destino se revalida) y lectura acotada. */
async function safeGet(raw: string, accept: string, maxBytes: number): Promise<{ url: URL; contentType: string; body: Buffer }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
    }).catch((error: unknown) => {
      throw new LinkPreviewError(`No se pudo abrir la página (${(error as Error).name === 'TimeoutError' ? 'tiempo agotado' : 'sin conexión'}).`);
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new LinkPreviewError('Redirección sin destino.');
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new LinkPreviewError(`La página respondió con error ${response.status}.`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new LinkPreviewError('El contenido es demasiado grande.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += (chunk as Uint8Array).byteLength;
      if (size > maxBytes) throw new LinkPreviewError('El contenido es demasiado grande.');
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return { url, contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(), body: Buffer.concat(chunks) };
  }
  throw new LinkPreviewError('Demasiadas redirecciones.');
}

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

/** Lee título, descripción, sitio e imagen de las etiquetas Open Graph / Twitter / HTML. */
export function parsePreviewMeta(html: string, pageUrl: URL): PreviewMeta {
  const head = html.slice(0, 300_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      attrs.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const image = meta.get('og:image:secure_url') ?? meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? meta.get('twitter:image:src');
  let imageUrl: string | undefined;
  if (image) {
    try {
      imageUrl = new URL(decodeEntities(image.trim()), pageUrl).toString();
    } catch {
      imageUrl = undefined;
    }
  }
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag, 200),
    description: clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'), 400),
    siteName: clean(meta.get('og:site_name'), 120),
    imageUrl,
  };
}

/** Descarga la página y lee su vista previa. */
export async function fetchPreviewMeta(url: string): Promise<PreviewMeta> {
  const page = await safeGet(url, 'text/html,application/xhtml+xml', MAX_HTML_BYTES);
  if (page.contentType && !page.contentType.includes('html')) throw new LinkPreviewError('La URL no es una página web.');
  return parsePreviewMeta(page.body.toString('utf8'), page.url);
}

/** Descarga la imagen de la vista previa (solo PNG, JPEG, WebP o GIF). */
export async function downloadPreviewImage(url: string): Promise<DownloadedImage> {
  const image = await safeGet(url, IMAGE_TYPES.join(','), MAX_IMAGE_BYTES);
  if (!IMAGE_TYPES.includes(image.contentType)) throw new LinkPreviewError('La imagen de la página no es PNG, JPEG, WebP ni GIF.');
  return { content: image.body, contentType: image.contentType };
}
