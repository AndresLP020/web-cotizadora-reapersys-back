import { ceilToPeso, divideBy } from '../../common/money/money';
import { combineRentals, type RentalSuggestion, suggestRental } from './rental-calculator';

const hostingWeb = { name: 'Hosting web', monthlyCents: 22_170, confirmed: false };
const storage = { gb: 1, perGbMonthCents: 28, confirmed: false };
const domain = { yearCents: 39_100, confirmed: false };

describe('mensualidad sugerida de suscripción', () => {
  it('Landing Start: 3,499 ÷ 12 + hosting + 1 GB + dominio + mantenimiento básico', () => {
    const s = suggestRental({
      recoverableCents: 349_900,
      termMonths: 12,
      financingBp: 0,
      hosting: hostingWeb,
      storage,
      domain,
      services: [{ name: 'Mantenimiento web básico', mode: 'fixed', monthlyCents: 39_900 }],
    });
    // El hosting ($221.70) se lista, pero no entra en la mensualidad: se cobra en el primer pago.
    // 29,158 + 28 + 3,258 + 39,900 = 72,344 → $724.00
    expect(s.lines.map((l) => l.monthlyCents)).toEqual([29_158, 22_170, 28, 3_258, 39_900]);
    expect(s.lines.find((l) => l.key === 'hosting')?.note).toMatch(/primer pago/);
    expect(s.rawMonthlyCents).toBe(72_344);
    expect(s.suggestedMonthlyCents).toBe(72_400);
    expect(s.mode).toBe('starting_at');
    expect(s.unconfirmed).toEqual(['Almacenamiento', 'Dominio']);
  });

  it('con costos confirmados y servicios fijos el precio es definitivo', () => {
    const s = suggestRental({
      recoverableCents: 799_900,
      termMonths: 12,
      financingBp: 1_000,
      hosting: { ...hostingWeb, confirmed: true },
      storage: null,
      domain: { ...domain, confirmed: true },
      services: [],
    });
    // 7,999 × 1.10 = 8,798.90 ÷ 12 = 733.24. El hosting confirmado no se suma.
    expect(s.lines[0]).toMatchObject({ monthlyCents: 73_324, note: '12 meses · recargo 10 %' });
    expect(s.rawMonthlyCents).toBe(73_324 + 3_258);
    expect(s.suggestedMonthlyCents).toBe(76_600);
    expect(s.mode).toBe('fixed');
  });

  it('la tienda virtual se renta a la mitad del cálculo, sin tocar el hosting', () => {
    const s = suggestRental({
      recoverableCents: 2_499_900,
      termMonths: 12,
      financingBp: 0,
      hosting: { name: 'Hosting e-commerce', monthlyCents: 27_717, confirmed: false },
      storage: { gb: 20, perGbMonthCents: 28, confirmed: false },
      domain,
      services: [{ name: 'Mantenimiento e-commerce', mode: 'fixed', monthlyCents: 149_900 }],
      monthlyRateBp: 5_000,
    });
    // 208,325 + 560 + 3,258 + 149,900 = 362,043; al 50 % = 181,022 → $1,811.
    expect(s.rawMonthlyCents).toBe(181_022);
    expect(s.suggestedMonthlyCents).toBe(181_100);
    expect(s.lines.find((line) => line.key === 'rental_rate')).toMatchObject({ monthlyCents: -181_021, note: '50 % del cálculo' });
    expect(s.lines.find((line) => line.key === 'hosting')?.monthlyCents).toBe(27_717);
    expect(s.mode).toBe('starting_at');
  });

  it('sin valor recuperable o con un servicio sin precio queda pendiente (no inventa importes)', () => {
    const s = suggestRental({
      recoverableCents: null,
      termMonths: 12,
      financingBp: 0,
      hosting: null,
      storage: { gb: 5, perGbMonthCents: 28, confirmed: false },
      domain: null,
      services: [{ name: 'Soporte operativo POS', mode: 'starting_at', monthlyCents: 69_900 }],
    });
    expect(s).toMatchObject({ mode: 'pending', suggestedMonthlyCents: null, rawMonthlyCents: null });
    expect(s.missing).toEqual(['Valor a recuperar en el plazo']);
  });

  it('operaciones de dinero auxiliares', () => {
    expect(divideBy(39_100, 12)).toBe(3_258);
    expect(divideBy(100, 3)).toBe(33);
    expect(ceilToPeso(94_514)).toBe(94_600);
    expect(ceilToPeso(94_600)).toBe(94_600);
    expect(() => divideBy(100, 0)).toThrow();
  });

  describe('combos', () => {
    const fixed = (cents: number, mode: 'fixed' | 'starting_at' = 'fixed'): RentalSuggestion => ({
      lines: [],
      rawMonthlyCents: cents,
      suggestedMonthlyCents: cents,
      mode,
      missing: [],
      unconfirmed: [],
    });

    it('suma las partes con el mismo descuento que el precio de compra del combo', () => {
      const result = combineRentals(
        [{ name: 'Web Business', suggestion: { ...fixed(182_100, 'starting_at') } }, { name: 'POS Integral', suggestion: { ...fixed(120_100) } }],
        { comboCents: 1_749_900, partsCents: 1_899_900 },
      );
      // Descuento 150,000 / 1,899,900 = 7.90 %: 302,200 − 23,874 = 278,326 → $2,784.
      expect(result.lines.at(-1)).toMatchObject({ key: 'combo_discount', monthlyCents: -23_874 });
      expect(result).toMatchObject({ rawMonthlyCents: 278_326, suggestedMonthlyCents: 278_400, mode: 'starting_at' });
    });

    it('queda pendiente si alguna parte no tiene mensualidad', () => {
      const pending: RentalSuggestion = { lines: [], rawMonthlyCents: null, suggestedMonthlyCents: null, mode: 'pending', missing: ['Valor a recuperar en el plazo'], unconfirmed: [] };
      const result = combineRentals([{ name: 'Web', suggestion: { ...fixed(100_000) } }, { name: 'POS', suggestion: pending }], { comboCents: 1, partsCents: 2 });
      expect(result).toMatchObject({ mode: 'pending', suggestedMonthlyCents: null, missing: ['POS: Valor a recuperar en el plazo'] });
    });
  });
});
