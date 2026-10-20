import { generatePassword, hashPassword, passwordPolicyError, verifyPassword } from './password';
import { hasPermission, ROLES } from './roles';

describe('contraseñas', () => {
  it('genera hashes con sal distinta y los verifica', async () => {
    const a = await hashPassword('Clave-Segura-2026');
    const b = await hashPassword('Clave-Segura-2026');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    await expect(verifyPassword('Clave-Segura-2026', a)).resolves.toBe(true);
    await expect(verifyPassword('clave-segura-2026', a)).resolves.toBe(false);
  });

  it('rechaza hashes con formato desconocido', async () => {
    await expect(verifyPassword('x', 'bcrypt$abc')).resolves.toBe(false);
  });

  it('aplica la política mínima', () => {
    expect(passwordPolicyError('Corta-1')).toMatch(/8 caracteres/);
    expect(passwordPolicyError('todominusculassinnada')).toMatch(/tres de/);
    expect(passwordPolicyError('Larga-y-Segura-1')).toBeNull();
    expect(passwordPolicyError(generatePassword())).toBeNull();
  });
});

describe('roles', () => {
  it('solo propietario y administrador ven costos; solo el propietario gestiona usuarios', () => {
    expect(ROLES.filter((r) => hasPermission(r, 'costs:read'))).toEqual(['owner', 'admin']);
    expect(ROLES.filter((r) => hasPermission(r, 'users:manage'))).toEqual(['owner']);
    expect(ROLES.filter((r) => hasPermission(r, 'prices:publish'))).toEqual(['owner', 'admin']);
  });

  it('el rol de solo lectura no modifica nada', () => {
    const writes = ['catalog:write', 'prices:write', 'prices:publish', 'quotes:write', 'leads:write', 'settings:write', 'users:manage'] as const;
    expect(writes.some((p) => hasPermission('viewer', p))).toBe(false);
  });
});
