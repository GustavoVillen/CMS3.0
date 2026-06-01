import React, { useMemo, useRef, useState } from "react";
import {
  Download, Upload, X, CheckCircle2, AlertCircle, Loader2,
  FileSpreadsheet, ChevronRight, RotateCcw, Wrench,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";

// ---------------------------------------------------------------------------
// Types matching the backend excel-import-service
// ---------------------------------------------------------------------------

type RowStatus = "CREATE" | "UPDATE" | "ERROR" | "CONFLICT_SOFT_DELETED";

interface PreviewRow {
  rowNumber: number;
  matchingKey?: string;
  status: RowStatus;
  existingId?: string;
  data: Record<string, unknown>;
  errorMessage?: string;
}

interface PreviewResult {
  parseErrors?: string[];
  fixes?: string[];
  rows: PreviewRow[];
}

interface ImportResult {
  created: number;
  updated: number;
  rejected: number;
  rowErrors?: { rowNumber: number; error: string }[];
}

type Step = "idle" | "uploading" | "preview" | "confirming" | "done";

// ---------------------------------------------------------------------------
// Module label map
// ---------------------------------------------------------------------------

const MODULE_LABELS: Record<string, string> = {
  vessels:           "Vessels",
  assets:            "Activos",
  maintenance_plans: "Planes de Mantenimiento",
  work_orders:       "Work Orders",
  spares:            "Repuestos",
  providers:         "Proveedores",
  certificates:      "Certificados",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExcelPanelProps {
  module: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const ExcelPanel: React.FC<ExcelPanelProps> = ({ module, onClose }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep]           = useState<Step>("idle");
  const [preview, setPreview]     = useState<PreviewResult | null>(null);
  const [result, setResult]       = useState<ImportResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [fileName, setFileName]   = useState<string | null>(null);

  // El export debe respetar el buque seleccionado globalmente (igual que la lista),
  // no exportar todos los buques del scope.
  const { selectedVesselCode } = useVesselContext();
  const exportUrl = `/app/excel/export/${module}${selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : ""}`;

  // ---- Download template ----
  const handleDownload = async () => {
    try {
      const res = await fetch(`/app/excel/template/${module}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("gpms_token") ?? ""}`,
          "X-Tenant-Slug": localStorage.getItem("gpms_tenant_slug") ?? "",
        },
      });
      if (!res.ok) throw new Error("Error al descargar template");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `template_${module}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("No se pudo descargar el template");
    }
  };

  // ---- Upload for preview ----
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setStep("uploading");

    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/app/excel/preview/${module}`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/octet-stream",
          Authorization:   `Bearer ${localStorage.getItem("gpms_token") ?? ""}`,
          "X-Tenant-Slug": localStorage.getItem("gpms_tenant_slug") ?? "",
        },
        body: buffer,
      });
      if (!res.ok) {
        // Surface the real server error: try JSON first, fall back to text body,
        // then to status code. Always log full payload so the browser console has detail.
        const text = await res.text();
        let serverMsg: string | null = null;
        try {
          const json = JSON.parse(text) as { error?: { code?: string; message?: string } };
          if (json.error?.message) {
            serverMsg = json.error.code
              ? `${json.error.code}: ${json.error.message}`
              : json.error.message;
          }
        } catch { /* not JSON */ }
        if (!serverMsg) serverMsg = text.slice(0, 300) || `HTTP ${res.status}`;
        console.error("[ExcelPanel] preview failed", { status: res.status, body: text });
        throw new Error(`Error ${res.status}: ${serverMsg}`);
      }
      const data: PreviewResult = await res.json();
      setPreview(data);
      // Only show parseErrors that aren't already auto-fixed
      if (data.parseErrors?.length) {
        setError(data.parseErrors.join(" | "));
      }
      setStep("preview");
      // fixes are shown inline in PreviewSummary — no need for top-level error
    } catch (err) {
      console.error("[ExcelPanel] upload error", err);
      setError(err instanceof Error ? err.message : "Error desconocido");
      setStep("idle");
    }

    // Reset input so same file can be re-uploaded
    if (fileRef.current) fileRef.current.value = "";
  };

  // ---- Confirm import ----
  const handleConfirm = async () => {
    if (!preview) return;
    setStep("confirming");
    setError(null);

    const rows = preview.rows
      .filter(r => r.status !== "ERROR")
      .map(r => ({
        rowNumber: r.rowNumber,
        matchingKey: r.matchingKey ?? "",
        action: r.status === "CONFLICT_SOFT_DELETED" ? "RESTORE_AND_UPDATE" : r.status,
        data: r.data,
        existingId: r.existingId,
      }));

    try {
      const res = await api.post<ImportResult>(`/app/excel/import/${module}`, { rows });
      setResult(res);
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al importar");
      setStep("preview");
    }
  };

  const handleReset = () => {
    setStep("idle");
    setPreview(null);
    setResult(null);
    setError(null);
    setFileName(null);
  };

  const label = MODULE_LABELS[module] ?? module;

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-surface border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-accent" />
            <div>
              <h2 className="text-sm font-bold text-white">Importar / Exportar Excel</h2>
              <p className="text-xs text-text-industrial/40">{label}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-text-industrial/40 hover:text-white transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Step: idle or uploading */}
          {(step === "idle" || step === "uploading") && (
            <>
              {/* Export */}
              <Section title="Exportar datos">
                <p className="text-xs text-text-industrial/50 mb-3">Descarga todos los registros actuales en formato Excel.</p>
                <a
                  href={exportUrl}
                  download
                  onClick={e => {
                    e.preventDefault();
                    const token = localStorage.getItem("gpms_token") ?? "";
                    const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
                    fetch(exportUrl, {
                      headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
                    }).then(async r => {
                      if (!r.ok) {
                        const json = await r.json().catch(() => ({}));
                        const msg = (json as { error?: { message?: string } }).error?.message ?? `Error ${r.status}`;
                        setError(msg);
                        return;
                      }
                      const blob = await r.blob();
                      const url = URL.createObjectURL(blob);
                      const a   = document.createElement("a");
                      a.href = url; a.download = `export_${module}.xlsx`; a.click();
                      URL.revokeObjectURL(url);
                    }).catch(() => setError("No se pudo descargar el archivo"));
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-medium text-text-industrial hover:bg-white/10 hover:border-accent/20 transition-all"
                >
                  <Download className="w-4 h-4 text-accent" />
                  Exportar {label}
                </a>
              </Section>

              {/* Template */}
              <Section title="Descargar template de importación">
                <p className="text-xs text-text-industrial/50 mb-3">Usa esta plantilla para preparar tus datos. Los campos con <span className="text-accent font-bold">*</span> son obligatorios.</p>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-medium text-text-industrial hover:bg-white/10 hover:border-accent/20 transition-all"
                >
                  <Download className="w-4 h-4 text-accent" />
                  Descargar template
                </button>
              </Section>

              {/* Upload */}
              <Section title="Importar archivo Excel">
                <p className="text-xs text-text-industrial/50 mb-3">Sube tu archivo .xlsx para ver una vista previa antes de confirmar.</p>
                <label className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed border-white/10 hover:border-accent/40 cursor-pointer transition-all group">
                  {step === "uploading"
                    ? <Loader2 className="w-8 h-8 text-accent animate-spin" />
                    : <Upload className="w-8 h-8 text-text-industrial/30 group-hover:text-accent transition-colors" />
                  }
                  <span className="text-xs text-text-industrial/40 group-hover:text-text-industrial/60 transition-colors">
                    {step === "uploading" ? `Procesando ${fileName}…` : "Haz clic o arrastra un archivo .xlsx"}
                  </span>
                  <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} disabled={step === "uploading"} />
                </label>
              </Section>

              {error && <ErrorBanner msg={error} />}
            </>
          )}

          {/* Step: preview */}
          {step === "preview" && preview && (
            <>
              <PreviewSummary preview={preview} fileName={fileName} />
              {error && <ErrorBanner msg={error} />}
            </>
          )}

          {/* Step: done */}
          {step === "done" && result && (
            <ImportDone result={result} onReset={handleReset} />
          )}
        </div>

        {/* Footer */}
        {step === "preview" && preview && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
            <button onClick={handleReset} className="flex items-center gap-2 text-xs text-text-industrial/50 hover:text-white transition-colors">
              <RotateCcw className="w-3 h-3" /> Subir otro archivo
            </button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-industrial/40">
                {preview.rows.filter(r => r.status !== "ERROR").length} filas válidas de {preview.rows.length}
              </span>
              <button
                onClick={handleConfirm}
                disabled={preview.rows.every(r => r.status === "ERROR")}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Confirmar importación <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {step === "confirming" && (
          <div className="flex items-center justify-center px-6 py-4 border-t border-white/10 gap-2 text-xs text-text-industrial/50 shrink-0">
            <Loader2 className="w-4 h-4 animate-spin text-accent" /> Importando datos…
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h3 className="text-xs font-bold text-text-industrial/50 uppercase tracking-wider mb-3">{title}</h3>
    {children}
  </div>
);

const ErrorBanner: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="flex items-center gap-2 text-xs text-red-400 p-3 bg-red-500/10 rounded-xl border border-red-500/20">
    <AlertCircle className="w-4 h-4 shrink-0" />{msg}
  </div>
);

const STATUS_STYLES: Record<RowStatus, { label: string; cls: string }> = {
  CREATE:                { label: "Nuevo",     cls: "bg-success-sea/10 text-success-sea border-success-sea/20" },
  UPDATE:                { label: "Actualizar",cls: "bg-accent/10 text-accent border-accent/20" },
  ERROR:                 { label: "Error",     cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  CONFLICT_SOFT_DELETED: { label: "Restaurar", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
};

const FixesBanner: React.FC<{ fixes: string[] }> = ({ fixes }) => (
  <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-1.5">
    <div className="flex items-center gap-2 text-xs font-bold text-yellow-400">
      <Wrench className="w-3.5 h-3.5" />
      {fixes.length} corrección{fixes.length !== 1 ? "es" : ""} aplicada{fixes.length !== 1 ? "s" : ""} automáticamente
    </div>
    <ul className="space-y-0.5">
      {fixes.map((fix, i) => (
        <li key={i} className="text-[11px] text-yellow-300/70 pl-5 list-disc">{fix}</li>
      ))}
    </ul>
  </div>
);

const PreviewSummary: React.FC<{ preview: PreviewResult; fileName: string | null }> = ({ preview, fileName }) => {
  const [sortKey, setSortKey] = useState<"rowNumber" | "status" | "preview">("rowNumber");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: "rowNumber" | "status" | "preview") => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    setSortDir(prev => (prev === "asc" ? "desc" : "asc"));
  };

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...preview.rows].sort((a, b) => {
      const aFirstKey = Object.keys(a.data)[0];
      const bFirstKey = Object.keys(b.data)[0];
      const aPreview = aFirstKey ? String(a.data[aFirstKey] ?? "") : "";
      const bPreview = bFirstKey ? String(b.data[bFirstKey] ?? "") : "";

      if (sortKey === "rowNumber") return (a.rowNumber - b.rowNumber) * dir;
      if (sortKey === "status") return a.status.localeCompare(b.status) * dir;
      return aPreview.localeCompare(bPreview, undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [preview.rows, sortDir, sortKey]);

  const headerLabel = (key: "rowNumber" | "status" | "preview", label: string) => {
    if (sortKey !== key) return `${label} ↕`;
    return `${label} ${sortDir === "asc" ? "↑" : "↓"}`;
  };

  const counts = preview.rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {} as Record<RowStatus, number>);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-text-industrial/50">
        <FileSpreadsheet className="w-4 h-4 text-accent" />
        <span className="text-white font-medium">{fileName}</span>
        <span>· {preview.rows.length} filas detectadas</span>
      </div>

      {/* Auto-fixes banner */}
      {(preview.fixes?.length ?? 0) > 0 && <FixesBanner fixes={preview.fixes!} />}

      {/* Summary pills */}
      <div className="flex gap-2 flex-wrap">
        {(Object.entries(counts) as [RowStatus, number][]).map(([status, count]) => {
          const s = STATUS_STYLES[status];
          return (
            <span key={status} className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-bold ${s.cls}`}>
              {count} {s.label}
            </span>
          );
        })}
      </div>

      {/* Row table */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto max-h-64">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left text-text-industrial/40 font-semibold w-12 cursor-pointer select-none" onClick={() => toggleSort("rowNumber")}>{headerLabel("rowNumber", "#")}</th>
                <th className="px-3 py-2 text-left text-text-industrial/40 font-semibold w-28 cursor-pointer select-none" onClick={() => toggleSort("status")}>{headerLabel("status", "Estado")}</th>
                <th className="px-3 py-2 text-left text-text-industrial/40 font-semibold cursor-pointer select-none" onClick={() => toggleSort("preview")}>{headerLabel("preview", "Datos / Errores")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sortedRows.map(row => {
                const s = STATUS_STYLES[row.status];
                const firstKey = Object.keys(row.data)[0];
                const preview_val = firstKey ? String(row.data[firstKey]) : "";
                return (
                  <tr key={row.rowNumber} className="hover:bg-white/2">
                    <td className="px-3 py-2 text-text-industrial/30">{row.rowNumber}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-3 py-2 text-text-industrial/60 max-w-xs">
                      {row.status === "ERROR"
                        ? <span className="text-red-400">{row.errorMessage ?? "Fila inválida"}</span>
                        : <span className="truncate block">{preview_val}</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const ImportDone: React.FC<{ result: ImportResult; onReset: () => void }> = ({ result, onReset }) => (
  <div className="flex flex-col items-center gap-6 py-8">
    <div className="p-4 rounded-full bg-success-sea/10 border border-success-sea/20">
      <CheckCircle2 className="w-10 h-10 text-success-sea" />
    </div>
    <div className="text-center">
      <h3 className="text-lg font-bold text-white mb-1">Importación completada</h3>
      <p className="text-sm text-text-industrial/50">Los datos fueron procesados correctamente.</p>
    </div>
    <div className="flex gap-6">
      <Stat label="Creados"     value={result.created}  color="text-success-sea" />
      <Stat label="Actualizados"value={result.updated}  color="text-accent" />
      <Stat label="Rechazados"  value={result.rejected} color="text-red-400" />
    </div>
    {(result.rowErrors?.length ?? 0) > 0 && (
      <div className="w-full space-y-1">
        {result.rowErrors!.map(e => (
          <div key={e.rowNumber} className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-1.5 border border-red-500/20">
            Fila {e.rowNumber}: {e.error}
          </div>
        ))}
      </div>
    )}
    <button onClick={onReset} className="flex items-center gap-2 text-xs text-accent hover:underline">
      <RotateCcw className="w-3 h-3" /> Importar otro archivo
    </button>
  </div>
);

const Stat: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="text-center">
    <p className={`text-3xl font-bold ${color}`}>{value}</p>
    <p className="text-xs text-text-industrial/40 mt-1">{label}</p>
  </div>
);
