// Celdas editables de las planillas tipo Excel (Plan de Mantenimiento y Planilla
// de a bordo). Se editan en la propia grilla: el valor se guarda al salir del
// campo (blur), Enter confirma y Escape descarta.
//
// `resetKey` es el mecanismo para revertir: cuando el guardado falla, el padre
// incrementa esa clave y la celda vuelve al último valor confirmado por el
// servidor — sin esto, la pantalla mostraría un dato que no se guardó.

import React, { useEffect, useState } from "react";

export const cellCls =
  "w-full bg-transparent text-[11px] text-fg px-1.5 py-1 rounded border border-transparent " +
  "hover:border-fg/15 focus:border-accent/60 focus:bg-fg/5 focus:outline-none transition-colors";

export const NumberCell: React.FC<{
  value: number | null;
  onCommit: (v: number | null) => void;
  resetKey: number;
}> = ({ value, onCommit, resetKey }) => {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value, resetKey]);
  const commit = () => {
    const trimmed = draft.trim();
    const nv = trimmed === "" ? null : Number(trimmed);
    if (nv != null && Number.isNaN(nv)) { setDraft(value == null ? "" : String(value)); return; }
    if (nv !== (value ?? null)) onCommit(nv);
  };
  return (
    <input
      type="number"
      className={cellCls + " font-mono"}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(value == null ? "" : String(value)); e.currentTarget.blur(); }
      }}
    />
  );
};

export const DateCell: React.FC<{
  value: string | null;
  onCommit: (v: string | null) => void;
  resetKey: number;
}> = ({ value, onCommit, resetKey }) => {
  const cur = value ? value.slice(0, 10) : "";
  const [draft, setDraft] = useState(cur);
  useEffect(() => setDraft(cur), [cur, resetKey]);
  return (
    <input
      type="date"
      className={cellCls + " font-mono"}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== cur) onCommit(draft || null); }}
    />
  );
};
