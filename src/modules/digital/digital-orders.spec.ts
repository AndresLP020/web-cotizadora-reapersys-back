import { BadRequestException } from '@nestjs/common';
import { validatePersonalization, validatePhotos } from './digital-orders.service';
import type { TemplateField } from './schemas/digital-template.schema';

const fields: TemplateField[] = [
  { key: 'recipientName', required: true },
  { key: 'senderName', required: false },
  { key: 'message', required: true, max: 20 },
  { key: 'date', required: false },
  { key: 'song', required: false },
  { key: 'rsvp', required: false },
  { key: 'photos', required: true, max: 2 },
];

function errorsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof BadRequestException) return (error.getResponse() as { message: string[] }).message;
    throw error;
  }
  return [];
}

describe('pedidos de detalles: datos personalizados', () => {
  it('guarda solo los datos que pide la plantilla, en su orden y con su etiqueta', () => {
    const result = validatePersonalization(fields, { message: ' Te quiero ', recipientName: 'Sofía', extra: 'no se guarda', senderName: '' }, 1);
    expect(result).toEqual([
      { key: 'recipientName', label: 'Para quién es', value: 'Sofía' },
      { key: 'message', label: 'Mensaje especial', value: 'Te quiero' },
    ]);
  });

  it('reúne todos los problemas: obligatorios, largo, formatos y fotos', () => {
    const errors = errorsOf(() =>
      validatePersonalization(fields, { message: 'x'.repeat(21), date: '2026-13-40', song: 'http://musica.example.com', rsvp: 'abc' }, 3),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'Puedes subir hasta 2 fotos.',
        'Falta «Para quién es».',
        '«Mensaje especial» admite hasta 20 caracteres.',
        '«Fecha especial» debe ser una fecha válida.',
        '«Canción» debe ser un enlace https.',
        '«Confirmar asistencia (WhatsApp)» debe ser un número de WhatsApp.',
      ]),
    );
  });

  it('exige fotos si son obligatorias y las rechaza si la plantilla no las pide', () => {
    expect(errorsOf(() => validatePersonalization(fields, { recipientName: 'A', message: 'B' }, 0))).toEqual(['Sube al menos una foto.']);
    expect(errorsOf(() => validatePersonalization([{ key: 'recipientName', required: true }], { recipientName: 'A' }, 1))).toEqual(['Esta plantilla no lleva fotos.']);
  });

  it('rechaza valores que no son texto', () => {
    expect(errorsOf(() => validatePersonalization([{ key: 'recipientName', required: true }], { recipientName: { $gt: '' } }, 0))).toEqual(['«Para quién es» no es válido.']);
  });
});

describe('pedidos de detalles: fotos', () => {
  const jpeg = (size: number) => ({ buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), mimetype: 'image/jpeg', size });

  it('acepta JPEG, PNG y WebP por sus bytes', () => {
    const png = { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), mimetype: 'image/png', size: 10 };
    expect(validatePhotos([jpeg(10), png])).toEqual(['image/jpeg', 'image/png']);
  });

  it('rechaza fotos de más de 5 MB, de otro tipo o más de 6', () => {
    expect(() => validatePhotos([jpeg(5_000_001)])).toThrow('más de 5 MB');
    expect(() => validatePhotos([{ buffer: Buffer.from('GIF89a..'), mimetype: 'image/jpeg', size: 8 }])).toThrow('JPEG, PNG o WebP');
    expect(() => validatePhotos(Array.from({ length: 7 }, () => jpeg(10)))).toThrow('hasta 6 fotos');
  });
});
