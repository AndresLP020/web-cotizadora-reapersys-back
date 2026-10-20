import {
  add,
  applyRate,
  formatMXN,
  fromWholePesos,
  MoneyError,
  multiply,
  parsePesos,
  removeIncludedRate,
  splitByRate,
  subtract,
} from './money';

describe('money', () => {
  describe('parsePesos', () => {
    it('convierte cadenas decimales a centavos sin coma flotante', () => {
      expect(parsePesos('3499')).toBe(349_900);
      expect(parsePesos('3,499.50')).toBe(349_950);
      expect(parsePesos('0.1')).toBe(10);
      expect(parsePesos('-12.05')).toBe(-1_205);
    });

    it('rechaza más de dos decimales y formatos inválidos', () => {
      expect(() => parsePesos('1.005')).toThrow(MoneyError);
      expect(() => parsePesos('abc')).toThrow(MoneyError);
      expect(() => parsePesos('')).toThrow(MoneyError);
    });
  });

  it('evita el error clásico de 0.1 + 0.2', () => {
    expect(add(parsePesos('0.10'), parsePesos('0.20'))).toBe(30);
  });

  it('suma, resta y multiplica enteros de centavos', () => {
    expect(add(fromWholePesos(7_999), fromWholePesos(11_000))).toBe(1_899_900);
    expect(subtract(fromWholePesos(18_999), fromWholePesos(17_499))).toBe(150_000);
    expect(multiply(6_000, 30)).toBe(180_000); // 30 productos adicionales de $60
  });

  it('rechaza importes no enteros', () => {
    expect(() => add(10.5)).toThrow(MoneyError);
    expect(() => multiply(100, 1.5)).toThrow(MoneyError);
  });

  describe('applyRate', () => {
    it('calcula IVA 16 % redondeando al centavo', () => {
      expect(applyRate(349_900, 1_600)).toBe(55_984);
      expect(applyRate(1, 1_600)).toBe(0); // 0.16 centavos
      expect(applyRate(4, 1_250)).toBe(1); // 0.5 centavos → redondea hacia arriba
    });

    it('redondea negativos alejándose de cero (simétrico)', () => {
      expect(applyRate(-4, 1_250)).toBe(-1);
    });

    it('valida el rango de puntos base', () => {
      expect(() => applyRate(100, -1)).toThrow(MoneyError);
      expect(() => applyRate(100, 10_001)).toThrow(MoneyError);
      expect(() => applyRate(100, 12.5)).toThrow(MoneyError);
    });
  });

  it('extrae la base de un importe con IVA incluido', () => {
    expect(removeIncludedRate(11_600, 1_600)).toBe(10_000);
    expect(removeIncludedRate(100, 1_600)).toBe(86); // 86.2 → 86; IVA incluido = 14
    expect(removeIncludedRate(0, 1_600)).toBe(0);
  });

  it('divide anticipo y liquidación sin perder centavos', () => {
    const { first, second } = splitByRate(1_000_001, 5_000);
    expect(first).toBe(500_001);
    expect(second).toBe(500_000);
    expect(first + second).toBe(1_000_001);
  });

  it('formatea en MXN', () => {
    expect(formatMXN(1_749_900)).toBe('$17,499.00');
    expect(formatMXN(-5)).toBe('-$0.05');
  });
});
