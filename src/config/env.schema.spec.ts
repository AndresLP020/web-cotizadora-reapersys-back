import { validateEnv } from './env.schema';

const base = { MONGODB_URI: 'mongodb://localhost:27018/?replicaSet=rs0' };

describe('validateEnv', () => {
  it('aplica valores por defecto de desarrollo', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.EMAIL_PROVIDER).toBe('simulated');
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.MONGODB_AUTO_INDEX).toBe(true);
  });

  it('exige MONGODB_URI con esquema válido', () => {
    expect(() => validateEnv({})).toThrow(/MONGODB_URI/);
    expect(() => validateEnv({ MONGODB_URI: 'http://x' })).toThrow(/mongodb:\/\//);
  });

  it('rechaza comodines en CORS', () => {
    expect(() => validateEnv({ ...base, CORS_ORIGINS: '*' })).toThrow(/comodines/);
    expect(() => validateEnv({ ...base, CORS_ORIGINS: 'https://*.example.com' })).toThrow(/comodines/);
  });

  it('acepta una lista explícita de orígenes', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'http://localhost:3000, https://reapersys.mx' });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://reapersys.mx']);
  });

  describe('producción', () => {
    const prod = { ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://reapersys.mx' };

    it('exige SESSION_SECRET robusto', () => {
      expect(() => validateEnv(prod)).toThrow(/SESSION_SECRET/);
      expect(() => validateEnv({ ...prod, SESSION_SECRET: 'corto' })).toThrow(/SESSION_SECRET/);
    });

    it('exige orígenes https y desactiva Swagger/autoIndex por defecto', () => {
      const secret = 'x'.repeat(48);
      expect(() =>
        validateEnv({ ...prod, SESSION_SECRET: secret, CORS_ORIGINS: 'http://reapersys.mx' }),
      ).toThrow(/https/);
      const env = validateEnv({ ...prod, SESSION_SECRET: secret });
      expect(env.SWAGGER_ENABLED).toBe(false);
      expect(env.MONGODB_AUTO_INDEX).toBe(false);
    });
  });

  it('exige credenciales cuando un proveedor real está activo', () => {
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() => validateEnv({ ...base, WHATSAPP_PROVIDER: 'meta_cloud' })).toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it('lee los días de recordatorio de cobranza', () => {
    const defaults = validateEnv(base);
    expect(defaults.BILLING_REMINDER_DAYS_BEFORE).toEqual([5, 1, 0]);
    expect(defaults.BILLING_REMINDER_DAYS_AFTER).toEqual([15, 7, 1]);
    expect(defaults.BILLING_REMINDER_HOUR).toBe(9);
    const env = validateEnv({ ...base, BILLING_REMINDER_DAYS_BEFORE: '3, 0, 3', BILLING_REMINDER_DAYS_AFTER: '' });
    expect(env.BILLING_REMINDER_DAYS_BEFORE).toEqual([3, 0]);
    expect(env.BILLING_REMINDER_DAYS_AFTER).toEqual([]);
    expect(() => validateEnv({ ...base, BILLING_REMINDER_DAYS_BEFORE: 'x' })).toThrow(/BILLING_REMINDER_DAYS_BEFORE/);
  });

  it('trata cadenas vacías de secretos como ausentes', () => {
    const env = validateEnv({ ...base, RESEND_API_KEY: '', SESSION_SECRET: '   ' });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
  });
});
