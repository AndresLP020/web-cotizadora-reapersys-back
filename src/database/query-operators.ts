import mongoose from 'mongoose';

/**
 * Con `sanitizeFilter` global, Mongoose neutraliza cualquier operador ($in, $gt...) dentro de un filtro
 * para impedir inyección NoSQL desde datos del usuario. Los operadores construidos POR EL SERVIDOR
 * se marcan como confiables con estos helpers. Nunca pasar aquí objetos sin validar del cliente.
 */
export function inValues<T>(values: readonly T[]): { $in: T[] } {
  return mongoose.trusted({ $in: [...values] });
}

/** Operador construido por el servidor (p. ej. { $gte: fecha }, { $ne: valor }). */
export function trusted<T extends object>(operator: T): T {
  return mongoose.trusted(operator);
}

/** Búsqueda insensible a mayúsculas por texto LITERAL (los metacaracteres se escapan). */
export function containsText(text: string): { $regex: string; $options: string } {
  const escaped = text.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return mongoose.trusted({ $regex: escaped, $options: 'i' });
}
