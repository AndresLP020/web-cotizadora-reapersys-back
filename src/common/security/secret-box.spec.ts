import { open, seal } from './secret-box';

describe('secret-box', () => {
  const secret = 'x'.repeat(40);

  it('cifra y descifra; cada cifrado es distinto', () => {
    const a = seal('token-123', secret, 'quote-access');
    const b = seal('token-123', secret, 'quote-access');
    expect(a).not.toBe(b);
    expect(a).not.toContain('token-123');
    expect(open(a, secret, 'quote-access')).toBe('token-123');
  });

  it('rechaza textos alterados, otra llave u otro contexto', () => {
    const sealed = seal('token-123', secret, 'quote-access');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(open(tampered, secret, 'quote-access')).toBeNull();
    expect(open(sealed, 'y'.repeat(40), 'quote-access')).toBeNull();
    expect(open(sealed, secret, 'otro')).toBeNull();
    expect(open('basura', secret, 'quote-access')).toBeNull();
  });
});
