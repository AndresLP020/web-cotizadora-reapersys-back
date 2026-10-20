import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('POST /api/v1/contact (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;

  const valid = {
    name: 'María López',
    company: 'Abarrotes López',
    email: '  Maria@Example.com ',
    phone: '+52 55 1234 5678',
    industry: 'tiendas-abarrotes',
    interest: 'pos',
    message: 'Necesito un punto de venta con lector de códigos.',
    consent: true,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.collection('leads').deleteMany({});
  });

  afterAll(async () => {
    await connection?.collection('leads').deleteMany({});
    await app?.close();
  });

  const post = (body: object) => request(app.getHttpServer()).post('/api/v1/contact').send(body);

  it('registra el prospecto con referencia pública, consentimiento y sin IP en claro', async () => {
    const res = await post(valid).expect(201);
    expect(res.body).toEqual({ received: true, reference: expect.stringMatching(/^RS-[0-9A-Z]{8}$/) });

    const lead = await connection.collection('leads').findOne({ reference: res.body.reference });
    expect(lead).toMatchObject({
      email: 'maria@example.com',
      source: 'contact_form',
      status: 'new',
      consent: { contact: true, textVersion: expect.any(String) },
    });
    expect(lead?.requestMeta.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(lead)).not.toContain('127.0.0.1');
  });

  it('rechaza solicitudes sin consentimiento', async () => {
    const res = await post({ ...valid, consent: false }).expect(400);
    expect(JSON.stringify(res.body.message)).toContain('consentimiento');
  });

  it('rechaza campos no declarados', async () => {
    await post({ ...valid, status: 'converted' }).expect(400);
  });

  it('bloquea operadores de MongoDB en lugar de valores (inyección NoSQL)', async () => {
    await post({ ...valid, email: { $gt: '' } }).expect(400);
  });

  it('acepta pero descarta envíos que llenan el honeypot', async () => {
    const before = await connection.collection('leads').countDocuments();
    await post({ ...valid, website: 'http://spam.example' }).expect(201);
    expect(await connection.collection('leads').countDocuments()).toBe(before);
  });

  it('limita a 5 envíos por IP cada 10 minutos', async () => {
    // Las 5 solicitudes anteriores (incluidas las rechazadas) ya consumieron el cupo.
    await post(valid).expect(429);
  });
});
