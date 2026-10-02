// Desplegable para elegir una persona del equipo: el nombre, y al lado —más
// chico y más tenue— su rol o cargo. El <select> nativo no permite dos estilos
// dentro de una misma opción, por eso es un desplegable propio.
//
// Se puede escribir (pedido de Gustavo, 02-oct-2026): al tipear, la lista se
// filtra por nombre, rol o cargo (sin importar mayúsculas ni acentos) y con
// Enter o un clic se elige. Al salir sin elegir vuelve a mostrar lo que estaba.
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
  /** Lo que se ve cuando no hay nadie elegido. */
  placeholder?: string;
}

/** Para buscar: minúsculas y sin acentos. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const PersonSelect: React.FC<Props> = ({ value, onChange, options, emptyLabel, className, disabled, autoFocus, placeholder }) => {
  const roleText = usePersonRoleText();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Lo que se está escribiendo. null = no se está buscando (se ve el elegido).
  const [query, setQuery] = useState<string | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const secondary = useCallback(
    (r: PersonOption) => [roleText(r.role, r.jobTitle), r.note].filter(Boolean).join(" · "),
    [roleText],
  );

  const allRows = useMemo(
    () => [
      ...(emptyLabel !== undefined ? [{ value: "", name: emptyLabel, role: null, jobTitle: null, note: null } as PersonOption] : []),
      ...options,
    ],
    [options, emptyLabel],
  );
  const selected = allRows.find(r => r.value === value) ?? null;

  // Filtrado: cada palabra escrita tiene que aparecer en el nombre, rol o cargo.
  const rows = useMemo(() => {
    const q = fold((query ?? "").trim());
    if (!q) return allRows;
    const words = q.split(/\s+/);
    return allRows.filter(r => {
      if (r.value === "" && emptyLabel !== undefined) return false;
      const hay = fold(`${r.name} ${secondary(r)}`);
      return words.every(w => hay.includes(w));
    });
  }, [allRows, query, emptyLabel, secondary]);

  const place = useCallback(() => {
    const b = boxRef.current?.getBoundingClientRect();
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

  const close = useCallback(() => { setOpen(false); setQuery(null); }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (boxRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
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
  }, [open, place, close]);

  const openList = () => {
    if (disabled) return;
    setActive(Math.max(0, allRows.findIndex(r => r.value === value)));
    setOpen(true);
  };
  const choose = (v: string) => { onChange(v); close(); inputRef.current?.blur(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { e.preventDefault(); openList(); return; }
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(rows.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(0, i - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); const r = rows[active]; if (r) choose(r.value); return; }
    if (e.key === "Tab") close();
  };

  const showSecondary = query === null && selected && selected.value !== "" && secondary(selected);

  return (
    <>
      <div
        ref={boxRef}
        onClick={() => { if (!disabled) { inputRef.current?.focus(); if (!open) openList(); } }}
        className={`${className ?? ""} flex items-center gap-2 text-left ${disabled ? "opacity-60" : "cursor-text"}`}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          value={query ?? (selected && selected.value !== "" ? selected.name : "")}
          placeholder={placeholder ?? (selected?.value === "" ? selected.name : "—")}
          onFocus={e => { e.currentTarget.select(); if (!open) openList(); }}
          onChange={e => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent p-0 text-fg outline-none placeholder:text-text-industrial/40 disabled:cursor-not-allowed"
        />
        {showSecondary && (
          <span className="shrink-0 max-w-[45%] truncate text-[11px] text-text-industrial/50">{secondary(selected!)}</span>
        )}
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-text-industrial/50" />
      </div>

      {open && rect && createPortal(
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "fixed",
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
            ...(rect.above ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
          }}
          className="z-[200] overflow-y-auto rounded-xl border border-fg/10 bg-surface dark:bg-[#0D1B2A] shadow-2xl py-1"
        >
          {rows.length === 0 && (
            <p className="px-3 py-1.5 text-sm italic text-text-industrial/50">—</p>
          )}
          {rows.map((r, i) => (
            <button
              key={r.value || "__empty__"}
              type="button"
              role="option"
              aria-selected={r.value === value}
              onMouseEnter={() => setActive(i)}
              // mousedown: elige antes de que el campo pierda el foco.
              onMouseDown={e => { e.preventDefault(); choose(r.value); }}
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
