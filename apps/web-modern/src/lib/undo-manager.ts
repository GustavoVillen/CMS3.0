// Deshacer / rehacer con Ctrl+Z y Ctrl+Y en toda la app (preview V25).
//
// Se resuelve una sola vez, a nivel del DOM, para no tener que tocar cada
// formulario: se registran los cambios de los campos nativos (input, textarea,
// select, casillas y opciones), tanto los que hace el usuario como los que hace
// la app por él (sugerencia de la IA, dictado). Ctrl+Z devuelve el campo a su
// valor anterior disparando el mismo evento que el tipeo, así React se entera
// igual que si lo hubiera cambiado el usuario.
//
// Límites a propósito:
// - Los controles propios (botones de opción, buscadores de equipo) no son
//   campos nativos y no se deshacen.
// - Lo guardado no se deshace: cualquier escritura exitosa contra la API vacía
//   el historial (ver `clearUndoHistory` en lib/api.ts).
// - Las contraseñas y los archivos no se registran.

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface Entry {
  el: Field;
  kind: "text" | "select" | "check" | "radio";
  before: string | boolean | HTMLInputElement | null;
  after: string | boolean | HTMLInputElement | null;
  at: number;
  /** Lo puso la app (IA, dictado): sus pasos intermedios ("Analizando…") se funden en uno. */
  programmatic?: boolean;
}

export type UndoEvent =
  | { type: "undo" | "redo"; label: string }
  | { type: "nothing-undo" | "nothing-redo" };

const TYPING_GROUP_MS = 1000;
const PROGRAMMATIC_WINDOW_MS = 20_000;
const MAX_ENTRIES = 200;

const past: Entry[] = [];
const future: Entry[] = [];
const listeners = new Set<(e: UndoEvent) => void>();
/** Último valor conocido de cada campo: es el "antes" del próximo cambio. */
const lastKnown = new WeakMap<Field, string | boolean>();
/** Cuándo apareció el campo (primera vez que se le asignó valor o recibió foco). */
const firstSeen = new WeakMap<Field, number>();
/** Último clic del usuario dentro de cada ventana (o de la página). */
const lastClickInScope = new WeakMap<Element, number>();
/** Radio marcado en cada grupo antes del cambio. */
const lastRadio = new WeakMap<Element, Map<string, HTMLInputElement | null>>();

let restoring = false;
let installed = false;
let nativeInputValue: PropertyDescriptor | undefined;
let nativeTextareaValue: PropertyDescriptor | undefined;
let nativeSelectValue: PropertyDescriptor | undefined;

export function subscribeUndo(fn: (e: UndoEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const emit = (e: UndoEvent) => listeners.forEach(fn => fn(e));

/** Lo guardado no se deshace: tras escribir en la API, el historial empieza de cero. */
export function clearUndoHistory(): void {
  past.length = 0;
  future.length = 0;
}

const isField = (t: EventTarget | null): t is Field =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

function kindOf(el: Field): Entry["kind"] | null {
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLTextAreaElement) return "text";
  const type = el.type;
  if (type === "password" || type === "file" || type === "hidden" || type === "button" || type === "submit") return null;
  if (type === "checkbox") return "check";
  if (type === "radio") return "radio";
  return "text";
}

/** La ventana del campo: los modales de la app son `fixed inset-0`; si no, la página. */
function scopeOf(el: Element): Element {
  return el.closest(".fixed.inset-0, [role='dialog']") ?? document.body;
}

function valueOf(el: Field): string | boolean {
  return el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
}

function radioGroupMap(el: HTMLInputElement): Map<string, HTMLInputElement | null> {
  const scope = scopeOf(el);
  let m = lastRadio.get(scope);
  if (!m) { m = new Map(); lastRadio.set(scope, m); }
  return m;
}

function checkedRadioOf(el: HTMLInputElement): HTMLInputElement | null {
  if (!el.name) return null;
  const scope = scopeOf(el);
  return scope.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`);
}

function remember(el: Field) {
  if (!firstSeen.has(el)) firstSeen.set(el, Date.now());
  if (el instanceof HTMLInputElement && el.type === "radio") {
    if (el.name) radioGroupMap(el).set(el.name, checkedRadioOf(el));
    return;
  }
  lastKnown.set(el, valueOf(el));
}

function push(entry: Entry) {
  const top = past[past.length - 1];
  // Tipeo continuo en el mismo campo: un solo paso por tramo.
  if (entry.kind === "text" && top && top.el === entry.el && top.kind === "text" && entry.at - top.at < TYPING_GROUP_MS) {
    top.after = entry.after;
    top.at = entry.at;
  } else {
    past.push(entry);
    if (past.length > MAX_ENTRIES) past.shift();
  }
  future.length = 0;
}

function recordUserChange(el: Field) {
  const kind = kindOf(el);
  if (!kind || restoring) return;
  const now = Date.now();
  if (kind === "radio") {
    const input = el as HTMLInputElement;
    const map = radioGroupMap(input);
    const before = map.get(input.name) ?? null;
    if (before === input) return;
    push({ el, kind, before, after: input, at: now });
    map.set(input.name, input);
    return;
  }
  const before = lastKnown.has(el) ? lastKnown.get(el)! : kind === "check" ? !(el as HTMLInputElement).checked : "";
  const after = valueOf(el);
  if (before === after) return;
  push({ el, kind, before, after, at: now });
  lastKnown.set(el, after);
}

/** Cambio hecho por la app (IA, dictado, autocompletado) después de un clic del usuario en esa ventana. */
function recordProgrammatic(el: Field, before: string, after: string) {
  if (restoring || before === after || !el.isConnected) return;
  const kind = kindOf(el);
  if (kind !== "text" && kind !== "select") return;
  const now = Date.now();
  const top = past[past.length - 1];
  // Ajuste de React justo después de tipear (p. ej. pasar a mayúsculas) o paso
  // intermedio de la IA: es parte del mismo cambio.
  if (top && top.el === el && (now - top.at < 500 || (top.programmatic && now - top.at < PROGRAMMATIC_WINDOW_MS))) {
    top.after = after; top.at = now; lastKnown.set(el, after); return;
  }
  const seen = firstSeen.get(el);
  const click = lastClickInScope.get(scopeOf(el));
  const clickedRecently = click != null && now - click <= PROGRAMMATIC_WINDOW_MS;
  // Carga inicial o recarga de datos: no es un cambio del usuario. Un campo vacío
  // que se llena después de un clic (la IA) sí lo es.
  const counts = clickedRecently && (seen == null ? before === "" : click! >= seen);
  if (seen == null) firstSeen.set(el, now);
  if (!counts) { lastKnown.set(el, after); return; }
  past.push({ el, kind, before, after, at: now, programmatic: true });
  if (past.length > MAX_ENTRIES) past.shift();
  future.length = 0;
  lastKnown.set(el, after);
}

function fieldLabel(el: Field): string {
  const ownText = (node: Element | null | undefined) => node
    ? Array.from(node.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent ?? "").join(" ").replace(/\s+/g, " ").replace(/\*\s*$/, "").trim()
    : "";
  const fromLabels = el.labels && el.labels.length ? ownText(el.labels[0]) : "";
  if (fromLabels) return fromLabels;
  let p: Element | null = el.parentElement;
  for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
    const lbl = p.querySelector("label");
    const txt = ownText(lbl);
    if (txt && lbl && !lbl.contains(el)) return txt;
  }
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    const txt = el.closest("label")?.textContent?.replace(/\s+/g, " ").trim();
    if (txt) return txt.slice(0, 60);
  }
  return el.getAttribute("aria-label") || (el as HTMLInputElement).placeholder || "";
}

function flash(el: Element) {
  const target = (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) ? (el.closest("label") ?? el) : el;
  const h = target as HTMLElement;
  const prev = h.style.boxShadow;
  h.style.transition = "box-shadow .6s ease";
  h.style.boxShadow = "0 0 0 3px rgba(245,158,11,.85)";
  window.setTimeout(() => { h.style.boxShadow = prev; }, 700);
  if (typeof h.scrollIntoView === "function") h.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** Pone el valor como si lo hubiera escrito el usuario: React ve el evento y actualiza su estado. */
function apply(entry: Entry, value: Entry["before"]) {
  const el = entry.el;
  restoring = true;
  try {
    if (entry.kind === "check") {
      if ((el as HTMLInputElement).checked !== value) (el as HTMLInputElement).click();
    } else if (entry.kind === "radio") {
      const target = value as HTMLInputElement | null;
      if (target && target.isConnected && !target.checked) target.click();
      if (target) radioGroupMap(target).set(target.name, target);
    } else {
      const desc = el instanceof HTMLSelectElement ? nativeSelectValue : el instanceof HTMLTextAreaElement ? nativeTextareaValue : nativeInputValue;
      desc?.set?.call(el, value as string);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    }
    if (entry.kind !== "radio") lastKnown.set(el, valueOf(el));
  } finally {
    restoring = false;
  }
  flash(entry.kind === "radio" ? ((value as HTMLInputElement | null) ?? el) : el);
}

export function undo(): void {
  let entry = past.pop();
  while (entry && !entry.el.isConnected) entry = past.pop();
  if (!entry) { emit({ type: "nothing-undo" }); return; }
  apply(entry, entry.before);
  future.push(entry);
  emit({ type: "undo", label: fieldLabel(entry.el) });
}

export function redo(): void {
  let entry = future.pop();
  while (entry && !entry.el.isConnected) entry = future.pop();
  if (!entry) { emit({ type: "nothing-redo" }); return; }
  apply(entry, entry.after);
  past.push(entry);
  emit({ type: "redo", label: fieldLabel(entry.el) });
}

function patchValueSetter(proto: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): PropertyDescriptor | undefined {
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (!desc?.set || !desc.get) return desc;
  const { get, set } = desc;
  Object.defineProperty(proto, "value", {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return get.call(this); },
    set(v: string) {
      const before = get.call(this) as string;
      set.call(this, v);
      if (!restoring) recordProgrammatic(this as Field, before, get.call(this) as string);
    },
  });
  return desc;
}

/**
 * Se instala antes de montar React: React captura el `value` del prototipo al
 * crear cada campo, así que tiene que encontrarlo ya envuelto.
 */
export function installUndoManager(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  nativeInputValue = patchValueSetter(HTMLInputElement.prototype);
  nativeTextareaValue = patchValueSetter(HTMLTextAreaElement.prototype);
  nativeSelectValue = patchValueSetter(HTMLSelectElement.prototype);

  document.addEventListener("focusin", e => { if (isField(e.target)) remember(e.target); }, true);
  document.addEventListener("pointerdown", e => {
    const target = e.target as Element | null;
    if (!target) return;
    lastClickInScope.set(scopeOf(target), Date.now());
    const field = target.closest("input, select, textarea, label");
    const input = field instanceof HTMLLabelElement ? field.control : field;
    if (isField(input)) remember(input);
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key === " " && isField(e.target)) remember(e.target);
  }, true);
  document.addEventListener("input", e => { if (isField(e.target) && kindOf(e.target) === "text") recordUserChange(e.target); }, true);
  document.addEventListener("change", e => {
    if (!isField(e.target)) return;
    const kind = kindOf(e.target);
    if (kind === "select" || kind === "check" || kind === "radio") recordUserChange(e.target);
  }, true);

  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — también con el cursor dentro de un campo.
  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
  });
}
