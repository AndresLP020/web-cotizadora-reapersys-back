/**
 * Constantes compartidas de los productos digitales (detalles personalizables y tarjetas NFC).
 * Las claves son el contrato con el frontend: no cambiarlas sin migrar los datos.
 */

/** Datos que una plantilla de detalle puede pedir al cliente. */
export const FIELD_KEYS = ['recipientName', 'senderName', 'title', 'message', 'date', 'photos', 'song', 'place', 'rsvp'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  recipientName: 'Para quién es',
  senderName: 'De parte de',
  title: 'Título',
  message: 'Mensaje especial',
  date: 'Fecha especial',
  photos: 'Fotos',
  song: 'Canción',
  place: 'Lugar y hora',
  rsvp: 'Confirmar asistencia (WhatsApp)',
};

/** Longitud máxima de cada dato de texto (el campo `max` de la plantilla puede bajarla, nunca subirla). */
export const FIELD_MAX_LENGTH: Record<Exclude<FieldKey, 'photos'>, number> = {
  recipientName: 60,
  senderName: 60,
  title: 80,
  message: 1000,
  date: 10,
  song: 300,
  place: 200,
  rsvp: 20,
};

/** Fotos que sube el cliente: máximo por pedido (cada plantilla puede pedir menos), peso y tipos. */
export const MAX_ORDER_PHOTOS = 6;
export const MAX_ORDER_PHOTO_BYTES = 5_000_000;
export const ORDER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Tarjetas NFC: para quién es la tarjeta y qué lleva su página. */
export const NFC_AUDIENCES = ['person', 'business', 'team'] as const;
export type NfcAudience = (typeof NFC_AUDIENCES)[number];
export const NFC_AUDIENCE_LABELS: Record<NfcAudience, string> = { person: 'Persona', business: 'Negocio', team: 'Equipo' };

export const NFC_INCLUDES = ['saveContact', 'whatsapp', 'callEmail', 'location', 'social', 'portfolio'] as const;
export type NfcInclude = (typeof NFC_INCLUDES)[number];
export const NFC_INCLUDE_LABELS: Record<NfcInclude, string> = {
  saveContact: 'Guardar contacto',
  whatsapp: 'WhatsApp',
  callEmail: 'Llamar y correo',
  location: 'Ubicación',
  social: 'Redes sociales',
  portfolio: 'Sitio o portafolio',
};

/** Tramos de cantidad de tarjetas. El último (50+) siempre se cotiza. */
export const NFC_QUANTITY_TIERS = [1, 10, 25, 50] as const;
export type NfcQuantityTier = (typeof NFC_QUANTITY_TIERS)[number];
export const NFC_QUOTE_ONLY_TIER: NfcQuantityTier = 50;

export const PRODUCT_STATUSES = ['draft', 'published'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Estado de entrega de un pedido digital (independiente del estado comercial del prospecto). */
export const FULFILLMENT_STATUSES = ['new', 'in_progress', 'delivered'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/** Bucket de GridFS para portadas, íconos e imágenes de diseños (públicas). */
export const PRODUCT_IMAGES_BUCKET = 'digital_template_images';
/** Bucket de GridFS para las fotos que suben los clientes (privadas: solo el panel). */
export const ORDER_PHOTOS_BUCKET = 'digital_order_photos';

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const SLUG_PATTERN = /^[a-z0-9-]{2,80}$/;
