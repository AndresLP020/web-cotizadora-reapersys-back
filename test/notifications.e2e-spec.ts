import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import type { EmailMessage, SendResult, WhatsAppTemplateMessage } from '../src/modules/notifications/providers/provider.types';

// WhatsApp "real" (credenciales de prueba) para habilitar el webhook; los envíos usan dobles de prueba.
process.env.WHATSAPP_PROVIDER = 'meta_cloud';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-me';
process.env.WHATSAPP_QUOTE_TEMPLATE = 'cotizacion_pdf';
process.env.EMAIL_ADMIN_NOTIFY = 'ventas@example.com';

const COLLECTIONS = [
  'categories', 'industries', 'components', 'component_prices', 'packages', 'package_prices', 'compatibility_rules', 'business_settings', 'operating_costs',
  'audit_logs', 'quotes', 'quote_versions', 'counters', 'clients', 'leads', 'users', 'sessions', 'notification_deliveries', 'quote_documents',
  'quote_documents.files', 'quote_documents.chunks',
];

/** Doble de prueba: registra los envíos y permite programar fallos. */
class FakeEmail {
  readonly name = 'fake-email';
  simulated = false;
  sent: EmailMessage[] = [];
  failures: Error[] = [];
  send(message: EmailMessage): Promise<SendResult> {
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `email-${this.sent.length}`, simulated: this.simulated });
  }
}
class FakeWhatsApp {
  readonly name = 'fake-whatsapp';
  simulated = false;
  sent: WhatsAppTemplateMessage[] = [];
  sendQuoteTemplate(message: WhatsAppTemplateMessage): Promise<SendResult> {
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `wamid.${this.sent.length}`, simulated: this.simulated });
  }
}

describe('PDF, correo y WhatsApp (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let http: ReturnType<typeof request>;
  let notifications: import('../src/modules/notifications/notifications.service').NotificationsService;
  const email = new FakeEmail();
  const whatsapp = new FakeWhatsApp();

  const createQuote = (packageSlug: string, extra: object = {}) =>
    http
      .post('/api/v1/quotes')
      .send({
        selection: { packageSlug },
        client: { name: 'Ana Ruiz', company: 'Boutique Ana', email: 'ana@example.com', whatsapp: '5215512345678' },
        consents: { contact: true, whatsapp: true },
        channels: { email: true, whatsapp: true },
        ...extra,
      })
      .expect(201);

  beforeAll(async () => {
    // Importación diferida: las variables de entorno anteriores deben existir al cargar la configuración.
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const { SeedModule } = await import('../src/database/seeds/seed.module');
    const { SeedService } = await import('../src/database/seeds/seed.service');
    const { EMAIL_PROVIDER, WHATSAPP_PROVIDER } = await import('../src/modules/notifications/providers/provider.types');
    const { NotificationsService } = await import('../src/modules/notifications/notifications.service');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SeedModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(email)
      .overrideProvider(WHATSAPP_PROVIDER)
      .useValue(whatsapp)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    for (const name of COLLECTIONS) await connection.collection(name).deleteMany({});
    await app.get(SeedService).run();
    await connection.collection('business_settings').updateOne({ key: 'default' }, { $set: { 'tax.confirmed': true, 'quote.validityDays': 15 } });
    notifications = app.get(NotificationsService);
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('cotización emitida', () => {
    let token: string;
    let folio: string;

    it('responde el estado real de cada entrega y encola correo, WhatsApp y aviso interno', async () => {
      const res = await createQuote('landing-page');
      token = res.body.accessToken;
      folio = res.body.folio;
      expect(res.body.status).toBe('issued');
      expect(res.body.deliveries).toEqual({
        pdf: { status: 'available', message: expect.any(String) },
        email: { status: 'queued', message: expect.stringContaining('a***@example.com') },
        whatsapp: { status: 'queued', message: expect.stringContaining('***5678') },
      });
      const queued = await connection.collection('notification_deliveries').find({}).toArray();
      expect(queued.map((d) => `${d.channel}/${d.kind}/${d.status}`).sort()).toEqual([
        'email/admin_new_quote/queued',
        'email/quote_issued/queued',
        'whatsapp/quote_issued/queued',
      ]);
      // El token solo existe cifrado y como hash.
      const quote = await connection.collection('quotes').findOne({ folio });
      expect(quote?.access.tokenCiphertext).toMatch(/^v1\./);
      expect(JSON.stringify(quote)).not.toContain(token);
    });

    it('el worker envía el PDF por correo y WhatsApp con el enlace correcto y marca la cotización como enviada', async () => {
      expect(await notifications.processDue()).toBe(3);

      const toClient = email.sent.find((m) => m.to === 'ana@example.com')!;
      expect(toClient.subject).toContain(folio);
      expect(toClient.attachments?.[0]?.filename).toBe(`${folio}.pdf`);
      expect(toClient.attachments?.[0]?.content.subarray(0, 5).toString()).toBe('%PDF-');
      expect(toClient.html).toContain(`/cotizacion/${token}`);
      expect(toClient.text).toContain('$4,058.84');

      const toAdmin = email.sent.find((m) => m.to === 'ventas@example.com')!;
      expect(toAdmin.subject).toContain(`Nueva cotización ${folio}`);
      expect(toAdmin.html).toContain('/admin/cotizaciones/');

      expect(whatsapp.sent[0]).toMatchObject({ to: '5215512345678', bodyParams: ['Ana Ruiz', folio, '$4,058.84 MXN'] });
      expect(whatsapp.sent[0]!.document.content.equals(toClient.attachments![0]!.content)).toBe(true);

      const quote = await connection.collection('quotes').findOne({ folio });
      expect(quote?.status).toBe('sent');
      expect(await connection.collection('notification_deliveries').countDocuments({ status: 'sent' })).toBe(3);
    });

    it('el PDF se genera una sola vez por versión y se descarga por el enlace seguro', async () => {
      const res = await http.get(`/api/v1/quotes/access/${token}/pdf`).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toContain(`${folio}.pdf`);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const quote = await connection.collection('quotes').findOne({ folio });
      expect(await connection.collection('quote_documents').countDocuments({ quote: quote?._id })).toBe(1);
      await http.get(`/api/v1/quotes/access/${'z'.repeat(43)}/pdf`).expect(404);
    });

    it('encolar de nuevo el mismo envío automático no lo duplica (idempotencia)', async () => {
      const quote = await connection.collection('quotes').findOne({ folio });
      await notifications.scheduleForNewQuote(quote!._id);
      expect(await notifications.processDue()).toBe(0);
      expect(await connection.collection('notification_deliveries').countDocuments({ quote: quote?._id })).toBe(3);
    });
  });

  describe('solicitud en revisión', () => {
    it('envía solo un acuse sin PDF y pospone WhatsApp', async () => {
      email.sent = [];
      whatsapp.sent = [];
      const res = await createQuote('punto-de-venta', { selection: { packageSlug: 'punto-de-venta', components: [{ slug: 'pos-returns', quantity: 1 }] } });
      expect(res.body.status).toBe('needs_review');
      expect(res.body.deliveries.whatsapp.status).toBe('deferred');
      await notifications.processDue();
      const ack = email.sent.find((m) => m.to === 'ana@example.com')!;
      expect(ack.subject).toContain('Recibimos tu solicitud');
      expect(ack.attachments).toBeUndefined();
      expect(ack.html).toContain('preliminares');
      expect(whatsapp.sent).toHaveLength(0);
    });
  });

  describe('reintentos y fallos', () => {
    it('un error temporal se reintenta con espera; uno permanente falla y puede reintentarse manualmente', async () => {
      const { DeliveryError } = await import('../src/modules/notifications/providers/provider.types');
      email.sent = [];
      email.failures = [new DeliveryError('Resend respondió 503', false)];
      const res = await createQuote('web-corporativa', { channels: { email: true, whatsapp: false } });
      const quote = await connection.collection('quotes').findOne({ folio: res.body.folio });
      const filter = { quote: quote?._id, kind: 'quote_issued' };

      await notifications.processDue();
      let delivery = await connection.collection('notification_deliveries').findOne(filter);
      expect(delivery).toMatchObject({ status: 'queued', attempts: 1, lastError: 'Resend respondió 503' });
      expect(delivery!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      // Al vencer la espera, el reintento tiene éxito.
      await connection.collection('notification_deliveries').updateOne(filter, { $set: { nextAttemptAt: new Date() } });
      await notifications.processDue();
      delivery = await connection.collection('notification_deliveries').findOne(filter);
      expect(delivery).toMatchObject({ status: 'sent', attempts: 2 });

      // Error permanente: falla sin reintentos automáticos.
      email.failures = [new DeliveryError('Resend respondió 422: correo inválido', true)];
      const second = await createQuote('landing-page', { channels: { email: true, whatsapp: false }, client: { name: 'Beto', email: 'beto@example.com' } });
      const q2 = await connection.collection('quotes').findOne({ folio: second.body.folio });
      await notifications.processDue();
      const failed = await connection.collection('notification_deliveries').findOne({ quote: q2?._id, kind: 'quote_issued' });
      expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
    });

    it('un worker caído a mitad de un envío libera el bloqueo al vencer', async () => {
      const stuck = await connection.collection('notification_deliveries').findOne({ status: 'sent' });
      await connection.collection('notification_deliveries').updateOne({ _id: stuck!._id }, { $set: { status: 'sending', lockedUntil: new Date(Date.now() - 1000) } });
      await notifications.processDue();
      expect((await connection.collection('notification_deliveries').findOne({ _id: stuck!._id }))?.status).toBe('sent');
    });
  });

  describe('panel: envíos manuales', () => {
    let agent: ReturnType<typeof request.agent>;
    let csrf: string;

    beforeAll(async () => {
      const { hashPassword } = await import('../src/security/password');
      const { User } = await import('../src/security/schemas/user.schema');
      const users = app.get<Model<unknown>>(getModelToken(User.name));
      await users.create({ email: 'owner@example.com', name: 'Owner', role: 'owner', passwordHash: await hashPassword('Clave-Segura-2026'), active: true, passwordChangedAt: new Date() });
      agent = request.agent(app.getHttpServer());
      csrf = (await agent.post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'Clave-Segura-2026' }).expect(200)).body.csrfToken;
    });

    it('reenvía una cotización emitida, lista los envíos y reintenta los fallidos', async () => {
      const list = await agent.get('/api/v1/admin/quotes?q=beto').expect(200);
      const id = list.body.items[0].id;
      const detail = await agent.get(`/api/v1/admin/quotes/${id}`).expect(200);
      const failed = detail.body.deliveries.find((d: { status: string }) => d.status === 'failed');
      expect(failed).toMatchObject({ channel: 'email', recipient: 'b***@example.com', lastError: expect.stringContaining('422') });
      expect(JSON.stringify(detail.body.deliveries)).not.toContain('beto@example.com');

      await agent.post(`/api/v1/admin/deliveries/${failed.id}/retry`).set('X-CSRF-Token', csrf).expect(200);
      await notifications.processDue();
      const after = await agent.get(`/api/v1/admin/quotes/${id}`).expect(200);
      expect(after.body.deliveries.find((d: { id: string }) => d.id === failed.id).status).toBe('sent');

      // WhatsApp sin consentimiento ni número: se rechaza.
      await agent.post(`/api/v1/admin/quotes/${id}/send`).set('X-CSRF-Token', csrf).send({ channels: ['whatsapp'] }).expect(400);
      const sent = await agent.post(`/api/v1/admin/quotes/${id}/send`).set('X-CSRF-Token', csrf).send({ channels: ['email'] }).expect(201);
      expect(sent.body[0]).toMatchObject({ channel: 'email', status: 'queued', requestedBy: 'owner@example.com' });

      const pdf = await agent.get(`/api/v1/admin/quotes/${id}/pdf`).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
    });

    it('no envía como cotización final una solicitud en revisión', async () => {
      const list = await agent.get('/api/v1/admin/quotes?status=needs_review').expect(200);
      await agent.post(`/api/v1/admin/quotes/${list.body.items[0].id}/send`).set('X-CSRF-Token', csrf).send({ channels: ['email'] }).expect(400);
    });

    it('en modo simulado nada se marca como enviado ni cambia el estado de la cotización', async () => {
      email.simulated = true;
      const res = await createQuote('landing-page', { channels: { email: true, whatsapp: false }, client: { name: 'Caro', email: 'caro@example.com' } });
      expect(res.body.deliveries.email.status).toBe('simulated');
      await notifications.processDue();
      const quote = await connection.collection('quotes').findOne({ folio: res.body.folio });
      expect(quote?.status).toBe('issued');
      expect((await connection.collection('notification_deliveries').findOne({ quote: quote?._id, kind: 'quote_issued' }))?.status).toBe('simulated');
      email.simulated = false;
    });
  });

  describe('webhook de WhatsApp', () => {
    const sign = (body: string, secret = 'test-app-secret') => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const statusPayload = (status: string, ts: number) =>
      JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status, timestamp: String(ts) }] } }] }] });

    it('verifica la suscripción solo con el token correcto', async () => {
      const ok = await http.get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123').expect(200);
      expect(ok.text).toBe('abc123');
      await http.get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=abc123').expect(403);
    });

    it('rechaza eventos sin firma válida', async () => {
      const body = statusPayload('delivered', 1_800_000_000);
      await http.post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').send(body).expect(403);
      await http.post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(body, 'otro')).send(body).expect(403);
    });

    it('actualiza el estado del mensaje y nunca retrocede', async () => {
      for (const [status, expected] of [['delivered', 1], ['read', 1], ['delivered', 0]] as const) {
        const body = statusPayload(status, 1_800_000_000);
        const res = await http.post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(body)).send(body).expect(200);
        expect(res.body.updated).toBe(expected);
      }
      const delivery = await connection.collection('notification_deliveries').findOne({ providerMessageId: 'wamid.1' });
      expect(delivery?.status).toBe('read');
      expect(delivery?.events.map((e: { status: string }) => e.status)).toEqual(['queued', 'sent', 'delivered', 'read', 'delivered']);
    });
  });
});
