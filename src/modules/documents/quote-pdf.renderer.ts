import PDFDocument from 'pdfkit';
import { formatMXN } from '../../common/money/money';
import type { QuoteCalculation, QuoteLine } from '../quotes/engine/engine.types';

/**
 * Datos de entrada del PDF. Todos los importes provienen del snapshot de la versión
 * de la cotización: el documento nunca recalcula nada.
 */
export interface QuotePdfData {
  business: { tradeName: string; legalName?: string; email?: string; whatsapp?: string };
  folio: string;
  version: number;
  createdAt: Date;
  validUntil: Date | null;
  client: { name: string; company?: string; email: string; phone?: string };
  calculation: QuoteCalculation;
  terms: string[];
}

// Colores de marca (src/styles/tokens.css). El PDF no puede leer variables CSS: se replican aquí
// con nombres de token. Fondo claro para impresión.
const COLOR = {
  midnight: '#0b132b',
  royal: '#3b82f6',
  indigo: '#6d5ef3',
  text: '#0b132b',
  muted: '#64748b',
  border: '#cbd5e1',
  soft: '#f1f5f9',
  warning: '#b45309',
};

const PAGE = { margin: 50, width: 612 - 100 };
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' });
const money = (cents: number | null) => (cents === null ? 'Por valorar' : formatMXN(cents));

const billingLabel: Record<string, string> = {
  monthly: 'mensual',
  annual: 'anual',
  third_party_variable: 'según proveedor',
  one_time: 'pago único',
};

function lineDetail(line: QuoteLine): string | undefined {
  if (line.kind === 'addon' && line.includedQuantity) return `${line.includedQuantity} incluidas, ${line.quantity} adicionales`;
  if (line.kind === 'addon' && line.quantity > 1 && line.unitCents !== null) return `${line.quantity} × ${formatMXN(line.unitCents)}`;
  if (line.priceMode === 'starting_at') return 'Precio mínimo sujeto a evaluación';
  if (line.kind === 'removal_credit' && line.amountCents === null) return 'Crédito pendiente de aprobación';
  if (line.kind === 'subscription_setup' && line.amountCents === null) return 'Pendiente de cotizar';
  return undefined;
}

export function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: PAGE.margin, bottom: PAGE.margin + 20, left: PAGE.margin, right: PAGE.margin },
      bufferPages: true,
      info: {
        Title: `Cotización ${data.folio}`,
        Author: data.business.tradeName,
        Subject: data.calculation.package?.name ?? 'Solución personalizada',
        // Fecha fija del documento: el mismo snapshot produce el mismo contenido.
        CreationDate: data.createdAt,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const calc = data.calculation;
    const final = calc.status === 'priced' && data.validUntil !== null;
    // Las versiones anteriores a la suscripción no guardan estos campos.
    const subscription = calc.paymentMode === 'subscription' ? calc.subscription : null;
    const left = PAGE.margin;
    const right = PAGE.margin + PAGE.width;

    const ensureSpace = (height: number) => {
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };
    const sectionTitle = (title: string) => {
      ensureSpace(40);
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).fillColor(COLOR.midnight).text(title.toUpperCase(), left, doc.y, { characterSpacing: 0.6 });
      doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).lineWidth(0.5).strokeColor(COLOR.border).stroke();
      doc.moveDown(0.6);
    };
    const row = (label: string, amount: string, opts: { detail?: string; bold?: boolean; color?: string } = {}) => {
      ensureSpace(opts.detail ? 30 : 18);
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(opts.color ?? COLOR.text);
      doc.text(label, left, y, { width: PAGE.width - 140 });
      const afterLabel = doc.y;
      doc.text(amount, right - 130, y, { width: 130, align: 'right' });
      doc.y = Math.max(afterLabel, doc.y);
      if (opts.detail) doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.muted).text(opts.detail, left, doc.y, { width: PAGE.width - 140 });
      doc.moveDown(0.35);
    };

    // ------------------------------------------------------------ encabezado
    doc.rect(0, 0, doc.page.width, 92).fill(COLOR.midnight);
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#ffffff').text('Reaper', left, 32, { continued: true }).fillColor('#60a5fa').text('Sys');
    doc.font('Helvetica').fontSize(9).fillColor('#cbd5e1').text('Tecnología a la medida de tu negocio', left, 60);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff').text(final ? 'COTIZACIÓN' : 'SOLICITUD DE COTIZACIÓN', left, 32, { width: PAGE.width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#cbd5e1').text(`Folio ${data.folio}${data.version > 1 ? ` · v${data.version}` : ''}`, left, 52, { width: PAGE.width, align: 'right' });
    doc.y = 112;

    if (!final) {
      const y = doc.y;
      doc.roundedRect(left, y, PAGE.width, 46, 6).fill('#fef3c7');
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.warning).text('Documento preliminar: no constituye una cotización final.', left + 12, y + 10, { width: PAGE.width - 24 });
      doc.font('Helvetica').fontSize(9).text('Algunos importes o condiciones requieren revisión. Un asesor confirmará la propuesta definitiva.', left + 12, y + 25, { width: PAGE.width - 24 });
      doc.y = y + 58;
    }

    // ------------------------------------------------------------ datos generales
    const infoTop = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted).text('CLIENTE', left, infoTop);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text(data.client.name, left, doc.y + 2, { width: 260 });
    doc.font('Helvetica').fontSize(10).fillColor(COLOR.text);
    if (data.client.company) doc.text(data.client.company, { width: 260 });
    doc.fillColor(COLOR.muted).text(data.client.email, { width: 260 });
    if (data.client.phone) doc.text(data.client.phone, { width: 260 });
    const leftBottom = doc.y;

    const meta: [string, string][] = [
      ['Fecha', dateFmt.format(data.createdAt)],
      ['Vigencia', data.validUntil ? `Hasta el ${dateFmt.format(data.validUntil)}` : 'Por definir'],
      ['Solución', calc.package?.name ?? 'Solución personalizada'],
      ['Modalidad', subscription ? `Suscripción · ${subscription.planLabel ?? 'Mensual'}` : 'Compra'],
      ['Moneda', 'Pesos mexicanos (MXN)'],
    ];
    let metaY = infoTop;
    for (const [label, value] of meta) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted).text(label.toUpperCase(), 330, metaY, { width: 80 });
      doc.font('Helvetica').fontSize(10).fillColor(COLOR.text).text(value, 410, metaY, { width: right - 410 });
      metaY = doc.y + 4;
    }
    doc.y = Math.max(leftBottom, metaY) + 4;

    // ------------------------------------------------------------ conceptos
    sectionTitle(subscription ? 'Pago inicial (de contado)' : 'Implementación (pago único)');
    for (const line of calc.lines) row(line.description, money(line.amountCents), { detail: lineDetail(line) });
    if (calc.lines.length === 0) row('Sin pago inicial', formatMXN(0), { detail: 'El paquete se cubre con la mensualidad' });

    const included = calc.includedItems.filter((i) => !i.removed);
    if (included.length > 0) {
      sectionTitle('Componentes incluidos');
      doc.font('Helvetica').fontSize(9).fillColor(COLOR.text);
      const colWidth = PAGE.width / 2 - 10;
      const startY = doc.y;
      const half = Math.ceil(included.length / 2);
      included.forEach((item, i) => {
        const col = i < half ? 0 : 1;
        const y = startY + (i % half) * 14;
        doc.text(`•  ${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ''}`, left + col * (colWidth + 20), y, { width: colWidth, lineBreak: false, ellipsis: true });
      });
      doc.y = startY + half * 14;
      const removed = calc.includedItems.filter((i) => i.removed);
      if (removed.length > 0) {
        doc.moveDown(0.4).fillColor(COLOR.muted).text(`Retirados: ${removed.map((r) => r.name).join(', ')}`, left, doc.y, { width: PAGE.width });
      }
    }

    // ------------------------------------------------------------ totales
    ensureSpace(150);
    doc.moveDown(0.8);
    const totalsX = right - 250;
    const totalsRow = (label: string, value: string, bold = false, size = 10) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(COLOR.text).text(label, totalsX, y, { width: 130 });
      doc.text(value, totalsX + 130, y, { width: 120, align: 'right' });
      doc.moveDown(0.3);
    };
    totalsRow('Subtotal', formatMXN(calc.totals.subtotalCents));
    if (calc.totals.discountCents > 0) totalsRow('Descuentos', `-${formatMXN(calc.totals.discountCents)}`);
    doc.moveTo(totalsX, doc.y).lineTo(right, doc.y).lineWidth(0.8).strokeColor(COLOR.royal).stroke();
    doc.moveDown(0.4);
    totalsRow(calc.totals.hasPendingAmounts ? 'Total parcial' : 'Total', formatMXN(calc.totals.totalCents), true, 13);
    totalsRow(`Anticipo (${calc.depositRateBp / 100} %)`, formatMXN(calc.totals.depositCents));
    totalsRow('Liquidación', formatMXN(calc.totals.balanceCents));
    if (calc.comboSavingsCents !== null && calc.comboSavingsCents > 0) {
      doc.moveDown(0.3).font('Helvetica').fontSize(8.5).fillColor(COLOR.muted)
        .text(`Ahorro del paquete combinado frente a sus paquetes por separado: ${formatMXN(calc.comboSavingsCents)} (ya reflejado en el precio).`, left, doc.y, { width: PAGE.width, align: 'right' });
    }

    // ------------------------------------------------------------ suscripción
    if (subscription) {
      sectionTitle('Suscripción mensual');
      const pending = subscription.monthlyCents === null;
      const fromNote = subscription.priceMode === 'starting_at' ? 'Mensualidad mínima sujeta a confirmar costos de operación' : undefined;
      const support = subscription.supportIncludedCents;
      row('Plan', subscription.planLabel ?? 'Mensual');
      row('Mensualidad', money(subscription.monthlyCents), {
        detail: support != null ? `Incluye soporte al usuario de ${formatMXN(support)} durante todo el mes` : fromNote,
      });
      const months = subscription.billingMonths ?? 1;
      const cadence = months > 1 ? `Cada ${months} meses` : 'Cada mes';
      row('Cobro', cadence);
      if (subscription.plan !== 'monthly') row('Plazo', subscription.termMonths === 0 ? 'Sin plazo forzoso' : `${subscription.termMonths} meses`);
      const annual = subscription.annualCharge;
      const hosting = subscription.hostingCharge;
      if (annual) {
        row(`${annual.name} · cada año`, formatMXN(annual.cents), {
          detail: 'Aparte de la mensualidad. Se cobra en el primer pago y se renueva cada año.',
        });
      } else if (hosting) {
        row(hosting.upfront ? 'Hosting · primer pago' : `Hosting · ${cadence.toLowerCase()}`, hosting.chargeCents === null ? 'Por confirmar' : formatMXN(hosting.chargeCents), {
          detail: hosting.upfront ? 'Se cobra una vez, en el primer pago. No se repite en los siguientes.' : 'Incluido en cada cobro de la suscripción',
        });
      }
      row('Siguientes pagos', subscription.subsequentPaymentCents == null ? 'Por confirmar' : formatMXN(subscription.subsequentPaymentCents), {
        detail: `${cadence}, a partir del segundo cobro`,
      });
      row('Primer pago', subscription.firstPaymentCents == null ? 'Por confirmar' : formatMXN(subscription.firstPaymentCents), {
        bold: true,
        detail: annual
          ? 'Suma los cargos de contado, el dominio y hosting del año y el primer periodo'
          : hosting?.upfront
            ? 'Suma los cargos de contado, el hosting y el primer periodo'
            : 'Suma los cargos de contado y el primer periodo; puede ser distinto de los siguientes',
      });
      if (subscription.plan !== 'monthly' && !pending && subscription.termMonths > 0 && subscription.commitmentCents !== null) {
        row(`Presupuesto de ${subscription.termMonths} meses`, formatMXN(subscription.commitmentCents));
      }
      ensureSpace(40);
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted).text(
        subscription.softwareOnly ? 'ESPECIFICACIONES DE LA RENTA' : 'LA MENSUALIDAD INCLUYE',
        left,
        doc.y,
        { width: PAGE.width },
      );
      doc.font('Helvetica').fontSize(9).fillColor(COLOR.text);
      for (const item of subscription.includes) {
        ensureSpace(14);
        doc.text(`•  ${item}`, left, doc.y, { width: PAGE.width });
      }
      doc.moveDown(0.3).fillColor(COLOR.muted).text(
        subscription.softwareOnly
          ? 'La renta cubre solo el software y no incluye equipo. ReaperSys conserva la propiedad del sistema; el servicio se mantiene mientras la suscripción esté activa.'
          : `ReaperSys conserva la propiedad del sistema; el servicio se mantiene mientras la suscripción esté activa.${subscription.hardwareUpfront ? ' El equipo físico se paga de contado y pasa a ser del cliente.' : ''}`,
        left,
        doc.y,
        { width: PAGE.width },
      );
    }

    // ------------------------------------------------------------ recurrentes
    const providedByClient = calc.providedByClient ?? [];
    if (calc.recurring.length > 0 || providedByClient.length > 0) {
      sectionTitle(subscription ? 'Servicios recurrentes adicionales' : 'Servicios recurrentes (no incluidos en el total)');
      for (const r of calc.recurring) {
        row(r.description, r.amountCents === null ? 'Según proveedor' : `${formatMXN(r.amountCents)} ${billingLabel[r.billing] ?? ''}`, {
          detail: r.priceMode === 'starting_at' ? 'Precio mínimo sujeto a evaluación' : undefined,
        });
      }
      for (const item of providedByClient) {
        row(item.name, 'No se cobra', { detail: 'El cliente ya cuenta con uno' });
      }
    }

    // ------------------------------------------------------------ revisión pendiente
    if (calc.reviewReasons.length > 0) {
      sectionTitle('Puntos pendientes de revisión');
      doc.font('Helvetica').fontSize(9).fillColor(COLOR.text);
      for (const reason of calc.reviewReasons) {
        ensureSpace(14);
        doc.text(`•  ${reason.message}`, left, doc.y, { width: PAGE.width });
      }
    }

    // ------------------------------------------------------------ condiciones
    if (data.terms.length > 0) {
      sectionTitle('Condiciones comerciales');
      doc.font('Helvetica').fontSize(9).fillColor(COLOR.text);
      for (const term of data.terms) {
        ensureSpace(14);
        doc.text(`•  ${term}`, left, doc.y, { width: PAGE.width });
        doc.moveDown(0.2);
      }
    }

    // ------------------------------------------------------------ pie de página
    const contact = [data.business.legalName, data.business.email, data.business.whatsapp ? `WhatsApp ${data.business.whatsapp}` : undefined]
      .filter(Boolean)
      .join('  ·  ');
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Sin margen inferior temporalmente: escribir dentro del margen haría que pdfkit agregue páginas.
      doc.page.margins.bottom = 0;
      const y = doc.page.height - PAGE.margin;
      doc.moveTo(left, y - 6).lineTo(right, y - 6).lineWidth(0.5).strokeColor(COLOR.border).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted);
      doc.text(`${data.business.tradeName}${contact ? `  ·  ${contact}` : ''}`, left, y, { width: PAGE.width - 80, lineBreak: false, ellipsis: true });
      doc.text(`Página ${i + 1} de ${range.count}`, right - 80, y, { width: 80, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}
