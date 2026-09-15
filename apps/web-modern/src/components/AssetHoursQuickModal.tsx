// Carga rápida de horómetros desde el Dashboard.
//
// La tarjeta del Dashboard (grilla de widgets) muestra el estado de las lecturas;
// el botón de carga abre este modal con la planilla en formato de tarjetas,
// reusando <AssetHoursGrid compact>: una fila por equipo, lo que falta cargar en
// naranja y la diferencia con la última lectura a la vista mientras se tipea.
//
// La fecha se elige acá mismo (Hoy / Ayer / Otra): la guardia que carga la
// lectura al otro día. Cambiarla recarga la planilla del padre y las horas se
// imputan a ese día. Cambiar de fecha o cerrar con lecturas sin guardar pregunta
// antes: lo tipeado se perdía sin aviso.
//
// La pantalla completa (/asset-hours) sigue siendo la de siempre: otro buque,
// historial por equipo, equipos sin seguimiento y export a Excel.

import React, { useRef, useState } from "react";
import { AlertTriangle, Check, ClockAlert, Copy, Gauge, Loader2, Save, Ship } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";
import { ModalCloseButton } from "./ModalCloseButton";
import { AssetHoursGrid, type AssetHoursGridHandle, type HoursGridStats, type HoursSheet } from "./AssetHoursGrid";

interface Props {
  sheet: HoursSheet;
  readingDate: string;
  /** Cambia la fecha de la planilla (el padre recarga la hoja de ese día). */
  onDateChange: (date: string) => void;
  /** La hoja de la fecha nueva todavía está viniendo del servidor. */
  loading?: boolean;
  vesselName: string | null;
  onSaved: () => void;
  onClose: () => void;
}

const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
const shortDate = (iso: string) => iso.split("-").slice(1).reverse().join("/");

export const AssetHoursQuickModal: React.FC<Props> = ({
  sheet, readingDate, onDateChange, loading, vesselName, onSaved, onClose,
}) => {
  const t = useT();
  const navigate = useNavigate();
  const gridRef = useRef<AssetHoursGridHandle>(null);
  const [stats, setStats] = useState<HoursGridStats>({ total: sheet.rows.length, done: 0, late: 0, dirty: 0 });
  // Qué hacer cuando termine un guardado pedido desde un aviso: cerrar o cambiar de fecha.
  const afterSaveRef = useRef<{ kind: "close" } | { kind: "date"; date: string } | null>(null);
  const [ask, setAsk] = useState<{ kind: "close" } | { kind: "date"; date: string } | null>(null);

  const today = isoDay(0);
  const yesterday = isoDay(1);
  const [otherOpen, setOtherOpen] = useState(readingDate !== today && readingDate !== yesterday);

  // Link a la pantalla completa CON el buque de esta planilla: es lo que se
  // manda por chat. Sin el código, el que lo abre cae en el buque que tenga
  // elegido él, que no tiene por qué ser el mismo.
  const fullPath = `/asset-hours?vesselCode=${encodeURIComponent(sheet.vesselCode)}`;
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${fullPath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sin portapapeles: queda el botón de abrir la pantalla completa */ }
  };

  const requestClose = () => {
    if (stats.dirty > 0) { setAsk({ kind: "close" }); return; }
    onClose();
  };
  const requestDate = (date: string) => {
    if (date === readingDate) return;
    if (stats.dirty > 0) { setAsk({ kind: "date", date }); return; }
    onDateChange(date);
  };
  const applyAfterSave = (action: typeof afterSaveRef.current) => {
    if (!action) return;
    if (action.kind === "close") onClose();
    else onDateChange(action.date);
  };

  const whenLabel = readingDate === today ? t("assetHours.quick.whenToday")
    : readingDate === yesterday ? t("assetHours.quick.whenYesterday")
    : shortDate(readingDate);
  const pct = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;
  const allDone = stats.total > 0 && stats.done === stats.total;

  return (
    // El clic afuera NO cierra: se perdía lo tipeado. Se cierra con la X, que
    // pregunta si hay lecturas sin guardar.
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-fg/10 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20 shrink-0">
                <Gauge className="w-4 h-4 text-accent" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-fg">{t("assetHours.pageTitle")}</h2>
                <p className="text-xs text-text-industrial/50">{t("assetHours.quick.subtitle")}</p>
              </div>
              {/* Nombre del buque, no el código. */}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/5 px-2.5 py-1 text-[11px] text-fg">
                <Ship className="w-3 h-3" /><b className="font-bold">{vesselName ?? sheet.vesselCode}</b>
              </span>
            </div>
            <ModalCloseButton onClose={requestClose} />
          </div>

          {/* Fecha con un toque. No se permiten fechas futuras (mismo tope que la pantalla completa). */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-text-industrial/60">{t("assetHours.quick.readingOf")}</span>
            <div className="flex rounded-lg border border-fg/10 bg-fg/5 p-0.5">
              {([
                ["today", t("assetHours.quick.today").replace("{date}", shortDate(today)), () => { setOtherOpen(false); requestDate(today); }],
                ["yesterday", t("assetHours.quick.yesterday").replace("{date}", shortDate(yesterday)), () => { setOtherOpen(false); requestDate(yesterday); }],
                ["other", t("assetHours.quick.otherDate"), () => setOtherOpen(true)],
              ] as const).map(([key, label, onPick]) => {
                const on = key === "other" ? otherOpen : !otherOpen && readingDate === (key === "today" ? today : yesterday);
                return (
                  <button key={key} type="button" onClick={onPick}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${on ? "bg-surface text-fg shadow-sm" : "text-text-industrial/60 hover:text-fg"}`}>
                    {label}
                  </button>
                );
              })}
            </div>
            {otherOpen && (
              <input
                type="date"
                value={readingDate}
                max={today}
                onChange={(e) => requestDate(e.target.value || today)}
                className="bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-xs text-fg"
              />
            )}
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />}
          </div>

          <div>
            <div className="h-1.5 rounded-full bg-fg/10 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${allDone ? "bg-success-sea" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-text-industrial/60">
              <span>
                {t("assetHours.quick.progress")
                  .replace("{done}", String(stats.done)).replace("{total}", String(stats.total)).replace("{when}", whenLabel)}
              </span>
              {stats.late > 0 && (
                <span className="flex items-center gap-1 font-bold text-amber-700 dark:text-amber-400">
                  <ClockAlert className="w-3.5 h-3.5" /> {t("assetHours.quick.late").replace("{n}", String(stats.late))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Mientras viene la hoja de la fecha nueva la planilla queda bloqueada:
            si no, se editaría la lectura de un día y se guardaría contra otro. */}
        <div className={`flex-1 overflow-y-auto px-5 py-3 bg-fg/[0.015] ${loading ? "opacity-50 pointer-events-none" : ""}`}>
          <AssetHoursGrid
            ref={gridRef}
            sheet={sheet}
            readingDate={readingDate}
            compact
            onStatsChange={setStats}
            onSaved={() => {
              onSaved();
              const action = afterSaveRef.current;
              afterSaveRef.current = null;
              applyAfterSave(action);
            }}
            onSaveCancelled={() => { afterSaveRef.current = null; }}
          />
        </div>

        <div className="px-5 py-3 border-t border-fg/10 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => { void copyLink(); }}
            title={t("assetHours.copyLinkHint")}
            className={`flex items-center gap-1.5 text-[11px] font-semibold transition-colors ${
              copied ? "text-success-sea" : "text-text-industrial/60 hover:text-fg"
            }`}
          >
            {copied
              ? <><Check className="w-3.5 h-3.5" />{t("common.copied")}</>
              : <><Copy className="w-3.5 h-3.5" />{t("common.copyLink")}</>}
          </button>
          <button
            type="button"
            // Con lecturas sin guardar primero se pregunta (irse las perdería).
            onClick={() => { if (stats.dirty > 0) { setAsk({ kind: "close" }); return; } onClose(); navigate(fullPath); }}
            title={t("assetHours.openFull")}
            className="text-[11px] font-semibold text-accent hover:underline"
          >
            {t("assetHours.quick.fullScreen")}
          </button>
          <span className="flex-1" />
          {sheet.canWrite && (
            <>
              <span className={`text-xs font-bold ${stats.dirty > 0 ? "text-accent" : "text-text-industrial/40"}`}>
                {stats.dirty > 0 ? t("assetHours.pendingCount").replace("{n}", String(stats.dirty)) : t("assetHours.quick.noChanges")}
              </span>
              <button
                type="button"
                onClick={() => gridRef.current?.save()}
                disabled={stats.dirty === 0 || loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                {t("assetHours.save")}{stats.dirty > 0 ? ` (${stats.dirty})` : ""}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Lecturas sin guardar: antes de cerrar o de cambiar la fecha. */}
      {ask && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div role="alertdialog" aria-modal="true"
            className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              {t("assetHours.quick.unsavedTitle").replace("{n}", String(stats.dirty))}
            </h2>
            <p className="text-sm text-text-industrial/80">
              {ask.kind === "close" ? t("assetHours.quick.leaveBody") : t("assetHours.quick.dateBody")}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button"
                onClick={() => { const a = ask; setAsk(null); applyAfterSave(a); }}
                className="px-3.5 py-2 rounded-xl text-xs text-fg hover:bg-fg/5">
                {ask.kind === "close" ? t("assetHours.quick.leaveExit") : t("assetHours.quick.dateChange")}
              </button>
              <button type="button" autoFocus
                onClick={() => { afterSaveRef.current = ask; setAsk(null); gridRef.current?.save(); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:brightness-110">
                <Save className="w-3.5 h-3.5" />
                {ask.kind === "close" ? t("assetHours.quick.leaveSave") : t("assetHours.quick.dateSave")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
