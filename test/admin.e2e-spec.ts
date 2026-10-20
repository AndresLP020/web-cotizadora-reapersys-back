import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SeedModule } from '../src/database/seeds/seed.module';
import { SeedService } from '../src/database/seeds/seed.service';
import { AuthService, MAX_FAILED_LOGINS } from '../src/security/auth.service';
import { hashPassword } from '../src/security/password';
import type { Role } from '../src/security/roles';
import { User } from '../src/security/schemas/user.schema';

const COLLECTIONS = [
  'categories', 'industries', 'components', 'component_prices', 'packages', 'package_prices', 'compatibility_rules',
  'business_settings', 'operating_costs', 'audit_logs', 'quotes', 'quote_versions', 'counters', 'clients', 'leads', 'users', 'sessions',
];
const PASSWORD = 'Correcta-Segura-2026';

interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  cookie: string;
}

describe('Autenticación y panel administrativo (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let users: Model<User>;
  let owner: Session;
  let sales: Session;
  let viewer: Session;

  const createUser = async (email: string, role: Role, password = PASSWORD) =>
    users.create({ email, name: `Usuario ${role}`, role, passwordHash: await hashPassword(password), active: true, passwordChangedAt: new Date() });

  const login = async (email: string, password = PASSWORD): Promise<Session> => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('reapersys_session='))!;
    return { agent, csrf: res.body.csrfToken, cookie };
  };

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
    users = app.get<Model<User>>(getModelToken(User.name));

    await createUser('owner@example.com', 'owner');
    await createUser('sales@example.com', 'sales');
    await createUser('viewer@example.com', 'viewer');
    await createUser('locked@example.com', 'sales');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('inicio de sesión', () => {
    it('rechaza credenciales inválidas con el mismo mensaje exista o no la cuenta', async () => {
      const http = request(app.getHttpServer());
      const wrong = await http.post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'incorrecta' }).expect(401);
      const unknown = await http.post('/api/v1/auth/login').send({ email: 'nadie@example.com', password: 'incorrecta' }).expect(401);
      expect(wrong.body.message).toBe(unknown.body.message);
      expect(wrong.headers['set-cookie']).toBeUndefined();
    });

    it('bloquea operadores de MongoDB en el correo', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: { $gt: '' }, password: 'x' }).expect(400);
    });

    it('abre sesión con cookie httpOnly y devuelve el token CSRF sin datos sensibles', async () => {
      owner = await login('owner@example.com');
      sales = await login('sales@example.com');
      viewer = await login('viewer@example.com');

      expect(owner.cookie).toMatch(/HttpOnly/i);
      expect(owner.cookie).toMatch(/SameSite=Lax/i);
      expect(owner.cookie).toMatch(/Path=\/api/);
      expect(owner.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const me = await owner.agent.get('/api/v1/auth/me').expect(200);
      expect(me.body.user).toMatchObject({ email: 'owner@example.com', role: 'owner' });
      expect(me.body.user.permissions).toContain('users:manage');
      expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|tokenHash/);

      // En la base solo existe el hash del token de sesión.
      const token = owner.cookie.split(';')[0]!.split('=')[1]!;
      const sessions = await connection.collection('sessions').find({}).toArray();
      expect(JSON.stringify(sessions)).not.toContain(token);
    });

    it('bloquea la cuenta tras intentos fallidos consecutivos, aun con la contraseña correcta', async () => {
      const auth = app.get(AuthService);
      for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
        await expect(auth.login('locked@example.com', 'incorrecta', {})).rejects.toThrow();
      }
      await expect(auth.login('locked@example.com', PASSWORD, {})).rejects.toThrow('bloqueada temporalmente');
      const user = await users.findOne({ email: 'locked@example.com' });
      expect(user?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
      expect(await connection.collection('audit_logs').countDocuments({ action: 'auth.locked', entityId: user?._id })).toBe(1);
    });

    it('sin sesión el panel responde 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/dashboard').expect(401);
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', 'reapersys_session=' + 'x'.repeat(43)).expect(401);
    });
  });

  describe('CSRF y permisos', () => {
    it('exige el token CSRF de la sesión en las operaciones que modifican datos', async () => {
      await owner.agent.patch('/api/v1/admin/settings').send({ tradeName: 'ReaperSys' }).expect(403);
      await owner.agent.patch('/api/v1/admin/settings').set('X-CSRF-Token', sales.csrf).send({ tradeName: 'ReaperSys' }).expect(403);
      await owner.agent.patch('/api/v1/admin/settings').set('X-CSRF-Token', owner.csrf).send({ tradeName: 'ReaperSys' }).expect(200);
    });

    it('aplica los permisos de cada rol', async () => {
      await viewer.agent.get('/api/v1/admin/dashboard').expect(200);
      await viewer.agent.patch('/api/v1/admin/settings').set('X-CSRF-Token', viewer.csrf).send({ tradeName: 'X' }).expect(403);
      await sales.agent.get('/api/v1/admin/users').expect(403);
      await sales.agent.get('/api/v1/admin/quotes').expect(200);
      await viewer.agent.get('/api/v1/admin/audit').expect(403);
      await owner.agent.get('/api/v1/admin/audit').expect(200);
    });

    it('las respuestas administrativas no se cachean', async () => {
      const res = await owner.agent.get('/api/v1/admin/dashboard').expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('precios desde el panel', () => {
    let sectionId: string;

    it('los costos y márgenes solo los ve quien tiene permiso', async () => {
      const ownerList = await owner.agent.get('/api/v1/admin/components?q=web-section').expect(200);
      const viewerList = await viewer.agent.get('/api/v1/admin/components?q=web-section').expect(200);
      sectionId = ownerList.body.items[0].id;
      expect(ownerList.body.items[0].price).toHaveProperty('costCents');
      expect(JSON.stringify(viewerList.body)).not.toMatch(/costCents|markupBp|marginBp/);
    });

    it('borrador → publicación → precio público, con recargo y margen calculados', async () => {
      const draft = await owner.agent
        .post(`/api/v1/admin/components/${sectionId}/prices`)
        .set('X-CSRF-Token', owner.csrf)
        .send({ mode: 'fixed', saleCents: 50_000, costCents: 20_000, notes: 'Ajuste' })
        .expect(201);
      expect(draft.body).toMatchObject({ status: 'draft', version: 2, markupBp: 15_000, marginBp: 6_000 });

      // Un asesor no puede publicar precios.
      await sales.agent.post(`/api/v1/admin/component-prices/${draft.body.id}/publish`).set('X-CSRF-Token', sales.csrf).expect(403);

      await owner.agent.post(`/api/v1/admin/component-prices/${draft.body.id}/publish`).set('X-CSRF-Token', owner.csrf).expect(200);
      const pub = await request(app.getHttpServer()).get('/api/v1/components/public?category=desarrollo-web').expect(200);
      expect(pub.body.items.find((c: { slug: string }) => c.slug === 'web-section').pricing.amountCents).toBe(50_000);

      const audit = await owner.agent.get('/api/v1/admin/audit?entityType=component').expect(200);
      expect(audit.body.items[0]).toMatchObject({ action: 'component_price.published', actor: 'owner@example.com' });
    });

    it('rechaza importes no enteros y descarta borradores', async () => {
      await owner.agent.post(`/api/v1/admin/components/${sectionId}/prices`).set('X-CSRF-Token', owner.csrf).send({ mode: 'fixed', saleCents: 10.5 }).expect(400);
      const draft = await owner.agent.post(`/api/v1/admin/components/${sectionId}/prices`).set('X-CSRF-Token', owner.csrf).send({ mode: 'fixed', saleCents: 1 }).expect(201);
      await owner.agent.delete(`/api/v1/admin/component-prices/${draft.body.id}`).set('X-CSRF-Token', owner.csrf).expect(204);
      await owner.agent.delete(`/api/v1/admin/component-prices/${draft.body.id}`).set('X-CSRF-Token', owner.csrf).expect(404);
    });

    it('aprobar el precio de un adicional «Por cotizar» lo vuelve cotizable', async () => {
      const preview = () =>
        request(app.getHttpServer())
          .post('/api/v1/quotes/preview')
          .send({ selection: { packageSlug: 'punto-de-venta', components: [{ slug: 'pos-returns', quantity: 1 }] } })
          .expect(200);
      const before = await preview();
      expect(before.body.lines.find((l: { kind: string }) => l.kind === 'addon')).toMatchObject({ amountCents: null, priceMode: 'pending' });
      expect(before.body.reviewReasons.map((r: { code: string }) => r.code)).toContain('component_pending_price');

      const list = await owner.agent.get('/api/v1/admin/components?q=pos-returns').expect(200);
      const id = list.body.items[0].id;
      const draft = await owner.agent.post(`/api/v1/admin/components/${id}/prices`).set('X-CSRF-Token', owner.csrf).send({ mode: 'fixed', saleCents: 250_000 }).expect(201);
      await owner.agent.post(`/api/v1/admin/component-prices/${draft.body.id}/publish`).set('X-CSRF-Token', owner.csrf).expect(200);

      const after = await preview();
      expect(after.body.totals.subtotalCents).toBe(1_800_000 + 250_000);
      expect(after.body.reviewReasons.map((r: { code: string }) => r.code)).not.toContain('component_pending_price');
    });
  });

  describe('suscripción desde el panel', () => {
    const packageId = async (slug: string) =>
      (await owner.agent.get('/api/v1/admin/packages').expect(200)).body.items.find((p: { slug: string }) => p.slug === slug).id as string;

    it('los costos de operación y la mensualidad sugerida solo los ve quien tiene permiso de costos', async () => {
      await viewer.agent.get('/api/v1/admin/operating-costs').expect(403);
      const costs = await owner.agent.get('/api/v1/admin/operating-costs').expect(200);
      expect(costs.body.items).toHaveLength(4);
      expect(costs.body.items.every((c: { confirmed: boolean }) => !c.confirmed)).toBe(true);

      const id = await packageId('tienda-virtual');
      const detail = await owner.agent.get(`/api/v1/admin/packages/${id}`).expect(200);
      expect(detail.body.rentalProfile).toMatchObject({ enabled: true, hostingCostKey: null, hardwareUpfront: false, services: [] });
      expect(detail.body.history.find((h: { status: string }) => h.status === 'published')).toMatchObject({ baseCents: 1_499_900 });
      expect((await viewer.agent.get(`/api/v1/admin/packages/${id}`).expect(200)).body.rentalSuggestion).toBeNull();
    });

    it('actualizar un costo queda auditado; la mensualidad se publica como precio versionado', async () => {
      const costs = await owner.agent.get('/api/v1/admin/operating-costs').expect(200);
      const hosting = costs.body.items.find((c: { key: string }) => c.key === 'hosting-ecommerce');
      await sales.agent.patch(`/api/v1/admin/operating-costs/${hosting.id}`).set('X-CSRF-Token', sales.csrf).send({ costCents: 1 }).expect(403);
      await owner.agent.patch(`/api/v1/admin/operating-costs/${hosting.id}`).set('X-CSRF-Token', owner.csrf).send({ costCents: 10.5 }).expect(400);
      const updated = await owner.agent
        .patch(`/api/v1/admin/operating-costs/${hosting.id}`)
        .set('X-CSRF-Token', owner.csrf)
        .send({ costCents: 25_000, confirmed: true })
        .expect(200);
      expect(updated.body).toMatchObject({ costCents: 25_000, confirmed: true });
      expect(await connection.collection('audit_logs').countDocuments({ action: 'operating_cost.updated' })).toBe(1);

      const id = await packageId('tienda-virtual');
      const detail = await owner.agent.get(`/api/v1/admin/packages/${id}`).expect(200);
      const current = detail.body.history.find((h: { status: string }) => h.status === 'published');

      const send = (rental: object) =>
        owner.agent
          .post(`/api/v1/admin/packages/${id}/prices`)
          .set('X-CSRF-Token', owner.csrf)
          .send({ mode: current.mode, baseCents: current.baseCents, variantPrices: current.variantPrices, removalCredits: current.removalCredits, rental });
      await send({ mode: 'fixed', monthlyCents: null, setupFeeCents: null }).expect(400);
      const draft = await send({ mode: 'fixed', monthlyCents: 120_000, setupFeeCents: null }).expect(201);
      await owner.agent.post(`/api/v1/admin/package-prices/${draft.body.id}/publish`).set('X-CSRF-Token', owner.csrf).expect(200);

      const preview = await request(app.getHttpServer())
        .post('/api/v1/quotes/preview')
        .send({ selection: { paymentMode: 'subscription', packageSlug: 'tienda-virtual' } })
        .expect(200);
      expect(preview.body.subscription).toMatchObject({ monthlyCents: 120_000, priceMode: 'fixed', hostingCharge: null, annualCharge: { name: 'Dominio y hosting', cents: 50_000 } });
      expect(preview.body.reviewReasons.map((r: { code: string }) => r.code)).not.toContain('subscription_starting_at');
    });

    it('Landing Page y Web Corporativa no se rentan', async () => {
      const id = await packageId('landing-page');
      const patch = (rentalProfile: object) => owner.agent.patch(`/api/v1/admin/packages/${id}`).set('X-CSRF-Token', owner.csrf).send({ rentalProfile });
      await patch({ recoverableMode: 'manual', recoverableCents: null }).expect(400);
      await patch({ hostingCostKey: 'no-existe' }).expect(400);
      const detail = await owner.agent.get(`/api/v1/admin/packages/${id}`).expect(200);
      expect(detail.body.rentalProfile.enabled).toBe(false);
      expect(detail.body.rentalSuggestion).toBeNull();
      expect((await owner.agent.get(`/api/v1/admin/packages/${await packageId('web-corporativa')}`).expect(200)).body.rentalProfile.enabled).toBe(false);
    });

    it('el plazo mínimo se configura en el panel y se publica en el sitio', async () => {
      const patch = (rental: object) => owner.agent.patch('/api/v1/admin/settings').set('X-CSRF-Token', owner.csrf).send({ rental });
      const plans = { monthToMonthSurchargeBp: 2_000, semiannualDiscountBp: 500, annualDiscountBp: 1_200 };
      await patch({ minimumTermMonths: 0, financingBp: 0, ...plans }).expect(400);
      await patch({ minimumTermMonths: 12, financingBp: 0, ...plans, annualDiscountBp: 9_000 }).expect(400);
      expect((await patch({ minimumTermMonths: 24, financingBp: 500, ...plans }).expect(200)).body.rental).toEqual({ minimumTermMonths: 24, financingBp: 500, ...plans });
      expect((await request(app.getHttpServer()).get('/api/v1/settings/public').expect(200)).body.subscription).toEqual({ minimumTermMonths: 24, ...plans });

      // Los planes se calculan con la configuración vigente: mes con mes +20 %, anual −12 %.
      const preview = await request(app.getHttpServer())
        .post('/api/v1/quotes/preview')
        .send({ selection: { paymentMode: 'subscription', subscriptionPlan: 'annual', packageSlug: 'tienda-virtual' } })
        .expect(200);
      // 1,200 − 12 % = 1,056 al mes.
      expect(preview.body.subscription).toMatchObject({
        plan: 'annual',
        baseMonthlyCents: 120_000,
        monthlyCents: 105_600,
        monthlyTaxCents: 0,
        billingMonths: 12,
        termMonths: 12,
      });
      expect(preview.body.subscription.plans.map((p: { plan: string }) => p.plan)).toEqual(['monthly', 'semiannual', 'annual']);
      expect(preview.body.subscription.plans.find((p: { plan: string }) => p.plan === 'monthly')).toMatchObject({ termMonths: 24 });
      expect(preview.body.subscription.plans.find((p: { plan: string }) => p.plan === 'semiannual')).toMatchObject({ billingMonths: 6, termMonths: 6 });
      await patch({ minimumTermMonths: 12, financingBp: 0, monthToMonthSurchargeBp: 1_500, semiannualDiscountBp: 500, annualDiscountBp: 1_000 }).expect(200);
    });
  });

  describe('configuración comercial', () => {
    it('definir la vigencia permite emitir cotizaciones formales', async () => {
      const before = await request(app.getHttpServer()).post('/api/v1/quotes/preview').send({ selection: { packageSlug: 'landing-page' } }).expect(200);
      expect(before.body.status).toBe('needs_review');

      await owner.agent
        .patch('/api/v1/admin/settings')
        .set('X-CSRF-Token', owner.csrf)
        .send({ quote: { depositRateBp: 5_000, validityDays: 15 } })
        .expect(200);

      const after = await request(app.getHttpServer()).post('/api/v1/quotes/preview').send({ selection: { packageSlug: 'landing-page' } }).expect(200);
      expect(after.body.status).toBe('priced');
      expect(await connection.collection('audit_logs').countDocuments({ action: 'settings.updated' })).toBeGreaterThanOrEqual(2);
    });

    it('valida rangos (vigencia, tasas)', async () => {
      await owner.agent.patch('/api/v1/admin/settings').set('X-CSRF-Token', owner.csrf).send({ quote: { depositRateBp: 5_000, validityDays: 0 } }).expect(400);
      await owner.agent.patch('/api/v1/admin/settings').set('X-CSRF-Token', owner.csrf).send({ tax: { rateBp: 20_000, treatment: 'exclusive', confirmed: true } }).expect(400);
    });

    it('los datos de contacto del sitio salen de la configuración (endpoint público)', async () => {
      await owner.agent
        .patch('/api/v1/admin/settings')
        .set('X-CSRF-Token', owner.csrf)
        .send({ contact: { email: 'hola@reapersys.example', whatsapp: '5215512345678' } })
        .expect(200);
      const res = await request(app.getHttpServer()).get('/api/v1/settings/public').expect(200);
      expect(res.body).toMatchObject({
        contact: { email: 'hola@reapersys.example', whatsapp: '5215512345678', facebook: null },
        quote: { validityDays: 15 },
        privacyNotice: { published: false },
      });
      // Sin aviso publicado no se exponen datos del responsable.
      expect(JSON.stringify(res.body)).not.toMatch(/legalName|legalAddress/);
    });

    it('el aviso de privacidad solo se publica con los datos del responsable completos', async () => {
      const patch = (body: object) => owner.agent.patch('/api/v1/admin/settings').set('X-CSRF-Token', owner.csrf).send(body);
      await patch({ privacyNoticePublished: true }).expect(400);
      await patch({ legalName: 'ReaperSys S.A. de C.V.', legalAddress: 'Av. Ejemplo 123, Col. Centro, CDMX', privacyNoticePublished: true }).expect(200);

      const published = await request(app.getHttpServer()).get('/api/v1/settings/public').expect(200);
      expect(published.body.privacyNotice).toMatchObject({
        published: true,
        legalName: 'ReaperSys S.A. de C.V.',
        legalAddress: 'Av. Ejemplo 123, Col. Centro, CDMX',
        contactEmail: 'hola@reapersys.example',
      });
      const firstDate = published.body.privacyNotice.updatedAt;

      // Cambiar el domicilio mientras está publicado actualiza la fecha del aviso.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await patch({ legalAddress: 'Calle Nueva 45, CDMX' }).expect(200);
      const updated = await request(app.getHttpServer()).get('/api/v1/settings/public').expect(200);
      expect(new Date(updated.body.privacyNotice.updatedAt).getTime()).toBeGreaterThan(new Date(firstDate).getTime());

      // Quitar el correo con el aviso publicado no se permite; retirarlo sí.
      await patch({ contact: {} }).expect(400);
      await patch({ privacyNoticePublished: false }).expect(200);
      expect((await request(app.getHttpServer()).get('/api/v1/settings/public').expect(200)).body.privacyNotice).toEqual({ published: false });
    });
  });

  describe('cotizaciones, clientes y prospectos', () => {
    let quoteId: string;
    let folio: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/quotes')
        .send({
          selection: { packageSlug: 'landing-page' },
          client: { name: 'Cliente Panel', email: 'panel@example.com' },
          consents: { contact: true },
          channels: { email: true, whatsapp: false },
        })
        .expect(201);
      folio = res.body.folio;
      expect(res.body.status).toBe('issued');
    });

    it('lista y busca por folio o cliente', async () => {
      const byFolio = await sales.agent.get(`/api/v1/admin/quotes?q=${folio}`).expect(200);
      expect(byFolio.body).toMatchObject({ total: 1, items: [{ folio, status: 'issued', client: { email: 'panel@example.com' } }] });
      quoteId = byFolio.body.items[0].id;
      const byClient = await sales.agent.get('/api/v1/admin/quotes?q=Cliente%20Panel').expect(200);
      expect(byClient.body.total).toBe(1);
      // Los metacaracteres se tratan como texto literal.
      expect((await sales.agent.get('/api/v1/admin/quotes?q=.*').expect(200)).body.total).toBe(0);
    });

    it('aplica transiciones de estado válidas y sincroniza el prospecto', async () => {
      await sales.agent.patch(`/api/v1/admin/quotes/${quoteId}/status`).set('X-CSRF-Token', sales.csrf).send({ status: 'needs_review' }).expect(400);
      await sales.agent.patch(`/api/v1/admin/quotes/${quoteId}/status`).set('X-CSRF-Token', sales.csrf).send({ status: 'approved', note: 'Firmada' }).expect(200);
      const detail = await sales.agent.get(`/api/v1/admin/quotes/${quoteId}`).expect(200);
      expect(detail.body).toMatchObject({ status: 'approved', allowedTransitions: ['cancelled'], lead: { status: 'converted' } });
      expect(detail.body.history.map((h: { action: string }) => h.action)).toContain('quote.status_changed');
    });

    it('una cotización cerrada no admite nuevas versiones', async () => {
      await sales.agent
        .post(`/api/v1/admin/quotes/${quoteId}/revise`)
        .set('X-CSRF-Token', sales.csrf)
        .send({ selection: { packageSlug: 'web-corporativa' }, reason: 'Cambio de paquete' })
        .expect(409);
    });

    it('muestra clientes con sus cotizaciones y prospectos filtrables', async () => {
      const clients = await viewer.agent.get('/api/v1/admin/clients?q=panel').expect(200);
      expect(clients.body.items[0]).toMatchObject({ email: 'panel@example.com', quotes: 1 });
      const client = await viewer.agent.get(`/api/v1/admin/clients/${clients.body.items[0].id}`).expect(200);
      expect(client.body.quotes[0].folio).toBe(folio);

      const leads = await sales.agent.get('/api/v1/admin/leads?source=quote_builder').expect(200);
      expect(leads.body.items[0]).toMatchObject({ reference: folio, status: 'converted' });
      await sales.agent.patch(`/api/v1/admin/leads/${leads.body.items[0].id}/status`).set('X-CSRF-Token', sales.csrf).send({ status: 'otro' }).expect(400);
    });

    it('el tablero refleja los datos reales', async () => {
      const res = await owner.agent.get('/api/v1/admin/dashboard').expect(200);
      expect(res.body.quotes.byStatus.approved).toBe(1);
      expect(res.body.quotes.perDay).toHaveLength(30);
      expect(res.body.quotes.perDay.at(-1).count).toBeGreaterThanOrEqual(1);
      expect(res.body.alerts.map((a: { code: string }) => a.code)).not.toContain('tax_unconfirmed');
    });
  });

  describe('usuarios y sesiones', () => {
    it('el propietario crea usuarios con contraseña robusta', async () => {
      const csrf = owner.csrf;
      await owner.agent.post('/api/v1/admin/users').set('X-CSRF-Token', csrf).send({ email: 'nuevo@example.com', name: 'Nuevo', role: 'sales', password: 'corta' }).expect(400);
      const created = await owner.agent
        .post('/api/v1/admin/users')
        .set('X-CSRF-Token', csrf)
        .send({ email: 'nuevo@example.com', name: 'Nuevo', role: 'sales', password: 'Otra-Clave-Segura-1' })
        .expect(201);
      expect(JSON.stringify(created.body)).not.toContain('passwordHash');
      await owner.agent.post('/api/v1/admin/users').set('X-CSRF-Token', csrf).send({ email: 'nuevo@example.com', name: 'Otro', role: 'sales', password: 'Otra-Clave-Segura-1' }).expect(409);
    });

    it('no permite quitarse el rol propio ni dejar el sistema sin propietario', async () => {
      const me = (await owner.agent.get('/api/v1/auth/me').expect(200)).body.user.id;
      await owner.agent.patch(`/api/v1/admin/users/${me}`).set('X-CSRF-Token', owner.csrf).send({ active: false }).expect(400);
      await owner.agent.patch(`/api/v1/admin/users/${me}`).set('X-CSRF-Token', owner.csrf).send({ role: 'admin' }).expect(400);
    });

    it('desactivar un usuario cierra sus sesiones de inmediato', async () => {
      const list = await owner.agent.get('/api/v1/admin/users').expect(200);
      const viewerUser = list.body.items.find((u: { email: string }) => u.email === 'viewer@example.com');
      await owner.agent.patch(`/api/v1/admin/users/${viewerUser.id}`).set('X-CSRF-Token', owner.csrf).send({ active: false }).expect(200);
      await viewer.agent.get('/api/v1/auth/me').expect(401);
    });

    it('cambiar la contraseña invalida las sesiones anteriores y entrega una nueva', async () => {
      const second = await login('sales@example.com');
      const res = await sales.agent
        .post('/api/v1/auth/password')
        .set('X-CSRF-Token', sales.csrf)
        .send({ currentPassword: PASSWORD, newPassword: 'Nueva-Clave-Segura-9' })
        .expect(200);
      expect(res.body.csrfToken).not.toBe(sales.csrf);
      await second.agent.get('/api/v1/auth/me').expect(401);
      await sales.agent.get('/api/v1/auth/me').expect(200); // el agente recibió la cookie nueva
    });

    it('cerrar sesión invalida la cookie', async () => {
      await owner.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', owner.csrf).expect(204);
      await owner.agent.get('/api/v1/auth/me').expect(401);
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', owner.cookie.split(';')[0]!).expect(401);
    });
  });
});
