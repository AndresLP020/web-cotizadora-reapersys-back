/**
 * Fechas de cobranza. Un vencimiento es un DÍA calendario: se guarda a las 12:00 UTC de ese día
 * (así cualquier zona horaria de México lo lee como la misma fecha) y "hoy" se calcula en
 * America/Mexico_City. Funciones puras, sin acceso a la base.
 */

export const BILLING_TIME_ZONE = 'America/Mexico_City';
/** Ventana de "vence pronto" en días. */
export const DUE_SOON_DAYS = 7;

export type DueState = 'overdue' | 'due_soon' | 'current' | 'none';

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const localDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: BILLING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const localHourFmt = new Intl.DateTimeFormat('en-US', { timeZone: BILLING_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' });

/** "YYYY-MM-DD" → Date a las 12:00 UTC. Lanza si la fecha no existe (p. ej. 2026-02-30). */
export function parseDay(day: string): Date {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new RangeError(`Fecha inválida: "${day}"`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new RangeError(`Fecha inválida: "${day}"`);
  }
  return date;
}

export function isValidDay(day: string): boolean {
  try {
    parseDay(day);
    return true;
  } catch {
    return false;
  }
}

/** Date guardada como día (12:00 UTC) → "YYYY-MM-DD". */
export function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Día calendario actual en la Ciudad de México. */
export function localToday(now: Date = new Date()): string {
  return localDateFmt.format(now);
}

/** Hora local (0–23) en la Ciudad de México. */
export function localHour(now: Date = new Date()): number {
  return Number(localHourFmt.format(now));
}

/** Días de `from` a `to` (ambos "YYYY-MM-DD"); negativo si `to` es anterior. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

export function addDays(day: string, days: number): string {
  return toDay(new Date(parseDay(day).getTime() + days * DAY_MS));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Suma meses conservando el día de cobro: si el mes destino es más corto se usa su último día
 * (31 ene + 1 → 28/29 feb; con anchorDay 31, 28 feb + 1 → 31 mar).
 */
export function addMonths(date: Date, months: number, anchorDay = date.getUTCDate()): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  const day = Math.min(anchorDay, daysInMonth(year, monthIndex));
  return new Date(Date.UTC(year, monthIndex, day, 12));
}

/** Días hasta el vencimiento contados desde hoy en México (negativo = atraso). */
export function daysUntil(dueDate: Date | null | undefined, now: Date = new Date()): number | null {
  return dueDate ? daysBetween(localToday(now), toDay(dueDate)) : null;
}

export function dueStateOf(days: number | null): DueState {
  if (days === null) return 'none';
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'due_soon';
  return 'current';
}

/** "YYYY-MM" de un día guardado. */
export function monthOf(date: Date): string {
  return toDay(date).slice(0, 7);
}

/** Los últimos `count` meses terminando en el mes de `today`, del más antiguo al actual. */
export function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const total = y * 12 + (m - 1) - i;
    const year = Math.floor(total / 12);
    months.push(`${year}-${String(total - year * 12 + 1).padStart(2, '0')}`);
  }
  return months;
}
