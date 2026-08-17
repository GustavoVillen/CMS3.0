// Tarjeta del Dashboard para cargar horómetros sin salir del tablero.
//
// Muestra siempre el estado (cuántos equipos están sin lectura reciente) y abre
// la planilla compacta al pedido, reusando <AssetHoursGrid>. La pantalla completa
// (/asset-hours) queda a un clic para el resto: historial, otras fechas, equipos
// sin seguimiento.
//
// Sólo aparece con un buque seleccionado: cargar horas es siempre por buque, y en
// vista de flota no hay a quién imputarlas.

import React, { useCallback, useEffect, useState } from "react";
import { Gauge, ChevronDown, ChevronUp, ExternalLink, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { AssetHoursGrid, STALE_DAYS, type HoursSheet } from "./AssetHoursGrid";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const AssetHoursQuickCard: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const { selectedVesselCode } = useVesselContext();
  const [sheet, setSheet] = useState<HoursSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const readingDate = todayIso();

  const reload = useCallback(async () => {
    if (!selectedVesselCode) { setSheet(null); return; }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ vesselCode: selectedVesselCode, date: readingDate });
      setSheet(await api.get<HoursSheet>(`/app/pms/asset-hours?${qs.toString()}`));
    } catch {
      setSheet(null);   // el detalle del error se ve en la pantalla completa
    } finally {
      setLoading(false);
    }
  }, [selectedVesselCode, readingDate]);

  useEffect(() => { void reload(); }, [reload]);

  if (!selectedVesselCode) return null;
  if (loading && !sheet) {
    return (
      <div className="bento-card p-3 flex items-center gap-2 text-xs text-text-industrial/50">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
        {t("assetHours.pageTitle")}
      </div>
    );
  }
  if (!sheet || sheet.rows.length === 0) return null;

  const stale = sheet.rows.filter((r) => r.daysSinceReading == null || r.daysSinceReading > STALE_DAYS).length;
  const loadedToday = sheet.rows.filter((r) => r.readingOnDate != null).length;

  return (
    <div className="bento-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20 shrink-0">
            <Gauge className="w-4 h-4 text-accent" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-fg">{t("assetHours.pageTitle")}</h2>
            <p className="text-[10px] text-text-industrial/50">
              {stale > 0
                ? t("assetHours.staleCount").replace("{n}", String(stale))
                : t("assetHours.allUpToDate")}
              {loadedToday > 0 && ` · ${t("assetHours.loadedToday").replace("{n}", String(loadedToday))}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {sheet.canWrite && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-[11px] font-bold text-accent hover:bg-accent/20 transition-colors"
            >
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {open ? t("assetHours.collapse") : t("assetHours.loadHours")}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/asset-hours")}
            title={t("assetHours.openFull")}
            className="p-1.5 rounded-lg text-text-industrial/40 hover:text-accent hover:bg-fg/5 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {open && (
        <AssetHoursGrid
          sheet={sheet}
          readingDate={readingDate}
          onSaved={() => { void reload(); }}
          compact
        />
      )}
    </div>
  );
};
