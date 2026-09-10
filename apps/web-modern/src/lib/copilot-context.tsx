/**
 * CopilotContext — structured screen context emitted by pages/modals.
 *
 * Pattern:
 *   - CopilotContextProvider wraps the tenant Layout
 *   - Pages call useCopilotEmitter(ctx) to push live context while a form/modal is open
 *   - CopilotoPanel calls useCopilotScreenContext() to read the context and show suggestions
 *   - Any component can call setRequestMessage(msg) to trigger a copilot auto-send
 *
 * Design principles:
 *   - Zero API calls from context machinery (offline heuristics only)
 *   - Context cleared automatically when emitting component unmounts
 *   - JSON.stringify dep in useCopilotEmitter prevents infinite re-run loops
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CopilotModule =
  | "WORK_ORDERS"
  | "CAPA"
  | "DEFERRALS"
  | "DEFECTS"
  | "CERTIFICATES"
  | "MAINTENANCE_PLANS"
  | "INSPECTIONS"
  | "DASHBOARD"
  | string;

/** Structured snapshot of what the user is currently working on. */
export interface CopilotScreenContext {
  /** Which application module is active. */
  module: CopilotModule;
  /** Fine-grained screen name, e.g. "RCA_EDIT", "WO_EDIT". */
  screen: string;
  /** DB entity ID of the record being edited. */
  entityId?: string;
  /** Human-readable code, e.g. "RCA-LATERE-001". */
  entityCode?: string;
  vesselCode?: string;
  /** Workflow status, e.g. "DRAFT", "IN_PROGRESS". */
  workflowStage?: string;
  /** Whether the current record is in an editable state. */
  canEdit?: boolean;
  /** Live values of visible/editable form fields (null = empty). */
  fieldValues?: Record<string, string | null>;
  /**
   * Opciones válidas de los campos de `fieldValues` que son lista cerrada
   * (recuadros de tildar, desplegables). La IA tiene que proponer el `value`
   * exacto — el `label` es sólo para que sepa de qué habla el recuadro.
   * Sin esto proponía texto libre que el formulario no podía aplicar.
   */
  fieldOptions?: Record<string, Array<{ value: string; label: string }>>;
  /** Related entity IDs for cross-module context. */
  relatedEntities?: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface CopilotContextValue {
  screenContext: CopilotScreenContext | null;
  setScreenContext: React.Dispatch<React.SetStateAction<CopilotScreenContext | null>>;
  /**
   * Set a message that CopilotoPanel should auto-send immediately.
   * The panel consumes it (sets back to null) after sending.
   * Use this from buttons outside the panel (e.g. "Asistir con IA").
   */
  requestMessage: string | null;
  setRequestMessage: (msg: string | null) => void;
  /**
   * True when an active form has registered a field-apply callback.
   * Used by CopilotoPanel to decide whether to show the "Aplicar campos" button.
   */
  hasApplyFieldsCallback: boolean;
  /** Register a callback that the copilot can call to apply field values to the active form. */
  registerApplyFieldsCallback: (fn: (fields: Record<string, string>) => void) => void;
  /** Unregister the callback (call on unmount or when form closes). */
  unregisterApplyFieldsCallback: () => void;
  /** Call the registered callback with the given field values. No-op when none registered. */
  applyFields: (fields: Record<string, string>) => void;
  /**
   * Nombres de los asistentes de IA que el formulario abierto expone para que
   * el copiloto los dispare (criterios de aceptación, LOTO, análisis de riesgo).
   * No los genera el copiloto: corre el MISMO generador que el rótulo con la
   * chispita del formulario, así el texto sale igual venga de donde venga.
   */
  formActionNames: string[];
  registerFormActions: (actions: Record<string, CopilotFormAction>) => void;
  unregisterFormActions: () => void;
  /** Corre las acciones pedidas, en orden, esperando cada una. Ignora las que no existan. */
  runFormActions: (names: string[]) => Promise<void>;
}

/** Un asistente de IA del formulario abierto (el de la chispita). */
export type CopilotFormAction = () => void | Promise<void>;

const CopilotContext = createContext<CopilotContextValue>({
  screenContext: null,
  setScreenContext: () => {},
  requestMessage: null,
  setRequestMessage: () => {},
  hasApplyFieldsCallback: false,
  registerApplyFieldsCallback: () => {},
  unregisterApplyFieldsCallback: () => {},
  applyFields: () => {},
  formActionNames: [],
  registerFormActions: () => {},
  unregisterFormActions: () => {},
  runFormActions: async () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CopilotContextProvider({ children }: { children: React.ReactNode }) {
  const [screenContext, setScreenContext] = useState<CopilotScreenContext | null>(null);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);

  // Apply-fields callback — ref holds the function, state tracks presence for reactive UI
  const applyFieldsCallbackRef = useRef<((fields: Record<string, string>) => void) | null>(null);
  const [hasApplyFieldsCallback, setHasApplyFieldsCallback] = useState(false);

  const registerApplyFieldsCallback = useCallback((fn: (fields: Record<string, string>) => void) => {
    applyFieldsCallbackRef.current = fn;
    setHasApplyFieldsCallback(true);
  }, []);

  const unregisterApplyFieldsCallback = useCallback(() => {
    applyFieldsCallbackRef.current = null;
    setHasApplyFieldsCallback(false);
  }, []);

  const applyFields = useCallback((fields: Record<string, string>) => {
    applyFieldsCallbackRef.current?.(fields);
  }, []);

  // Asistentes de IA del formulario abierto — mismo patrón que apply-fields:
  // el ref guarda las funciones, el state sólo la lista de nombres para que la
  // UI reaccione.
  const formActionsRef = useRef<Record<string, CopilotFormAction>>({});
  const [formActionNames, setFormActionNames] = useState<string[]>([]);

  const registerFormActions = useCallback((actions: Record<string, CopilotFormAction>) => {
    formActionsRef.current = actions;
    setFormActionNames(Object.keys(actions));
  }, []);

  const unregisterFormActions = useCallback(() => {
    formActionsRef.current = {};
    setFormActionNames([]);
  }, []);

  const runFormActions = useCallback(async (names: string[]) => {
    for (const name of names) {
      const fn = formActionsRef.current[name];
      if (fn) await fn();
    }
  }, []);

  return (
    <CopilotContext.Provider value={{
      screenContext, setScreenContext,
      requestMessage, setRequestMessage,
      hasApplyFieldsCallback,
      registerApplyFieldsCallback,
      unregisterApplyFieldsCallback,
      applyFields,
      formActionNames,
      registerFormActions,
      unregisterFormActions,
      runFormActions,
    }}>
      {children}
    </CopilotContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Read the current screen context and copilot triggers. Used by CopilotoPanel and action buttons. */
export function useCopilotScreenContext() {
  return useContext(CopilotContext);
}

/**
 * Register a callback so the copilot can apply field values to the active form.
 * Call this inside any editable modal/form that supports copilot field-filling.
 * The callback is automatically unregistered when the component unmounts.
 *
 * @param fn  Function that receives a Record<fieldKey, value> and applies them to the form state.
 *            Pass `null` when the form is read-only or the callback should not be active.
 */
export function useCopilotApplyFields(fn: ((fields: Record<string, string>) => void) | null) {
  const { registerApplyFieldsCallback, unregisterApplyFieldsCallback } = useContext(CopilotContext);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!fnRef.current) return;
    registerApplyFieldsCallback((fields) => { fnRef.current?.(fields); });
    return () => { unregisterApplyFieldsCallback(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn !== null]); // re-register when nullability changes
}

/**
 * Registra los asistentes de IA del formulario abierto para que el copiloto
 * pueda dispararlos (por ejemplo, recalcular LOTO cuando el usuario acepta).
 *
 * Se guarda un envoltorio que siempre llama a la versión FRESCA del handler:
 * los `useCallback` del formulario cambian de identidad en cada render y, sin
 * esto, el copiloto correría una versión vieja, con datos viejos.
 *
 * @param actions  Mapa nombre → handler, o `null` cuando el formulario es de
 *                 sólo lectura y no hay nada que disparar.
 */
export function useCopilotFormActions(actions: Record<string, CopilotFormAction> | null) {
  const { registerFormActions, unregisterFormActions } = useContext(CopilotContext);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const namesKey = actions ? Object.keys(actions).sort().join(",") : "";

  useEffect(() => {
    if (!namesKey) return;
    const wrapped: Record<string, CopilotFormAction> = {};
    for (const name of namesKey.split(",")) {
      wrapped[name] = () => actionsRef.current?.[name]?.();
    }
    registerFormActions(wrapped);
    return () => { unregisterFormActions(); };
  }, [namesKey, registerFormActions, unregisterFormActions]);
}

/**
 * El copiloto acaba de escribir algo en la base: las pantallas abiertas que
 * muestren ese dato tienen que volver a pedirlo.
 *
 * Va por evento del navegador y no por un callback registrado en el contexto a
 * propósito. El registro de asistentes (`useCopilotFormActions`) tiene UN solo
 * casillero: si una ventana se registra encima de la pantalla, la tapa. Para
 * refrescar eso no sirve — se necesita que avisen TODOS los que estén
 * escuchando, sin orden ni prioridad, y que no haya forma de que uno anule al
 * otro. Un evento hace exactamente eso y no puede quedar "desregistrado" por
 * accidente.
 */
const DATA_CHANGED_EVENT = "cms3:copilot-data-changed";

/** La dispara el panel del copiloto después de que el servidor confirmó la escritura. */
export function notifyCopilotDataChanged(): void {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}

/**
 * Vuelve a cargar los datos de la pantalla cuando el copiloto escribe algo.
 * Se puede usar en cualquier página o ventana, todas las veces que haga falta.
 */
export function useCopilotDataRefresh(reload: (() => void) | null) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    const handler = () => { reloadRef.current?.(); };
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => { window.removeEventListener(DATA_CHANGED_EVENT, handler); };
  }, []);
}

/**
 * Emit structured context from a page or modal.
 *
 * - Emits whenever ctx content changes (JSON.stringify diff, not object identity).
 * - Clears context on unmount/change ONLY IF the active context is still ours
 *   (a deeper emitter may have overwritten it — e.g. a modal mounted on top of a
 *   list page; closing the list emitter must not clobber the modal's context).
 * - Passing `null` is a no-op: it means "I have nothing to emit", it does NOT
 *   clear what another emitter already set. This matters when the page-level
 *   emitter goes null because a modal opened on top of it.
 */
export function useCopilotEmitter(ctx: CopilotScreenContext | null) {
  const { setScreenContext } = useContext(CopilotContext);

  // Use serialised content as the stable dependency to avoid re-running on
  // every render caused by new object references with identical content.
  const ctxKey = ctx === null ? "__null__" : JSON.stringify(ctx);

  useEffect(() => {
    if (ctx === null) {
      // Nothing to emit — do not touch the active context. Another emitter
      // (e.g. a modal mounted on top of this page) may have set it.
      return;
    }
    setScreenContext(ctx);
    return () => {
      // Only clear if the active context is still the one we set. If a deeper
      // emitter (modal) overwrote it, leave it alone — that emitter owns the
      // value now and will clean up on its own unmount.
      setScreenContext(prev => {
        if (prev === null) return null;
        return JSON.stringify(prev) === ctxKey ? null : prev;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);
}
