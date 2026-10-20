import { z } from 'zod';

/**
 * Esquema de variables de entorno del backend.
 * La aplicación no arranca si la configuración es inválida o insegura.
 */

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const csvList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const dayOffsets = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.string().regex(/^\d{1,2}$/, 'Use días enteros de 0 a 90 separados por coma.').transform(Number).pipe(z.number().max(90))).max(10))
  .transform((days) => [...new Set(days)].sort((a, b) => b - a));

const optionalSecret = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Detrás de un proxy inverso (Nginx, plataforma cloud) para leer la IP real. */
    TRUST_PROXY: booleanFromString.default(false),

    /** URL pública del frontend; se usa para enlaces en correos y PDFs. */
    PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
    /** Orígenes permitidos para CORS, separados por coma. Nunca "*". */
    CORS_ORIGINS: csvList.default(['http://localhost:3000']),

    MONGODB_URI: z
      .string()
      .min(1, 'MONGODB_URI es obligatoria')
      .refine((uri) => uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'), {
        message: 'MONGODB_URI debe comenzar con mongodb:// o mongodb+srv://',
      }),
    MONGODB_DB_NAME: z.string().min(1).default('reapersys'),
    /** Crear índices automáticamente al iniciar. En producción se recomienda migrarlos. */
    MONGODB_AUTO_INDEX: booleanFromString.optional(),

    /** Secreto para firmar sesiones y tokens. Obligatorio en producción. */
    SESSION_SECRET: optionalSecret,
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    COOKIE_DOMAIN: optionalSecret,

    THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),

    SWAGGER_ENABLED: booleanFromString.optional(),

    // --- Correo transaccional ---
    EMAIL_PROVIDER: z.enum(['simulated', 'resend']).default('simulated'),
    EMAIL_FROM: z.string().default('ReaperSys <cotizaciones@example.com>'),
    EMAIL_ADMIN_NOTIFY: optionalSecret,
    RESEND_API_KEY: optionalSecret,

    // --- WhatsApp Business Platform (Cloud API) ---
    WHATSAPP_PROVIDER: z.enum(['simulated', 'meta_cloud']).default('simulated'),
    WHATSAPP_API_VERSION: z.string().default('v23.0'),
    WHATSAPP_PHONE_NUMBER_ID: optionalSecret,
    WHATSAPP_ACCESS_TOKEN: optionalSecret,
    WHATSAPP_APP_SECRET: optionalSecret,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalSecret,
    WHATSAPP_QUOTE_TEMPLATE: optionalSecret,
    /** Idioma de la plantilla aprobada en Meta (p. ej. es_MX). */
    WHATSAPP_TEMPLATE_LANGUAGE: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('es_MX'),

    // --- Cola de notificaciones ---
    /** Procesa la cola en este proceso. Desactívelo si ejecuta un worker aparte. */
    NOTIFICATIONS_WORKER_ENABLED: booleanFromString.optional(),
    NOTIFICATIONS_POLL_SECONDS: z.coerce.number().int().min(1).max(300).default(5),
    NOTIFICATIONS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),

    // --- Recordatorios de cobranza ---
    /** Revisa cada hora rentas y compras con cobro pendiente. Por defecto activo salvo en pruebas. */
    BILLING_REMINDERS_ENABLED: booleanFromString.optional(),
    /** Días ANTES del vencimiento en que se avisa al cliente (0 = el mismo día). */
    BILLING_REMINDER_DAYS_BEFORE: dayOffsets.default([5, 1, 0]),
    /** Días DESPUÉS del vencimiento en que se avisa al cliente si sigue sin pagar. */
    BILLING_REMINDER_DAYS_AFTER: dayOffsets.default([15, 7, 1]),
    /** Hora local (America/Mexico_City) a partir de la cual se envían los recordatorios del día. */
    BILLING_REMINDER_HOUR: z.coerce.number().int().min(0).max(23).default(9),

    // --- Almacenamiento de documentos PDF ---
    DOCUMENT_STORAGE: z.enum(['gridfs']).default('gridfs'),
  })
  .superRefine((env, ctx) => {
    const isProduction = env.NODE_ENV === 'production';

    if (env.CORS_ORIGINS.some((origin) => origin.includes('*'))) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'No se permiten comodines en CORS_ORIGINS; enumere los orígenes explícitamente.',
      });
    }
    for (const origin of env.CORS_ORIGINS) {
      if (!URL.canParse(origin)) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: `Origen inválido: ${origin}` });
      }
    }

    if (isProduction) {
      if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_SECRET'],
          message: 'SESSION_SECRET es obligatorio en producción y debe tener al menos 32 caracteres.',
        });
      }
      if (env.CORS_ORIGINS.some((origin) => origin.startsWith('http://'))) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'En producción los orígenes CORS deben usar https.',
        });
      }
    }

    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY es obligatoria cuando EMAIL_PROVIDER=resend.',
      });
    }

    if (env.WHATSAPP_PROVIDER === 'meta_cloud') {
      const required = [
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_APP_SECRET',
        'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
        'WHATSAPP_QUOTE_TEMPLATE',
      ] as const;
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} es obligatoria cuando WHATSAPP_PROVIDER=meta_cloud.`,
          });
        }
      }
    }
  })
  .transform((env) => ({
    ...env,
    MONGODB_AUTO_INDEX: env.MONGODB_AUTO_INDEX ?? env.NODE_ENV !== 'production',
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    NOTIFICATIONS_WORKER_ENABLED: env.NOTIFICATIONS_WORKER_ENABLED ?? env.NODE_ENV !== 'test',
    BILLING_REMINDERS_ENABLED: env.BILLING_REMINDERS_ENABLED ?? env.NODE_ENV !== 'test',
  }));

export type Env = z.infer<typeof envSchema>;

/** Usado por ConfigModule.forRoot({ validate }). Lanza un error legible si la configuración es inválida. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${details}`);
  }
  return result.data;
}
