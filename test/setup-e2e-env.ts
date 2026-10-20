// Se ejecuta antes de importar AppModule: ConfigModule valida el entorno al cargarse.
// MONGODB_URI puede sobrescribirse desde el entorno (p. ej. CI con otro host).
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://localhost:27018/?replicaSet=rs0';
process.env.MONGODB_DB_NAME = 'reapersys_test';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SWAGGER_ENABLED = 'false';
process.env.EMAIL_PROVIDER = 'simulated';
process.env.WHATSAPP_PROVIDER = 'simulated';
