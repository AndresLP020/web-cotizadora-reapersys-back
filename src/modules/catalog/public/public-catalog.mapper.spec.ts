import { Types } from 'mongoose';
import type { PackagePrice } from '../../pricing/schemas/package-price.schema';
import type { Component } from '../schemas/component.schema';
import type { Package } from '../schemas/package.schema';
import { componentPricing, packagePricing, toPublicComponent, toPublicPackage, variantOptionPricing } from './public-catalog.mapper';

const posIntegral = {
  pricingType: 'fixed',
  variantGroups: [
    {
      key: 'equipo',
      name: 'Configuración',
      defaultOption: 'a',
      options: [
        { key: 'a', name: '8 GB / 250 GB', items: [] },
        { key: 'b', name: '16 GB / 500 GB', items: [] },
      ],
    },
  ],
} as unknown as Package;

const priceWithPendingB = {
  mode: 'fixed',
  baseCents: 1_100_000,
  variantPrices: [{ groupKey: 'equipo', optionKey: 'b', mode: 'pending', deltaCents: null }],
} as unknown as PackagePrice;

describe('public catalog mapper', () => {
  describe('variantes', () => {
    const group = posIntegral.variantGroups[0]!;

    it('la opción por defecto toma el precio base', () => {
      expect(variantOptionPricing(priceWithPendingB, group, 'a')).toEqual({
        mode: 'fixed',
        amountCents: 1_100_000,
        currency: 'MXN',
        pendingPricing: false,
      });
    });

    it('una diferencia pendiente NO se convierte en un importe (variante B del POS Integral)', () => {
      expect(variantOptionPricing(priceWithPendingB, group, 'b')).toMatchObject({ mode: 'pending', amountCents: null, pendingPricing: true });
    });

    it('una opción sin delta registrado también queda pendiente', () => {
      const price = { ...priceWithPendingB, variantPrices: [] } as unknown as PackagePrice;
      expect(variantOptionPricing(price, group, 'b').pendingPricing).toBe(true);
    });

    it('suma el delta aprobado al precio base (POS Premium High = 18,000 + 1,500)', () => {
      const price = {
        mode: 'fixed',
        baseCents: 1_800_000,
        variantPrices: [{ groupKey: 'equipo', optionKey: 'b', mode: 'fixed', deltaCents: 150_000 }],
      } as unknown as PackagePrice;
      expect(variantOptionPricing(price, group, 'b').amountCents).toBe(1_950_000);
    });
  });

  describe('precio del paquete', () => {
    it('se presenta "desde" si alguna variante cuesta más o está pendiente', () => {
      expect(packagePricing(posIntegral, priceWithPendingB)).toMatchObject({ mode: 'starting_at', amountCents: 1_100_000 });
    });

    it('se mantiene fijo sin variantes', () => {
      const simple = { pricingType: 'fixed', variantGroups: [] } as unknown as Package;
      const price = { mode: 'fixed', baseCents: 349_900, variantPrices: [] } as unknown as PackagePrice;
      expect(packagePricing(simple, price)).toEqual({ mode: 'fixed', amountCents: 349_900, currency: 'MXN', pendingPricing: false });
    });

    it('sin versión publicada queda pendiente, y "evaluation" se muestra sujeto a valoración', () => {
      expect(packagePricing(posIntegral, undefined)).toMatchObject({ mode: 'pending', amountCents: null });
      const evaluation = { pricingType: 'evaluation', variantGroups: [] } as unknown as Package;
      expect(packagePricing(evaluation, priceWithPendingB)).toMatchObject({ mode: 'on_request', amountCents: null });
    });
  });

  it('un componente sin precio publicado o pendiente no muestra importe', () => {
    expect(componentPricing(undefined)).toMatchObject({ mode: 'pending', amountCents: null });
    expect(componentPricing({ mode: 'pending', saleCents: null })).toMatchObject({ pendingPricing: true });
    expect(componentPricing({ mode: 'starting_at', saleCents: 600_000 })).toMatchObject({ mode: 'starting_at', amountCents: 600_000 });
  });

  it('nunca expone costos, proveedor, existencias ni SKU interno', () => {
    const component = {
      _id: new Types.ObjectId(),
      sku: 'HW-SCALE',
      slug: 'scale',
      name: 'Báscula',
      kind: 'hardware',
      billing: 'one_time',
      unit: 'equipo',
      supplier: new Types.ObjectId(),
      stock: 7,
      requiresEvaluation: false,
      maxQuantity: 5,
    } as unknown as Component & { _id: Types.ObjectId };
    const price = { mode: 'fixed', saleCents: 200_000, costCents: 120_000 } as const;

    const result = toPublicComponent(component, { slug: 'hardware-pos', name: 'Hardware' }, price);
    const json = JSON.stringify(result);
    expect(result.pricing.amountCents).toBe(200_000);
    for (const forbidden of ['cost', '120000', 'supplier', 'stock', 'HW-SCALE', 'margin', 'markup']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('lista los paquetes contenidos de un combo por nombre', () => {
    const webId = new Types.ObjectId();
    const combo = {
      _id: new Types.ObjectId(),
      slug: 'reaper-business',
      name: 'Reaper Business',
      category: 'combo',
      summary: 'x',
      pricingType: 'fixed',
      features: [],
      notes: [],
      variantGroups: [],
      includesPackages: [{ package: webId, variants: {} }],
      featured: false,
      sortOrder: 1,
    } as unknown as Package & { _id: Types.ObjectId };
    const web = { _id: webId, slug: 'web-business', name: 'Web Business' } as unknown as Package & { _id: Types.ObjectId };

    const result = toPublicPackage(combo, { price: undefined, packagesById: new Map([[webId.toString(), web]]) });
    expect(result.includesPackages).toEqual([{ slug: 'web-business', name: 'Web Business' }]);
  });
});
