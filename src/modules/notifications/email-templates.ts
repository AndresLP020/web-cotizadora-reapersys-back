import { formatMXN } from '../../common/money/money';

/**
 * Plantillas de correo. Los clientes de correo no admiten variables CSS: los colores de marca
 * (src/styles/tokens.css) se escriben en línea. Todo valor dinámico pasa por escapeHtml.
 */
const BRAND = { midnight: '#0b132b', royal: '#3b82f6', text: '#0f172a', muted: '#64748b', soft: '#f1f5f9', warning: '#b45309' };

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' });

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const QUOTE_FOOTER = (tradeName: string) => `Recibes este correo porque solicitaste una cotización a ${tradeName}.`;

function layout(tradeName: string, title: string, bodyHtml: string, footer = QUOTE_FOOTER(tradeName)): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.soft};font-family:Arial,Helvetica,sans-serif;color:${BRAND.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.soft};padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${BRAND.midnight};padding:24px 32px;color:#ffffff;font-size:22px;font-weight:bold">${escapeHtml(tradeName)}</td></tr>
<tr><td style="padding:32px;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px;background:${BRAND.soft};color:${BRAND.muted};font-size:12px">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND.royal};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${escapeHtml(label)}</a></p>`;
}

export interface QuoteEmailData {
  tradeName: string;
  clientName: string;
  folio: string;
  solution: string;
  totalCents: number;
  hasPendingAmounts: boolean;
  validUntil: Date | null;
  link: string | null;
  /** Solo en suscripción: totalCents es el cargo de contado. El primer pago puede incluir ese cargo más el primer periodo. */
  subscription?: {
    monthlyCents: number | null;
    termMonths: number;
    planLabel?: string;
    billingMonths?: number;
    budgetCents?: number | null;
    hostingChargeCents?: number | null;
    hostingUpfront?: boolean;
    firstPaymentCents?: number | null;
    subsequentPaymentCents?: number | null;
  } | null;
}

function everyMonths(months: number): string {
  return months > 1 ? `cada ${months} meses` : 'cada mes';
}

/** Plan, hosting y diferencia entre el primer pago y los siguientes. */
export function monthlyLabel(s: NonNullable<QuoteEmailData['subscription']>): string {
  const months = s.billingMonths ?? 1;
  const cadence = everyMonths(months);
  const plan = s.planLabel ?? 'Mensual';
  const subsequent = s.subsequentPaymentCents == null ? 'por confirmar' : `${formatMXN(s.subsequentPaymentCents)} MXN ${cadence}`;
  const first = s.firstPaymentCents == null ? 'por confirmar' : `${formatMXN(s.firstPaymentCents)} MXN`;
  const hosting = s.hostingChargeCents == null ? '' : s.hostingUpfront ? ` Hosting en el primer pago: ${formatMXN(s.hostingChargeCents)} MXN.` : ` Hosting: ${formatMXN(s.hostingChargeCents)} MXN ${cadence}.`;
  const term = s.billingMonths === 1 ? '' : s.termMonths === 0 ? '' : ` (plazo de ${s.termMonths} meses)`;
  return `${plan}${term}.${hosting} Siguientes pagos: ${subsequent}. Primer pago: ${first}.`;
}

export function quoteIssuedEmail(d: QuoteEmailData): RenderedEmail {
  const total = `${formatMXN(d.totalCents)} MXN`;
  const totalLabel = d.subscription ? 'Pago inicial' : 'Total';
  const monthly = d.subscription ? monthlyLabel(d.subscription) : null;
  const validity = d.validUntil ? dateFmt.format(d.validUntil) : null;
  const body = `<p>Hola ${escapeHtml(d.clientName)},</p>
<p>Te compartimos tu cotización <strong>${escapeHtml(d.folio)}</strong> para <strong>${escapeHtml(d.solution)}</strong>${d.subscription ? ' en suscripción mensual' : ''}. Encontrarás el documento PDF adjunto con el desglose completo.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border:1px solid #e2e8f0;border-radius:8px">
<tr><td style="padding:12px 16px;color:${BRAND.muted}">${totalLabel}</td><td style="padding:12px 16px;text-align:right;font-weight:bold">${escapeHtml(total)}</td></tr>
${monthly ? `<tr><td style="padding:12px 16px;color:${BRAND.muted};border-top:1px solid #e2e8f0">Suscripción</td><td style="padding:12px 16px;text-align:right;font-weight:bold;border-top:1px solid #e2e8f0">${escapeHtml(monthly)}</td></tr>` : ''}
${validity ? `<tr><td style="padding:12px 16px;color:${BRAND.muted};border-top:1px solid #e2e8f0">Vigencia</td><td style="padding:12px 16px;text-align:right;border-top:1px solid #e2e8f0">Hasta el ${escapeHtml(validity)}</td></tr>` : ''}
</table>
${d.link ? button(d.link, 'Ver cotización en línea') : ''}
<p>Si tienes dudas o quieres ajustar algo, responde a este correo.</p>`;
  return {
    subject: `Tu cotización ${d.folio} — ${d.tradeName}`,
    html: layout(d.tradeName, `Cotización ${d.folio}`, body),
    text: [
      `Hola ${d.clientName},`,
      `Te compartimos tu cotización ${d.folio} para ${d.solution} (PDF adjunto).`,
      `${totalLabel}: ${total}`,
      monthly ? `Suscripción: ${monthly}` : '',
      validity ? `Vigencia: hasta el ${validity}` : '',
      d.link ? `Consúltala en línea: ${d.link}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function quoteReceivedEmail(d: QuoteEmailData): RenderedEmail {
  const body = `<p>Hola ${escapeHtml(d.clientName)},</p>
<p>Recibimos tu solicitud de cotización <strong>${escapeHtml(d.folio)}</strong> para <strong>${escapeHtml(d.solution)}</strong>.</p>
<p style="background:#fef3c7;color:${BRAND.warning};padding:12px 16px;border-radius:8px">Algunos importes o condiciones requieren revisión. Un asesor confirmará la propuesta definitiva; los importes que veas ahora son preliminares.</p>
${d.link ? button(d.link, 'Consultar mi solicitud') : ''}
<p>Te contactaremos pronto.</p>`;
  return {
    subject: `Recibimos tu solicitud ${d.folio} — ${d.tradeName}`,
    html: layout(d.tradeName, `Solicitud ${d.folio}`, body),
    text: [
      `Hola ${d.clientName},`,
      `Recibimos tu solicitud de cotización ${d.folio} para ${d.solution}.`,
      'Algunos importes requieren revisión; un asesor confirmará la propuesta definitiva.',
      d.link ? `Consúltala: ${d.link}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function adminNewQuoteEmail(d: {
  tradeName: string;
  folio: string;
  status: string;
  clientName: string;
  clientEmail: string;
  solution: string;
  totalCents: number;
  hasPendingAmounts: boolean;
  adminLink: string;
  subscription?: QuoteEmailData['subscription'];
}): RenderedEmail {
  const total = `${formatMXN(d.totalCents)}${d.hasPendingAmounts ? ' (parcial)' : ''}`;
  const rows: [string, string][] = [
    ['Cliente', `${d.clientName} <${d.clientEmail}>`],
    ['Solución', d.solution],
    ...(d.subscription
      ? ([
          ['Modalidad', 'Suscripción mensual'],
          ['Pago inicial', total],
          ['Mensualidad', monthlyLabel(d.subscription)],
        ] as [string, string][])
      : ([['Total', total]] as [string, string][])),
    ['Estado', d.status === 'issued' ? 'Emitida' : 'En revisión'],
  ];
  const body = `<p>Se registró la cotización <strong>${escapeHtml(d.folio)}</strong>.</p>
<table role="presentation" cellpadding="6" style="font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:${BRAND.muted}">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
${button(d.adminLink, 'Abrir en el panel')}`;
  return {
    subject: `Nueva cotización ${d.folio} (${d.status === 'issued' ? 'emitida' : 'en revisión'})`,
    html: layout(d.tradeName, `Nueva cotización ${d.folio}`, body),
    text: [`Nueva cotización ${d.folio}`, ...rows.map(([k, v]) => `${k}: ${v}`), d.adminLink].join('\n'),
  };
}

export function adminNewLeadEmail(d: { tradeName: string; reference: string; name: string; email: string; phone?: string; company?: string; message: string; adminLink: string }): RenderedEmail {
  const rows: [string, string][] = [
    ['Nombre', d.name],
    ['Empresa', d.company ?? '—'],
    ['Correo', d.email],
    ['Teléfono', d.phone ?? '—'],
  ];
  const body = `<p>Nuevo mensaje del formulario de contacto (<strong>${escapeHtml(d.reference)}</strong>).</p>
<table role="presentation" cellpadding="6" style="font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:${BRAND.muted}">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
<p style="white-space:pre-line;background:${BRAND.soft};padding:12px 16px;border-radius:8px">${escapeHtml(d.message)}</p>
${button(d.adminLink, 'Ver prospectos')}`;
  return {
    subject: `Nuevo prospecto ${d.reference}: ${d.name}`,
    html: layout(d.tradeName, `Nuevo prospecto ${d.reference}`, body),
    text: [`Nuevo prospecto ${d.reference}`, ...rows.map(([k, v]) => `${k}: ${v}`), '', d.message, '', d.adminLink].join('\n'),
  };
}

// ------------------------------------------------------------------ cobranza y testimonios

const INTERNAL_FOOTER = 'Aviso interno del panel administrativo.';

function rowsTable(rows: [string, string][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border:1px solid #e2e8f0;border-radius:8px">${rows
    .map(([k, v], i) => {
      const border = i ? ';border-top:1px solid #e2e8f0' : '';
      return `<tr><td style="padding:12px 16px;color:${BRAND.muted}${border}">${escapeHtml(k)}</td><td style="padding:12px 16px;text-align:right;font-weight:bold${border}">${escapeHtml(v)}</td></tr>`;
    })
    .join('')}</table>`;
}

function plural(days: number): string {
  return `${days} ${days === 1 ? 'día' : 'días'}`;
}

/** "3 días de atraso", "hoy", "en 5 días". */
function relativeDue(days: number): string {
  if (days < 0) return `${plural(-days)} de atraso`;
  if (days === 0) return 'hoy';
  return `en ${plural(days)}`;
}

export interface PaymentReminderData {
  tradeName: string;
  clientName: string;
  reference: string;
  packageName: string;
  type: 'rental' | 'purchase';
  amountCents: number | null;
  dueDate: Date;
  /** Negativo = días de atraso. */
  daysUntilDue: number;
  billingMonths: number;
  contactEmail?: string | null;
  whatsappUrl?: string | null;
}

/** Recordatorio de pago al cliente: tono cordial y formal, sin datos internos. */
export function paymentReminderEmail(d: PaymentReminderData): RenderedEmail {
  const due = dateFmt.format(d.dueDate);
  const amount = d.amountCents === null ? 'por confirmar' : `${formatMXN(d.amountCents)} MXN`;
  const concept = d.type === 'rental' ? (d.billingMonths > 1 ? `Renta de ${d.billingMonths} meses` : 'Mensualidad') : 'Saldo de la compra';
  const overdue = d.daysUntilDue < 0;
  const when = overdue ? `venció el ${due} (${relativeDue(d.daysUntilDue)})` : d.daysUntilDue === 0 ? `vence hoy, ${due}` : `vence el ${due} (${relativeDue(d.daysUntilDue)})`;
  const subject = `${overdue ? 'Pago pendiente' : 'Recordatorio de pago'}: ${d.packageName} — ${d.tradeName}`;
  const contact = [d.contactEmail ? `escríbenos a ${d.contactEmail}` : '', d.whatsappUrl ? `contáctanos por WhatsApp (${d.whatsappUrl})` : ''].filter(Boolean).join(' o ');
  const howToPay = `Para realizar tu pago o solicitar los datos bancarios, responde a este correo${contact ? ` o ${contact}` : ''}.`;
  const body = `<p>Hola ${escapeHtml(d.clientName)},</p>
<p>Te recordamos que el pago de <strong>${escapeHtml(d.packageName)}</strong> ${escapeHtml(when)}.</p>
${overdue ? `<p style="background:#fef3c7;color:${BRAND.warning};padding:12px 16px;border-radius:8px">Si ya realizaste el pago, por favor ignora este mensaje o envíanos tu comprobante para registrarlo.</p>` : ''}
${rowsTable([
  ['Concepto', concept],
  ['Importe', amount],
  ['Fecha de pago', due],
  ['Referencia', d.reference],
])}
<p>${escapeHtml(howToPay)}</p>
<p>Gracias por tu preferencia.</p>`;
  return {
    subject,
    html: layout(d.tradeName, subject, body, `Recibes este correo porque tienes un servicio contratado con ${d.tradeName}.`),
    text: [
      `Hola ${d.clientName},`,
      `Te recordamos que el pago de ${d.packageName} ${when}.`,
      `Concepto: ${concept}`,
      `Importe: ${amount}`,
      `Referencia: ${d.reference}`,
      overdue ? 'Si ya realizaste el pago, ignora este mensaje o envíanos tu comprobante.' : '',
      howToPay,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export interface DigestRow {
  reference: string;
  clientName: string;
  clientEmail: string;
  packageName: string;
  amountCents: number | null;
  dueDate: Date;
  daysUntilDue: number;
}

/** Resumen diario para el administrador: qué cobrar (vencidos) y qué viene. */
export function adminBillingDigestEmail(d: { tradeName: string; overdue: DigestRow[]; upcoming: DigestRow[]; adminLink: string }): RenderedEmail {
  const total = (rows: DigestRow[]) => formatMXN(rows.reduce((sum, r) => sum + (r.amountCents ?? 0), 0));
  const cell = 'border-top:1px solid #e2e8f0;vertical-align:top';
  const table = (rows: DigestRow[]) =>
    `<table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;font-size:13px;border-collapse:collapse">
<tr style="background:${BRAND.soft}"><th align="left">Cliente</th><th align="left">Paquete</th><th align="left">Vence</th><th align="right">Importe</th></tr>
${rows
  .map(
    (r) =>
      `<tr><td style="${cell}">${escapeHtml(r.clientName)}<br><span style="color:${BRAND.muted}">${escapeHtml(r.clientEmail)}</span></td><td style="${cell}">${escapeHtml(r.packageName)}<br><span style="color:${BRAND.muted}">${escapeHtml(r.reference)}</span></td><td style="${cell}">${escapeHtml(dateFmt.format(r.dueDate))}<br><span style="color:${r.daysUntilDue < 0 ? BRAND.warning : BRAND.muted}">${escapeHtml(relativeDue(r.daysUntilDue))}</span></td><td align="right" style="${cell};font-weight:bold">${escapeHtml(r.amountCents === null ? '—' : formatMXN(r.amountCents))}</td></tr>`,
  )
  .join('')}</table>`;
  const sections = [
    d.overdue.length ? `<h3 style="margin:24px 0 8px;color:${BRAND.warning}">Vencidos (${d.overdue.length}) · ${escapeHtml(total(d.overdue))} MXN</h3>${table(d.overdue)}` : '',
    d.upcoming.length ? `<h3 style="margin:24px 0 8px">Por vencer (${d.upcoming.length}) · ${escapeHtml(total(d.upcoming))} MXN</h3>${table(d.upcoming)}` : '',
  ].join('');
  const subject = `Cobranza del día: ${d.overdue.length} vencidos y ${d.upcoming.length} por vencer`;
  const body = `<p>Este es el resumen de cobros pendientes.</p>${sections}${button(d.adminLink, 'Abrir cobranza')}`;
  const lines = (rows: DigestRow[]) =>
    rows.map((r) => `- ${r.clientName} <${r.clientEmail}> · ${r.packageName} · ${dateFmt.format(r.dueDate)} (${relativeDue(r.daysUntilDue)}) · ${r.amountCents === null ? '—' : formatMXN(r.amountCents)}`);
  return {
    subject,
    html: layout(d.tradeName, subject, body, INTERNAL_FOOTER),
    text: [subject, d.overdue.length ? '\nVencidos:' : '', ...lines(d.overdue), d.upcoming.length ? '\nPor vencer:' : '', ...lines(d.upcoming), '', d.adminLink].filter(Boolean).join('\n'),
  };
}

export function adminNewTestimonialEmail(d: { tradeName: string; name: string; company?: string; rating: number; message: string; adminLink: string }): RenderedEmail {
  const stars = '★'.repeat(d.rating) + '☆'.repeat(5 - d.rating);
  const subject = `Nuevo comentario de ${d.name} (${d.rating}/5) pendiente de revisar`;
  const body = `<p>Un cliente dejó un comentario en el sitio. No se publica hasta que lo apruebes.</p>
${rowsTable([
  ['Nombre', d.name],
  ['Empresa', d.company ?? '—'],
  ['Calificación', stars],
])}
<p style="white-space:pre-line;background:${BRAND.soft};padding:12px 16px;border-radius:8px">${escapeHtml(d.message)}</p>
${button(d.adminLink, 'Revisar comentarios')}`;
  return {
    subject,
    html: layout(d.tradeName, subject, body, INTERNAL_FOOTER),
    text: [subject, `Empresa: ${d.company ?? '—'}`, '', d.message, '', d.adminLink].join('\n'),
  };
}
