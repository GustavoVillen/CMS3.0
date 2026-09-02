// Planilla de carga de horómetros. Se usa en dos lados con el mismo componente:
//   - pantalla "Horas de Equipos" (compact=false): pack Vista Planilla completo
//     (orden por columna, ancho de columnas ajustable y persistido).
//   - tarjeta del Dashboard (compact=true): sólo equipo + última lectura + horas
//     de hoy, para cargar sin salir del tablero.
//
// Guardado POR LOTE: se editan las filas que hagan falta y un solo botón manda
// todas juntas (PUT /app/pms/asset-hours). Antes de guardar, los avisos que
// importan salen en <AlertDialog> (ventanita con OK), nunca en un recuadro al pie:
//   - horas menores a la última lectura (horómetro reemplazado o error de tipeo)
//   - salto mayor a 24 h por día transcurrido
// El usuario confirma y la lectura entra igual, con nota.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, History } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { AlertDialog } from "./AlertDialog";

export interface HoursSheetRow {
  assetId: string;
  assetCode: string;
  assetName: string;
  sfiCode: string | null;
  vesselCode: string;
  trackDailyReport: boolean;
  lastReading: { runningHours: number; readingDate: string; source: string } | null;
  daysSinceReading: number | null;
  /** Última lectura anterior a la fecha de la planilla: contra ella se calcula
   *  la diferencia de horas de la columna "Dif. horas". */
  previousReading: { runningHours: number; readingDate: string; source: string } | null;
  readingOnDate: { runningHours: number; rpm: number | null; source: string; note: string | null } | null;
}

export interface HoursSheet {
  vesselCode: string;
  readingDate: string;
  canWrite: boolean;
  rows: HoursSheetRow[];
}

/** Días sin lectura a partir de los cuales la fila se marca como atrasada. */
export const STALE_DAYS = 7;

/** Salto máximo plausible de horómetro por día calendario. */
const MAX_HOURS_PER_DAY = 24;

const COL_IDS = ["equipo", "sfi", "last", "date", "stale", "input", "delta", "rpm", "source"] as const;
type ColId = (typeof COL_IDS)[number];
const DEFAULT_WIDTHS: Record<ColId, number> = {
  equipo: 240, sfi: 70, last: 110, date: 104, stale: 96, input: 150, delta: 100, rpm: 110, source: 120,
};
const MIN_WIDTHS: Record<ColId, number> = {
  equipo: 120, sfi: 50, last: 80, date: 84, stale: 70, input: 110, delta: 80, rpm: 90, source: 80,
};
const COL_WIDTHS_LS_KEY = "assetHours.grid.colWidths";

/**
 * Los dos campos que la tripulación ESCRIBE (horas y RPM) van más grandes que
 * el resto de la grilla, a propósito: son el único dato que se carga acá, se
 * tipean muchas veces desde un celular o con la sala de máquinas encima, y un
 * dígito de más corre el vencimiento de todos los planes por horas del equipo.
 * Escrito una vez y compartido para que los dos no se separen con el tiempo.
 */
const READING_INPUT_CLS =
  "w-full bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 text-base font-mono font-semibold " +
  "text-fg text-right placeholder:font-normal placeholder:text-sm placeholder-text-industrial/30 " +
  "focus:outline-none focus:border-accent/60 disabled:opacity-50";

type SortKey = "equipo" | "sfi" | "last" | "date" | "stale";

interface Props {
  sheet: HoursSheet;
  /** Fecha a la que se imputan las horas cargadas (YYYY-MM-DD). */
  readingDate: string;
  /** Recarga la planilla del padre después de guardar. */
  onSaved: () => void;
  /** Versión reducida para el Dashboard. */
  compact?: boolean;
  /** Abre el historial de lecturas de un equipo (sólo en la pantalla completa). */
  onOpenHistory?: (row: HoursSheetRow) => void;
}

function fmtHours(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export const AssetHoursGrid: React.FC<Props> = ({
  sheet, readingDate, onSaved, compact, onOpenHistory,
}) => {
  const t = useT();
  const readOnly = !sheet.canWrite;

  // Borradores por equipo. Arrancan con lo ya cargado para esa fecha, así la
  // planilla muestra lo que hay y editar es corregir, no volver a tipear todo.
  const initialDrafts = useCallback(() => {
    const map: Record<string, string> = {};
    for (const row of sheet.rows) {
      map[row.assetId] = row.readingOnDate ? String(row.readingOnDate.runningHours) : "";
    }
    return map;
  }, [sheet.rows]);

  // El RPM es un dato aparte de la misma lectura: se edita en su propia celda y
  // viaja con las horas en el mismo guardado.
  const initialRpmDrafts = useCallback(() => {
    const map: Record<string, string> = {};
    for (const row of sheet.rows) {
      map[row.assetId] = row.readingOnDate?.rpm != null ? String(row.readingOnDate.rpm) : "";
    }
    return map;
  }, [sheet.rows]);

  const [drafts, setDrafts] = useState<Record<string, string>>(initialDrafts);
  const [rpmDrafts, setRpmDrafts] = useState<Record<string, string>>(initialRpmDrafts);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  // Confirmación pendiente: el aviso ya se mostró y el usuario decide si sigue.
  const [pending, setPending] = useState<{ message: string; note: string } | null>(null);

  // Al cambiar de buque o de fecha, los borradores se rehacen desde el servidor.
  useEffect(() => {
    setDrafts(initialDrafts());
    setRpmDrafts(initialRpmDrafts());
  }, [sheet.vesselCode, sheet.readingDate, initialDrafts, initialRpmDrafts]);

  const savedHoursOf = (row: HoursSheetRow) =>
    row.readingOnDate ? String(row.readingOnDate.runningHours) : "";
  const savedRpmOf = (row: HoursSheetRow) =>
    row.readingOnDate?.rpm != null ? String(row.readingOnDate.rpm) : "";
  /** Horas que se van a guardar para la fila: lo tipeado o, si se vació la celda,
   *  lo que ya estaba guardado para esa fecha (el RPM no puede ir solo). */
  const effectiveHoursOf = (row: HoursSheetRow) => {
    const draft = (drafts[row.assetId] ?? "").trim();
    return draft !== "" ? draft : savedHoursOf(row);
  };

  const dirtyIds = useMemo(() => {
    return sheet.rows
      .filter((row) => {
        const draft = (drafts[row.assetId] ?? "").trim();
        const hoursChanged = draft !== "" && draft !== savedHoursOf(row);
        const rpmChanged = (rpmDrafts[row.assetId] ?? "").trim() !== savedRpmOf(row);
        return hoursChanged || rpmChanged;
      })
      .map((row) => row.assetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, rpmDrafts, sheet.rows]);

  const setDraft = (assetId: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [assetId]: value }));
  const setRpmDraft = (assetId: string, value: string) =>
    setRpmDrafts((prev) => ({ ...prev, [assetId]: value }));

  /** Horas operadas desde el registro anterior. Se recalcula mientras se tipea. */
  const deltaOf = (row: HoursSheetRow): number | null => {
    if (!row.previousReading) return null;
    const raw = effectiveHoursOf(row);
    if (raw === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return value - row.previousReading.runningHours;
  };

  // ── Validación blanda: avisa, no bloquea ──────────────────────────────────
  const buildWarnings = (): { message: string; note: string } | null => {
    const back: string[] = [];
    const jump: string[] = [];
    for (const assetId of dirtyIds) {
      const row = sheet.rows.find((r) => r.assetId === assetId);
      if (!row) continue;
      const raw = effectiveHoursOf(row);
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const last = row.lastReading;
      if (!last) continue;

      if (value < last.runningHours) {
        back.push(t("assetHours.warn.backwardsItem")
          .replace("{asset}", row.assetName)
          .replace("{value}", fmtHours(value))
          .replace("{last}", fmtHours(last.runningHours))
          .replace("{date}", last.readingDate));
        continue;
      }
      const days = Math.max(
        1,
        Math.round((new Date(`${readingDate}T00:00:00Z`).getTime()
          - new Date(`${last.readingDate}T00:00:00Z`).getTime()) / 86_400_000),
      );
      if (value - last.runningHours > days * MAX_HOURS_PER_DAY) {
        jump.push(t("assetHours.warn.jumpItem")
          .replace("{asset}", row.assetName)
          .replace("{delta}", fmtHours(value - last.runningHours))
          .replace("{days}", String(days)));
      }
    }
    if (back.length === 0 && jump.length === 0) return null;

    const parts: string[] = [];
    if (back.length > 0) parts.push(`${t("assetHours.warn.backwards")}\n${back.join("\n")}`);
    if (jump.length > 0) parts.push(`${t("assetHours.warn.jump")}\n${jump.join("\n")}`);
    parts.push(t("assetHours.warn.confirm"));
    return {
      message: parts.join("\n\n"),
      note: back.length > 0 ? t("assetHours.note.backwards") : t("assetHours.note.jump"),
    };
  };

  const send = async (note: string | null) => {
    setSaving(true);
    try {
      await api.put("/app/pms/asset-hours", {
        readingDate,
        entries: dirtyIds.map((assetId) => {
          const row = sheet.rows.find((r) => r.assetId === assetId)!;
          const rpmDraft = (rpmDrafts[assetId] ?? "").trim();
          return {
            assetId,
            runningHours: Number(effectiveHoursOf(row)),
            rpm: rpmDraft === "" ? null : Number(rpmDraft),
            note,
          };
        }),
      });
      onSaved();
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("assetHours.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (dirtyIds.length === 0) { setAlert(t("assetHours.nothingToSave")); return; }
    for (const assetId of dirtyIds) {
      const row = sheet.rows.find((r) => r.assetId === assetId)!;
      const raw = effectiveHoursOf(row);
      // El RPM es un dato DE la lectura: sin horas no hay lectura donde guardarlo.
      if (raw === "") { setAlert(t("assetHours.rpmNeedsHours")); return; }
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) { setAlert(t("assetHours.invalidNumber")); return; }
      const rpmDraft = (rpmDrafts[assetId] ?? "").trim();
      if (rpmDraft !== "") {
        const rpm = Number(rpmDraft);
        if (!Number.isFinite(rpm) || rpm < 0) { setAlert(t("assetHours.invalidRpm")); return; }
      }
    }
    const warning = buildWarnings();
    if (warning) { setPending(warning); return; }
    await send(null);
  };

  // ── Orden por columna ─────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  };
  const sortVal = (row: HoursSheetRow, key: SortKey): string | number | null => {
    switch (key) {
      case "equipo": return row.assetName.toLowerCase();
      case "sfi": return row.sfiCode ?? null;
      case "last": return row.lastReading?.runningHours ?? null;
      case "date": return row.lastReading?.readingDate ?? null;
      case "stale": return row.daysSinceReading ?? null;
      default: return null;
    }
  };
  const sortedRows = useMemo(() => {
    if (!sortKey) return sheet.rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...sheet.rows].sort((a, b) => {
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // vacíos al final, sin importar la dirección
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [sheet.rows, sortKey, sortDir]);

  // ── Ancho de columnas ajustable (drag) + persistencia ─────────────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    let saved: Record<string, number> = {};
    try { saved = JSON.parse(localStorage.getItem(COL_WIDTHS_LS_KEY) || "{}"); } catch { /* ignore */ }
    return { ...DEFAULT_WIDTHS, ...saved };
  });
  const resizing = useRef<{ id: ColId; startX: number; startW: number } | null>(null);
  const startResize = (id: ColId) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { id, startX: e.clientX, startW: colWidths[id] ?? DEFAULT_WIDTHS[id] };
    const onMove = (ev: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      const w = Math.max(MIN_WIDTHS[r.id], r.startW + (ev.clientX - r.startX));
      setColWidths((prev) => ({ ...prev, [r.id]: w }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      resizing.current = null;
      document.body.style.cursor = "";
      setColWidths((prev) => {
        try { localStorage.setItem(COL_WIDTHS_LS_KEY, JSON.stringify(prev)); } catch { /* ignore */ }
        return prev;
      });
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const visibleCols: ColId[] = compact
    ? ["equipo", "last", "date", "input"]
    : [...COL_IDS];
  const widthOf = (id: ColId) => colWidths[id] ?? DEFAULT_WIDTHS[id];
  const tableWidth = visibleCols.reduce((s, id) => s + widthOf(id), 0);

  const th = "px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-industrial/50 whitespace-nowrap";
  const renderHeader = (id: ColId, label: string, key?: SortKey) => {
    const active = key != null && sortKey === key;
    return (
      <th key={id} className={`${th} relative`}>
        {key && !compact ? (
          <button
            type="button"
            onClick={() => toggleSort(key)}
            className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg transition-colors select-none max-w-full overflow-hidden"
          >
            <span className="truncate">{label}</span>
            <span className={active ? "text-accent" : "opacity-40"}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
          </button>
        ) : (
          <span className="truncate block">{label}</span>
        )}
        {!compact && (
          <div
            onMouseDown={startResize(id)}
            onClick={(e) => e.stopPropagation()}
            title={t("assetHours.resizeHint")}
            className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none hover:bg-accent/40 active:bg-accent/60"
          />
        )}
      </th>
    );
  };

  const sourceLabel = (source: string): string => {
    if (source === "MANUAL") return t("assetHours.source.manual");
    if (source === "VOYAGE_TANK_REPORT") return t("assetHours.source.voyage");
    if (source === "DAILY_REPORT") return t("assetHours.source.daily");
    return source;
  };

  const headerFor = (id: ColId) => {
    switch (id) {
      case "equipo": return renderHeader(id, t("assetHours.col.asset"), "equipo");
      case "sfi": return renderHeader(id, t("assetHours.col.sfi"), "sfi");
      case "last": return renderHeader(id, t("assetHours.col.lastReading"), "last");
      case "date": return renderHeader(id, t("assetHours.col.readingDate"), "date");
      case "stale": return renderHeader(id, t("assetHours.col.daysSince"), "stale");
      case "input": return renderHeader(id, t("assetHours.col.hoursOnDate"));
      case "delta": return renderHeader(id, t("assetHours.col.deltaHours"));
      case "rpm": return renderHeader(id, t("assetHours.col.rpm"));
      case "source": return renderHeader(id, t("assetHours.col.source"));
      default: return null;
    }
  };

  return (
    <div className="space-y-2">
      {!compact && (
        <p className="text-[11px] text-text-industrial/50 px-1">
          {readOnly ? t("assetHours.readonlyHint") : t("assetHours.editHint")}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-fg/10">
        <table className="border-collapse text-fg table-fixed" style={{ width: compact ? "100%" : tableWidth }}>
          {!compact && (
            <colgroup>
              {visibleCols.map((id) => <col key={id} style={{ width: widthOf(id) }} />)}
            </colgroup>
          )}
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-fg/10">
              {visibleCols.map((id) => headerFor(id))}
            </tr>
          </thead>
          <tbody className="divide-y divide-fg/5">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="px-4 py-8 text-center text-xs text-text-industrial/40">
                  {t("assetHours.empty")}
                </td>
              </tr>
            )}
            {sortedRows.map((row) => {
              const stale = row.daysSinceReading == null || row.daysSinceReading > STALE_DAYS;
              const isDirty = dirtyIds.includes(row.assetId);
              return (
                <tr
                  key={row.assetId}
                  className={`hover:bg-fg/3 transition-colors ${isDirty ? "bg-accent/5" : ""}`}
                >
                  {visibleCols.includes("equipo") && (
                    <td className="px-2 py-1.5 text-[11px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-medium" title={`${row.assetCode} — ${row.assetName}`}>
                          {row.assetName}
                        </span>
                        {onOpenHistory && !compact && (
                          <button
                            type="button"
                            onClick={() => onOpenHistory(row)}
                            title={t("assetHours.history")}
                            className="shrink-0 p-0.5 rounded text-text-industrial/40 hover:text-accent hover:bg-fg/5 transition-colors"
                          >
                            <History className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                  {visibleCols.includes("sfi") && (
                    <td className="px-2 py-1.5 text-[11px] font-mono text-text-industrial/60">{row.sfiCode ?? "—"}</td>
                  )}
                  {visibleCols.includes("last") && (
                    <td className="px-2 py-1.5 text-[11px] font-mono text-right">
                      {row.lastReading ? `${fmtHours(row.lastReading.runningHours)} h` : "—"}
                    </td>
                  )}
                  {visibleCols.includes("date") && (
                    <td className="px-2 py-1.5 text-[11px] text-text-industrial/60">
                      {row.lastReading?.readingDate ?? "—"}
                    </td>
                  )}
                  {visibleCols.includes("stale") && (
                    <td className="px-2 py-1.5 text-[11px]">
                      {row.daysSinceReading == null ? (
                        <span className="text-amber-500 font-semibold">{t("assetHours.never")}</span>
                      ) : (
                        <span className={stale ? "text-amber-500 font-semibold" : "text-text-industrial/60"}>
                          {row.daysSinceReading}
                        </span>
                      )}
                    </td>
                  )}
                  {visibleCols.includes("input") && (
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        disabled={readOnly || saving}
                        value={drafts[row.assetId] ?? ""}
                        onChange={(e) => setDraft(row.assetId, e.target.value)}
                        placeholder={row.lastReading ? fmtHours(row.lastReading.runningHours) : "0"}
                        className={READING_INPUT_CLS}
                      />
                    </td>
                  )}
                  {visibleCols.includes("delta") && (() => {
                    const delta = deltaOf(row);
                    const prev = row.previousReading;
                    return (
                      <td
                        className="px-2 py-1.5 text-[11px] font-mono text-right"
                        title={prev
                          ? t("assetHours.deltaHint")
                              .replace("{last}", fmtHours(prev.runningHours))
                              .replace("{date}", prev.readingDate)
                          : t("assetHours.deltaNone")}
                      >
                        {delta == null ? (
                          <span className="text-text-industrial/40">—</span>
                        ) : (
                          <span className={delta < 0 ? "text-amber-500 font-semibold" : "text-text-industrial/70"}>
                            {delta > 0 ? "+" : ""}{fmtHours(delta)} h
                          </span>
                        )}
                      </td>
                    );
                  })()}
                  {visibleCols.includes("rpm") && (
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step="any"
                        disabled={readOnly || saving}
                        value={rpmDrafts[row.assetId] ?? ""}
                        onChange={(e) => setRpmDraft(row.assetId, e.target.value)}
                        placeholder={t("assetHours.rpmPlaceholder")}
                        className={READING_INPUT_CLS}
                      />
                    </td>
                  )}
                  {visibleCols.includes("source") && (
                    <td className="px-2 py-1.5 text-[10px] text-text-industrial/50">
                      {row.readingOnDate
                        ? sourceLabel(row.readingOnDate.source)
                        : row.lastReading ? sourceLabel(row.lastReading.source) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-text-industrial/50">
            {dirtyIds.length > 0
              ? t("assetHours.pendingCount").replace("{n}", String(dirtyIds.length))
              : t("assetHours.noPending")}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={saving || dirtyIds.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {t("assetHours.save")}
          </button>
        </div>
      )}

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}

      {pending && (
        <ConfirmDialog
          message={pending.message}
          confirmLabel={t("assetHours.saveAnyway")}
          cancelLabel={t("common.cancel")}
          onCancel={() => setPending(null)}
          onConfirm={() => { const note = pending.note; setPending(null); void send(note); }}
        />
      )}
    </div>
  );
};

/** Aviso con dos salidas: seguir o cancelar. Mismo formato visual que AlertDialog. */
const ConfirmDialog: React.FC<{
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ message, confirmLabel, cancelLabel, onConfirm, onCancel }) => {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-fg">{t("common.attention")}</h2>
        <p className="text-sm text-text-industrial/80 leading-relaxed whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-fg/5 border border-fg/10 text-sm font-semibold text-fg hover:bg-fg/10 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl bg-accent text-accent-fg text-sm font-bold hover:bg-accent/80 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
