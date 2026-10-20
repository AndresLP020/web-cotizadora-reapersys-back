import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { seedComponents, seedIndustries, seedPackages, seedRules } from '../src/database/seeds/catalog.seed-data';
import { SeedModule } from '../src/database/seeds/seed.module';
import { SeedService } from '../src/database/seeds/seed.service';
import { SYSTEM_ACTOR } from '../src/modules/audit/audit.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

const COLLECTIONS = [
  'categories',
  'industries',
  'components',
  'component_prices',
  'packages',
  'package_prices',
  'compatibility_rules',
  'business_settings',
  'operating_costs',
  'audit_logs',
];

describe('Catálogo y precios (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SeedModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    // Se vacían documentos (no la base) para conservar los índices únicos creados al iniciar.
    for (const name of COLLECTIONS) await connection.collection(name).deleteMany({});
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('seed', () => {
    it('carga el catálogo completo del brief', async () => {
      const report = await app.get(SeedService).run();
      expect(report).toEqual({
        settings: 1,
        categories: 9,
        industries: seedIndustries.length,
        components: seedComponents.length,
        componentPrices: seedComponents.length,
        packages: seedPackages.length,
        packagePrices: seedPackages.length,
        rules: seedRules.length,
        operatingCosts: 4,
        rentalBackfill: 0,
        retiredPackages: 0,
        // En una base nueva no hay nada que actualizar: el catálogo ya nace con dominio y hosting anuales.
        infrastructureUpgrade: 0,
      });
      expect(seedPackages).toHaveLength(7);
    });

    it('es idempotente: una segunda ejecución no inserta ni duplica nada', async () => {
      const report = await app.get(SeedService).run();
      expect(Object.values(report).every((count) => count === 0)).toBe(true);
      expect(await connection.collection('component_prices').countDocuments()).toBe(seedComponents.length);
    });

    it('en una base anterior, desactiva el hosting y dominio viejos y agrega las redes a la Web Corporativa (una sola vez)', async () => {
      const components = connection.collection('components');
      const prices = connection.collection('component_prices');
      const annual = await components.find({ slug: { $in: ['hosting-annual', 'domain-annual'] } }).toArray();
      const social = await components.find({ slug: { $in: ['whatsapp-button', 'facebook-button', 'instagram-button', 'tiktok-button'] } }).toArray();
      const { _id: _annualId, ...template } = annual[0]!;
      await components.insertOne({ ...template, slug: 'domain', sku: 'MNT-DOMAIN', status: 'active' });
      await prices.deleteMany({ component: { $in: annual.map((c) => c._id) } });
      await components.deleteMany({ _id: { $in: annual.map((c) => c._id) } });
      await connection.collection('packages').updateOne(
        { slug: 'web-corporativa' },
        { $pull: { items: { component: { $in: social.map((c) => c._id) } }, features: 'Botones de redes sociales (WhatsApp, Facebook, Instagram y TikTok)' } } as never,
      );

      const report = await app.get(SeedService).run();
      expect(report).toMatchObject({ components: 2, componentPrices: 2, infrastructureUpgrade: 6 });
      expect(await components.findOne({ slug: 'domain' })).toMatchObject({ status: 'inactive' });
      const corporate = await connection.collection('packages').findOne({ slug: 'web-corporativa' });
      expect(corporate!.items.map((i: { component: unknown }) => String(i.component))).toEqual(expect.arrayContaining(social.map((c) => String(c._id))));
      expect(corporate!.features).toContain('Botones de redes sociales (WhatsApp, Facebook, Instagram y TikTok)');

      expect((await app.get(SeedService).run()).infrastructureUpgrade).toBe(0);
      await components.deleteOne({ slug: 'domain' });
    });

    it('carga la configuración comercial confirmada por la empresa y vigencia de 7 días', async () => {
      const settings = await connection.collection('business_settings').findOne({ key: 'default' });
      expect(settings).toMatchObject({
        tax: { rateBp: 0, treatment: 'exclusive', confirmed: true },
        quote: { validityDays: 7, depositRateBp: 5_000 },
        privacyNotice: { published: false },
      });
    });

    it('no publica precios inventados: los adicionales y el hardware quedan sin importe', async () => {
      for (const slug of ['pc-new-i5', 'stripe-payments', 'pos-returns']) {
        const component = await connection.collection('components').findOne({ slug });
        expect(component?.pricingStatus).toBe('pending_pricing');
        const price = await connection.collection('component_prices').findOne({ component: component?._id, status: 'published' });
        expect(price).toMatchObject({ mode: 'pending', saleCents: null });
      }
    });

    it('elimina los paquetes de catálogos anteriores con sus precios', async () => {
      const { insertedId } = await connection.collection('packages').insertOne({ slug: 'ecommerce-pro', name: 'E-commerce Pro', category: 'ecommerce' });
      await connection.collection('package_prices').insertOne({ package: insertedId, version: 1, status: 'published', mode: 'fixed', baseCents: 1 });
      const report = await app.get(SeedService).run();
      expect(report.retiredPackages).toBe(1);
      expect(await connection.collection('packages').countDocuments({ slug: 'ecommerce-pro' })).toBe(0);
      expect(await connection.collection('package_prices').countDocuments({ package: insertedId })).toBe(0);
      expect(await connection.collection('packages').countDocuments()).toBe(seedPackages.length);
    });
  });

  describe('suscripción mensual', () => {
    it('publica la renta aprobada; landing y web corporativa no se rentan', async () => {
      const rentalOf = async (slug: string) => {
        const pkg = await connection.collection('packages').findOne({ slug });
        return (await connection.collection('package_prices').findOne({ package: pkg?._id, status: 'published' }))?.rental;
      };
      expect(await rentalOf('tienda-virtual')).toEqual({ mode: 'fixed', monthlyCents: 100_000, setupFeeCents: null });
      expect(await rentalOf('punto-de-venta')).toEqual({ mode: 'fixed', monthlyCents: 70_000, setupFeeCents: null });
      expect(await rentalOf('solucion-combinada')).toEqual({ mode: 'fixed', monthlyCents: 150_000, setupFeeCents: null });
      expect(await rentalOf('software-personalizado')).toEqual({ mode: 'pending', monthlyCents: null, setupFeeCents: null });
      expect(await rentalOf('landing-page')).toEqual({ mode: 'pending', monthlyCents: null, setupFeeCents: null });
      expect((await connection.collection('packages').findOne({ slug: 'landing-page' }))?.rentalProfile.enabled).toBe(false);
      expect((await connection.collection('packages').findOne({ slug: 'web-corporativa' }))?.rentalProfile.enabled).toBe(false);
    });

    it('el catálogo público muestra la mensualidad sin exponer costos', async () => {
      const res = await http.get('/api/v1/packages').expect(200);
      const bySlug = new Map(res.body.items.map((p: { slug: string }) => [p.slug, p]));
      expect((bySlug.get('landing-page') as { subscription: unknown }).subscription).toBeNull();
      expect((bySlug.get('web-corporativa') as { subscription: unknown }).subscription).toBeNull();
      expect((bySlug.get('tienda-virtual') as { subscription: unknown }).subscription).toEqual({
        pricing: { mode: 'fixed', amountCents: 100_000, currency: 'MXN', pendingPricing: false },
        hardwareUpfront: false,
        includesHosting: false,
        storageGb: 0,
        includesDomain: false,
        softwareOnly: false,
        supportIncludedCents: null,
        infrastructureAnnualCents: null,
      });
      expect((bySlug.get('software-personalizado') as { subscription: { pricing: unknown } }).subscription.pricing).toMatchObject({ mode: 'pending', pendingPricing: true });
      expect(JSON.stringify(res.body)).not.toMatch(/hostingCostKey|recoverable|financing/);
      const settings = await http.get('/api/v1/settings/public').expect(200);
      expect(settings.body.subscription).toEqual({ minimumTermMonths: 12, monthToMonthSurchargeBp: 1_500, semiannualDiscountBp: 500, annualDiscountBp: 1_000 });
    });
  });

  describe('GET /api/v1/packages', () => {
    it('devuelve los 7 servicios con los precios base aprobados y sin datos privados', async () => {
      const res = await http.get('/api/v1/packages').expect(200);
      const bySlug = new Map(res.body.items.map((p: { slug: string }) => [p.slug, p]));
      expect(res.body.items).toHaveLength(7);

      const expected: Record<string, { mode: string; amountCents: number | null }> = {
        'landing-page': { mode: 'fixed', amountCents: 349_900 },
        'web-corporativa': { mode: 'fixed', amountCents: 799_900 },
        'tienda-virtual': { mode: 'fixed', amountCents: 1_499_900 },
        'punto-de-venta': { mode: 'fixed', amountCents: 1_800_000 },
        'solucion-combinada': { mode: 'fixed', amountCents: 2_700_000 },
        'software-personalizado': { mode: 'starting_at', amountCents: 3_900_000 },
        'aun-no-estoy-seguro': { mode: 'on_request', amountCents: null },
      };
      for (const [slug, pricing] of Object.entries(expected)) {
        expect((bySlug.get(slug) as { pricing: unknown }).pricing).toMatchObject(pricing);
      }

      const json = JSON.stringify(res.body);
      for (const forbidden of ['cost', 'removalCredit', 'supplier', 'createdBy', '"_id"', '"__v"']) {
        expect(json).not.toContain(forbidden);
      }
    });

    it('filtra por categoría y destacados, y valida los parámetros', async () => {
      expect((await http.get('/api/v1/packages?category=web').expect(200)).body.items).toHaveLength(2);
      expect((await http.get('/api/v1/packages?category=combo').expect(200)).body.items).toHaveLength(1);
      expect((await http.get('/api/v1/packages?category=custom').expect(200)).body.items).toHaveLength(2);
      expect((await http.get('/api/v1/packages?featured=true').expect(200)).body.items).toHaveLength(3);
      await http.get('/api/v1/packages?category=otra').expect(400);
    });

    it('la Solución Combinada lista los paquetes que integra', async () => {
      const res = await http.get('/api/v1/packages?category=combo').expect(200);
      expect(res.body.items[0].includesPackages).toEqual([
        { slug: 'tienda-virtual', name: 'Tienda Virtual' },
        { slug: 'punto-de-venta', name: 'Punto de Venta (POS)' },
      ]);
      expect(res.body.items[0].notes.join(' ')).toContain('no se cobra aparte');
    });
  });

  describe('GET /api/v1/packages/:slug', () => {
    it('detalla lo incluido y los adicionales compatibles con sus dependencias', async () => {
      const res = await http.get('/api/v1/packages/punto-de-venta').expect(200);
      expect(res.body.items).toContainEqual({ component: { slug: 'pos-register', name: 'Venta en caja', unit: 'unidad' }, quantity: 1, removable: false });
      const addOns = res.body.addOns.map((c: { slug: string }) => c.slug);
      expect(addOns).toEqual(expect.arrayContaining(['pos-suppliers', 'pos-supplier-accounts', 'pos-payroll', 'scale']));
      expect(addOns).not.toContain('pos-online-orders');
      expect(addOns).not.toContain('stripe-payments');
      expect(res.body.addOns.find((c: { slug: string }) => c.slug === 'pos-supplier-accounts')).toMatchObject({
        pricing: { mode: 'pending', pendingPricing: true },
        requires: [{ slug: 'pos-suppliers', name: 'Proveedores', message: expect.any(String) }],
      });
      expect(res.body.recommendedRecurring).toEqual([]);
    });

    it('la tienda solo ofrece los adicionales documentados de la Parte 1', async () => {
      const res = await http.get('/api/v1/packages/tienda-virtual').expect(200);
      const addOns = res.body.addOns.map((c: { slug: string }) => c.slug);
      expect(addOns).toEqual(expect.arrayContaining(['offers-manager', 'stripe-payments', 'mercadopago-payments', 'order-emails', 'whatsapp-button']));
      for (const excluded of ['coupons', 'wishlist', 'cart-recovery', 'subscriptions', 'reviews', 'managed-blog', 'chatbot', 'crm-integration', 'whatsapp-business-api']) {
        expect(addOns).not.toContain(excluded);
      }
      expect(res.body.subscriptionIncludedServices).toEqual([]);
    });

    it('la combinada incluye los pedidos en línea y ofrece los adicionales de ambos lados', async () => {
      const res = await http.get('/api/v1/packages/solucion-combinada').expect(200);
      expect(res.body.items.map((i: { component: { slug: string } }) => i.component.slug)).toEqual(['pos-online-orders']);
      expect(res.body.includedPackages).toEqual([
        { slug: 'tienda-virtual', name: 'Tienda Virtual', variants: {} },
        { slug: 'punto-de-venta', name: 'Punto de Venta (POS)', variants: {} },
      ]);
      const addOns = res.body.addOns.map((c: { slug: string }) => c.slug);
      expect(addOns).toEqual(expect.arrayContaining(['stripe-payments', 'pos-reports']));
      expect(new Set(addOns).size).toBe(addOns.length);
    });

    it('404 para paquetes inexistentes o retirados y 400 para slugs inválidos', async () => {
      await http.get('/api/v1/packages/no-existe').expect(404);
      await http.get('/api/v1/packages/ecommerce-pro').expect(404);
      await http.get('/api/v1/packages/%24where').expect(400);
    });
  });

  describe('GET /api/v1/components/public, categories, industries', () => {
    it('solo expone complementos vendibles con su precio y tipo de cobro', async () => {
      const res = await http.get('/api/v1/components/public').expect(200);
      const slugs = res.body.items.map((c: { slug: string }) => c.slug);
      expect(slugs).toContain('web-section');
      expect(slugs).not.toContain('pc-new-i5');
      expect(slugs).not.toContain('ecommerce-product');
      expect(res.body.items.find((c: { slug: string }) => c.slug === 'web-section').pricing).toMatchObject({ mode: 'fixed', amountCents: 45_000 });
      expect(res.body.items.find((c: { slug: string }) => c.slug === 'domain-annual')).toMatchObject({
        billing: 'annual',
        pricing: { mode: 'fixed', amountCents: 25_000 },
      });
    });

    it('separa los servicios recurrentes de los pagos únicos', async () => {
      const res = await http.get('/api/v1/components/public?category=servicios-recurrentes').expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.every((c: { billing: string }) => c.billing !== 'one_time')).toBe(true);
    });

    it('lista categorías e industrias', async () => {
      expect((await http.get('/api/v1/categories').expect(200)).body.items).toHaveLength(9);
      const industries = (await http.get('/api/v1/industries').expect(200)).body.items;
      expect(industries).toHaveLength(9);
      expect(industries[0]).toMatchObject({ slug: 'tiendas-abarrotes', suggestedSolutions: ['pos'] });
    });
  });

  describe('versionado de precios', () => {
    let pricing: PricingService;
    let componentId: Types.ObjectId;
    const admin = SYSTEM_ACTOR('e2e-admin');

    beforeAll(async () => {
      pricing = app.get(PricingService);
      componentId = (await connection.collection('components').findOne({ slug: 'web-section' }))!._id;
    });

    it('publicar crea una versión nueva, reemplaza la vigente y se refleja en la API', async () => {
      const draft = await pricing.createComponentPriceDraft(componentId, { mode: 'fixed', saleCents: 50_000, costCents: 20_000 }, admin);
      expect(draft).toMatchObject({ version: 2, status: 'draft' });

      // Un borrador no afecta el precio público.
      let res = await http.get('/api/v1/components/public?category=desarrollo-web').expect(200);
      expect(res.body.items.find((c: { slug: string }) => c.slug === 'web-section').pricing.amountCents).toBe(45_000);

      await pricing.publishComponentPrice(draft._id, admin);
      res = await http.get('/api/v1/components/public?category=desarrollo-web').expect(200);
      expect(res.body.items.find((c: { slug: string }) => c.slug === 'web-section').pricing.amountCents).toBe(50_000);
      expect(JSON.stringify(res.body)).not.toContain('20000');

      const history = await pricing.listComponentPriceHistory(componentId);
      expect(history.map((v) => [v.version, v.status])).toEqual([
        [2, 'published'],
        [1, 'superseded'],
      ]);
    });

    it('restaurar una versión anterior crea una versión nueva auditada (no reactiva la antigua)', async () => {
      const v1 = (await pricing.listComponentPriceHistory(componentId)).find((v) => v.version === 1)!;
      const restored = await pricing.restoreComponentPrice(v1._id, admin);
      expect(restored).toMatchObject({ version: 3, status: 'published', saleCents: 45_000, restoredFromVersion: 1 });

      const history = await pricing.listComponentPriceHistory(componentId);
      expect(history.filter((v) => v.status === 'published')).toHaveLength(1);
      expect(history.find((v) => v.version === 1)?.status).toBe('superseded');

      const audit = await connection
        .collection('audit_logs')
        .find({ entityId: componentId, actor: { type: 'system', label: 'e2e-admin' } })
        .sort({ createdAt: 1 })
        .toArray();
      expect(audit.map((a) => a.action)).toEqual(['component_price.published', 'component_price.restored']);
      expect(audit[1]).toMatchObject({ before: { version: 2, saleCents: 50_000 }, after: { version: 3, saleCents: 45_000 } });
    });

    it('rechaza publicar versiones que no son borradores', async () => {
      const current = (await pricing.listComponentPriceHistory(componentId))[0]!;
      await expect(pricing.publishComponentPrice(current._id, admin)).rejects.toThrow('Solo se pueden publicar borradores');
    });

    it('la base de datos garantiza una sola versión publicada por componente', async () => {
      await expect(
        connection.collection('component_prices').insertOne({
          component: componentId,
          version: 99,
          status: 'published',
          mode: 'fixed',
          saleCents: 1,
          costCents: null,
          currency: 'MXN',
          createdBy: 'test',
        }),
      ).rejects.toThrow(/duplicate key/);
    });

    it('publicar un precio pendiente marca el componente como pending_pricing', async () => {
      const draft = await pricing.createComponentPriceDraft(componentId, { mode: 'pending', saleCents: null }, admin);
      await pricing.publishComponentPrice(draft._id, admin);
      expect((await connection.collection('components').findOne({ _id: componentId }))?.pricingStatus).toBe('pending_pricing');
    });

    it('el modelo rechaza importes inconsistentes', async () => {
      await expect(pricing.createComponentPriceDraft(componentId, { mode: 'fixed', saleCents: null }, admin)).rejects.toThrow();
      await expect(pricing.createComponentPriceDraft(componentId, { mode: 'fixed', saleCents: 10.5 }, admin)).rejects.toThrow();
      await expect(pricing.createComponentPriceDraft(componentId, { mode: 'pending', saleCents: 100 }, admin)).rejects.toThrow();
    });
  });
});
