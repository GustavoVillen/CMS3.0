// SIRE 2.0 Ch. 4 — External Audits (PSC, Flag, Class, Vetting).
// Registro histórico de inspecciones externas con findings.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardCheck, Plus, Loader2, X, ExternalLink, AlertTriangle, CheckCircle2, ShieldAlert, Sparkles } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate } from "../lib/utils";
import { useT } from "../lib/i18n";

// "Conditional" o "Fail" habilitan el registro de findings (case-insensitive,
// tolera datos legados en texto libre).
const resultEnablesFindings = (r: string | null | undefined) => /conditional|fail/i.test(r ?? "");

// Mapea severidad del finding (texto libre MINOR/MAJOR/CRITICAL) a DefectSeverity.
function findingSeverityToDefect(severity: string | null | undefined): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const s = (severity ?? "").toUpperCase();
  if (s.includes("CRITICAL")) return "CRITICAL";
  if (s.includes("MAJOR")) return "HIGH";
  if (s.includes("MINOR")) return "LOW";
  return "MEDIUM";
}

const DEFECT_STATUS_COLOR: Record<string, string> = {
  OPEN:         "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  UNDER_REVIEW: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  IN_PROGRESS:  "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  DEFERRED:     "bg-fg/5 text-text-industrial/70 border-fg/10",
  RESOLVED:     "bg-success-sea/10 text-success-sea border-success-sea/30",
  CLOSED:       "bg-success-sea/10 text-success-sea border-success-sea/30",
};

const AUDIT_TYPE_LABEL: Record<string, string> = {
  PSC: "Port State Control",
  FLAG: "Flag State",
  CLASS: "Sociedad de Clasificación",
  VETTING_OIL_MAJOR: "Vetting (Oil Major / SIRE)",
  CDI: "CDI",
  RIGHTSHIP: "RightShip",
  OTHER: "Otro",
};

const FINDING_TYPE_LABEL: Record<string, string> = {
  DEFICIENCY: "Deficiencia",
  OBSERVATION: "Observación",
  RECOMMENDATION: "Recomendación",
  POSITIVE_OBSERVATION: "Observación positiva",
};

const FINDING_STATUS_COLOR: Record<string, string> = {
  OPEN:                "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  IN_PROGRESS:         "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  CLOSED:              "bg-success-sea/10 text-success-sea border-success-sea/30",
  REJECTED_BY_AUDITOR: "bg-fg/5 text-text-industrial/60 border-fg/10",
};

interface Finding {
  id: string;
  findingCode: string | null;
  findingType: string;
  category: string | null;
  description: string;
  status: string;
  severity: string | null;
  detentionRelated: boolean;
  rectificationDeadline: string | null;
  clearingDate: string | null;
  evidenceNotes: string | null;
  evidenceDocUrl: string | null;
  // Defecto vinculado (gestión correctiva en el módulo Defects).
  defectId?: string | null;
  defectCode?: string | null;
  defectStatus?: string | null;
}

interface Audit {
  id: string;
  auditCode: string;
  vesselCode: string;
  auditType: string;
  auditDate: string;
  port: string | null;
  country: string | null;
  agencyOrAuthority: string | null;
  inspectorName: string | null;
  overallResult: string | null;
  summary: string | null;
  scoreOrRating: string | null;
  reportUrl: string | null;
  findingsTotal?: number;
  findingsOpen?: number;
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

// ─── Audit modal ────────────────────────────────────────────────────────────

const AuditModal: React.FC<{ audit: Audit | null; onClose: () => void; onSaved: () => void }> = ({ audit: auditProp, onClose, onSaved }) => {
  const t = useT();
  const navigate = useNavigate();
  const { vessels } = useVesselContext();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  // `audit` es estado interno: al guardar uno nuevo transicionamos a modo edición
  // sin cerrar la ventana, para registrar las deficiencias en el acto.
  const [audit, setAudit] = useState<Audit | null>(auditProp);
  const isNew = !audit;
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loadingFindings, setLoadingFindings] = useState(false);

  const [vesselCode, setVesselCode]   = useState(audit?.vesselCode ?? vessels[0]?.code ?? "");
  const [auditType, setAuditType]     = useState(audit?.auditType ?? "PSC");
  const [auditDate, setAuditDate]     = useState((audit?.auditDate ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [port, setPort]               = useState(audit?.port ?? "");
  const [country, setCountry]         = useState(audit?.country ?? "");
  const [agency, setAgency]           = useState(audit?.agencyOrAuthority ?? "");
  const [inspectorName, setInspector] = useState(audit?.inspectorName ?? "");
  const [overallResult, setResult]    = useState(audit?.overallResult ?? "");
  const [summary, setSummary]         = useState(audit?.summary ?? "");
  const [score, setScore]             = useState(audit?.scoreOrRating ?? "");
  const [reportUrl, setReportUrl]     = useState(audit?.reportUrl ?? "");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAddFinding, setShowAddFinding] = useState(false);
  // Finding que se está promoviendo a Defecto (dispara PromoteToDefectModal).
  const [promoteFinding, setPromoteFinding] = useState<Finding | null>(null);

  const findingsEnabled = resultEnablesFindings(overallResult);

  React.useEffect(() => {
    if (!audit) return;
    setLoadingFindings(true);
    api.get<{ findings: Finding[] }>(`/app/external-audits/${audit.id}`)
      .then(r => setFindings(r.findings ?? []))
      .catch(() => setFindings([]))
      .finally(() => setLoadingFindings(false));
  }, [audit]);

  const onSave = useCallback(async () => {
    if (!vesselCode || !auditType || !auditDate) { setErr("Vessel, tipo y fecha son requeridos."); return; }
    setSaving(true); setErr(null);
    try {
      const payload = {
        vesselCode, auditType, auditDate,
        port: port.trim() || null,
        country: country.trim() || null,
        agencyOrAuthority: agency.trim() || null,
        inspectorName: inspectorName.trim() || null,
        overallResult: overallResult.trim() || null,
        summary: summary.trim() || null,
        scoreOrRating: score.trim() || null,
        reportUrl: reportUrl.trim() || null,
      };
      if (isNew) {
        // Crear y NO cerrar: pasamos a modo edición para registrar findings al instante.
        const created = await api.post<Audit>("/app/external-audits", payload);
        setAudit(created);
      } else {
        await api.patch(`/app/external-audits/${audit!.id}`, payload);
      }
      onSaved(); // recarga la lista de fondo; la ventana permanece abierta
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al guardar."); }
    finally { setSaving(false); }
  }, [isNew, audit, vesselCode, auditType, auditDate, port, country, agency, inspectorName, overallResult, summary, score, reportUrl, onSaved]);

  const onDelete = useCallback(async () => {
    if (!audit || !isAdmin) return;
    if (!window.confirm(t("confirm.deleteAudit").replace("{code}", audit.auditCode))) return;
    try {
      await api.delete(`/app/external-audits/${audit.id}`);
      onClose(); // tras borrar, cerrar la ventana (onClose también recarga la lista)
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al eliminar."); }
  }, [audit, isAdmin, onClose, t]);

  const reloadFindings = useCallback(async () => {
    if (!audit) return;
    try {
      const r = await api.get<{ findings: Finding[] }>(`/app/external-audits/${audit.id}`);
      setFindings(r.findings ?? []);
    } catch { /* noop */ }
  }, [audit]);

  // ESC: cerrar / preguntar guardar si hay cambios
  const isDirty = useDirtyTracker({ vesselCode, auditType, auditDate, port, country, agency, inspectorName, overallResult, summary, score, reportUrl });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
   <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[90vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("nav.externalAudits")}</p>
              <h2 className="text-sm font-bold text-fg">{isNew ? t("ea.modal.newTitle") : audit!.auditCode}</h2>
            </div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Vessel *</label>
              <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={!isNew} className={inputCls}>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Tipo *</label>
              <select value={auditType} onChange={e => setAuditType(e.target.value)} className={inputCls}>
                {Object.entries(AUDIT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Fecha *</label>
              <input type="date" value={auditDate} onChange={e => setAuditDate(e.target.value)} className={inputCls} />
            </div>
            <div><label className={labelCls}>Resultado general</label>
              <select value={overallResult} onChange={e => setResult(e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option value="Pass">Pass</option>
                <option value="Conditional">Conditional</option>
                <option value="Fail">Fail</option>
                {/* Valor legado no contemplado en las opciones: lo preservamos para no perderlo */}
                {overallResult && !["Pass", "Conditional", "Fail"].includes(overallResult) && (
                  <option value={overallResult}>{overallResult}</option>
                )}
              </select>
            </div>
            <div><label className={labelCls}>Puerto</label>
              <input value={port} onChange={e => setPort(e.target.value)} className={inputCls} />
            </div>
            <div><label className={labelCls}>País</label>
              <input value={country} onChange={e => setCountry(e.target.value)} className={inputCls} />
            </div>
            <div><label className={labelCls}>Autoridad / Agencia</label>
              <input value={agency} onChange={e => setAgency(e.target.value)} placeholder="USCG, MCA, Shell..." className={inputCls} />
            </div>
            <div><label className={labelCls}>Inspector</label>
              <input value={inspectorName} onChange={e => setInspector(e.target.value)} className={inputCls} />
            </div>
            <div><label className={labelCls}>Score / Rating</label>
              <input value={score} onChange={e => setScore(e.target.value)} placeholder="85%, B-, etc." className={inputCls} />
            </div>
            <div><label className={labelCls}>URL del informe</label>
              <input value={reportUrl} onChange={e => setReportUrl(e.target.value)} placeholder="https://..." className={inputCls} />
            </div>
            <div className="col-span-2"><label className={labelCls}>Resumen</label>
              <textarea rows={3} value={summary} onChange={e => setSummary(e.target.value)} className={inputCls + " resize-y"} />
            </div>
          </div>

          {isNew ? (
            findingsEnabled && (
              <div className="border-t border-fg/10 pt-4">
                <p className="text-xs text-text-industrial/50 italic">{t("ea.findings.saveFirst")}</p>
              </div>
            )
          ) : (
            <div className="border-t border-fg/10 pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-text-industrial/70">Findings ({findings.length})</h3>
                {findingsEnabled && (
                  <button onClick={() => setShowAddFinding(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold uppercase tracking-wider hover:bg-accent/20">
                    <Plus className="w-3 h-3" /> Agregar
                  </button>
                )}
              </div>
              {!findingsEnabled && findings.length === 0
                ? <p className="text-xs text-text-industrial/40 italic text-center py-2">{t("ea.findings.gatedHint")}</p>
                : loadingFindings ? <Loader2 className="w-4 h-4 animate-spin text-accent mx-auto" />
                : findings.length === 0 ? <p className="text-xs text-text-industrial/40 italic text-center py-2">Sin findings registrados.</p>
                : (
                  <div className="space-y-2">
                    {findings.map(f => <FindingRow key={f.id} auditId={audit!.id} finding={f} onChange={reloadFindings} onPromote={setPromoteFinding} />)}
                  </div>
                )
              }
            </div>
          )}

          {showAddFinding && audit && (
            <FindingAddForm
              auditId={audit.id}
              onClose={() => setShowAddFinding(false)}
              onSaved={(created) => {
                setShowAddFinding(false);
                void reloadFindings();
                if (created.findingType === "DEFICIENCY" && window.confirm(t("ea.finding.promoteConfirm"))) setPromoteFinding(created);
              }}
            />
          )}

          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-fg/10 shrink-0">
          <div>
            {!isNew && isAdmin && (
              <button onClick={() => { void onDelete(); }} className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-xs hover:bg-red-500/20">
                Eliminar
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">Cerrar</button>
            <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>

    {promoteFinding && audit && (
      <PromoteToDefectModal
        audit={audit}
        finding={promoteFinding}
        onClose={() => setPromoteFinding(null)}
        onCreated={(defectId) => {
          setPromoteFinding(null);
          void reloadFindings();
          navigate(`/defects?defectId=${defectId}`);
        }}
      />
    )}
   </>
  );
};

const FindingRow: React.FC<{ auditId: string; finding: Finding; onChange: () => void; onPromote: (f: Finding) => void }> = ({ auditId, finding, onChange, onPromote }) => {
  const t = useT();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const isDeficiency = finding.findingType === "DEFICIENCY";
  return (
    <div className="bg-fg/[0.03] border border-fg/10 rounded-xl p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {finding.findingCode && <span className="text-[10px] font-mono text-accent">{finding.findingCode}</span>}
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-fg/10 bg-fg/5 text-text-industrial/80 font-bold uppercase tracking-wider">
            {FINDING_TYPE_LABEL[finding.findingType] ?? finding.findingType}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider ${FINDING_STATUS_COLOR[finding.status]}`}>
            {finding.status}
          </span>
          {finding.detentionRelated && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 font-bold uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Detention
            </span>
          )}
          {finding.severity && <span className="text-[10px] text-text-industrial/60">{finding.severity}</span>}
          {finding.defectId && finding.defectCode && (
            <button
              type="button"
              onClick={() => navigate(`/defects?defectId=${finding.defectId}`)}
              title={t("ea.finding.openLinkedDefect")}
              className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider flex items-center gap-1 hover:brightness-110 ${DEFECT_STATUS_COLOR[finding.defectStatus ?? "OPEN"] ?? "bg-fg/5 text-text-industrial/70 border-fg/10"}`}
            >
              <ShieldAlert className="w-3 h-3" /> {finding.defectCode}{finding.defectStatus ? ` · ${finding.defectStatus}` : ""}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isDeficiency && !finding.defectId && (
            <button onClick={() => onPromote(finding)} className="text-[10px] text-accent hover:underline flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> {t("ea.finding.promoteToDefect")}
            </button>
          )}
          <button onClick={() => setEditing(v => !v)} className="text-[10px] text-accent hover:underline">{editing ? "Cerrar" : "Editar"}</button>
        </div>
      </div>
      <p className="text-xs text-fg">{finding.description}</p>
      {finding.clearingDate && (
        <p className="text-[10px] text-success-sea flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Cerrado el {fmtDate(finding.clearingDate)}{finding.evidenceNotes ? ` — ${finding.evidenceNotes}` : ""}
        </p>
      )}
      {editing && <FindingEditForm auditId={auditId} finding={finding} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChange(); }} />}
    </div>
  );
};

// Promueve un finding (deficiencia) a un Defecto gestionado en el módulo Defects.
// El activo (que el finding no trae) lo sugiere la IA desde la descripción y el usuario confirma.
const PromoteToDefectModal: React.FC<{ audit: Audit; finding: Finding; onClose: () => void; onCreated: (defectId: string) => void }> = ({ audit, finding, onClose, onCreated }) => {
  const t = useT();
  const [assets, setAssets] = useState<{ id: string; assetCode: string; name: string | null }[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [severity, setSeverity] = useState<string>(findingSeverityToDefect(finding.severity));
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoRef = useRef(false);

  useEffect(() => {
    setLoadingAssets(true);
    api.get<{ items: { id: string; assetCode: string; name: string | null }[] }>(`/app/pms/assets?vesselCode=${encodeURIComponent(audit.vesselCode)}&limit=200`)
      .then(r => setAssets(r.items ?? []))
      .catch(() => setAssets([]))
      .finally(() => setLoadingAssets(false));
  }, [audit.vesselCode]);

  const suggestAsset = useCallback(async () => {
    if (suggesting || assets.length === 0) return;
    setSuggesting(true);
    try {
      const res = await api.post<{ assetId: string | null }>("/app/pms/work-orders/suggest-asset", {
        taskDesc: finding.description,
        assets: assets.map(a => ({ id: a.id, code: a.assetCode, name: a.name })),
      });
      if (res.assetId && assets.some(a => a.id === res.assetId)) { setAssetId(res.assetId); setSuggested(true); }
    } catch (e) { console.error("[suggest-asset] failed:", e); }
    finally { setSuggesting(false); }
  }, [suggesting, assets, finding.description]);

  // Auto-sugerir el activo una vez, al cargar los equipos.
  useEffect(() => {
    if (autoRef.current || assets.length === 0 || assetId) return;
    autoRef.current = true;
    void suggestAsset();
  }, [assets, assetId, suggestAsset]);

  const onSave = async () => {
    if (!assetId) { setErr(t("wo.modal.equipmentRequired")); return; }
    setSaving(true); setErr(null);
    try {
      const defect = await api.post<{ id: string }>(`/app/external-audits/${audit.id}/findings/${finding.id}/promote-to-defect`, { assetId, severity });
      onCreated(defect.id);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al crear el defecto."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("ea.finding.promoteToDefect")}</p>
              <h2 className="text-sm font-bold text-fg">{audit.auditCode}{finding.findingCode ? ` · ${finding.findingCode}` : ""}</h2>
            </div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className={labelCls}>{t("form.briefDesc")}</label>
            <p className="text-xs text-fg bg-fg/5 border border-fg/10 rounded-xl px-3 py-2">{finding.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label onClick={() => { void suggestAsset(); }} title={t("wo.ai.suggestAssetTooltip")}
                className={`flex items-center gap-1.5 ${labelCls} ${assets.length > 0 ? `cursor-pointer hover:text-accent ${suggesting ? "opacity-60 animate-pulse" : ""}` : "opacity-50"}`}>
                {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-accent" />}
                {t("wo.modal.equipment")} *
              </label>
              {loadingAssets
                ? <div className="flex items-center gap-2 py-2.5"><Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /></div>
                : <select value={assetId} onChange={e => { setAssetId(e.target.value); setSuggested(false); }} className={inputCls}>
                    <option value="">{t("wo.modal.selectEquipment")}</option>
                    {assets.map(a => <option key={a.id} value={a.id}>{a.assetCode} — {a.name}</option>)}
                  </select>
              }
              {suggested && assetId && <p className="text-[10px] text-accent flex items-center gap-1 mt-1"><Sparkles className="w-3 h-3" /> {t("wo.ai.assetSuggested")}</p>}
            </div>
            <div>
              <label className={labelCls}>{t("col.severity")}</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className={inputCls}>
                {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("ea.finding.createDefect")}
          </button>
        </div>
      </div>
    </div>
  );
};

const FindingAddForm: React.FC<{ auditId: string; onClose: () => void; onSaved: (created: Finding) => void }> = ({ auditId, onClose, onSaved }) => {
  const [findingCode, setFindingCode] = useState("");
  const [findingType, setFindingType] = useState("DEFICIENCY");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [detentionRelated, setDetention] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSave = async () => {
    if (!description.trim()) { setErr("Descripción requerida."); return; }
    setSaving(true); setErr(null);
    try {
      const created = await api.post<Finding>(`/app/external-audits/${auditId}/findings`, {
        findingCode: findingCode.trim() || null,
        findingType,
        category: category.trim() || null,
        description: description.trim(),
        severity: severity.trim() || null,
        detentionRelated,
        rectificationDeadline: deadline || null,
      });
      onSaved(created);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-accent/5 border border-accent/30 rounded-xl p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div><label className={labelCls}>Código</label><input value={findingCode} onChange={e => setFindingCode(e.target.value)} placeholder="30150, 7.1.2..." className={inputCls + " text-xs"} /></div>
        <div><label className={labelCls}>Tipo</label>
          <select value={findingType} onChange={e => setFindingType(e.target.value)} className={inputCls + " text-xs"}>
            {Object.entries(FINDING_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div><label className={labelCls}>Categoría</label><input value={category} onChange={e => setCategory(e.target.value)} placeholder="Safety, Pollution..." className={inputCls + " text-xs"} /></div>
        <div><label className={labelCls}>Severidad</label><input value={severity} onChange={e => setSeverity(e.target.value)} placeholder="MAJOR / MINOR / CRITICAL" className={inputCls + " text-xs"} /></div>
        <div><label className={labelCls}>Plazo rectificación</label><input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className={inputCls + " text-xs"} /></div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-xs text-fg"><input type="checkbox" checked={detentionRelated} onChange={e => setDetention(e.target.checked)} /> Detention-related</label>
        </div>
      </div>
      <div><label className={labelCls}>Descripción *</label><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} className={inputCls + " text-xs resize-y"} /></div>
      {err && <p className="text-[11px] text-red-700 dark:text-red-400">{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-industrial">Cancelar</button>
        <button onClick={() => { void onSave(); }} disabled={saving} className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs disabled:opacity-50">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Agregar"}
        </button>
      </div>
    </div>
  );
};

const FindingEditForm: React.FC<{ auditId: string; finding: Finding; onClose: () => void; onSaved: () => void }> = ({ auditId, finding, onClose, onSaved }) => {
  const t = useT();
  const [status, setStatus] = useState(finding.status);
  const [clearingDate, setClearingDate] = useState(finding.clearingDate?.slice(0, 10) ?? "");
  const [evidenceNotes, setEvidenceNotes] = useState(finding.evidenceNotes ?? "");
  const [evidenceDocUrl, setEvidenceDocUrl] = useState(finding.evidenceDocUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSave = async () => {
    setSaving(true); setErr(null);
    try {
      await api.patch(`/app/external-audits/${auditId}/findings/${finding.id}`, {
        status,
        clearingDate: clearingDate || null,
        evidenceNotes: evidenceNotes.trim() || null,
        evidenceDocUrl: evidenceDocUrl.trim() || null,
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };
  const onDelete = async () => {
    if (!window.confirm(t("confirm.deleteFinding"))) return;
    try { await api.delete(`/app/external-audits/${auditId}/findings/${finding.id}`); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  return (
    <div className="bg-fg/[0.04] border border-fg/10 rounded-lg p-2 space-y-2 mt-1">
      <div className="grid grid-cols-2 gap-2">
        <div><label className={labelCls}>Estado</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls + " text-xs"}>
            {["OPEN", "IN_PROGRESS", "CLOSED", "REJECTED_BY_AUDITOR"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div><label className={labelCls}>Fecha de cierre</label>
          <input type="date" value={clearingDate} onChange={e => setClearingDate(e.target.value)} className={inputCls + " text-xs"} />
        </div>
      </div>
      <div><label className={labelCls}>Notas de evidencia</label>
        <textarea rows={2} value={evidenceNotes} onChange={e => setEvidenceNotes(e.target.value)} className={inputCls + " text-xs resize-y"} />
      </div>
      <div><label className={labelCls}>URL evidencia</label>
        <input value={evidenceDocUrl} onChange={e => setEvidenceDocUrl(e.target.value)} className={inputCls + " text-xs"} />
      </div>
      {err && <p className="text-[11px] text-red-700 dark:text-red-400">{err}</p>}
      <div className="flex justify-between gap-2">
        <button onClick={() => { void onDelete(); }} className="px-3 py-1 rounded-lg text-[10px] text-red-700 dark:text-red-400 hover:text-red-300">Eliminar</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3 py-1 rounded-lg text-xs text-text-industrial">Cancelar</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-3 py-1 rounded-lg bg-accent text-accent-fg font-bold text-xs disabled:opacity-50">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const ExternalAuditsPage: React.FC = () => {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<"all" | "open">("all");
  const path = useMemo(() => filter === "open" ? "/app/external-audits" : "/app/external-audits", [filter]);
  const { data, loading, reload } = useFetch<{ items: Audit[]; total: number }>(path, [path]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Audit | null>(null);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (filter === "open") return all.filter(a => (a.findingsOpen ?? 0) > 0);
    return all;
  }, [data, filter]);

  // Apertura directa por ?auditId= (ej. navegación desde un Defecto vinculado).
  const autoAuditId = searchParams.get("auditId");
  useEffect(() => {
    if (!autoAuditId || editing) return;
    const found = (data?.items ?? []).find(a => a.id === autoAuditId);
    if (found) {
      setEditing(found);
      searchParams.delete("auditId");
      setSearchParams(searchParams, { replace: true });
    }
  }, [autoAuditId, data, editing, searchParams, setSearchParams]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={ClipboardCheck} title={t("nav.externalAudits")} total={items.length} onReload={reload}>
        <ExportExcelButton module="external_audits" />
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> {t("ea.newButton")}
        </button>
      </PageHeader>

      <div className="flex gap-2">
        {([["all", "Todas"], ["open", "Con findings abiertos"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
              filter === v ? "bg-accent/15 text-accent border-accent/40" : "bg-fg/5 text-text-industrial/60 border-fg/10"
            }`}
          >{l}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">Sin auditorías registradas.</div>
      ) : (
        <div className="bg-fg/5 border border-fg/10 rounded-xl divide-y divide-fg/5">
          {items.map(a => (
            <button key={a.id} onClick={() => setEditing(a)} className="w-full text-left p-4 hover:bg-fg/5 transition-colors flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-text-industrial/40">{a.auditCode}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-bold bg-fg/5 text-fg border-fg/10">
                    {AUDIT_TYPE_LABEL[a.auditType] ?? a.auditType}
                  </span>
                  <VesselLabel code={a.vesselCode} className="text-[10px]" showCode />
                  {(a.findingsOpen ?? 0) > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">
                      {a.findingsOpen} abiertos
                    </span>
                  )}
                  {(a.findingsTotal ?? 0) > 0 && (a.findingsOpen ?? 0) === 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-bold bg-success-sea/10 text-success-sea border-success-sea/30 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {t("status.closed")}
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold text-fg">{a.agencyOrAuthority ?? "—"} {a.port ? `· ${a.port}` : ""}{a.country ? `, ${a.country}` : ""}</p>
                {a.summary && <p className="text-xs text-text-industrial/50 line-clamp-1">{a.summary}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-fg font-mono">{fmtDate(a.auditDate)}</p>
                <p className="text-[10px] text-text-industrial/40">{a.findingsTotal ?? 0} findings</p>
                {a.overallResult && <p className="text-[10px] text-accent">{a.overallResult}</p>}
              </div>
              {a.reportUrl && (
                <a href={a.reportUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title="Informe original" className="p-1 text-text-industrial/40 hover:text-accent">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </button>
          ))}
        </div>
      )}

      {(showCreate || editing) && (
        <AuditModal
          audit={editing}
          onClose={() => { setShowCreate(false); setEditing(null); void reload(); }}
          onSaved={() => { void reload(); }}
        />
      )}
    </div>
  );
};
