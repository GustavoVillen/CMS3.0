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
  | "RCA"
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
  /** Related entity IDs for cross-module context. */
  relatedEntities?: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface CopilotContextValue {
  screenContext: CopilotScreenContext | null;
  setScreenContext: (ctx: CopilotScreenContext | null) => void;
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
}

const CopilotContext = createContext<CopilotContextValue>({
  screenContext: null,
  setScreenContext: () => {},
  requestMessage: null,
  setRequestMessage: () => {},
  hasApplyFieldsCallback: false,
  registerApplyFieldsCallback: () => {},
  unregisterApplyFieldsCallback: () => {},
  applyFields: () => {},
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

  return (
    <CopilotContext.Provider value={{
      screenContext, setScreenContext,
      requestMessage, setRequestMessage,
      hasApplyFieldsCallback,
      registerApplyFieldsCallback,
      unregisterApplyFieldsCallback,
      applyFields,
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
 * Emit structured context from a page or modal.
 *
 * - Emits whenever ctx content changes (JSON.stringify diff, not object identity).
 * - Clears context automatically when the emitting component unmounts.
 * - Safe to call unconditionally (pass null when no meaningful context exists).
 */
export function useCopilotEmitter(ctx: CopilotScreenContext | null) {
  const { setScreenContext } = useContext(CopilotContext);

  // Hold a ref to always call setScreenContext with the latest value even after
  // the dep-array closure has gone stale.
  const latestCtx = useRef(ctx);
  latestCtx.current = ctx;

  // Use serialised content as the stable dependency to avoid re-running on
  // every render caused by new object references with identical content.
  const ctxKey = ctx === null ? "__null__" : JSON.stringify(ctx);

  useEffect(() => {
    setScreenContext(latestCtx.current);
    // Clear context when this component unmounts (modal/page closes).
    // Also clears when ctxKey changes — immediately re-emitted by the next effect run.
    return () => { setScreenContext(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);
}
