import type { PackageCategory } from '../../catalog/catalog.constants';

/** Mantenimiento del sitio o la tienda: en renta ya va dentro de la mensualidad. */
export const SITE_MAINTENANCE_SLUGS = ['maintenance-web-basic', 'maintenance-web-business', 'maintenance-ecommerce'];

/** Servicios recurrentes que aplican a cada tipo de paquete. */
export const RECURRING_BY_CATEGORY: Record<PackageCategory, string[]> = {
  web: ['maintenance-web-basic', 'maintenance-web-business'],
  ecommerce: ['maintenance-ecommerce'],
  pos: ['support-pos'],
  combo: ['maintenance-ecommerce', 'support-pos'],
  custom: ['support-pos', 'integration-monitoring'],
};

/** Servicios que solo tienen sentido si la cotización conecta con un tercero. */
export const INTEGRATION_SERVICE_SLUGS = ['integration-monitoring', 'software-licenses'];

/** Integraciones y pasarelas con terceros (incluidas o agregadas). */
export const INTEGRATION_SLUGS = [
  'whatsapp-business-api',
  'crm-integration',
  'chatbot',
  'stripe-payments',
  'mercadopago-payments',
  'payment-gateway',
  'pos-ecommerce-sync',
];

/**
 * Indica si un servicio recurrente se puede contratar con el paquete.
 * Sin paquete (desde cero) se acepta cualquiera: un asesor valora la solución.
 */
export function recurringApplies(
  slug: string,
  context: { category: PackageCategory | null; renting: boolean; hasIntegration: boolean },
): { ok: true } | { ok: false; reason: 'included_in_rental' | 'not_applicable' } {
  if (context.category === null) return { ok: true };
  if (context.renting && SITE_MAINTENANCE_SLUGS.includes(slug)) return { ok: false, reason: 'included_in_rental' };
  if (RECURRING_BY_CATEGORY[context.category].includes(slug)) return { ok: true };
  if (INTEGRATION_SERVICE_SLUGS.includes(slug) && context.hasIntegration) return { ok: true };
  return { ok: false, reason: 'not_applicable' };
}
