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

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, History, Loader2, PartyPopper, Pencil, Save, Search } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { AlertDialog } from "./AlertDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { useColumnFilters, ColumnFilterEmpty, type ColumnFilterSpec } from "./ColumnFilter";

export interface HoursSheetRow {
  assetId: string;
  assetCode: string;
  assetName: string;
  sfiCode: string | null;
  vesselCode: string;
  trackDailyReport: boolean;
  lastReading: { id: string; runningHours: number; readingDate: string; source: string } | null;
  daysSinceReading: number | null;
  /** Última lectura anterior a la fecha de la planilla: contra ella se calcula
   *  la diferencia de horas de la columna "Dif. horas". */
  previousReading: { id: string; runningHours: number; readingDate: string; source: string } | null;
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
  equipo: 240, sfi: 70, last: 110, date: 132, stale: 96, input: 150, delta: 100, rpm: 110, source: 120,
};
const MIN_WIDTHS: Record<ColId, number> = {
  equipo: 120, sfi: 50, last: 80, date: 120, stale: 70, input: 110, delta: 80, rpm: 90, source: 80,
};
// v2: la columna de fecha pasó a llevar un campo editable y necesita más ancho;
// los anchos guardados de la versión anterior la dejaban cortada.
const COL_WIDTHS_LS_KEY = "assetHours.grid.colWidths.v2";

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

/** Resumen de la planilla para el encabezado de la ventana rápida. */
export interface HoursGridStats { total: number; done: number; late: number; dirty: number }

/** Lo que la ventana rápida le puede pedir a la planilla (su botón Guardar). */
export interface AssetHoursGridHandle { save: () => void }

interface Props {
  sheet: HoursSheet;
  /** Fecha a la que se imputan las horas cargadas (YYYY-MM-DD). */
  readingDate: string;
  /** Recarga la planilla del padre después de guardar. `count` = lecturas guardadas. */
  onSaved: (count?: number) => void;
  /** Versión de tarjetas para la ventana rápida del Dashboard (guardar lo pone el padre). */
  compact?: boolean;
  /** Abre el historial de lecturas de un equipo (sólo en la pantalla completa). */
  onOpenHistory?: (row: HoursSheetRow) => void;
  /** Vista de tarjetas: avisa cuántos faltan, cuántos atrasados y cuántos sin guardar. */
  onStatsChange?: (stats: HoursGridStats) => void;
  /** El guardado pedido no se hizo (aviso cancelado, dato inválido o error). */
  onSaveCancelled?: () => void;
}

function fmtHours(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export const AssetHoursGrid = forwardRef<AssetHoursGridHandle, Props>(({
  sheet, readingDate, onSaved, compact, onOpenHistory, onStatsChange, onSaveCancelled,
}, ref) => {
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

  // Los borradores se sembraban UNA sola vez, al abrir la planilla. Cuando la
  // planilla se recarga —el copiloto registró una lectura, otro guardado, un
  // cambio de fecha— la celda seguía mostrando el valor viejo y parecía que no
  // había pasado nada.
  //
  // Se repone SÓLO la celda que el usuario no tocó: si sigue igual a lo que
  // trajo el servidor la vez anterior, se actualiza; si la está tipeando, se la
  // deja en paz. Mismo criterio que Observaciones en la OT.
  const lastServerDraftsRef = useRef<Record<string, string>>({});
  const lastServerRpmRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const server = initialDrafts();
    const serverRpm = initialRpmDrafts();
    const reponer = (
      prev: Record<string, string>,
      fresco: Record<string, string>,
      anterior: Record<string, string>,
    ) => {
      const next = { ...prev };
      for (const [assetId, value] of Object.entries(fresco)) {
        const sinTocar = next[assetId] === undefined || next[assetId] === (anterior[assetId] ?? "");
        if (sinTocar) next[assetId] = value;
      }
      return next;
    };
    setDrafts(prev => reponer(prev, server, lastServerDraftsRef.current));
    setRpmDrafts(prev => reponer(prev, serverRpm, lastServerRpmRef.current));
    lastServerDraftsRef.current = server;
    lastServerRpmRef.current = serverRpm;
  }, [initialDrafts, initialRpmDrafts]);
  // Corregir la FECHA de una lectura ya cargada no es cargar horas: es reescribir
  // el historial del que dependen los planes por horas. Lo pueden el
  // administrador, el superintendente técnico y el capitán / jefe de máquinas
  // (mismos tres roles que valida el backend en ensureCanEditHoursReadings).
  const { user } = useAuth();
  const canEditReadings = !!user
    && ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"].includes(user.role);
  const [savingDateId, setSavingDateId] = useState<string | null>(null);
  const changeReadingDate = useCallback(async (row: HoursSheetRow, date: string) => {
    const reading = row.lastReading;
    if (!reading || !date || date === reading.readingDate) return;
    setSavingDateId(reading.id);
    try {
      const res = await api.patch<{ overwrote: boolean }>(
        `/app/pms/asset-hours/readings/${encodeURIComponent(reading.id)}`,
        { readingDate: date },
      );
      // Si la fecha destino ya tenía lectura de ese equipo, se pisó: hay que
      // decirlo, porque se perdió un registro.
      if (res.overwrote) {
        setAlert(t("assetHours.dateOverwrote")
          .replace("{asset}", row.assetName)
          .replace("{date}", date));
      }
      onSaved();
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("assetHours.saveFailed"));
    } finally {
      setSavingDateId(null);
    }
  }, [onSaved, t]);
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
      if (compact) {
        setSavedMsg(t("assetHours.quick.saved").replace("{n}", String(dirtyIds.length)));
        window.setTimeout(() => setSavedMsg(null), 2500);
      }
      onSaved(dirtyIds.length);
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("assetHours.saveFailed"));
      onSaveCancelled?.();
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    // Cualquier salida sin guardar le avisa al padre (p. ej. "Guardar y salir").
    const stop = (message: string) => { setAlert(message); onSaveCancelled?.(); };
    if (dirtyIds.length === 0) { stop(t("assetHours.nothingToSave")); return; }
    for (const assetId of dirtyIds) {
      const row = sheet.rows.find((r) => r.assetId === assetId)!;
      const raw = effectiveHoursOf(row);
      // El RPM es un dato DE la lectura: sin horas no hay lectura donde guardarlo.
      if (raw === "") { stop(t("assetHours.rpmNeedsHours")); return; }
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) { stop(t("assetHours.invalidNumber")); return; }
      const rpmDraft = (rpmDrafts[assetId] ?? "").trim();
      if (rpmDraft !== "") {
        const rpm = Number(rpmDraft);
        if (!Number.isFinite(rpm) || rpm < 0) { stop(t("assetHours.invalidRpm")); return; }
      }
    }
    const warning = buildWarnings();
    if (warning) { setPending(warning); return; }
    await send(null);
  };

  useImperativeHandle(ref, () => ({ save: () => { void save(); } }));

  /** "hoy", "ayer" o la fecha: con qué palabra se nombra el día de la planilla. */
  const whenLabel = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (readingDate === today) return t("assetHours.quick.whenToday");
    if (readingDate === yesterday) return t("assetHours.quick.whenYesterday");
    return readingDate.split("-").reverse().join("/");
  })();

  // ── Vista de tarjetas (ventana rápida del Tablero) ────────────────────────
  // Una fila compacta por equipo, pensada para cargar desde el celular: qué
  // falta cargar (naranja), qué ya está (verde), qué se tipeó y no se guardó
  // (celeste) y qué número parece mal (rojo), con la diferencia a la vista
  // mientras se escribe. Pedido del usuario, sep 2026 (preview V11).
  const [filter, setFilter] = useState<"pending" | "done" | "all">("pending");
  const [query, setQuery] = useState("");
  const [rpmOpen, setRpmOpen] = useState<Record<string, boolean>>({});
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const dayDiff = (from: string, to: string) =>
    Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
  const isLate = (row: HoursSheetRow) => row.daysSinceReading == null || row.daysSinceReading > STALE_DAYS;
  /** El número tipeado no cierra: menor a la última o salto mayor a 24 h por día. */
  const rowWarning = (row: HoursSheetRow): "back" | "jump" | null => {
    const delta = deltaOf(row);
    if (delta == null || !row.previousReading) return null;
    if (delta < 0) return "back";
    const days = Math.max(1, dayDiff(row.previousReading.readingDate, readingDate));
    return delta > days * MAX_HOURS_PER_DAY ? "jump" : null;
  };

  const stats = useMemo(() => ({
    total: sheet.rows.length,
    done: sheet.rows.filter(r => r.readingOnDate || dirtyIds.includes(r.assetId)).length,
    late: sheet.rows.filter(isLate).length,
    dirty: dirtyIds.length,
  }), [sheet.rows, dirtyIds]);
  useEffect(() => { onStatsChange?.(stats); }, [stats, onStatsChange]);

  const cardRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sheet.rows
      .filter(r => filter === "all" || (filter === "done" ? !!r.readingOnDate : !r.readingOnDate))
      .filter(r => !q || `${r.assetName} ${r.assetCode}`.toLowerCase().includes(q));
  }, [sheet.rows, filter, query]);

  const pill = (cls: string, text: React.ReactNode) => (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide ${cls}`}>{text}</span>
  );

  const cardsView = (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          ["pending", t("assetHours.quick.filterPending"), sheet.rows.filter(r => !r.readingOnDate).length],
          ["done", t("assetHours.quick.filterDone"), sheet.rows.filter(r => r.readingOnDate).length],
          ["all", t("assetHours.quick.filterAll"), sheet.rows.length],
        ] as const).map(([key, label, count]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-colors ${
              filter === key ? "border-accent bg-accent/5 text-accent" : "border-fg/10 bg-surface text-text-industrial/60 hover:text-fg"
            }`}>
            {label}
            <span className={`rounded-full px-1.5 text-[11px] ${key === "pending" && count > 0 ? "bg-amber-600 text-white" : "bg-fg/10"}`}>{count}</span>
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-48">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-text-industrial/40" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("assetHours.quick.search")}
            className="w-full rounded-full border border-fg/10 bg-surface pl-8 pr-3 py-1.5 text-xs text-fg focus:outline-none focus:border-accent/50" />
        </div>
      </div>

      {sheet.rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-text-industrial/40">{t("assetHours.empty")}</p>
      ) : cardRows.length === 0 ? (
        <div className="py-8 text-center text-sm text-text-industrial/60">
          {filter === "pending" && !query
            ? <><PartyPopper className="w-7 h-7 mx-auto mb-1 text-success-sea" /><b>{t("assetHours.quick.allDone").replace("{when}", whenLabel)}</b></>
            : t("common.noResults")}
        </div>
      ) : (
        <div className="space-y-1.5">
          {cardRows.map(row => {
            const dirty = dirtyIds.includes(row.assetId);
            const loaded = !!row.readingOnDate;
            const warning = dirty ? rowWarning(row) : null;
            const delta = deltaOf(row);
            const prev = row.previousReading;
            const tone = warning ? "border-l-red-600 bg-red-50 dark:bg-red-500/10"
              : dirty ? "border-l-accent bg-accent/5"
              : loaded ? "border-l-success-sea bg-surface"
              : "border-l-amber-500 bg-amber-50 dark:bg-amber-500/10";
            const prevDays = prev ? dayDiff(prev.readingDate, readingDate) : null;
            const showRpm = rpmOpen[row.assetId] || (rpmDrafts[row.assetId] ?? "") !== "";
            return (
              <div key={row.assetId}
                className={`grid grid-cols-1 sm:grid-cols-[1fr_15.5rem] items-center gap-1 sm:gap-2.5 rounded-xl border border-fg/10 border-l-4 px-2.5 py-1.5 ${tone}`}>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-fg" title={`${row.assetCode} — ${row.assetName}`}>
                    {row.assetName}
                    <span className="ml-1.5 font-mono text-[11px] font-normal text-text-industrial/40">{row.assetCode}</span>
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-industrial/60">
                    {loaded && !dirty
                      ? pill("bg-success-sea/15 text-success-sea", <><Check className="w-2.5 h-2.5" />{t("assetHours.quick.statusDone")}</>)
                      : dirty
                        ? pill("bg-accent/15 text-accent", t("assetHours.quick.statusDirty"))
                        : pill("bg-amber-600 text-white", <><Pencil className="w-2.5 h-2.5" />{t("assetHours.quick.statusPending")}</>)}
                    {row.daysSinceReading == null
                      ? pill("bg-red-700 text-white", t("assetHours.never"))
                      : isLate(row) && pill("bg-amber-600 text-white", t("assetHours.quick.lateDays").replace("{n}", String(row.daysSinceReading)))}
                    <span>
                      {t("assetHours.quick.last")} <b className="text-fg">{prev ? `${fmtHours(prev.runningHours)} h` : "—"}</b>
                      {prevDays != null && ` · ${prevDays <= 0 ? t("assetHours.quick.agoToday")
                        : prevDays === 1 ? t("assetHours.quick.agoYesterday")
                        : t("assetHours.quick.agoDays").replace("{n}", String(prevDays))}`}
                    </span>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      disabled={readOnly || saving}
                      value={drafts[row.assetId] ?? ""}
                      onChange={(e) => setDraft(row.assetId, e.target.value)}
                      placeholder={prev
                        ? t("assetHours.quick.example").replace("{n}", fmtHours(prev.runningHours + 8))
                        : t("assetHours.quick.hoursPh")}
                      className={`w-full rounded-lg border-[1.5px] bg-surface pl-2.5 pr-7 py-1 text-right font-mono text-base font-bold text-fg placeholder:font-normal placeholder:text-sm placeholder-text-industrial/30 focus:outline-none focus:border-accent disabled:opacity-50 ${
                        warning ? "border-red-500" : !loaded && !dirty ? "border-amber-500" : "border-fg/20"
                      }`}
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1.5 text-xs font-bold text-text-industrial/40">h</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={`min-w-0 flex-1 truncate text-[11px] font-bold ${
                      warning ? "text-red-700 dark:text-red-400" : delta != null ? "text-success-sea" : "font-normal text-text-industrial/40"
                    }`}>
                      {delta == null
                        ? (prev ? " " : t("assetHours.quick.first"))
                        : warning === "back"
                          ? t("assetHours.quick.deltaBack").replace("{n}", fmtHours(delta))
                          : warning === "jump"
                            ? t("assetHours.quick.deltaJump").replace("{n}", fmtHours(delta)).replace("{d}", String(Math.max(1, prevDays ?? 1)))
                            : t("assetHours.quick.deltaOk").replace("{n}", fmtHours(delta))}
                    </span>
                    {showRpm ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step="any"
                        disabled={readOnly || saving}
                        value={rpmDrafts[row.assetId] ?? ""}
                        onChange={(e) => setRpmDraft(row.assetId, e.target.value)}
                        placeholder={t("assetHours.rpmPlaceholder")}
                        className="w-20 shrink-0 rounded-md border border-fg/20 bg-surface px-1.5 py-0.5 text-right font-mono text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-50"
                      />
                    ) : !readOnly && (
                      <button type="button" onClick={() => setRpmOpen(prev => ({ ...prev, [row.assetId]: true }))}
                        className="shrink-0 text-[10px] font-bold text-accent hover:underline">
                        {t("assetHours.quick.addRpm")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {savedMsg && (
        <p className="flex items-center justify-center gap-1.5 rounded-xl bg-success-sea/10 px-3 py-2 text-xs font-bold text-success-sea" aria-live="polite">
          <CheckCircle2 className="w-4 h-4" /> {savedMsg}
        </p>
      )}
    </div>
  );

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
  const sourceLabel = useCallback((source: string): string => {
    if (source === "MANUAL") return t("assetHours.source.manual");
    if (source === "VOYAGE_TANK_REPORT") return t("assetHours.source.voyage");
    if (source === "DAILY_REPORT") return t("assetHours.source.daily");
    return source;
  }, [t]);

  // ── Filtro por columna (embudo del encabezado) ────────────────────────────
  // Sólo el grupo SFI y el origen del dato: el equipo es uno por fila y las
  // horas y fechas son números distintos en cada una, así que ahí no filtra nada.
  const filterSpecs = useMemo<ColumnFilterSpec<HoursSheetRow>[]>(() => [
    { key: "sfi", label: t("assetHours.col.sfi"), value: r => r.sfiCode ?? "" },
    { key: "source", label: t("assetHours.col.source"), value: r => r.lastReading ? sourceLabel(r.lastReading.source) : "" },
  ], [t, sourceLabel]);
  const colFilters = useColumnFilters(sheet.rows, filterSpecs, {
    key: sortKey,
    dir: sortDir,
    onSort: (key, dir) => { setSortKey(key as SortKey); setSortDir(dir); },
  });

  const sortedRows = useMemo(() => {
    if (!sortKey) return colFilters.rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...colFilters.rows].sort((a, b) => {
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // vacíos al final, sin importar la dirección
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [colFilters.rows, sortKey, sortDir]);

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
    // El embudo sólo en escritorio: en compacto la planilla se ve como tarjetas.
    const filterCol = !compact && (id === "sfi" || id === "source") ? id : null;
    return (
      <th key={id} className={`${th} relative`}>
        <div className="flex items-center gap-1 min-w-0">
        {key && !compact ? (
          <button
            type="button"
            onClick={() => toggleSort(key)}
            className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg transition-colors select-none min-w-0 flex-1 overflow-hidden"
          >
            <span className="truncate">{label}</span>
            <span className={active ? "text-accent" : "opacity-40"}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
          </button>
        ) : (
          <span className="truncate block flex-1 min-w-0">{label}</span>
        )}
        {filterCol && colFilters.funnel(filterCol)}
        </div>
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

  if (compact) {
    return (
      <>
        {cardsView}
        {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
        {pending && (
          <ConfirmDialog
            message={pending.message}
            confirmLabel={t("assetHours.saveAnyway")}
            cancelLabel={t("common.cancel")}
            onCancel={() => { setPending(null); onSaveCancelled?.(); }}
            onConfirm={() => { const note = pending.note; setPending(null); void send(note); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-2">
      {!compact && (
        <p className="text-[11px] text-text-industrial/50 px-1">
          {readOnly ? t("assetHours.readonlyHint") : t("assetHours.editHint")}
        </p>
      )}

      {colFilters.bar}

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
                  {colFilters.anyActive
                    ? <ColumnFilterEmpty onClear={colFilters.clearAll} />
                    : t("assetHours.empty")}
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
                      {/* Corregir la fecha de una lectura ya cargada reescribe
                          historial (de ahí salen los planes por horas), así que
                          es sólo del administrador; el backend lo revalida. */}
                      {canEditReadings && row.lastReading ? (
                        <input
                          type="date"
                          value={row.lastReading.readingDate}
                          disabled={savingDateId === row.lastReading.id}
                          onChange={e => { void changeReadingDate(row, e.target.value); }}
                          title={t("assetHours.editDateHint")}
                          className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-[11px] font-mono text-fg hover:border-fg/20 focus:border-accent/60 focus:outline-none disabled:opacity-40"
                        />
                      ) : (row.lastReading?.readingDate ?? "—")}
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
      {colFilters.overlay}

      {pending && (
        <ConfirmDialog
          message={pending.message}
          confirmLabel={t("assetHours.saveAnyway")}
          cancelLabel={t("common.cancel")}
          onCancel={() => { setPending(null); onSaveCancelled?.(); }}
          onConfirm={() => { const note = pending.note; setPending(null); void send(note); }}
        />
      )}
    </div>
  );
});
AssetHoursGrid.displayName = "AssetHoursGrid";
