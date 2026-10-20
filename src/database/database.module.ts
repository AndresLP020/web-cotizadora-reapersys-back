import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from './database.service';

// Defensa contra inyección NoSQL: Mongoose envuelve en $eq cualquier objeto con
// operadores ($gt, $ne, ...) que llegue dentro de un filtro, salvo uso explícito de trusted().
mongoose.set('sanitizeFilter', true);
// Ignora silenciosamente campos de filtro que no existen en el esquema.
mongoose.set('strictQuery', true);

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGODB_URI'),
        dbName: config.get('MONGODB_DB_NAME'),
        autoIndex: config.get('MONGODB_AUTO_INDEX'),
        autoCreate: true,
        serverSelectionTimeoutMS: 10_000,
        appName: 'reapersys-backend',
      }),
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
