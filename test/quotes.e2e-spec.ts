import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SeedModule } from '../src/database/seeds/seed.module';
import { SeedService } from '../src/database/seeds/seed.service';
import { SYSTEM_ACTOR } from '../src/modules/audit/audit.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { QuotesService } from '../src/modules/quotes/quotes.service';

const COLLECTIONS = [
  'categories', 'industries', 'components', 'component_prices', 'packages', 'package_prices', 'compatibility_rules',
  'business_settings', 'operating_costs', 'audit_logs', 'quotes', 'quote_versions', 'counters', 'clients', 'leads',
];

const client = { name: 'Laura Méndez', company: 'Café Aurora', email: 'Laura@Example.com', phone: '+52 55 1234 5678' };
const baseRequest = (selection: object, extra: object = {}) => ({
  selection,
  industry: 'restaurantes-cafeterias',
  solution: 'web',
  client,
  consents: { contact: true },
  channels: { email: true, whatsapp: false },
  ...extra,
});

describe('Cotizaciones (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let http: ReturnType<typeof request>;

  const setSettings = (set: Record<string, unknown>) => connection.collection('business_settings').updateOne({ key: 'default' }, { $set: set });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SeedModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    for (const name of COLLECTIONS) await connection.collection(name).deleteMany({});
    await app.get(SeedService).run();
    // Escenario de partida de estas pruebas: vigencia aún sin configurar.
    await connection.collection('business_settings').updateOne({ key: 'default' }, { $set: { 'tax.confirmed': false, 'quote.validityDays': null } });
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('POST /api/v1/quotes/preview', () => {
    it('calcula en el servidor con los precios vigentes, sin exponer referencias internas', async () => {
      const res = await http
        .post('/api/v1/quotes/preview')
        .send({ selection: { packageSlug: 'landing-page', components: [{ slug: 'web-section', quantity: 6 }] } })
        .expect(200);
      expect(res.body.totals).toMatchObject({ subtotalCents: 439_900, taxCents: 0, totalCents: 439_900 });
      expect(res.body.isFinal).toBe(false);
      expect(res.body.reviewReasons.map((r: { code: string }) => r.code)).toEqual(['validity_not_configured']);
      expect(JSON.stringify(res.body)).not.toMatch(/priceId|priceRef|costCents|"_id"/);
    });

    it('400 para selecciones imposibles y 200 "blocked" para incompatibilidades', async () => {
      await http.post('/api/v1/quotes/preview').send({ selection: { packageSlug: 'no-existe' } }).expect(400);
      await http
        .post('/api/v1/quotes/preview')
        .send({ selection: { packageSlug: 'tienda-virtual', removedComponents: ['store-cart'] } })
        .expect(400);
      await http
        .post('/api/v1/quotes/preview')
        .send({ selection: { packageSlug: 'tienda-virtual', components: [{ slug: 'wishlist', quantity: 1 }] } })
        .expect(400);
      await http.post('/api/v1/quotes/preview').send({ selection: { packageSlug: 'landing-page', variants: { $gt: '' } } }).expect(400);
      const blocked = await http
        .post('/api/v1/quotes/preview')
        .send({ selection: { packageSlug: 'punto-de-venta', components: [{ slug: 'pos-supplier-accounts', quantity: 1 }] } })
        .expect(200);
      expect(blocked.body.status).toBe('blocked');
    });

    it('suscripción: se cobra la mensualidad aprobada, sin cargos de contado inventados', async () => {
      const res = await http
        .post('/api/v1/quotes/preview')
        .send({ selection: { paymentMode: 'subscription', packageSlug: 'tienda-virtual' } })
        .expect(200);
      expect(res.body.paymentMode).toBe('subscription');
      expect(res.body.totals).toMatchObject({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
      expect(res.body.subscription).toMatchObject({
        monthlyCents: 100_000,
        priceMode: 'fixed',
        termMonths: 12,
        commitmentCents: 1_200_000,
        firstPaymentCents: 150_000,
        subsequentPaymentCents: 100_000,
        hostingCharge: null,
        annualCharge: { name: 'Dominio y hosting', cents: 50_000 },
      });
      expect(res.body.reviewReasons.map((r: { code: string }) => r.code)).toEqual(['validity_not_configured']);
      expect(JSON.stringify(res.body)).not.toMatch(/priceId|priceRef/);

      await http.post('/api/v1/quotes/preview').send({ selection: { paymentMode: 'subscription', packageSlug: 'landing-page' } }).expect(400);
      await http.post('/api/v1/quotes/preview').send({ selection: { paymentMode: 'renta', packageSlug: 'tienda-virtual' } }).expect(400);
    });

    it('el punto de venta y la combinada también se rentan', async () => {
      const pos = await http.post('/api/v1/quotes/preview').send({ selection: { paymentMode: 'subscription', packageSlug: 'punto-de-venta' } }).expect(200);
      expect(pos.body.subscription.monthlyCents).toBe(70_000);
      const combo = await http.post('/api/v1/quotes/preview').send({ selection: { paymentMode: 'subscription', packageSlug: 'solucion-combinada' } }).expect(200);
      expect(combo.body.subscription.monthlyCents).toBe(150_000);
    });
  });

  describe('POST /api/v1/quotes', () => {
    let token: string;

    it('registra la solicitud con folio, cliente, prospecto, versión 1 y auditoría', async () => {
      const res = await http.post('/api/v1/quotes').send(baseRequest({ packageSlug: 'web-corporativa' })).expect(201);
      token = res.body.accessToken;

      expect(res.body).toMatchObject({
        folio: expect.stringMatching(/^RS-\d{4}-00001$/),
        status: 'needs_review',
        validUntil: null,
        accessPath: `/cotizacion/${token}`,
      });
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // Sin credenciales de correo, el envío queda registrado como simulado (nunca como enviado).
      expect(res.body.deliveries.email.status).toBe('simulated');
      expect(res.body.deliveries.pdf.status).toBe('available');
      expect(res.body.deliveries.whatsapp.status).toBe('not_requested');

      const quote = await connection.collection('quotes').findOne({ folio: res.body.folio });
      expect(quote?.access.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      // El token en claro no se guarda en ninguna colección.
      for (const name of ['quotes', 'quote_versions', 'leads', 'clients', 'audit_logs']) {
        const docs = await connection.collection(name).find({}).toArray();
        expect(JSON.stringify(docs)).not.toContain(token);
      }

      const version = await connection.collection('quote_versions').findOne({ quote: quote?._id, version: 1 });
      expect(version?.calculation.totals.subtotalCents).toBe(799_900);
      expect(version?.calculation.lines[0].priceRef).toMatchObject({ type: 'package', version: 1 });

      const savedClient = await connection.collection('clients').findOne({ email: 'laura@example.com' });
      expect(savedClient?.consents.map((c: { channel: string }) => c.channel)).toEqual(['contact', 'email']);
      const lead = await connection.collection('leads').findOne({ quote: quote?._id });
      expect(lead).toMatchObject({ source: 'quote_builder', status: 'new', reference: res.body.folio });
      expect(quote?.summary).toMatchObject({ paymentMode: 'purchase', monthlyCents: null });
      expect(await connection.collection('audit_logs').countDocuments({ action: 'quote.created', entityId: quote?._id })).toBe(1);
    });

    it('el enlace seguro muestra la cotización; tokens ajenos o mal formados no', async () => {
      const res = await http.get(`/api/v1/quotes/access/${token}`).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ status: 'needs_review', client: { name: 'Laura Méndez', company: 'Café Aurora' } });
      expect(JSON.stringify(res.body)).not.toContain('laura@example.com');

      await http.get(`/api/v1/quotes/access/${'x'.repeat(43)}`).expect(404);
      await http.get('/api/v1/quotes/access/corto').expect(400);
    });

    it('el mismo correo reutiliza el cliente y los folios son consecutivos', async () => {
      const res = await http.post('/api/v1/quotes').send(baseRequest({ packageSlug: 'landing-page' })).expect(201);
      expect(res.body.folio).toMatch(/-00002$/);
      expect(await connection.collection('clients').countDocuments()).toBe(1);
    });

    it('rechaza incompatibilidades salvo que se solicite valoración personalizada', async () => {
      const selection = { packageSlug: 'punto-de-venta', components: [{ slug: 'pos-payroll-advances', quantity: 1 }] };
      const rejected = await http.post('/api/v1/quotes').send(baseRequest(selection)).expect(422);
      expect(rejected.body.message).toContain('incompatibles');
      const accepted = await http.post('/api/v1/quotes').send(baseRequest(selection, { requestEvaluation: true })).expect(201);
      expect(accepted.body.status).toBe('needs_review');
    });

    it('WhatsApp requiere número y consentimiento explícito', async () => {
      await http
        .post('/api/v1/quotes')
        .send(baseRequest({ packageSlug: 'landing-page' }, { channels: { email: true, whatsapp: true } }))
        .expect(400);
    });

    it('descarta envíos con honeypot y exige el consentimiento de contacto', async () => {
      await http.post('/api/v1/quotes').send(baseRequest({ packageSlug: 'landing-page' }, { website: 'spam' })).expect(400);
      await http.post('/api/v1/quotes').send(baseRequest({ packageSlug: 'landing-page' }, { consents: { contact: false } })).expect(400);
    });

    it('un enlace vencido responde 410', async () => {
      const res = await http.post('/api/v1/quotes').send(baseRequest({ packageSlug: 'landing-page' }));
      await connection.collection('quotes').updateOne({ folio: res.body.folio }, { $set: { 'access.expiresAt': new Date(Date.now() - 1000) } });
      await http.get(`/api/v1/quotes/access/${res.body.accessToken}`).expect(410);
    });
  });

  describe('emisión formal y versionado', () => {
    it('con vigencia configurada, una cotización completa se emite con vigencia', async () => {
      await setSettings({ 'quote.validityDays': 15 });
      const res = await http.post('/api/v1/quotes').send(baseRequest({ packageSlug: 'landing-page' })).expect(201);
      expect(res.body.status).toBe('issued');
      expect(res.body.calculation.isFinal).toBe(true);
      const days = (new Date(res.body.validUntil).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(14.9);
      expect(days).toBeLessThanOrEqual(15);
    });

    it('las cotizaciones emitidas conservan sus importes al cambiar precios; una revisión crea versión nueva', async () => {
      const issued = await http.post('/api/v1/quotes').send(baseRequest({ packageSlug: 'landing-page' })).expect(201);
      expect(issued.body.calculation.totals.subtotalCents).toBe(349_900);

      // El administrador publica un precio nuevo para Landing Page.
      const pricing = app.get(PricingService);
      const pkg = await connection.collection('packages').findOne({ slug: 'landing-page' });
      const draft = await pricing.createPackagePriceDraft(pkg!._id, { mode: 'fixed', baseCents: 450_000 }, SYSTEM_ACTOR('e2e'));
      await pricing.publishPackagePrice(draft._id, SYSTEM_ACTOR('e2e'));

      // La cotización existente NO cambia…
      const view = await http.get(`/api/v1/quotes/access/${issued.body.accessToken}`).expect(200);
      expect(view.body.calculation.totals.subtotalCents).toBe(349_900);
      // …mientras que las nuevas usan el precio publicado.
      const preview = await http.post('/api/v1/quotes/preview').send({ selection: { packageSlug: 'landing-page' } }).expect(200);
      expect(preview.body.totals.subtotalCents).toBe(450_000);

      // Una modificación posterior genera la versión 2 con precios vigentes; la 1 queda intacta.
      const quote = await connection.collection('quotes').findOne({ folio: issued.body.folio });
      const quotesService = app.get(QuotesService);
      const revised = await quotesService.revise(quote!._id, { packageSlug: 'landing-page' }, SYSTEM_ACTOR('e2e'), 'Actualización de precios');
      expect(revised).toMatchObject({ version: 2, status: 'issued' });

      const versions = await quotesService.listVersions(quote!._id);
      expect(versions.map((v) => [v.version, v.calculation.totals.subtotalCents])).toEqual([
        [1, 349_900],
        [2, 450_000],
      ]);
      const latest = await http.get(`/api/v1/quotes/access/${issued.body.accessToken}`).expect(200);
      expect(latest.body).toMatchObject({ version: 2, calculation: { totals: { subtotalCents: 450_000 } } });
      expect(await connection.collection('audit_logs').countDocuments({ action: 'quote.revised', entityId: quote!._id })).toBe(1);
    });
  });
});
