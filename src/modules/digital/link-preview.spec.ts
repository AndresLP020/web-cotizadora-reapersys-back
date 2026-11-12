import { assertPublicUrl, isPrivateAddress, parsePreviewMeta } from './link-preview';
import { slugify, sniffImageType } from './digital.service';

describe('vista previa de enlaces', () => {
  const page = new URL('https://demo.example.com/cumple/estrellas');

  it('lee título, descripción, sitio e imagen de Open Graph, con la imagen absoluta', () => {
    const html = `<html><head>
      <title>Título HTML</title>
      <meta property="og:title" content="Cumpleaños &amp; Estrellas">
      <meta content='Una invitación   con fotos' property='og:description' />
      <meta property="og:site_name" content="Detalles RS">
      <meta property="og:image" content="/img/portada.jpg">
    </head></html>`;
    expect(parsePreviewMeta(html, page)).toEqual({
      title: 'Cumpleaños & Estrellas',
      description: 'Una invitación con fotos',
      siteName: 'Detalles RS',
      imageUrl: 'https://demo.example.com/img/portada.jpg',
    });
  });

  it('sin Open Graph usa Twitter, <title> y la descripción normal', () => {
    const html = `<title>Para ti</title><meta name="description" content="Un mensaje"><meta name="twitter:image" content="https://cdn.example.com/a.png">`;
    expect(parsePreviewMeta(html, page)).toEqual({ title: 'Para ti', description: 'Un mensaje', siteName: undefined, imageUrl: 'https://cdn.example.com/a.png' });
  });

  it('una página sin metadatos no inventa nada', () => {
    expect(parsePreviewMeta('<p>hola</p>', page)).toEqual({ title: undefined, description: undefined, siteName: undefined, imageUrl: undefined });
  });

  it('reconoce direcciones privadas, locales y reservadas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect([ip, isPrivateAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect([ip, isPrivateAddress(ip)]).toEqual([ip, false]);
  });

  it('rechaza URLs locales, privadas o de otros protocolos sin abrirlas', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/admin')).rejects.toThrow('dirección privada');
    await expect(assertPublicUrl('http://[::1]:4000/')).rejects.toThrow('dirección privada');
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('dirección privada');
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow('http o https');
    await expect(assertPublicUrl('https://user:pass@example.com')).rejects.toThrow('usuario ni contraseña');
    await expect(assertPublicUrl('no es url')).rejects.toThrow('no es válida');
  });
});

describe('imágenes y slugs', () => {
  it('detecta el tipo real por los primeros bytes', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('GIF89a...'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });

  it('genera slugs sin acentos ni símbolos', () => {
    expect(slugify('Cumpleaños de Ánimo ✨ 2026')).toBe('cumpleanos-de-animo-2026');
    expect(slugify('***')).toBe('plantilla');
  });
});
