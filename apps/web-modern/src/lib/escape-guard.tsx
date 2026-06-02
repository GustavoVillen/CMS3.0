import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";

// ---------------------------------------------------------------------------
// EscapeGuardProvider
//
// Listener global de tecla ESC.
// Cada modal/vista que quiera reaccionar a ESC se registra con `useEscapeGuard`.
// Al presionar ESC:
//   - Si la última vista registrada tiene `isDirty` → abre dialog de confirmación
//     con [Guardar] [Descartar] [Cancelar]
//   - Si no hay cambios → ejecuta `onClose` directamente
//   - Si no hay nada registrado → navega a "/" (Dashboard)
// ---------------------------------------------------------------------------

interface Guard {
  id: number;
  isDirty: () => boolean;
  onSave?: () => Promise<void> | void;
  onClose: () => void;
}

interface EscapeGuardContextValue {
  register: (g: Omit<Guard, "id">) => number;
  unregister: (id: number) => void;
}

const EscapeGuardContext = createContext<EscapeGuardContextValue | null>(null);

let guardIdCounter = 0;

interface DialogState {
  open: boolean;
  guard: Guard | null;
}

export function EscapeGuardProvider({ children }: { children: React.ReactNode }) {
  const stackRef = useRef<Guard[]>([]);
  const [dialog, setDialog] = useState<DialogState>({ open: false, guard: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = dialog.open;

  // Flag para distinguir back programático (limpieza de history) del back
  // disparado por el usuario (botón físico Android, swipe gesture iOS).
  const programmaticBackRef = useRef(false);

  const register = useCallback((g: Omit<Guard, "id">) => {
    const id = ++guardIdCounter;
    stackRef.current = [...stackRef.current, { ...g, id }];
    // Pushear una entry "guard" al history para que el back button del
    // sistema (Android, iOS swipe) pueda interceptarse y cerrar el guard
    // en vez de navegar fuera de la app.
    try { window.history.pushState({ __escapeGuard: id }, ""); } catch { /* noop */ }
    return id;
  }, []);

  const unregister = useCallback((id: number) => {
    const wasTop = stackRef.current[stackRef.current.length - 1]?.id === id;
    stackRef.current = stackRef.current.filter(g => g.id !== id);
    // Si el state actual del history es nuestro guard, lo limpiamos haciendo
    // history.back() programáticamente. Marcamos el flag para que el listener
    // de popstate no lo confunda con un back del usuario.
    const state = window.history.state as { __escapeGuard?: number } | null;
    if (wasTop && state?.__escapeGuard === id) {
      programmaticBackRef.current = true;
      try { window.history.back(); } catch { /* noop */ }
    }
  }, []);

  const closeDialog = useCallback(() => {
    setDialog({ open: false, guard: null });
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const guard = dialog.guard;
    if (!guard?.onSave) return;
    setSaving(true);
    setError(null);
    try {
      await guard.onSave();
      guard.onClose();
      closeDialog();
    } catch (e: any) {
      setError(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }, [dialog.guard, closeDialog]);

  const handleDiscard = useCallback(() => {
    dialog.guard?.onClose();
    closeDialog();
  }, [dialog.guard, closeDialog]);

  // Global ESC listener — attached once
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      // ESC inside the confirmation dialog = cancel
      if (dialogOpenRef.current) {
        e.preventDefault();
        closeDialog();
        return;
      }

      const top = stackRef.current[stackRef.current.length - 1];
      if (top) {
        e.preventDefault();
        if (top.isDirty()) {
          setDialog({ open: true, guard: top });
        } else {
          top.onClose();
        }
        return;
      }

      // No guards: go back to dashboard if not already there
      if (locationRef.current !== "/" && locationRef.current !== "/m") {
        e.preventDefault();
        navigate("/");
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeDialog, navigate]);

  // ── Back button del sistema (Android / iOS swipe) ────────────────────────
  // El mismo stack de guards reacciona también a popstate. Cada `register`
  // pushea una entry custom; cuando el usuario hace back, este listener
  // ejecuta onClose del top guard (o abre el dialog de confirmación si dirty).
  useEffect(() => {
    const onPopState = () => {
      // Back programático (limpieza de history desde unregister) — ignorar.
      if (programmaticBackRef.current) {
        programmaticBackRef.current = false;
        return;
      }
      // Si el dialog de confirmación está abierto, el back lo cancela y
      // vuelve a empujar el state para mantener el guard "atrasable".
      if (dialogOpenRef.current) {
        closeDialog();
        const top = stackRef.current[stackRef.current.length - 1];
        if (top) {
          try { window.history.pushState({ __escapeGuard: top.id }, ""); } catch { /* noop */ }
        }
        return;
      }
      const top = stackRef.current[stackRef.current.length - 1];
      if (!top) return; // sin guards activos, dejar pasar el back nativo
      if (top.isDirty()) {
        // Abrir dialog y re-pushear para que el próximo back (cancel) funcione.
        setDialog({ open: true, guard: top });
        try { window.history.pushState({ __escapeGuard: top.id }, ""); } catch { /* noop */ }
      } else {
        // Cerrar limpio. onClose va a llamar a unregister que ya hace el
        // history.back programático, pero como ya estamos en popstate
        // (el back fue del usuario, no programático), no hace falta más
        // limpieza — el state ya cambió.
        top.onClose();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [closeDialog]);

  return (
    <EscapeGuardContext.Provider value={{ register, unregister }}>
      {children}
      {dialog.open && (
        <UnsavedChangesDialog
          saving={saving}
          error={error}
          canSave={!!dialog.guard?.onSave}
          onSave={handleSave}
          onDiscard={handleDiscard}
          onCancel={closeDialog}
        />
      )}
    </EscapeGuardContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// UnsavedChangesDialog
// ---------------------------------------------------------------------------

interface DialogProps {
  saving: boolean;
  error: string | null;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

function UnsavedChangesDialog({ saving, error, canSave, onSave, onDiscard, onCancel }: DialogProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-fg">Cambios sin guardar</h2>
        <p className="text-sm text-text-industrial/70 leading-relaxed">
          Tenés cambios sin guardar. ¿Qué querés hacer?
        </p>
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-fg/5 text-fg text-sm font-bold border border-fg/10 hover:bg-fg/10 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-fg/5 text-text-industrial/60 text-sm font-bold border border-fg/10 hover:bg-fg/10 disabled:opacity-40"
          >
            Descartar
          </button>
          {canSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-accent text-fg text-sm font-bold hover:bg-accent/80 disabled:opacity-40"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// useEscapeGuard
//
// Hook que registra el comportamiento de ESC para un componente.
//
// @param enabled  Si false, no se registra (default true). Útil para vistas
//                 condicionales — ej. solo registrar cuando view === "create".
// @param isDirty  Bandera reactiva: hay cambios sin guardar?
// @param onSave   Handler de guardado. Si se omite, el dialog no muestra
//                 botón "Guardar" (modal de sólo lectura).
// @param onClose  Cómo cerrar/volver atrás. Se llama en ESC sin cambios,
//                 después de Guardar o al Descartar.
// ---------------------------------------------------------------------------

export function useEscapeGuard(opts: {
  enabled?: boolean;
  isDirty: boolean;
  onSave?: () => Promise<void> | void;
  onClose: () => void;
}) {
  const ctx = useContext(EscapeGuardContext);
  if (!ctx) throw new Error("useEscapeGuard requires EscapeGuardProvider");

  const dirtyRef = useRef(opts.isDirty);
  const onSaveRef = useRef(opts.onSave);
  const onCloseRef = useRef(opts.onClose);
  dirtyRef.current = opts.isDirty;
  onSaveRef.current = opts.onSave;
  onCloseRef.current = opts.onClose;

  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    const id = ctx.register({
      isDirty: () => dirtyRef.current,
      onSave: onSaveRef.current ? () => onSaveRef.current!() : undefined,
      onClose: () => onCloseRef.current(),
    });
    return () => ctx.unregister(id);
  }, [enabled, ctx]);
}

// ---------------------------------------------------------------------------
// useDirtyTracker
//
// Helper opcional que captura un snapshot del valor en el primer render
// y devuelve true cuando el valor cambió.
//
// Apto para modals que se montan frescos por cada item (key-by-id o render
// condicional). No apto si el "initial" cambia durante la vida del componente.
//
// Uso:
//   const isDirty = useDirtyTracker({ name, code, status });
//   useEscapeGuard({ isDirty, onSave: handleSave, onClose });
// ---------------------------------------------------------------------------

export function useDirtyTracker<T>(value: T): boolean {
  const initialRef = useRef<string | null>(null);
  const current = JSON.stringify(value);
  if (initialRef.current === null) {
    initialRef.current = current;
  }
  return initialRef.current !== current;
}
