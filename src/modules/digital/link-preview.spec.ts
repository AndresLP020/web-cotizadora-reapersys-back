import {
  assertPublicUrl,
  downloadImage,
  fetchPreviewMeta,
  isPrivateAddress,
  MAX_HTML_BYTES,
  parsePreviewMeta,
  type PreviewDeps,
  type RawResponse,
  sniffImageType,
} from './link-preview';
import { slugify } from './digital.service';

/** Respuesta simulada: el cuerpo se entrega en trozos para probar la lectura acotada. */
function response(status: number, headers: Record<string, string>, body: string | Buffer = '', chunkSize = 64 * 1024): RawResponse {
  const buffer = typeof body === 'string' ? Buffer.from(body) : body;
  let aborted = false;
  return {
    status,
    headers,
    abort: () => {
      aborted = true;
    },
    body: (function* () {
      for (let i = 0; i < buffer.length && !aborted; i += chunkSize) yield buffer.subarray(i, i + chunkSize);
    })(),
  };
}

/** DNS y servidor simulados: cada host resuelve a sus IPs y cada URL responde lo indicado. */
function fakeDeps(dns: Record<string, string[]>, routes: Record<string, () => RawResponse>) {
  const calls: { url: string; address: string }[] = [];
  const deps: PreviewDeps = {
    resolve: (host) => {
      const ips = dns[host];
      return ips ? Promise.resolve(ips) : Promise.reject(new Error('ENOTFOUND'));
    },
    transport: (url, address) => {
      calls.push({ url: url.toString(), address });
      const route = routes[url.toString()];
      return Promise.resolve(route ? route() : response(404, {}));
    },
  };
  return { deps, calls };
}

const html = (head: string) => `<!doctype html><html><head>${head}</head><body>hola</body></html>`;

describe('vista previa de enlaces: lectura de metadatos', () => {
  const page = new URL('https://demo.example.com/cumple/estrellas');

  it('lee título, descripción, sitio, imagen e ícono de Open Graph, con URLs absolutas', () => {
    const doc = `<html><head>
      <title>Título HTML</title>
      <meta property="og:title" content="Cumpleaños &amp; Estrellas">
      <meta content='Una invitación   con fotos' property='og:description' />
      <meta property="og:site_name" content="Detalles RS">
      <meta property="og:image" content="/img/portada.jpg">
      <link rel="shortcut icon" href="/favicon.png">
    </head></html>`;
    expect(parsePreviewMeta(doc, page)).toEqual({
      title: 'Cumpleaños & Estrellas',
      description: 'Una invitación con fotos',
      siteName: 'Detalles RS',
      imageUrl: 'https://demo.example.com/img/portada.jpg',
      faviconUrl: 'https://demo.example.com/favicon.png',
      domain: 'demo.example.com',
    });
  });

  it('sin Open Graph usa Twitter, <title>, la descripción normal y /favicon.ico', () => {
    const doc = `<title>Para ti</title><meta name="description" content="Un mensaje"><meta name="twitter:image" content="https://cdn.example.com/a.png">`;
    expect(parsePreviewMeta(doc, new URL('https://www.example.com/x'))).toEqual({
      title: 'Para ti',
      description: 'Un mensaje',
      siteName: undefined,
      imageUrl: 'https://cdn.example.com/a.png',
      faviconUrl: 'https://www.example.com/favicon.ico',
      domain: 'example.com',
    });
  });

  it('una página sin metadatos no inventa título, descripción ni imagen', () => {
    const meta = parsePreviewMeta('<p>hola</p>', page);
    expect([meta.title, meta.description, meta.siteName, meta.imageUrl]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('descarta imágenes que no son https (no se descargan por http)', () => {
    expect(parsePreviewMeta('<meta property="og:image" content="http://cdn.example.com/a.png">', page).imageUrl).toBeUndefined();
  });
});

describe('vista previa de enlaces: protección SSRF', () => {
  it('reconoce direcciones privadas, locales, de metadata y reservadas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect([ip, isPrivateAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect([ip, isPrivateAddress(ip)]).toEqual([ip, false]);
  });

  it('rechaza http, otros protocolos, credenciales e IPs privadas sin abrirlas', async () => {
    const { deps, calls } = fakeDeps({}, {});
    await expect(fetchPreviewMeta('http://example.com/', deps)).rejects.toThrow('Solo se admiten URLs https');
    await expect(assertPublicUrl('file:///etc/passwd', deps.resolve)).rejects.toThrow('https');
    await expect(assertPublicUrl('https://user:pass@example.com', deps.resolve)).rejects.toThrow('usuario ni contraseña');
    await expect(assertPublicUrl('https://127.0.0.1/admin', deps.resolve)).rejects.toThrow('dirección privada');
    await expect(assertPublicUrl('https://[::1]:4000/', deps.resolve)).rejects.toThrow('dirección privada');
    await expect(assertPublicUrl('https://169.254.169.254/latest/meta-data', deps.resolve)).rejects.toThrow('dirección privada');
    await expect(assertPublicUrl('no es url', deps.resolve)).rejects.toThrow('no es válida');
    expect(calls).toEqual([]);
  });

  it('rechaza un dominio que resuelve a una IP privada (aunque también tenga una pública)', async () => {
    const { deps, calls } = fakeDeps({ 'interno.example.com': ['93.184.216.34', '10.0.0.5'] }, {});
    await expect(fetchPreviewMeta('https://interno.example.com/', deps)).rejects.toThrow('dirección privada');
    expect(calls).toEqual([]);
  });

  it('se conecta a la IP ya validada (no vuelve a resolver el DNS)', async () => {
    const { deps, calls } = fakeDeps(
      { 'demo.example.com': ['93.184.216.34'] },
      { 'https://demo.example.com/': () => response(200, { 'content-type': 'text/html; charset=utf-8' }, html('<title>Hola</title>')) },
    );
    await expect(fetchPreviewMeta('https://demo.example.com/', deps)).resolves.toMatchObject({ title: 'Hola', domain: 'demo.example.com' });
    expect(calls).toEqual([{ url: 'https://demo.example.com/', address: '93.184.216.34' }]);
  });

  it('rechaza una redirección hacia una IP privada', async () => {
    const { deps, calls } = fakeDeps(
      { 'demo.example.com': ['93.184.216.34'], 'metadata.example.com': ['169.254.169.254'] },
      { 'https://demo.example.com/': () => response(302, { location: 'https://metadata.example.com/latest' }) },
    );
    await expect(fetchPreviewMeta('https://demo.example.com/', deps)).rejects.toThrow('dirección privada');
    expect(calls.map((c) => c.url)).toEqual(['https://demo.example.com/']);
  });

  it('rechaza una redirección a http', async () => {
    const { deps } = fakeDeps(
      { 'demo.example.com': ['93.184.216.34'] },
      { 'https://demo.example.com/': () => response(301, { location: 'http://demo.example.com/' }) },
    );
    await expect(fetchPreviewMeta('https://demo.example.com/', deps)).rejects.toThrow('Solo se admiten URLs https');
  });

  it('sigue hasta 3 redirecciones y rechaza la cuarta', async () => {
    const hop = (n: number) => () => response(302, { location: `/r${n + 1}` });
    const ok = () => response(200, { 'content-type': 'text/html' }, html('<title>Final</title>'));
    const dns = { 'demo.example.com': ['93.184.216.34'] };
    const three = fakeDeps(dns, {
      'https://demo.example.com/r0': hop(0),
      'https://demo.example.com/r1': hop(1),
      'https://demo.example.com/r2': hop(2),
      'https://demo.example.com/r3': ok,
    });
    await expect(fetchPreviewMeta('https://demo.example.com/r0', three.deps)).resolves.toMatchObject({ title: 'Final' });
    const four = fakeDeps(dns, {
      'https://demo.example.com/r0': hop(0),
      'https://demo.example.com/r1': hop(1),
      'https://demo.example.com/r2': hop(2),
      'https://demo.example.com/r3': hop(3),
      'https://demo.example.com/r4': ok,
    });
    await expect(fetchPreviewMeta('https://demo.example.com/r0', four.deps)).rejects.toThrow('Demasiadas redirecciones');
  });

  it('rechaza una respuesta enorme, declarada o no en content-length', async () => {
    const big = Buffer.alloc(MAX_HTML_BYTES + 10, 'a');
    const declared = fakeDeps(
      { 'demo.example.com': ['93.184.216.34'] },
      { 'https://demo.example.com/': () => response(200, { 'content-type': 'text/html', 'content-length': String(big.length) }, '') },
    );
    await expect(fetchPreviewMeta('https://demo.example.com/', declared.deps)).rejects.toThrow('demasiado grande');
    const streamed = fakeDeps({ 'demo.example.com': ['93.184.216.34'] }, { 'https://demo.example.com/': () => response(200, { 'content-type': 'text/html' }, big) });
    await expect(fetchPreviewMeta('https://demo.example.com/', streamed.deps)).rejects.toThrow('demasiado grande');
  });

  it('rechaza contenido que no es HTML', async () => {
    const { deps } = fakeDeps(
      { 'demo.example.com': ['93.184.216.34'] },
      { 'https://demo.example.com/': () => response(200, { 'content-type': 'application/json' }, '{"a":1}') },
    );
    await expect(fetchPreviewMeta('https://demo.example.com/', deps)).rejects.toThrow('no es una página web');
  });

  it('las imágenes se validan por sus bytes, no por el tipo declarado', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { deps } = fakeDeps(
      { 'cdn.example.com': ['93.184.216.34'] },
      {
        'https://cdn.example.com/ok.png': () => response(200, { 'content-type': 'image/png' }, png),
        'https://cdn.example.com/falsa.png': () => response(200, { 'content-type': 'image/png' }, '<svg onload=alert(1)>'),
      },
    );
    await expect(downloadImage('https://cdn.example.com/ok.png', 'image', deps)).resolves.toEqual({ content: png, contentType: 'image/png' });
    await expect(downloadImage('https://cdn.example.com/falsa.png', 'image', deps)).rejects.toThrow('no es PNG');
  });
});

describe('imágenes y slugs', () => {
  it('detecta el tipo real por los primeros bytes', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('GIF89a...'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from([0, 0, 1, 0, 1]))).toBe('image/x-icon');
    expect(sniffImageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });

  it('genera slugs sin acentos ni símbolos', () => {
    expect(slugify('Cumpleaños de Ánimo ✨ 2026')).toBe('cumpleanos-de-animo-2026');
    expect(slugify('***')).toBe('plantilla');
  });
});
