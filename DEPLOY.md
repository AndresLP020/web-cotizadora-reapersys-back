# Despliegue de la API en Render (con MongoDB Atlas)

## 1. Base de datos — MongoDB Atlas

1. Crea un cluster (el plan gratuito M0 funciona) en https://cloud.mongodb.com.
2. **Database Access** → crea un usuario con contraseña (rol *Read and write to any database*).
3. **Network Access** → *Add IP Address* → `0.0.0.0/0` (Render no tiene IP fija en los planes básicos).
4. **Connect → Drivers** → copia la URL `mongodb+srv://usuario:contraseña@cluster.xxxx.mongodb.net/?retryWrites=true&w=majority`.

## 2. Servicio en Render

1. Render → **New → Blueprint** → elige este repositorio. Render lee `render.yaml`.
2. Captura las variables marcadas como manuales:

| Variable | Valor |
| --- | --- |
| `MONGODB_URI` | URL de Atlas del paso 1 |
| `PUBLIC_APP_URL` | URL del frontend, p. ej. `https://web-cotizadora-reapersys.vercel.app` (sin `/` final) |
| `CORS_ORIGINS` | La misma URL (varias separadas por coma, siempre `https://`) |
| `EMAIL_PROVIDER` | `resend` para enviar correos reales, `simulated` mientras no tengas Resend |
| `RESEND_API_KEY` | Clave de Resend (obligatoria con `resend`) |
| `EMAIL_FROM` | Remitente con dominio verificado en Resend, p. ej. `ReaperSys <avisos@tudominio.com>` |
| `EMAIL_ADMIN_NOTIFY` | Tu correo: avisos internos y resumen diario de cobranza |

`SESSION_SECRET` lo genera Render automáticamente. `TRUST_PROXY=2` ya viene configurado (proxy de Vercel + balanceador de Render).

3. Al terminar, comprueba `https://<tu-servicio>.onrender.com/api/v1/health`.

> **Plan:** `render.yaml` usa *starter* (siempre encendido). En *free* el servicio se duerme tras 15 min sin visitas:
> el primer acceso tarda ~1 min y los recordatorios de pago solo se revisan mientras está despierto.

## 3. Preparar la base de producción (una sola vez)

Desde esta carpeta en tu computadora, apuntando a Atlas (las variables de la terminal tienen prioridad sobre `.env`):

**PowerShell**
```powershell
$env:MONGODB_URI="mongodb+srv://usuario:contraseña@cluster.xxxx.mongodb.net/?retryWrites=true&w=majority"
npm run db:indexes
npm run seed
$env:ADMIN_PASSWORD="TuContraseña"; npm run user:create -- --email=tu@correo.com --name="Tu Nombre"
Remove-Item Env:MONGODB_URI, Env:ADMIN_PASSWORD
```

**Bash**
```bash
export MONGODB_URI="mongodb+srv://..."
npm run db:indexes && npm run seed
ADMIN_PASSWORD='TuContraseña' npm run user:create -- --email=tu@correo.com --name="Tu Nombre"
unset MONGODB_URI
```

- `db:indexes` crea los índices (la API no los crea sola en producción). Repítelo si una versión nueva agrega índices.
- `seed` carga el catálogo inicial; es idempotente y no sobrescribe datos existentes.

## 4. Correo (Resend)

1. Cuenta en https://resend.com → **Domains** → agrega tu dominio y crea los registros DNS que indica.
2. **API Keys** → crea una clave y ponla en `RESEND_API_KEY`; cambia `EMAIL_PROVIDER` a `resend`.
3. Sin dominio verificado, Resend solo entrega a tu propio correo: los recordatorios no llegarían a tus clientes.
