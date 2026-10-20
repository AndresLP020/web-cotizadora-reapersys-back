import { writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { calculateQuote } from '../quotes/engine/quote-engine';
import { seedSnapshot } from '../quotes/engine/seed-snapshot.fixture';
import { renderQuotePdf, type QuotePdfData } from './quote-pdf.renderer';

const base = (overrides: Partial<QuotePdfData> = {}): QuotePdfData => ({
  business: { tradeName: 'ReaperSys', email: 'ventas@example.com' },
  folio: 'RS-2026-00042',
  version: 1,
  createdAt: new Date('2026-10-16T18:00:00Z'),
  validUntil: new Date('2026-10-31T18:00:00Z'),
  client: { name: 'María López', company: 'Abarrotes López', email: 'maria@example.com' },
  calculation: calculateQuote(seedSnapshot(), {
    packageSlug: 'web-corporativa',
    variants: {},
    removedComponents: [],
    components: [
      { slug: 'seo-initial', quantity: 1 },
      { slug: 'web-internal-page', quantity: 6 },
    ],
    recurring: ['maintenance-web-business'],
  }),
  terms: ['Anticipo del 50 % y liquidación del 50 % restante.'],
  ...overrides,
});

/** Texto visible del PDF: descomprime los streams y decodifica las cadenas hexadecimales de pdfkit. */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => {
    try {
      return inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      return '';
    }
  });
  return streams
    .flatMap((content) => [...content.matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1]!, 'hex').toString('latin1')))
    .join('');
}

describe('PDF de cotización', () => {
  it('genera un PDF válido con folio, cliente y totales del snapshot', async () => {
    const data = base();
    const pdf = await renderQuotePdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(pdf);
    expect(text).toContain('RS-2026-00042');
    expect(text).toContain('María López');
    // El total impreso es exactamente el calculado por el motor.
    const total = data.calculation.totals.totalCents;
    expect(text).toContain(`$${new Intl.NumberFormat('es-MX').format(Math.trunc(total / 100))}.${String(total % 100).padStart(2, '0')}`);
    expect(text).toContain('NO INCLUIDOS EN EL TOTAL');
    if (process.env.PDF_SAMPLE_OUT) writeFileSync(process.env.PDF_SAMPLE_OUT, pdf);
  });

  it('marca como preliminar una solicitud sin vigencia o pendiente de revisión', async () => {
    const text = pdfText(await renderQuotePdf(base({ validUntil: null })));
    expect(text).toContain('SOLICITUD DE COTIZACI');
    expect(text).toContain('Documento preliminar');
  });

  it('en la renta de la tienda imprime la mensualidad aprobada y los planes', async () => {
    const rent = (subscriptionPlan?: 'annual' | 'semiannual') =>
      calculateQuote(seedSnapshot(), { paymentMode: 'subscription', subscriptionPlan, packageSlug: 'tienda-virtual', variants: {}, removedComponents: [], components: [], recurring: [] });
    const text = pdfText(await renderQuotePdf(base({ calculation: rent() })));
    expect(text).toContain('Suscripción · Mensual');
    expect(text).toContain('Sin pago inicial');
    expect(text).toContain('Primer pago');
    expect(text).toContain('$1,000.00');
    expect(text).not.toContain('IVA');
    expect(text).toContain('Dominio y hosting · cada año$500.00');
    expect(text).toContain('Primer pago$1,500.00');
    expect(text).toContain('conserva la propiedad');

    const annualText = pdfText(await renderQuotePdf(base({ calculation: rent('annual') })));
    expect(annualText).toContain('Cada 12 meses');
    expect(annualText).toContain('Presupuesto de 12 meses');
    // 1,000 − 10 % = 900 al mes × 12.
    expect(annualText).toContain('$10,800.00');

    const semiannualText = pdfText(await renderQuotePdf(base({ calculation: rent('semiannual') })));
    expect(semiannualText).toContain('Cada 6 meses');
    // 1,000 − 5 % = 950 al mes × 6.
    expect(semiannualText).toContain('$5,700.00');
  });

  it('es determinista para el mismo snapshot', async () => {
    const data = base();
    const [a, b] = await Promise.all([renderQuotePdf(data), renderQuotePdf(data)]);
    // pdfkit agrega un identificador de documento aleatorio: se compara sin él.
    const strip = (buf: Buffer) => buf.toString('latin1').replace(/\/ID \[[^\]]*\]/, '');
    expect(strip(a)).toBe(strip(b));
  });
});
