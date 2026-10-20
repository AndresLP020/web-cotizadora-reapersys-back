import { addDays, addMonths, daysBetween, daysUntil, dueStateOf, lastMonths, localHour, localToday, parseDay, toDay } from './billing-dates';

describe('billing-dates', () => {
  it('guarda los días a las 12:00 UTC y rechaza fechas inexistentes', () => {
    expect(parseDay('2026-10-20').toISOString()).toBe('2026-10-20T12:00:00.000Z');
    expect(toDay(parseDay('2026-01-05'))).toBe('2026-01-05');
    expect(() => parseDay('2026-02-30')).toThrow(RangeError);
    expect(() => parseDay('20-10-2026')).toThrow(RangeError);
  });

  it('suma meses ajustando al fin de mes y conservando el día de cobro', () => {
    const jan31 = parseDay('2026-01-31');
    expect(toDay(addMonths(jan31, 1))).toBe('2026-02-28');
    expect(toDay(addMonths(parseDay('2028-01-31'), 1))).toBe('2028-02-29');
    expect(toDay(addMonths(parseDay('2026-02-28'), 1, 31))).toBe('2026-03-31');
    expect(toDay(addMonths(parseDay('2026-11-15'), 2))).toBe('2027-01-15');
    expect(toDay(addMonths(parseDay('2026-12-15'), 12))).toBe('2027-12-15');
    expect(toDay(addMonths(parseDay('2026-03-31'), -1))).toBe('2026-02-28');
  });

  it('calcula "hoy" y la hora en la Ciudad de México', () => {
    // 03:00 UTC del 21 = 21:00 del 20 en CDMX (UTC-6).
    const now = new Date('2026-10-21T03:00:00Z');
    expect(localToday(now)).toBe('2026-10-20');
    expect(localHour(now)).toBe(21);
  });

  it('cuenta días y deriva el estado del vencimiento', () => {
    expect(daysBetween('2026-10-20', '2026-10-25')).toBe(5);
    expect(daysBetween('2026-10-20', '2026-10-18')).toBe(-2);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    const now = new Date('2026-10-20T18:00:00Z');
    expect(daysUntil(parseDay('2026-10-20'), now)).toBe(0);
    expect(daysUntil(null, now)).toBeNull();
    expect(dueStateOf(null)).toBe('none');
    expect(dueStateOf(-1)).toBe('overdue');
    expect(dueStateOf(0)).toBe('due_soon');
    expect(dueStateOf(7)).toBe('due_soon');
    expect(dueStateOf(8)).toBe('current');
  });

  it('lista los últimos meses del más antiguo al actual', () => {
    expect(lastMonths('2026-02-10', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(lastMonths('2026-02-10', 1)).toEqual(['2026-02']);
  });
});
