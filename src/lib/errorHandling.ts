import { logger } from '@/lib/logger';

/**
 * Lista de mensajes de error esperados (lógica de negocio, permisos, etc.)
 * que no deben ensuciar la consola como errores de sistema.
 */
export const EXPECTED_ERROR_MESSAGES = [
  'No tienes permiso para realizar esta acción',
  'No autorizado',
  'Negocio no encontrado',
  'No tienes acceso a este negocio',
  'Producto no encontrado o no autorizado',
  'Has alcanzado el límite de productos de tu plan',
  'Has alcanzado el límite de categorías de tu plan',
  'Categoria no encontrada o acceso denegado',
  'No se pueden sincronizar las categorías',
  'Ya has dado me gusta a este producto',
];

/**
 * Verifica si un error es uno de los errores esperados de lógica de negocio.
 */
export function isBusinessError(error: unknown): boolean {
  if (!error) return false;

  const getMessage = (err: unknown): string => {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && 'message' in err)
      return String((err as { message: unknown }).message);
    if (err && typeof err === 'object' && 'error' in err)
      return String((err as { error: unknown }).error);
    return String(err);
  };

  const message = getMessage(error);
  return EXPECTED_ERROR_MESSAGES.some((expected) => message.includes(expected));
}

/**
 * Loguea el error en la consola solo si no es un error de negocio esperado.
 */
export function logError(context: string, error: unknown) {
  if (isBusinessError(error)) {
    // Si es un error esperado, opcionalmente podemos usar console.warn o nada
    // El usuario pidió no usar console para estos casos
    return;
  }

  logger.error(`${context}: critical error`, {
    error: error instanceof Error ? error.message : String(error),
  });
}
