// Marca de "registro recién creado": la deja quien crea la OT o la SS y la lee
// su ficha al abrirse, para mostrar el aviso "¡… abierta!" con los pasos que
// siguen (completar y enviar a aprobar).
//
// Va en sessionStorage (no en el estado de la navegación) porque cada pantalla
// abre el registro a su manera — deep-link desde el Tablero, desde Planes, desde
// la OT — y así el aviso sale igual sin tocar cada una. Si el navegador no deja
// usar el storage, simplemente no hay aviso.

export type JustCreatedKind = "wo" | "ss";

const key = (kind: JustCreatedKind) => `cms3.justCreated.${kind}`;

/** `id` = código de la OT o id de la SS (lo que use su ficha para abrirse). */
export function markJustCreated(kind: JustCreatedKind, id: string | undefined | null): void {
  if (!id) return;
  try { sessionStorage.setItem(key(kind), id); } catch { /* sin storage: no hay aviso */ }
}

/** ¿Se acaba de crear? Sólo mira: se borra aparte con `clearJustCreated`. */
export function isJustCreated(kind: JustCreatedKind, id: string): boolean {
  try { return sessionStorage.getItem(key(kind)) === id; } catch { return false; }
}

export function clearJustCreated(kind: JustCreatedKind): void {
  try { sessionStorage.removeItem(key(kind)); } catch { /* nada que limpiar */ }
}
