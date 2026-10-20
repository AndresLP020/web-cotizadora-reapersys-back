import { QuoteSelectionError, type QuoteSelection } from './engine.types';
import { calculateQuote } from './quote-engine';
import { seedSnapshot } from './seed-snapshot.fixture';

const select = (partial: Partial<QuoteSelection>): QuoteSelection => ({
  packageSlug: null,
  variants: {},
  removedComponents: [],
  components: [],
  recurring: [],
  ...partial,
});

const catalog = seedSnapshot();
const codes = (result: ReturnType<typeof calculateQuote>) => result.reviewReasons.map((r) => r.code);
const includedSlugs = (result: ReturnType<typeof calculateQuote>) => result.includedItems.map((i) => i.componentSlug);

describe('motor de cotización', () => {
  describe('precios base aprobados (§1)', () => {
    it.each([
      ['landing-page', 349_900],
      ['web-corporativa', 799_900],
      ['tienda-virtual', 1_499_900],
      ['punto-de-venta', 1_800_000],
      ['solucion-combinada', 2_700_000],
    ])('%s cobra exactamente su precio base', (packageSlug, cents) => {
      const result = calculateQuote(catalog, select({ packageSlug }));
      expect(result.lines.find((l) => l.kind === 'package')).toMatchObject({ amountCents: cents, priceMode: 'fixed' });
      expect(result.totals.subtotalCents).toBe(cents);
    });

    it('Software Personalizado es un mínimo «desde $39,000» sujeto a evaluación', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'software-personalizado' }));
      expect(result.status).toBe('needs_review');
      expect(codes(result)).toContain('package_starting_at');
      expect(result.lines[0]).toMatchObject({ amountCents: 3_900_000, priceMode: 'starting_at' });
    });

    it('«Aún no estoy seguro» no genera un total automático', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'aun-no-estoy-seguro' }));
      expect(result.status).toBe('needs_review');
      expect(codes(result)).toContain('package_requires_evaluation');
      expect(result.lines[0]).toMatchObject({ amountCents: null });
      expect(result.totals.hasPendingAmounts).toBe(true);
    });

    it('Landing Page conserva su alcance: subtotal, anticipo y mantenimiento', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'landing-page' }));
      expect(result.status).toBe('priced');
      expect(result.totals).toMatchObject({ subtotalCents: 349_900, totalCents: 349_900, depositCents: 174_950, balanceCents: 174_950, recurringMonthlyCents: 39_900 });
      expect(result.includedItems).toContainEqual(expect.objectContaining({ componentSlug: 'web-section', quantity: 4, removed: false }));
    });
  });

  describe('renta mensual (§1)', () => {
    const subscribe = (packageSlug: string, partial: Partial<QuoteSelection> = {}) =>
      calculateQuote(catalog, select({ paymentMode: 'subscription', packageSlug, ...partial }));

    it.each([
      ['tienda-virtual', 100_000],
      ['punto-de-venta', 70_000],
      ['solucion-combinada', 150_000],
    ])('%s se renta en %i centavos al mes, sin cuota de instalación inventada', (slug, monthly) => {
      const result = subscribe(slug);
      expect(result.lines).toEqual([]);
      expect(result.totals.totalCents).toBe(0);
      expect(result.subscription).toMatchObject({
        baseMonthlyCents: monthly,
        monthlyCents: monthly,
        priceMode: 'fixed',
        hostingCharge: null,
        annualCharge: { name: 'Dominio y hosting', cents: 50_000 },
        hardwareUpfront: false,
      });
      // Primer pago: primer mes + dominio y hosting del año.
      expect(result.subscription!.firstPaymentCents).toBe(monthly + 50_000);
      expect(result.recurring).toEqual([]);
    });

    it('no suma a la vez compra y renta', () => {
      const result = subscribe('tienda-virtual');
      expect(result.lines.some((l) => l.kind === 'package')).toBe(false);
    });

    it('Landing Page y Web Corporativa no se rentan', () => {
      expect(() => subscribe('landing-page')).toThrow('no se ofrece en suscripción');
      expect(() => subscribe('web-corporativa')).toThrow('no se ofrece en suscripción');
    });

    it('Software Personalizado: renta «a cotizar» (pendiente)', () => {
      const result = subscribe('software-personalizado');
      expect(result.subscription).toMatchObject({ monthlyCents: null, priceMode: 'pending' });
      expect(codes(result)).toContain('subscription_pending_price');
    });

    it('en renta, un adicional sin precio aprobado tampoco genera total', () => {
      const result = subscribe('tienda-virtual', { components: [{ slug: 'stripe-payments', quantity: 1 }] });
      expect(result.lines.find((l) => l.kind === 'addon')).toMatchObject({ amountCents: null, priceMode: 'pending' });
      expect(result.subscription!.firstPaymentCents).toBeNull();
    });
  });

  describe('incluidos vs adicionales (§7)', () => {
    it('la Tienda Virtual lista sus funcionalidades incluidas', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'tienda-virtual' }));
      expect(includedSlugs(result)).toEqual(
        expect.arrayContaining(['store-catalog', 'store-cart', 'store-checkout', 'store-basic-payments', 'store-orders', 'store-integrity']),
      );
    });

    it('pedir algo incluido no genera ningún cargo', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'punto-de-venta', components: [{ slug: 'pos-tickets', quantity: 1 }] }));
      expect(result.lines.filter((l) => l.kind === 'addon')).toHaveLength(0);
      expect(result.totals.subtotalCents).toBe(1_800_000);
    });

    it('un adicional sin precio aprobado se muestra «Por cotizar»: sin importe inventado y a revisión', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'tienda-virtual', components: [{ slug: 'offers-manager', quantity: 1 }] }));
      expect(result.status).toBe('needs_review');
      expect(codes(result)).toContain('component_pending_price');
      expect(result.lines.find((l) => l.kind === 'addon')).toMatchObject({ componentSlug: 'offers-manager', amountCents: null, priceMode: 'pending' });
      expect(result.totals.subtotalCents).toBe(1_499_900);
      expect(result.totals.hasPendingAmounts).toBe(true);
    });

    it('con precio aprobado desde Administración, el adicional se cobra', () => {
      const approved = seedSnapshot();
      const component = approved.componentsBySlug.get('pos-returns')!;
      component.price = { priceId: 'price-pos-returns', version: 2, mode: 'fixed', saleCents: 120_000 };
      const result = calculateQuote(approved, select({ packageSlug: 'punto-de-venta', components: [{ slug: 'pos-returns', quantity: 1 }] }));
      expect(result.status).toBe('priced');
      expect(result.totals.subtotalCents).toBe(1_800_000 + 120_000);
    });

    it('solo acepta los adicionales documentados para el paquete', () => {
      expect(() => calculateQuote(catalog, select({ packageSlug: 'tienda-virtual', components: [{ slug: 'wishlist', quantity: 1 }] }))).toThrow(
        'no se ofrece con Tienda Virtual',
      );
      expect(() => calculateQuote(catalog, select({ packageSlug: 'tienda-virtual', components: [{ slug: 'chatbot', quantity: 1 }] }))).toThrow(
        QuoteSelectionError,
      );
      expect(() => calculateQuote(catalog, select({ packageSlug: 'punto-de-venta', components: [{ slug: 'stripe-payments', quantity: 1 }] }))).toThrow(
        'no se ofrece con Punto de Venta',
      );
    });

    it('los pedidos en línea no se ofrecen aislados a un POS', () => {
      expect(() =>
        calculateQuote(catalog, select({ packageSlug: 'punto-de-venta', components: [{ slug: 'pos-online-orders', quantity: 1 }] })),
      ).toThrow('no se ofrece como complemento');
    });

    it('Landing Page cobra solo las secciones que exceden las cuatro incluidas', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'landing-page', components: [{ slug: 'web-section', quantity: 6 }] }));
      expect(result.lines.find((l) => l.kind === 'addon')).toMatchObject({ quantity: 2, includedQuantity: 4, amountCents: 90_000 });
    });

    it('Web Corporativa suma varios complementos con precisión de centavos', () => {
      const result = calculateQuote(
        catalog,
        select({
          packageSlug: 'web-corporativa',
          components: [
            { slug: 'email-button', quantity: 1 },
            { slug: 'seo-initial', quantity: 1 },
            { slug: 'web-internal-page', quantity: 6 },
          ],
        }),
      );
      // 7,999 + 200 + 1,500 + 2 × 950 = 11,599
      expect(result.totals.totalCents).toBe(1_159_900);
    });

    it('Web Corporativa incluye los botones de redes sociales y no los cobra de nuevo', () => {
      const result = calculateQuote(
        catalog,
        select({ packageSlug: 'web-corporativa', components: [{ slug: 'whatsapp-button', quantity: 1 }, { slug: 'instagram-button', quantity: 1 }] }),
      );
      expect(includedSlugs(result)).toEqual(expect.arrayContaining(['whatsapp-button', 'facebook-button', 'instagram-button', 'tiktok-button']));
      expect(result.lines.filter((l) => l.kind === 'addon')).toEqual([]);
      expect(result.totals.totalCents).toBe(799_900);
    });
  });

  describe('dependencias (§4.2)', () => {
    it('Cuentas de proveedores sin Proveedores queda bloqueado con la causa', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'punto-de-venta', components: [{ slug: 'pos-supplier-accounts', quantity: 1 }] }));
      expect(result.status).toBe('blocked');
      expect(result.blockingIssues[0]).toMatchObject({ componentSlug: 'pos-supplier-accounts', message: expect.stringContaining('Proveedores') });
    });

    it('con su dependencia, deja de estar bloqueado', () => {
      const result = calculateQuote(
        catalog,
        select({ packageSlug: 'punto-de-venta', components: [{ slug: 'pos-suppliers', quantity: 1 }, { slug: 'pos-supplier-accounts', quantity: 1 }] }),
      );
      expect(result.status).toBe('needs_review');
      expect(result.blockingIssues).toEqual([]);
    });

    it('Adelantos de sueldo requiere Sueldos', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'punto-de-venta', components: [{ slug: 'pos-payroll-advances', quantity: 1 }] }));
      expect(result.blockingIssues.map((i) => i.ruleKey)).toEqual(['pos-payroll-advances-requires-pos-payroll']);
    });

    it('desde cero, los módulos de tienda y POS quedan bloqueados por falta de paquete', () => {
      const result = calculateQuote(catalog, select({ components: [{ slug: 'pos-returns', quantity: 1 }] }));
      expect(result.status).toBe('blocked');
    });
  });

  describe('Solución Combinada (§5)', () => {
    const combo = () => calculateQuote(catalog, select({ packageSlug: 'solucion-combinada' }));

    it('incluye ambos lados UNA sola vez, más los pedidos en línea desde el POS', () => {
      const result = combo();
      const slugs = includedSlugs(result);
      expect(slugs).toEqual(expect.arrayContaining(['store-catalog', 'store-checkout', 'pos-register', 'pos-inventory', 'pos-customers', 'pos-online-orders']));
      expect(new Set(slugs).size).toBe(slugs.length);
      expect(result.includedItems.every((i) => i.quantity === 1)).toBe(true);
    });

    it('no cobra aparte la conexión tienda–POS', () => {
      const result = combo();
      expect(result.lines).toHaveLength(1);
      expect(result.totals.subtotalCents).toBe(2_700_000);
      expect(result.status).toBe('priced');
      expect(() => calculateQuote(catalog, select({ packageSlug: 'solucion-combinada', components: [{ slug: 'pos-ecommerce-sync', quantity: 1 }] }))).toThrow(
        'no se ofrece con Solución Combinada',
      );
    });

    it('ofrece los adicionales de ambos lados sin duplicar los compartidos', () => {
      const result = calculateQuote(
        catalog,
        select({ packageSlug: 'solucion-combinada', components: [{ slug: 'bulk-sales', quantity: 1 }, { slug: 'stripe-payments', quantity: 1 }, { slug: 'pos-reports', quantity: 1 }] }),
      );
      expect(result.blockingIssues).toEqual([]);
      expect(result.lines.filter((l) => l.kind === 'addon').map((l) => l.componentSlug)).toEqual(['bulk-sales', 'stripe-payments', 'pos-reports']);
    });
  });

  describe('cambio de paquete y retiros', () => {
    it('un módulo opcional en un paquete queda incluido (sin cargo) en otro', () => {
      // pos-online-orders no es complemento del POS, pero va incluido en la Solución Combinada.
      const result = calculateQuote(catalog, select({ packageSlug: 'solucion-combinada', components: [{ slug: 'pos-online-orders', quantity: 1 }] }));
      expect(result.lines.filter((l) => l.kind === 'addon')).toHaveLength(0);
    });

    it('los incluidos no se pueden retirar sin crédito aprobado configurado', () => {
      expect(() => calculateQuote(catalog, select({ packageSlug: 'tienda-virtual', removedComponents: ['store-cart'] }))).toThrow('no se puede retirar');
    });

    it('con un incluido retirable y sin crédito aprobado, se envía a revisión', () => {
      const removable = seedSnapshot({
        mutatePackage: (pkg) => {
          if (pkg.slug !== 'punto-de-venta') return;
          pkg.items = pkg.items.map((i) => (i.componentId === 'pos-tickets' ? { ...i, removable: true } : i));
          pkg.price!.removalCredits = [{ componentId: 'pos-tickets', mode: 'pending', creditCents: null }];
        },
      });
      const result = calculateQuote(removable, select({ packageSlug: 'punto-de-venta', removedComponents: ['pos-tickets'] }));
      expect(codes(result)).toContain('removal_credit_pending');
      expect(result.totals.subtotalCents).toBe(1_800_000);
    });
  });

  describe('recurrentes y configuración', () => {
    it('los recurrentes se muestran aparte y NO se suman al total inicial', () => {
      const result = calculateQuote(catalog, select({ packageSlug: 'web-corporativa', recurring: ['maintenance-web-business'] }));
      expect(result.totals.totalCents).toBe(799_900);
      expect(result.totals.recurringMonthlyCents).toBe(89_900);
      expect(result.totals.recurringAnnualCents).toBe(50_000);
    });

    it('la tienda y el POS no anexan mantenimiento obligatorio', () => {
      const slugs = (packageSlug: string) => calculateQuote(catalog, select({ packageSlug })).recurring.map((r) => r.componentSlug);
      expect(slugs('tienda-virtual')).toEqual(['domain-hosting']);
      expect(slugs('punto-de-venta')).toEqual(['domain-hosting']);
    });

    it('sin vigencia, ninguna cotización se presenta como definitiva', () => {
      const pending = seedSnapshot({ settings: { validityDays: null } });
      expect(codes(calculateQuote(pending, select({ packageSlug: 'landing-page' })))).toEqual(['validity_not_configured']);
    });

    it('usa el porcentaje de anticipo configurado', () => {
      const thirty = seedSnapshot({ settings: { depositRateBp: 3_000 } });
      const result = calculateQuote(thirty, select({ packageSlug: 'landing-page' }));
      expect(result.totals.depositCents).toBe(104_970);
    });

    it('comenzar desde cero es una solución personalizada sujeta a valoración', () => {
      const result = calculateQuote(catalog, select({ components: [{ slug: 'custom-software', quantity: 1 }] }));
      expect(codes(result)).toEqual(expect.arrayContaining(['custom_solution', 'component_pending_price']));
    });

    it('rechaza selecciones vacías, repetidas o paquetes retirados', () => {
      expect(() => calculateQuote(catalog, select({}))).toThrow('Selecciona un paquete');
      expect(() => calculateQuote(catalog, select({ packageSlug: 'ecommerce-pro' }))).toThrow('no está disponible');
      expect(() =>
        calculateQuote(catalog, select({ packageSlug: 'punto-de-venta', components: [{ slug: 'pos-returns', quantity: 1 }, { slug: 'pos-returns', quantity: 1 }] })),
      ).toThrow('repetido');
    });
  });

  describe('dominio y hosting', () => {
    it.each(['landing-page', 'web-corporativa', 'tienda-virtual', 'punto-de-venta', 'solucion-combinada', 'software-personalizado'])(
      '%s lleva dominio y hosting juntos: $500 al año, aparte del total',
      (packageSlug) => {
        const result = calculateQuote(catalog, select({ packageSlug }));
        expect(result.recurring.filter((r) => r.billing === 'annual')).toEqual([
          { componentSlug: 'domain-hosting', description: 'Dominio y hosting', billing: 'annual', amountCents: 50_000, priceMode: 'fixed' },
        ]);
        expect(result.totals.recurringAnnualCents).toBe(50_000);
        expect(result.providedByClient).toEqual([]);
      },
    );

    it('se descuenta lo que el cliente ya tiene', () => {
      const ownDomain = calculateQuote(catalog, select({ packageSlug: 'landing-page', clientProvided: ['domain-annual'] }));
      expect(ownDomain.recurring.find((r) => r.componentSlug === 'domain-hosting')).toMatchObject({ description: 'Hosting', amountCents: 25_000 });
      expect(ownDomain.totals.recurringAnnualCents).toBe(25_000);
      expect(ownDomain.providedByClient).toEqual([{ componentSlug: 'domain-annual', name: 'Dominio' }]);
      expect(ownDomain.status).toBe('priced');

      const ownBoth = calculateQuote(catalog, select({ packageSlug: 'landing-page', clientProvided: ['domain-annual', 'hosting-annual'] }));
      expect(ownBoth.totals.recurringAnnualCents).toBe(0);
      expect(ownBoth.recurring.map((r) => r.componentSlug)).not.toContain('domain-hosting');
    });

    it('en renta va en el primer pago y también se descuenta', () => {
      const result = calculateQuote(catalog, select({ paymentMode: 'subscription', packageSlug: 'tienda-virtual', clientProvided: ['hosting-annual'] }));
      expect(result.subscription).toMatchObject({ annualCharge: { name: 'Dominio', cents: 25_000 }, firstPaymentCents: 125_000 });

      const ownBoth = calculateQuote(
        catalog,
        select({ paymentMode: 'subscription', packageSlug: 'tienda-virtual', clientProvided: ['hosting-annual', 'domain-annual'] }),
      );
      expect(ownBoth.subscription).toMatchObject({ annualCharge: null, firstPaymentCents: 100_000 });
    });

    it('rechaza lo que no es dominio ni hosting, o cobrarlos por separado', () => {
      expect(() => calculateQuote(catalog, select({ packageSlug: 'landing-page', clientProvided: ['seo-initial'] }))).toThrow('no es dominio ni hosting');
      expect(() => calculateQuote(catalog, select({ packageSlug: 'landing-page', recurring: ['domain-annual'] }))).toThrow('ya va con el paquete');
      expect(() => calculateQuote(catalog, select({ paymentMode: 'subscription', packageSlug: 'tienda-virtual', recurring: ['hosting-annual'] }))).toThrow(
        'ya va con el paquete',
      );
    });
  });

  it('es determinista: la misma entrada produce exactamente el mismo resultado', () => {
    const input = select({ packageSlug: 'solucion-combinada', components: [{ slug: 'pos-reports', quantity: 1 }] });
    expect(calculateQuote(catalog, input)).toEqual(calculateQuote(catalog, input));
  });
});
