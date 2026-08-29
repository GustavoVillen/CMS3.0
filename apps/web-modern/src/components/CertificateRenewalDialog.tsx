// Ventanita para renovar un certificado.
//
// Algunos mantenimientos son servicios tercerizados que terminan en un
// certificado emitido por el proveedor (ej. el SERVICE anual del AIS). Cuando
// ese mantenimiento se reporta, esta ventanita ofrece pasar las fechas nuevas al
// certificado de /certificates.
//
// SIEMPRE con confirmación: el certificado es un documento legal de un tercero,
// así que las fechas salen del papel del proveedor y no de cuándo se registró el
// trabajo. Los valores vienen prellenados sólo como sugerencia y se pueden
// corregir; si el usuario cierra sin confirmar, no se toca nada (el certificado
// queda marcado como "pendiente de actualizar" en /certificates).

import React, { useMemo, useRef, useState } from "react";
import { ExternalLink, Folder, Loader2, RefreshCw } from "lucide-react";
import { ModalCloseButton } from "./ModalCloseButton";
import { api, ApiError } from "../lib/api";
import { AutoTextArea } from "./AutoTextArea";

/** Lo mínimo que la ventanita necesita saber del certificado. */
export interface RenewableCertificate {
  id: string;
  certificateCode: string;
  name: string;
  issueDate: string;
  expiryDate: string;
  lastInspectionDate?: string | null;
  originalSourceName?: string | null;
}

const DAY = 86_400_000;
/** Más de 10 años de vigencia = fecha centinela (2000→2099), no sirve de guía. */
const MAX_SANE_VALIDITY_DAYS = 3650;

function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value);
  return s.includes("T") ? s.slice(0, 10) : s;
}

/** Fechas al mediodía UTC: evita que el huso corra un día la cuenta. */
function parseUtcNoon(yyyyMmDd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const t = Date.parse(`${yyyyMmDd}T12:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function addDaysToInput(yyyyMmDd: string, days: number): string {
  const base = parseUtcNoon(yyyyMmDd);
  if (base == null) return "";
  return new Date(base + days * DAY).toISOString().slice(0, 10);
}

/**
 * Vigencia que traía el certificado, en días. Se usa para sugerir el nuevo
 * vencimiento: la vigencia real la fija el proveedor y puede no coincidir con la
 * frecuencia del plan (el AIS vence a los 6 meses y el plan es anual).
 */
export function previousValidityDays(cert: { issueDate: string; expiryDate: string }): number | null {
  const from = parseUtcNoon(toDateInput(cert.issueDate));
  const to = parseUtcNoon(toDateInput(cert.expiryDate));
  if (from == null || to == null) return null;
  const days = Math.round((to - from) / DAY);
  if (days <= 0 || days > MAX_SANE_VALIDITY_DAYS) return null;
  return days;
}

export const CertificateRenewalDialog: React.FC<{
  cert: RenewableCertificate;
  /** Fecha de la ejecución del mantenimiento, si viene de reportar una. */
  defaultIssueDate?: string | null;
  /** Trazabilidad: qué mantenimiento originó la renovación. */
  maintenancePlanId?: string | null;
  workLogId?: string | null;
  onClose: () => void;
  onRenewed: () => void;
}> = ({ cert, defaultIssueDate, maintenancePlanId, workLogId, onClose, onRenewed }) => {
  const validityDays = useMemo(() => previousValidityDays(cert), [cert]);

  const [issueDate, setIssueDate] = useState(
    toDateInput(defaultIssueDate) || new Date().toISOString().slice(0, 10),
  );
  // Si la vigencia anterior no es creíble (centinelas 2000/2099) no se sugiere
  // nada: lo escribe el usuario mirando el certificado.
  const [expiryDate, setExpiryDate] = useState(() => {
    const base = toDateInput(defaultIssueDate) || new Date().toISOString().slice(0, 10);
    return validityDays ? addDaysToInput(base, validityDays) : "";
  });
  const [lastInsp, setLastInsp] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceLink, setSourceLink] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceMime, setSourceMime] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Al mover la emisión se recalcula el vencimiento sugerido (si hay vigencia).
  const handleIssueChange = (v: string) => {
    setIssueDate(v);
    if (validityDays && v) setExpiryDate(addDaysToInput(v, validityDays));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setError(null);
    try {
      const r = await api.upload<{ url: string; name: string }>("/app/certificates/upload-source", file);
      setSourceLink(r.url);
      setSourceName(r.name);
      setSourceMime(r.name.includes(".") ? "." + r.name.split(".").pop()!.toLowerCase() : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el archivo.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (saving) return;
    if (!issueDate || !expiryDate) { setError("Completá la emisión y el vencimiento."); return; }
    if ((parseUtcNoon(expiryDate) ?? 0) <= (parseUtcNoon(issueDate) ?? 0)) {
      setError("El vencimiento tiene que ser posterior a la emisión."); return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/app/certificates/${cert.id}/renew`, {
        issueDate,
        expiryDate,
        lastInspectionDate: lastInsp || null,
        notes: notes.trim() || null,
        maintenancePlanId: maintenancePlanId ?? null,
        workLogId: workLogId ?? null,
        // Sólo se manda si se adjuntó uno nuevo: si no, se conserva el actual.
        ...(sourceLink
          ? { originalSourceLink: sourceLink, originalSourceName: sourceName, originalSourceMimeOrExt: sourceMime }
          : {}),
      });
      onRenewed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo renovar el certificado.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
  const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider";

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
            <RefreshCw className="w-4 h-4 text-accent" /> Renovar certificado
          </h2>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="rounded-xl bg-fg/5 border border-fg/10 px-3 py-2">
            <p className="text-sm font-bold text-fg">{cert.certificateCode} — {cert.name}</p>
            <p className="text-[11px] text-text-industrial/50 mt-0.5">
              Vigencia actual: {toDateInput(cert.issueDate).split("-").reverse().join("/")} → {toDateInput(cert.expiryDate).split("-").reverse().join("/")}
            </p>
          </div>

          <p className="text-xs text-text-industrial/60 leading-relaxed">
            Cargá las fechas <span className="font-bold text-fg">del certificado que emitió el proveedor</span>.
            Las de abajo son sólo una sugerencia.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={labelCls}>Nueva emisión *</label>
              <input type="date" value={issueDate} onChange={e => handleIssueChange(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Nuevo vencimiento *</label>
              <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className={inputCls} />
              {!validityDays && (
                <p className="text-[11px] text-text-industrial/40">
                  No se pudo deducir la vigencia anterior: cargalo a mano.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Últ. inspección</label>
            <input type="date" value={lastInsp} onChange={e => setLastInsp(e.target.value)} className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Certificado nuevo (archivo)</label>
            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="shrink-0 w-10 h-10 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 transition-all flex items-center justify-center disabled:opacity-50"
                title="Seleccionar archivo"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  : <Folder className={`w-4 h-4 ${sourceLink ? "text-yellow-700 dark:text-yellow-400" : "text-text-industrial/40"}`} />}
              </button>
              <button
                type="button" onClick={() => sourceLink && window.open(sourceLink, "_blank", "noopener,noreferrer")}
                disabled={!sourceLink}
                className="shrink-0 w-10 h-10 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 transition-all flex items-center justify-center disabled:opacity-40"
                title="Abrir archivo"
              >
                <ExternalLink className="w-4 h-4 text-accent" />
              </button>
              <span className="text-xs text-text-industrial/50 truncate">
                {sourceName || (cert.originalSourceName ? `Se conserva: ${cert.originalSourceName}` : "Sin archivo")}
              </span>
            </div>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Notas de la renovación</label>
            <AutoTextArea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          </div>

          <p className="text-[11px] text-text-industrial/40">
            La vigencia anterior queda guardada en el historial del certificado.
          </p>

          {error && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-fg hover:bg-fg/5 transition-all">
              Ahora no
            </button>
            <button
              type="button" onClick={() => { void submit(); }} disabled={saving}
              className="px-5 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Renovar certificado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
