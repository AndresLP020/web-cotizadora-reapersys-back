/** Roles y permisos del panel administrativo. Los permisos se derivan del rol (no se asignan sueltos). */

export const ROLES = ['owner', 'admin', 'sales', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard:read',
  'catalog:read',
  'catalog:write',
  /** Ver costos de adquisición, recargos y márgenes (información privada). */
  'costs:read',
  'prices:write',
  'prices:publish',
  'quotes:read',
  'quotes:write',
  'clients:read',
  'leads:read',
  'leads:write',
  'settings:read',
  'settings:write',
  'users:manage',
  'audit:read',
  /** Rentas, compras, pagos y reportes de cobranza. */
  'billing:read',
  'billing:write',
  /** Moderar los comentarios de clientes antes de publicarlos. */
  'testimonials:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = ['dashboard:read', 'catalog:read', 'quotes:read', 'clients:read', 'leads:read', 'settings:read', 'billing:read'];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(PERMISSIONS.filter((p) => p !== 'users:manage')),
  sales: new Set<Permission>([...READ_ONLY, 'quotes:write', 'leads:write', 'billing:write', 'testimonials:manage']),
  viewer: new Set<Permission>(READ_ONLY),
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  sales: 'Asesor comercial',
  viewer: 'Solo lectura',
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
