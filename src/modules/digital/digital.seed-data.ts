import type { FieldKey, NfcQuantityTier } from './digital.constants';
import type { TemplateColors } from './schemas/digital-template.schema';
import type { NfcColors } from './schemas/nfc-design.schema';

/**
 * Catálogo inicial de productos digitales. Todo se crea en borrador y sin precio:
 * no se publica nada hasta que el dueño cargue la URL de su demo desde el panel.
 */

export const seedOccasions = [
  { slug: 'para-mi-pareja', label: 'Para mi pareja' },
  { slug: 'cumpleanos', label: 'Cumpleaños' },
  { slug: 'amigas-y-amigos', label: 'Amigas y amigos' },
  { slug: 'invitaciones', label: 'Invitaciones' },
  { slug: 'aniversario', label: 'Aniversario' },
];

interface SeedTemplate {
  slug: string;
  name: string;
  description: string;
  occasions: string[];
  fields: { key: FieldKey; required: boolean; max?: number }[];
  colors: TemplateColors;
}

const c = (bg: string, accent: string, ink: string, stage: string): TemplateColors => ({ bg, accent, ink, stage });

export const seedTemplates: SeedTemplate[] = [
  {
    slug: 'carta-que-se-abre',
    name: 'Carta que se abre',
    description: 'Un sobre que se abre al tocarlo y revela tu carta, con sus fotos.',
    occasions: ['para-mi-pareja', 'aniversario'],
    fields: [
      { key: 'recipientName', required: true },
      { key: 'senderName', required: true },
      { key: 'message', required: true },
      { key: 'photos', required: false, max: 3 },
    ],
    colors: c('#3B1424', '#F4A6B8', '#FFE4EA', '#FCE7EC'),
  },
  {
    slug: 'cuenta-regresiva',
    name: 'Cuenta regresiva',
    description: 'Los días, horas y minutos que faltan para la fecha especial.',
    occasions: ['cumpleanos', 'invitaciones'],
    fields: [
      { key: 'recipientName', required: true },
      { key: 'title', required: false },
      { key: 'date', required: true },
      { key: 'message', required: false },
      { key: 'place', required: false },
    ],
    colors: c('#2A1A10', '#F6C77A', '#FBE7C6', '#FDF1DC'),
  },
  {
    slug: 'galaxia-de-recuerdos',
    name: 'Galaxia de recuerdos',
    description: 'Sus fotos flotando entre estrellas, con su canción de fondo.',
    occasions: ['para-mi-pareja', 'aniversario'],
    fields: [
      { key: 'recipientName', required: true },
      { key: 'senderName', required: true },
      { key: 'message', required: true },
      { key: 'photos', required: true, max: 6 },
      { key: 'song', required: false },
    ],
    colors: c('#141E3A', '#9DB4E8', '#DCE6FF', '#E3E9F8'),
  },
  {
    slug: 'invitacion-de-fiesta',
    name: 'Invitación de fiesta',
    description: 'Fecha, lugar y confirmación de asistencia por WhatsApp.',
    occasions: ['invitaciones', 'cumpleanos'],
    fields: [
      { key: 'title', required: true },
      { key: 'date', required: true },
      { key: 'place', required: true },
      { key: 'message', required: false },
      { key: 'rsvp', required: true },
    ],
    colors: c('#0F3B3A', '#8FE3D2', '#E9FFF8', '#DDF5EF'),
  },
  {
    slug: 'album-de-mejores-amigas',
    name: 'Álbum de mejores amigas',
    description: 'Un álbum para recordar juntas sus mejores momentos.',
    occasions: ['amigas-y-amigos', 'cumpleanos'],
    fields: [
      { key: 'recipientName', required: true },
      { key: 'senderName', required: true },
      { key: 'message', required: false },
      { key: 'photos', required: true, max: 6 },
    ],
    colors: c('#3A2218', '#F7B58C', '#FFEADC', '#FDEBDF'),
  },
  {
    slug: 'quieres-ser-mi',
    name: '¿Quieres ser mi…?',
    description: 'La pregunta, con un botón de «sí» que no se puede esquivar.',
    occasions: ['para-mi-pareja'],
    fields: [
      { key: 'recipientName', required: true },
      { key: 'senderName', required: true },
      { key: 'title', required: true },
      { key: 'message', required: false },
      { key: 'song', required: false },
    ],
    colors: c('#4A0E1A', '#FF7A8A', '#FFE0E4', '#FDE2E6'),
  },
];

export const seedNfcDesigns: { slug: string; name: string; colors: NfcColors }[] = [
  {
    slug: 'ejecutivo',
    name: 'Ejecutivo',
    colors: { card: '#0A0D16', line: '#1E2433', ink: '#F5F7FB', muted: '#A9B1C6', accent: '#7DD3FC', onAccent: '#06212F', btn: '#0A0F1E', onBtn: '#FFFFFF' },
  },
  {
    slug: 'minimal',
    name: 'Minimal',
    colors: { card: '#F4F3EF', line: '#DDDAD2', ink: '#111111', muted: '#555555', accent: '#111111', onAccent: '#F4F3EF', btn: '#111111', onBtn: '#FFFFFF' },
  },
  {
    slug: 'color-de-marca',
    name: 'Color de marca',
    colors: { card: '#1E40AF', line: '#3355C4', ink: '#FFFFFF', muted: '#C7D2FE', accent: '#FDE68A', onAccent: '#1E2A5A', btn: '#1E40AF', onBtn: '#FFFFFF' },
  },
  {
    slug: 'creativo',
    name: 'Creativo',
    colors: { card: '#3B0F4A', line: '#5A2370', ink: '#FFF5FF', muted: '#E3C2EA', accent: '#F0ABFC', onAccent: '#3B0F4A', btn: '#3B0F4A', onBtn: '#FFFFFF' },
  },
];

export const seedNfcPriceTiers: { quantity: NfcQuantityTier; unitPriceCents: null; quoteOnly: boolean }[] = [
  { quantity: 1, unitPriceCents: null, quoteOnly: false },
  { quantity: 10, unitPriceCents: null, quoteOnly: false },
  { quantity: 25, unitPriceCents: null, quoteOnly: false },
  { quantity: 50, unitPriceCents: null, quoteOnly: true },
];
