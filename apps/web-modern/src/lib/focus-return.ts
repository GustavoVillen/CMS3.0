// Al cerrarse una ventana (formulario, aviso, confirmación, subventana de un
// formulario) el foco vuelve a donde estaba el usuario antes de abrirla: el
// campo, el botón o la fila. Sin esto el navegador lo manda al principio de la
// página y se pierde el lugar en el que se estaba trabajando.
//
// Es un único vigilante para toda la app porque las ventanas están armadas a
// mano en decenas de pantallas. Lo que todas comparten es la capa de fondo
// `fixed inset-0` (el mismo criterio que usa undo-manager para reconocerlas).
//
// Sólo actúa si al cerrar el foco quedó perdido: si la pantalla ya lo puso en
// otro lado a propósito (ej. la Planilla a Bordo vuelve a la fila tildada), se
// respeta.

const WINDOW_SEL = ".fixed.inset-0, [role='dialog'], [role='alertdialog']";
const CONTROL_SEL = "a[href], button, input, select, textarea, [contenteditable='true']";
const ROW_SEL = "tr, [role='row'], li";
const RECENT_MAX = 20;

interface OpenWindow {
  el: Element;
  returnTo: Element | null;
}

let installed = false;

export function installFocusReturn(): void {
  if (installed) return;
  installed = true;

  // Últimos lugares tocados (con foco o con clic), el más reciente al final.
  // El clic cuenta aparte porque una fila de tabla se abre con un clic pero no
  // recibe foco.
  const recent: Element[] = [];
  const note = (e: Event) => {
    if (!(e.target instanceof Element)) return;
    const i = recent.indexOf(e.target);
    if (i >= 0) recent.splice(i, 1);
    recent.push(e.target);
    if (recent.length > RECENT_MAX) recent.shift();
  };
  document.addEventListener("focusin", note, true);
  document.addEventListener("pointerdown", note, true);

  const open: OpenWindow[] = [];

  new MutationObserver(records => {
    const added: Element[] = [];
    for (const r of records) {
      r.addedNodes.forEach(n => {
        if (!(n instanceof Element)) return;
        if (n.matches(WINDOW_SEL)) added.push(n);
        else added.push(...n.querySelectorAll(WINDOW_SEL));
      });
    }
    if (added.length > 0) {
      // Si la ventana enfocó un campo al abrir, ese foco ya es de adentro: el
      // lugar de vuelta es lo último tocado FUERA de lo que se acaba de abrir.
      const inAdded = (el: Element) => added.some(w => w.contains(el));
      let returnTo: Element | null = null;
      for (let i = recent.length - 1; i >= 0; i--) {
        const el = recent[i]!;
        if (el.isConnected && !inAdded(el)) { returnTo = el; break; }
      }
      for (const w of added) {
        // Fondo y contenido de una misma ventana: cuenta una sola vez.
        if (added.some(o => o !== w && o.contains(w))) continue;
        if (open.some(o => o.el === w)) continue;
        open.push({ el: w, returnTo });
      }
    }

    // Si se cierran varias juntas, manda la primera que se abrió: es la que
    // tapaba el lugar donde estaba el usuario.
    let target: Element | null = null;
    let closed = false;
    for (let i = 0; i < open.length; ) {
      if (open[i]!.el.isConnected) { i++; continue; }
      if (!closed) { target = open[i]!.returnTo; closed = true; }
      open.splice(i, 1);
    }
    // Se espera un cuadro: la pantalla termina de redibujarse y, si quiere,
    // pone el foco ella misma primero.
    if (target) {
      const t = target;
      requestAnimationFrame(() => restore(t));
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function restore(target: Element): void {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  if (!target.isConnected) return;
  // Si queda otra ventana abierta que no es la del lugar de vuelta, el foco es
  // de esa: no se lo manda detrás.
  const covering = [...document.querySelectorAll(WINDOW_SEL)]
    .filter(w => !w.parentElement?.closest(WINDOW_SEL))
    .some(w => !w.contains(target));
  if (covering) return;

  const el = focusableFor(target);
  if (!el) return;
  el.focus({ preventScroll: true });
  // Si la fila quedó fuera de la vista, vuelve al centro; si se ve, no se mueve.
  const anchor = el.closest("tr") ?? el;
  if (!fullyVisible(anchor)) anchor.scrollIntoView({ block: "center" });
}

/** El control tocado; si era una celda sin control, la fila entera. */
function focusableFor(target: Element): HTMLElement | null {
  const control = target.closest<HTMLElement>(CONTROL_SEL);
  if (control && !(control as HTMLButtonElement).disabled) return control;
  const row = target.closest<HTMLElement>(ROW_SEL);
  if (row) {
    // tabindex -1: se le puede dar el foco, pero Tab no se detiene en cada fila.
    if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "-1");
    return row;
  }
  return target.closest<HTMLElement>("[tabindex]");
}

function fullyVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) return false;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!/(auto|scroll)/.test(getComputedStyle(p).overflowY)) continue;
    const b = p.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) return false;
  }
  return true;
}
