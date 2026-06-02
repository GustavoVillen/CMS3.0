// Botón directo de descarga de Excel. NO abre el panel de import — solo dispara
// GET /app/excel/export/{module} con los filtros pasados y guarda el archivo.
//
// Patrón consistente con otros botones de la PageHeader: bordeado, ícono +
// label, hover acento. Si la descarga falla (403 sin permiso, 500, etc.),
// muestra un alert con el error del backend.

import React, { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { downloadAuthedFile } from "../lib/authed-media";

interface Props {
  /** Identificador del módulo en VALID_MODULES (backend). */
  module: string;
  /** Filtros opcionales que se mandan como query string (?vesselCode=...&status=...). */
  filters?: Record<string, string | null | undefined>;
  /** Texto del botón. Default: "Excel". */
  label?: string;
}

export const ExportExcelButton: React.FC<Props> = ({ module, filters, label }) => {
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (filters) {
        for (const [k, v] of Object.entries(filters)) {
          if (v) params.set(k, v);
        }
      }
      const qs = params.toString();
      const today = new Date().toISOString().slice(0, 10);
      await downloadAuthedFile(
        `/app/excel/export/${module}${qs ? `?${qs}` : ""}`,
        `${module}_${today}.xlsx`,
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "No se pudo exportar Excel.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={() => { void handle(); }}
      disabled={busy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      title="Descargar listado en Excel"
    >
      {busy
        ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
        : <FileSpreadsheet className="w-3.5 h-3.5 text-accent" />}
      {label ?? "Excel"}
    </button>
  );
};
