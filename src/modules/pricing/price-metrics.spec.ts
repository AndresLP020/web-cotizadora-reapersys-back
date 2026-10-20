import { marginBp, markupBp, priceMetrics } from './price-metrics';

describe('price metrics', () => {
  it('diferencia recargo sobre costo y margen bruto', () => {
    // costo $100, precio $150
    expect(markupBp(15_000, 10_000)).toBe(5_000); // 50 %
    expect(marginBp(15_000, 10_000)).toBe(3_333); // 33.33 %
  });

  it('redondea al punto base más cercano', () => {
    // (200 − 130) / 130 = 53.846 % → 5385 bp
    expect(markupBp(20_000, 13_000)).toBe(5_385);
    // (200 − 130) / 200 = 35 %
    expect(marginBp(20_000, 13_000)).toBe(3_500);
  });

  it('maneja ventas por debajo del costo (valores negativos)', () => {
    expect(markupBp(9_000, 10_000)).toBe(-1_000);
    expect(marginBp(9_000, 10_000)).toBe(-1_111);
  });

  it('devuelve null cuando el indicador no está definido', () => {
    expect(markupBp(10_000, null)).toBeNull();
    expect(markupBp(10_000, 0)).toBeNull();
    expect(marginBp(0, 500)).toBeNull();
    expect(marginBp(null, 500)).toBeNull();
  });

  it('calcula la utilidad bruta en centavos', () => {
    expect(priceMetrics(1_100_000, 800_000)).toEqual({ markupBp: 3_750, marginBp: 2_727, grossProfitCents: 300_000 });
  });
});
