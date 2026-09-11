// Desplegable para elegir una persona del equipo: el nombre, y al lado —más
// chico y más tenue— su rol o cargo. El <select> nativo no permite dos estilos
// dentro de una misma opción, por eso es un desplegable propio.
//
// La lista se dibuja en un portal con posición fija: los modales tienen scroll
// propio y recortaban los menúes absolutos (mismo problema que el buscador de
// equipos).

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { usePersonRoleText } from "../lib/role-labels";

export interface PersonOption {
  value: string;
  name: string;
  /** Rol del sistema (TENANT_ADMIN…); se muestra traducido si no hay cargo. */
  role?: string | null;
  /** Cargo cargado en Equipo; gana sobre el rol. */
  jobTitle?: string | null;
  /** Aclaración extra, también tenue (p. ej. "sin firma"). */
  note?: string | null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: PersonOption[];
  /** Texto de la opción vacía ("Sin asignar"). Sin esto, no se ofrece opción vacía. */
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export const PersonSelect: React.FC<Props> = ({ value, onChange, options, emptyLabel, className, disabled, autoFocus }) => {
  const roleText = usePersonRoleText();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => [
      ...(emptyLabel !== undefined ? [{ value: "", name: emptyLabel, role: null, jobTitle: null, note: null } as PersonOption] : []),
      ...options,
    ],
    [options, emptyLabel],
  );
  const selected = rows.find(r => r.value === value) ?? null;

  const place = useCallback(() => {
    const b = buttonRef.current?.getBoundingClientRect();
    if (!b) return;
    const below = window.innerHeight - b.bottom - 8;
    const above = b.top - 8;
    const openAbove = below < 200 && above > below;
    setRect({
      left: b.left,
      width: b.width,
      top: openAbove ? b.top - 4 : b.bottom + 4,
      maxHeight: Math.max(160, Math.min(320, openAbove ? above : below)),
      above: openAbove,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  const openList = () => {
    if (disabled) return;
    setActive(Math.max(0, rows.findIndex(r => r.value === value)));
    setOpen(true);
  };
  const choose = (v: string) => { onChange(v); setOpen(false); buttonRef.current?.focus(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); openList(); return; }
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(rows.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(0, i - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); const r = rows[active]; if (r) choose(r.value); }
  };

  const secondary = (r: PersonOption) => [roleText(r.role, r.jobTitle), r.note].filter(Boolean).join(" · ");

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        autoFocus={autoFocus}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${className ?? ""} flex items-center gap-2 text-left`}
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="text-fg">{selected?.name ?? "—"}</span>
          {selected && secondary(selected) && (
            <span className="ml-1.5 text-[11px] text-text-industrial/50">{secondary(selected)}</span>
          )}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-text-industrial/50" />
      </button>

      {open && rect && createPortal(
        <div
          ref={listRef}
          role="listbox"
          onKeyDown={onKeyDown}
          style={{
            position: "fixed",
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
            ...(rect.above ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
          }}
          className="z-[200] overflow-y-auto rounded-xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] shadow-2xl py-1"
        >
          {rows.map((r, i) => (
            <button
              key={r.value || "__empty__"}
              type="button"
              role="option"
              aria-selected={r.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r.value)}
              className={`w-full flex items-baseline gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                i === active ? "bg-accent/15" : ""} ${r.value === value ? "font-semibold" : ""}`}
            >
              <span className="text-fg shrink-0">{r.name}</span>
              {secondary(r) && <span className="text-[11px] text-text-industrial/50 truncate">{secondary(r)}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};
