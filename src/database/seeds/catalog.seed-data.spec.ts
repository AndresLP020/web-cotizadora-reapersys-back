import { seedComponents, seedPackages, seedRules, type SeedPackage } from './catalog.seed-data';

const components = new Map(seedComponents.map((c) => [c.slug, c]));
const packages = new Map(seedPackages.map((p) => [p.slug, p]));

/** Slugs incluidos de verdad: los propios y los de sus paquetes contenidos (combos). */
function includedSlugs(pkg: SeedPackage): Set<string> {
  const inner = (pkg.includesPackages ?? []).flatMap((ref) => packages.get(ref.package)?.items ?? []);
  return new Set([...inner, ...(pkg.items ?? [])].map((item) => item.component));
}

describe('catálogo del seed', () => {
  it('todo slug referenciado existe', () => {
    for (const pkg of seedPackages) {
      const slugs = [...(pkg.items ?? []).map((i) => i.component), ...(pkg.addOns ?? []), ...(pkg.equivalents ?? []), ...(pkg.recommendedRecurring ?? [])];
      for (const slug of slugs) expect([pkg.slug, slug, components.has(slug)]).toEqual([pkg.slug, slug, true]);
    }
    for (const rule of seedRules) expect([rule.key, components.has(rule.subject)]).toEqual([rule.key, true]);
  });

  describe.each(seedPackages.map((pkg) => [pkg.slug, pkg] as const))('%s', (_slug, pkg) => {
    const included = includedSlugs(pkg);
    const covered = new Set(pkg.features.flatMap((f) => f.covers));

    it('cada característica describe algo que el paquete incluye', () => {
      for (const { text, covers } of pkg.features) {
        expect([text, covers.length > 0]).toEqual([text, true]);
        for (const slug of covers) {
          const ok = slug.startsWith('@') ? (pkg.includesPackages ?? []).some((ref) => ref.package === slug.slice(1)) : (pkg.items ?? []).some((i) => i.component === slug);
          expect([text, slug, ok]).toEqual([text, slug, true]);
        }
      }
    });

    it('todo lo incluido aparece en alguna característica', () => {
      for (const item of pkg.items ?? []) expect([item.component, covered.has(item.component)]).toEqual([item.component, true]);
      for (const ref of pkg.includesPackages ?? []) expect([ref.package, covered.has(`@${ref.package}`)]).toEqual([ref.package, true]);
    });

    it('«Puedes agregar» no repite lo incluido ni lo equivalente (salvo unidades extra)', () => {
      const equivalents = new Set(pkg.equivalents ?? []);
      for (const slug of pkg.addOns ?? []) {
        const component = components.get(slug)!;
        expect([slug, equivalents.has(slug)]).toEqual([slug, false]);
        if (included.has(slug)) expect([slug, (component.maxQuantity ?? 1) > 1]).toEqual([slug, true]);
        expect([slug, component.publicVisible ?? false]).toEqual([slug, true]);
      }
    });
  });

  it('tienda, POS y combo prometen productos ilimitados entre sus primeras 3 características', () => {
    for (const slug of ['tienda-virtual', 'punto-de-venta', 'solucion-combinada']) {
      const top = packages.get(slug)!.features.slice(0, 3).map((f) => f.text.toLowerCase());
      expect([slug, top.some((text) => text.includes('productos ilimitados'))]).toEqual([slug, true]);
    }
  });

  it('no queda ningún tope de productos (salvo los 6 destacados)', () => {
    const texts = [
      ...seedPackages.flatMap((p) => [...p.features.map((f) => f.text), ...(p.notes ?? [])]),
      ...seedComponents.flatMap((c) => [c.name, c.description ?? '', c.includedLabel ?? '', ...(c.highlights ?? [])]),
    ];
    const limits = texts.filter((text) => /(hasta|máximo|límite de) [\d,]+ productos/i.test(text) && !/destacados/i.test(text));
    expect(limits).toEqual([]);
    expect(seedComponents.filter((c) => c.unit === 'producto')).toEqual([]);
  });

  it('no muestra notas internas pendientes de validación', () => {
    expect(seedPackages.flatMap((p) => p.notes ?? []).filter((note) => /pendiente de validación/i.test(note))).toEqual([]);
  });
});
