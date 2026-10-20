import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Requiere MongoDB accesible (npm run db:up). El entorno de prueba se define en setup-e2e-env.ts
 * y usa una base de datos aislada (reapersys_test).
 */
describe('Health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health responde ok con MongoDB conectado', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.up).toBe(true);
    expect(typeof res.body.database.transactions).toBe('boolean');
    expect(res.body.integrations.email.simulated).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/token|secret|api_key/i);
  });

  it('aplica cabeceras de seguridad y oculta x-powered-by', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS solo autoriza orígenes de la lista', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const denied = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'https://malicioso.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rutas inexistentes devuelven el formato de error uniforme', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/no-existe').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, path: '/api/v1/no-existe' });
  });
});
