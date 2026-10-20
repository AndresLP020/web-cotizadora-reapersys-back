import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { parseArgs } from 'node:util';
import { AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { generatePassword, hashPassword, passwordPolicyError } from './password';
import { ROLES, type Role } from './roles';
import { User, UserSchema } from './schemas/user.schema';

@Module({ imports: [AppConfigModule, DatabaseModule, MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])] })
class CliModule {}

/**
 * Alta de usuarios del panel por línea de comandos (para el primer propietario).
 *
 *   npm run user:create -- --email=ana@empresa.com --name="Ana Pérez" [--role=owner]
 *
 * La contraseña se toma de la variable ADMIN_PASSWORD; si no existe, se genera una aleatoria
 * que se muestra UNA sola vez. Nunca se escribe en archivos ni en logs persistentes.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'owner' } },
  });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  const role = values.role as Role;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Indica --email con un correo válido.');
  if (!name || name.length < 2) throw new Error('Indica --name con el nombre completo.');
  if (!ROLES.includes(role)) throw new Error(`--role debe ser uno de: ${ROLES.join(', ')}.`);

  const provided = process.env.ADMIN_PASSWORD;
  const password = provided ?? generatePassword();
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);

  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['warn', 'error'] });
  try {
    const users = app.get<Model<User>>(getModelToken(User.name));
    if (await users.exists({ email })) throw new Error(`Ya existe un usuario con el correo ${email}.`);
    await users.create({ email, name, role, passwordHash: await hashPassword(password), active: true, passwordChangedAt: new Date() });

    process.stdout.write(`\nUsuario creado: ${email} (${role})\n`);
    if (!provided) {
      process.stdout.write(`Contraseña temporal (se muestra solo esta vez): ${password}\n`);
      process.stdout.write('Cámbiala al iniciar sesión en /admin/cuenta.\n\n');
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('user:create').error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
