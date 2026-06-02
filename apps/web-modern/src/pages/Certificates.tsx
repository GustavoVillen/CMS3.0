import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, FileSpreadsheet, FileText, Folder, Loader2, Plus, Trash2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

interface Certificate {
  id: string;
  certificateCode: string;
  name: string;
  vesselCode: string;
  issuingAuthority: string;
  status: string;
  issueDate: string;
  expiryDate: string;
  lastInspectionDate?: string | null;
  notes?: string | null;
  assetId?: string | null;
  originalSourceLink?: string | null;
  originalSourceName?: string | null;
  originalSourceMimeOrExt?: string | null;
  createdAt: string;
}

interface ListResponse { items: Certificate[]; total: number; }

function asDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value);
  return s.includes("T") ? s.slice(0, 10) : s;
}

function computeAutoCertificateStatus(expiryDateValue: string): "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" {
  const expiry = new Date(expiryDateValue);
  if (Number.isNaN(expiry.getTime())) return "ACTIVE";
  const diffDays = Math.floor((expiry.getTime() - Date.now()) / 86400000);
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= 30) return "EXPIRING_SOON";
  return "ACTIVE";
}

const CERT_STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-success-sea/10 text-success-sea border-success-sea/20",
  EXPIRING_SOON: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  EXPIRED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  SUSPENDED: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  CLOSED: "bg-fg/5 text-text-industrial/40 border-fg/10",
};


// ── ExpiryCell ──────────────────────────────────────────────────────────────

function ExpiryCell({ date }: { date?: string | null }) {
  if (!date) return <span className="text-text-industrial/30">—</span>;
  const d = new Date(date);
  const diff = Math.floor((d.getTime() - Date.now()) / 86400000);
  const cls = diff < 0 ? "text-red-700 dark:text-red-400 font-bold" : diff <= 30 ? "text-yellow-700 dark:text-yellow-400 font-bold" : "text-text-industrial/70";
  return <span className={cls}>{fmtDate(date)}{diff < 0 ? " ⚠" : diff <= 30 ? " ⏰" : ""}</span>;
}

// ── Form modal ───────────────────────────────────────────────────────────────

interface CertFormProps {
  initial?: Certificate | null;
  onClose: () => void;
  onSaved: () => void;
}

const CertificateForm: React.FC<CertFormProps> = ({ initial, onClose, onSaved }) => {
  const t = useT();
  const isEdit = !!initial;

  const [certCode, setCertCode]   = useState(initial?.certificateCode ?? "");
  const [name, setName]           = useState(initial?.name ?? "");
  const [vesselCode, setVessel]   = useState(initial?.vesselCode ?? "");
  const [authority, setAuthority] = useState(initial?.issuingAuthority ?? "");
  const [issueDate, setIssueDate] = useState(asDateInput(initial?.issueDate));
  const [expiryDate, setExpiry]   = useState(asDateInput(initial?.expiryDate));
  const [lastInsp, setLastInsp]   = useState(asDateInput(initial?.lastInspectionDate));
  const [notes, setNotes]         = useState(initial?.notes ?? "");
  const [originalSourceLink, setOriginalSourceLink] = useState(initial?.originalSourceLink ?? "");
  const [originalSourceName, setOriginalSourceName] = useState(initial?.originalSourceName ?? "");
  const [originalSourceMimeOrExt, setOriginalSourceMimeOrExt] = useState(initial?.originalSourceMimeOrExt ?? "");
  const [saving, setSaving]       = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasLink = originalSourceLink.trim() !== "";
  const { data: vesselsData } = useFetch<{ items: { code: string; name: string }[] }>("/app/vessels?limit=200", []);

  const derivedStatus = useMemo(() => {
    const trimmed = expiryDate.trim();
    if (!trimmed) return initial?.status ?? "ACTIVE";
    const auto = computeAutoCertificateStatus(trimmed);
    if ((initial?.status === "SUSPENDED" || initial?.status === "CLOSED") && isEdit) {
      return initial.status;
    }
    return auto;
  }, [expiryDate, initial?.status, isEdit]);

  useCopilotEmitter({
    module: "CERTIFICATES",
    screen: isEdit ? "CERT_EDIT" : "CERT_CREATE",
    entityId: initial?.id,
    entityCode: initial?.certificateCode,
    vesselCode: vesselCode || initial?.vesselCode,
    workflowStage: derivedStatus,
    canEdit: true,
    fieldValues: {
      name:         name         || null,
      certCode:     certCode     || null,
      authority:    authority    || null,
      expiryDate:   expiryDate   || null,
      issueDate:    issueDate    || null,
    },
  });

  const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";

  const handleSelectOriginalFile = useCallback(() => {
    setSourceError(null);
    fileInputRef.current?.click();
  }, []);

  const handleFilePicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setSourceError(null);
    setUploading(true);
    try {
      const result = await api.upload<{ url: string; name: string }>("/app/certificates/upload-source", file);
      setOriginalSourceLink(result.url);
      setOriginalSourceName(result.name);
      const ext = result.name.includes(".") ? "." + result.name.split(".").pop()!.toLowerCase() : "";
      setOriginalSourceMimeOrExt(ext);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "No se pudo subir el archivo.");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleOpenOriginalSource = useCallback(() => {
    const link = originalSourceLink.trim();
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
  }, [originalSourceLink]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        certificateCode: certCode.trim().toUpperCase(),
        name: name.trim(),
        vesselCode: vesselCode.trim().toUpperCase(),
        issuingAuthority: authority.trim(),
        issueDate,
        expiryDate,
        lastInspectionDate: lastInsp || null,
        notes: notes.trim() || null,
        originalSourceLink: originalSourceLink.trim() || null,
        originalSourceName: originalSourceName.trim() || null,
        originalSourceMimeOrExt: originalSourceMimeOrExt.trim() || null,
      };
      if (isEdit) {
        await api.patch(`/app/certificates/${initial!.id}`, payload);
      } else {
        await api.post("/app/certificates", payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    certCode, name, vesselCode, authority, issueDate, expiryDate, lastInsp, notes,
    originalSourceLink, originalSourceName, originalSourceMimeOrExt,
  });
  useEscapeGuard({
    isDirty,
    onSave: () => handleSubmit({ preventDefault: () => {} } as React.FormEvent),
    onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-fg">
              {isEdit ? "Editar Certificado" : "Nuevo Certificado"}
            </h2>
          </div>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-fg transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.code")} *</label>
              <input
                value={certCode}
                onChange={e => setCertCode(e.target.value.toUpperCase())}
                required
                placeholder="CERT-001"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.vessel")} *</label>
              <select
                value={vesselCode}
                onChange={e => setVessel(e.target.value)}
                required
                disabled={isEdit}
                className={`${inputCls} disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <option value="">Seleccionar vessel...</option>
                {(vesselsData?.items ?? []).map(v => (
                  <option key={v.code} value={v.code}>{v.code} — {v.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.name")} *</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="Certificado de Seguridad" className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.authority")} *</label>
            <input value={authority} onChange={e => setAuthority(e.target.value)} required placeholder="Prefectura Naval Argentina" className={inputCls} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.issued")} *</label>
              <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} required className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.expiry")} *</label>
              <input type="date" value={expiryDate} onChange={e => setExpiry(e.target.value)} required className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Últ. Inspección</label>
              <input type="date" value={lastInsp} onChange={e => setLastInsp(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.status")}</label>
            <div className="min-h-[42px] flex items-center">
              <span className={`inline-block text-xs px-3 py-1 rounded-full border font-bold ${CERT_STATUS_STYLES[derivedStatus] ?? "bg-fg/5 text-text-industrial/40 border-fg/10"}`}>
                {derivedStatus}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Archivo original</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectOriginalFile}
                disabled={uploading}
                className="shrink-0 w-10 h-10 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 transition-all flex items-center justify-center disabled:opacity-50"
                title="Seleccionar archivo"
              >
                {uploading
                  ? <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  : <Folder className={`w-4 h-4 ${hasLink ? "text-yellow-700 dark:text-yellow-400" : "text-text-industrial/40"}`} />
                }
              </button>
              <button
                type="button"
                onClick={handleOpenOriginalSource}
                disabled={!hasLink}
                className="shrink-0 w-10 h-10 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 transition-all flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                title="Abrir archivo"
              >
                <ExternalLink className="w-4 h-4 text-accent" />
              </button>
              {originalSourceName && (
                <span className="text-xs text-text-industrial/50 truncate">{originalSourceName}</span>
              )}
            </div>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePicked} />
            {sourceError && (
              <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{sourceError}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Notas</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} />
          </div>
          {error && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-fg hover:bg-fg/5 transition-all">{t("common.cancel")}</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? t("common.saveChanges") : t("common.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Delete confirm ───────────────────────────────────────────────────────────

const DeleteConfirm: React.FC<{ cert: Certificate; onClose: () => void; onDeleted: () => void }> = ({ cert, onClose, onDeleted }) => {
  const t = useT();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/app/certificates/${cert.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.deleteError"));
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-sm bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-fg">¿Eliminar certificado?</h2>
        <p className="text-xs text-text-industrial/60">
          <span className="text-fg font-bold">{cert.certificateCode} — {cert.name}</span>
        </p>
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-fg hover:bg-fg/5 transition-all">{t("common.cancel")}</button>
          <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 rounded-xl bg-red-500/80 text-fg font-bold text-xs hover:bg-red-500 disabled:opacity-50 transition-all">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────

export const CertificatesPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  // Cualquier rol operativo puede crear/editar certificados (subir
  // archivos renovados). Borrar sigue siendo solo admin.
  const canWrite = isAdmin
    || user?.role === "FLEET_SUPERINTENDENT"
    || user?.role === "MAINTENANCE_MANAGER"
    || user?.role === "TECHNICIAN_OPERATOR"
    || user?.role === "INSPECTOR_COMPLIANCE";
  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const [vesselInput, setVesselInput] = useState(vesselFilter);
  const [showExcel, setShowExcel] = useState(false);
  const [formCert, setFormCert] = useState<Certificate | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Certificate | null>(null);

  useCopilotEmitter(formCert === undefined ? { module: "CERTIFICATES", screen: "CERT_LIST" } : null);

  useEffect(() => { setVesselInput(vesselFilter); }, [vesselFilter]);

  const updateFilters = useCallback((next: { status?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : statusFilter;
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (nextStatus) params.set("status", nextStatus); else params.delete("status");
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, statusFilter, vesselFilter]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (vesselFilter) p.set("vesselCode", vesselFilter);
    return `/app/certificates${p.toString() ? `?${p.toString()}` : ""}`;
  }, [statusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  const openEdit = useCallback(async (row: Certificate) => {
    try {
      const detail = await api.get<Certificate>(`/app/certificates/${row.id}`);
      setFormCert(detail);
    } catch {
      setFormCert(row);
    }
  }, []);

  const columns: Column<Certificate>[] = useMemo(() => [
    { key: "certificateCode", header: t("col.code"),      render: r => <span className="font-mono font-bold text-fg text-xs">{r.certificateCode}</span> },
    { key: "name",            header: t("col.name"),      render: r => <span className="font-medium text-fg line-clamp-1">{r.name}</span> },
    { key: "vesselCode",      header: t("col.vessel"),    render: r => <VesselLabel code={r.vesselCode} className="text-xs" showCode /> },
    { key: "issuingAuthority",header: t("col.authority"), render: r => <span className="text-text-industrial/80">{r.issuingAuthority}</span> },
    { key: "expiryDate",      header: t("col.expiry"),    render: r => <ExpiryCell date={r.expiryDate} /> },
    { key: "status",          header: t("col.status"),    render: r => <StatusBadge status={r.status} /> },
    {
      key: "actions", header: "", sortable: false,
      render: r => isAdmin ? (
        <button
          onClick={e => { e.stopPropagation(); setDeleteTarget(r); }}
          className="p-1.5 rounded-lg text-text-industrial/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title={t("common.delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ) : null,
    },
  ], [t, isAdmin]);

  return (
    <div className="space-y-5">
      {showExcel && <ExcelPanel module="certificates" onClose={() => { setShowExcel(false); reload(); }} />}
      {formCert !== undefined && (
        <CertificateForm
          initial={formCert}
          onClose={() => setFormCert(undefined)}
          onSaved={() => { setFormCert(undefined); reload(); }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          cert={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); reload(); }}
        />
      )}

      <PageHeader icon={FileText} title={t("page.certificates")} total={data?.total} onReload={reload}>
        {canWrite && (
          <button onClick={() => setFormCert(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("common.new")}
          </button>
        )}
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
      </PageHeader>

      <DataTable
        columns={columns}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("empty.certificates")}
        onRowClick={canWrite ? row => { void openEdit(row); } : undefined}
      />
    </div>
  );
};
