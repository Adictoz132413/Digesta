/**
 * Buscar actualización a mano: pide al service worker que revise si hay una
 * versión nueva publicada y, si la hay, la activa y recarga la app.
 * Los datos no se tocan: viven en IndexedDB, no en la caché de la app.
 */
export type UpdateResult = 'actualizando' | 'al_dia' | 'sin_conexion' | 'no_disponible';

export async function checkForAppUpdate(): Promise<UpdateResult> {
  if (!('serviceWorker' in navigator)) return 'no_disponible';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'no_disponible';
  if (!navigator.onLine) return 'sin_conexion';
  try {
    await reg.update();
  } catch {
    return 'sin_conexion';
  }
  // Esperar a que termine de instalarse una versión nueva (si la hay)
  const waiting = await new Promise<ServiceWorker | null>((resolve) => {
    if (reg.waiting) return resolve(reg.waiting);
    const sw = reg.installing;
    if (!sw) return resolve(null);
    const t = setTimeout(() => resolve(reg.waiting), 20_000);
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed') {
        clearTimeout(t);
        resolve(reg.waiting ?? sw);
      } else if (sw.state === 'redundant') {
        clearTimeout(t);
        resolve(null);
      }
    });
  });
  if (!waiting) return 'al_dia';
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return 'actualizando';
}

/** Fecha de compilación de esta versión (la inyecta Vite). */
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
