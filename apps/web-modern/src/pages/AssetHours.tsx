// Pantalla "Horas de Equipos" — carga de horómetros por buque y fecha.
//
// Por qué existe: las "horas actuales" de cada equipo salen de las lecturas de
// horómetro (ver apps/api/src/tenant/asset-hours). Los planes por horas vencen
// contra ese número, así que si nadie carga lecturas el plan nunca vence. Antes la
// única vía era el Reporte Diario, que está dormante; hoy el M2 las carga solo, y
// esta pantalla cubre el resto: corregir una lectura, equipos que no son motores y
// buques que no usan el M2.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Copy, Gauge, Loader2, Plus, Trash2, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { AssetHoursGrid, STALE_DAYS, type HoursSheet, type HoursSheetRow } from "../components/AssetHoursGrid";
import { useVesselContext } from "../lib/vessel-context";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

interface HistoryEntry {
  id: string;
  readingDate: string;
  runningHours: number;
  rpm: number | null;
  source: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const AssetHoursPage: React.FC = () => {
  const t = useT();
  const { vessels, selectedVesselCode, setSelectedVesselCode } = useVesselContext();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [vesselCode, setVesselCode] = useState(selectedVesselCode ?? vessels[0]?.code ?? "");
  const [readingDate, setReadingDate] = useState(todayIso());
  const [includeUntracked, setIncludeUntracked] = useState(false);

  const [sheet, setSheet] = useState<HoursSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ row: HoursSheetRow; entries: HistoryEntry[] } | null>(null);

  // El buque del selector propio sigue al del contexto global (mismo patrón que
  // Horas de Descanso), para que cambiar de buque arriba cambie la planilla.
  useEffect(() => {
    if (selectedVesselCode && selectedVesselCode !== vesselCode) setVesselCode(selectedVesselCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVesselCode]);

  useEffect(() => {
    if (!vesselCode && vessels.length > 0) setVesselCode(vessels[0]!.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vessels]);

  // ── Link compartible ──────────────────────────────────────────────────────
  // La pantalla se comparte pegando la URL: `?vesselCode=` manda sobre el buque
  // que tenga elegido quien abre el link, así llega a la planilla del buque que
  // el que compartió estaba mirando. Se aplica UNA sola vez y recién cuando se
  // sabe qué buques ve el usuario: un buque fuera de su alcance se ignora (el
  // contexto ya sanea el selector global contra su lista real).
  const [urlApplied, setUrlApplied] = useState(false);
  useEffect(() => {
    if (urlApplied || vessels.length === 0) return;
    setUrlApplied(true);
    const fromUrl = searchParams.get("vesselCode")?.toUpperCase();
    if (!fromUrl || !vessels.some(v => v.code === fromUrl)) return;
    setVesselCode(fromUrl);
    setSelectedVesselCode(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vessels, urlApplied]);

  // …y de ahí en más la URL sigue al selector, para que lo que se copia de la
  // barra de direcciones sea siempre lo que se está viendo. `replace` para no
  // llenar el historial del navegador con un paso por cada cambio de buque.
  useEffect(() => {
    if (!urlApplied || !vesselCode) return;
    if (searchParams.get("vesselCode") === vesselCode) return;
    const next = new URLSearchParams(searchParams);
    next.set("vesselCode", vesselCode);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlApplied, vesselCode]);

  // useT() devuelve una función NUEVA en cada render, así que no puede ir en las
  // dependencias de `reload`: con `useEffect(..., [reload])` cada carga provocaba
  // otra carga (bucle infinito de requests y spinner eterno). Se accede por ref.
  const tRef = useRef(t);
  tRef.current = t;

  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Navegador sin permiso de portapapeles: la URL ya es la correcta, se
      // copia a mano desde la barra de direcciones.
      setError(tRef.current("assetHours.copyLinkFailed"));
    }
  }, []);

  const reload = useCallback(async () => {
    if (!vesselCode) { setSheet(null); return; }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ vesselCode, date: readingDate });
      if (includeUntracked) qs.set("includeUntracked", "true");
      setSheet(await api.get<HoursSheet>(`/app/pms/asset-hours?${qs.toString()}`));
    } catch (err) {
      setSheet(null);
      setError(err instanceof ApiError ? err.message : tRef.current("assetHours.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [vesselCode, readingDate, includeUntracked]);

  useEffect(() => { void reload(); }, [reload]);

  const openHistory = async (row: HoursSheetRow) => {
    try {
      const res = await api.get<{ entries: HistoryEntry[] }>(
        `/app/pms/asset-hours/${row.assetId}/history`,
      );
      setHistory({ row, entries: res.entries ?? [] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("assetHours.loadFailed"));
    }
  };

  // ── Corregir o borrar una lectura del historial ───────────────────────────
  // Es reescribir el historial del que salen los planes por horas. Corregirla la
  // pueden el administrador, el superintendente técnico y el capitán / jefe de
  // máquinas; BORRARLA sólo el administrador, porque ahí la lectura se va de
  // verdad. Los dos criterios son los mismos que valida el backend. Después de
  // cada cambio se recargan las dos cosas: el historial abierto y la planilla (la
  // última lectura del equipo pudo cambiar).
  const canEditReadings = !!user
    && ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"].includes(user.role);
  const canDeleteReadings = user?.role === "TENANT_ADMIN";
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refreshAfterEdit = useCallback(async (row: HoursSheetRow) => {
    await reload();
    try {
      const res = await api.get<{ entries: HistoryEntry[] }>(
        `/app/pms/asset-hours/${row.assetId}/history`,
      );
      setHistory({ row, entries: res.entries ?? [] });
    } catch { /* el historial se puede reabrir; la planilla ya está al día */ }
  }, [reload]);

  const patchEntry = useCallback(async (
    row: HoursSheetRow,
    entryId: string,
    patch: { readingDate?: string; runningHours?: number },
  ) => {
    setBusyEntryId(entryId);
    try {
      const res = await api.patch<{ overwrote: boolean }>(
        `/app/pms/asset-hours/readings/${encodeURIComponent(entryId)}`, patch,
      );
      if (res.overwrote && patch.readingDate) {
        setError(tRef.current("assetHours.dateOverwrote")
          .replace("{asset}", row.assetName)
          .replace("{date}", patch.readingDate));
      }
      await refreshAfterEdit(row);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tRef.current("assetHours.saveFailed"));
    } finally {
      setBusyEntryId(null);
    }
  }, [refreshAfterEdit]);

  const deleteEntry = useCallback(async (row: HoursSheetRow, entryId: string) => {
    setBusyEntryId(entryId);
    setConfirmDeleteId(null);
    try {
      await api.delete(`/app/pms/asset-hours/readings/${encodeURIComponent(entryId)}`);
      await refreshAfterEdit(row);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tRef.current("assetHours.saveFailed"));
    } finally {
      setBusyEntryId(null);
    }
  }, [refreshAfterEdit]);

  const staleCount = useMemo(
    () => (sheet?.rows ?? []).filter((r) => r.daysSinceReading == null || r.daysSinceReading > STALE_DAYS).length,
    [sheet],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Gauge}
        title={t("assetHours.pageTitle")}
        total={sheet?.rows.length ?? 0}
        onReload={reload}
      >
        <button
          type="button"
          onClick={() => { void copyLink(); }}
          title={t("assetHours.copyLinkHint")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
            linkCopied
              ? "bg-success-sea/20 border-success-sea/40 text-success-sea"
              : "bg-fg/5 border-fg/10 text-text-industrial hover:border-accent/40 hover:text-fg"
          }`}
        >
          {linkCopied
            ? <><Check className="w-3.5 h-3.5" />{t("common.copied")}</>
            : <><Copy className="w-3.5 h-3.5" />{t("common.copyLink")}</>}
        </button>
        <ExportExcelButton module="asset_hours" filters={vesselCode ? { vesselCode } : undefined} />
        {staleCount > 0 && (
          <span className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs font-bold">
            {t("assetHours.staleCount").replace("{n}", String(staleCount))}
          </span>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={vesselCode}
          onChange={(e) => setVesselCode(e.target.value)}
          className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
        >
          <option value="">{t("assetHours.vesselPlaceholder")}</option>
          {vessels.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
        </select>

        <label className="flex items-center gap-2 text-xs text-text-industrial/60">
          {t("assetHours.readingDate")}
          <input
            type="date"
            value={readingDate}
            max={todayIso()}
            onChange={(e) => setReadingDate(e.target.value || todayIso())}
            className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
          />
        </label>

        <button
          type="button"
          onClick={() => setIncludeUntracked((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
            includeUntracked
              ? "bg-accent/10 border-accent/30 text-accent"
              : "bg-fg/5 border-fg/10 text-text-industrial/60 hover:text-fg"
          }`}
          title={t("assetHours.includeUntrackedHint")}
        >
          {includeUntracked ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {includeUntracked ? t("assetHours.onlyTracked") : t("assetHours.addAsset")}
        </button>
      </div>

      {!vesselCode ? (
        <div className="text-center py-10 text-text-industrial/40 text-sm">{t("assetHours.selectVesselHint")}</div>
      ) : loading && !sheet ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : sheet ? (
        <AssetHoursGrid
          sheet={sheet}
          readingDate={readingDate}
          onSaved={reload}
          onOpenHistory={openHistory}
        />
      ) : null}

      {history && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setHistory(null)}>
          <div
            className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-fg/10">
              <div>
                <h2 className="text-base font-bold text-fg">{t("assetHours.history")}</h2>
                <p className="text-xs text-text-industrial/50">{history.row.assetName}</p>
              </div>
              <ModalCloseButton onClose={() => setHistory(null)} />
            </div>
            <div className="overflow-y-auto p-5">
              {history.entries.length === 0 ? (
                <p className="text-xs text-text-industrial/40 text-center py-6">{t("assetHours.noHistory")}</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-text-industrial/50 border-b border-fg/10">
                      <th className="py-2 pr-2">{t("assetHours.col.readingDate")}</th>
                      <th className="py-2 pr-2 text-right">{t("assetHours.col.lastReading")}</th>
                      <th className="py-2 pr-2 text-right">{t("assetHours.col.rpm")}</th>
                      <th className="py-2 pr-2">{t("assetHours.col.source")}</th>
                      <th className="py-2 pr-2">{t("assetHours.col.loadedBy")}</th>
                      <th className="py-2">{t("assetHours.col.note")}</th>
                      {canDeleteReadings && <th className="py-2 w-24"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fg/5">
                    {history.entries.map((e) => (
                      <tr key={e.id} className={busyEntryId === e.id ? "opacity-50" : ""}>
                        {/* Fecha y horas editables para el administrador: es la
                            única forma de corregir una lectura mal cargada. */}
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {canEditReadings ? (
                            <input
                              type="date"
                              defaultValue={e.readingDate}
                              disabled={busyEntryId === e.id}
                              onBlur={ev => {
                                const v = ev.target.value;
                                if (v && v !== e.readingDate) void patchEntry(history.row, e.id, { readingDate: v });
                              }}
                              className="bg-transparent border border-transparent rounded px-1 py-0.5 font-mono text-[11px] text-fg hover:border-fg/20 focus:border-accent/60 focus:outline-none"
                            />
                          ) : e.readingDate}
                        </td>
                        <td className="py-1.5 pr-2 font-mono text-right">
                          {canEditReadings ? (
                            <input
                              type="number"
                              defaultValue={e.runningHours}
                              disabled={busyEntryId === e.id}
                              onBlur={ev => {
                                const v = ev.target.value.trim();
                                const n = Number(v);
                                if (v !== "" && Number.isFinite(n) && n !== e.runningHours) {
                                  void patchEntry(history.row, e.id, { runningHours: n });
                                }
                              }}
                              className="w-24 bg-transparent border border-transparent rounded px-1 py-0.5 font-mono text-[11px] text-right text-fg hover:border-fg/20 focus:border-accent/60 focus:outline-none"
                            />
                          ) : `${e.runningHours.toLocaleString()} h`}
                        </td>
                        <td className="py-1.5 pr-2 font-mono text-right text-text-industrial/60">
                          {e.rpm != null ? e.rpm.toLocaleString() : "—"}
                        </td>
                        <td className="py-1.5 pr-2 text-text-industrial/60">
                          {e.source === "MANUAL" ? t("assetHours.source.manual")
                            : e.source === "VOYAGE_TANK_REPORT" ? t("assetHours.source.voyage")
                            : t("assetHours.source.daily")}
                        </td>
                        <td className="py-1.5 pr-2 text-text-industrial/60">{e.createdByName ?? "—"}</td>
                        <td className="py-1.5 text-text-industrial/50">{e.note ?? ""}</td>
                        {canDeleteReadings && (
                          <td className="py-1.5 text-right whitespace-nowrap">
                            {/* Borrar pide confirmación en la misma fila: la lectura
                                se va de verdad (queda sólo en el registro de auditoría). */}
                            {confirmDeleteId === e.id ? (
                              <span className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => { void deleteEntry(history.row, e.id); }}
                                  className="text-[10px] font-bold text-red-600 dark:text-red-400 hover:underline"
                                >
                                  {t("common.delete")}
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-[10px] text-text-industrial/60 hover:text-fg"
                                >
                                  {t("common.cancel")}
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(e.id)}
                                disabled={busyEntryId === e.id}
                                title={t("assetHours.deleteReading")}
                                className="p-1 rounded text-text-industrial/50 hover:text-red-600 dark:hover:text-red-400 hover:bg-fg/5 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
};
