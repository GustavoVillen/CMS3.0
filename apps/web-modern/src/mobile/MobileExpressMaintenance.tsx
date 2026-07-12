// MobileExpressMaintenance — versión móvil del módulo "Mantenimiento Express".
//
// Espeja la pantalla de escritorio (/mantenimiento-express): lista los planes
// ACTIVOS cuyo triggerResultMode === "EXPRESS" y permite REPORTAR la ejecución
// con paridad de campos respecto al ExecutionModal de escritorio
// (ejecutor, resultado, fecha, horas, repuestos, notas, deficiencias + IA,
// checklist, guardar / guardar+PDF, abrir DEF). Reutiliza el mismo componente
// SpareUsageEditor y los mismos endpoints del backend — no toca schema.
//
// Se abre desde el FAB "+" (acción rápida) del MobileLayout; por eso recibe
// onBack para volver al Panel, igual que las otras sub-vistas (Tripulación…).

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { ChevronLeft, Loader2, Zap, X, FileDown, Search, Wrench } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useT, useWoTerms } from "../lib/i18n";
import { useEscapeGuard } from "../lib/escape-guard";
import { SpareUsageEditor, type SpareLine } from "../components/SpareUsageEditor";
import { ModalCloseButton } from "../components/ModalCloseButton";

interface Plan {
  id: string;
  taskCode: string;
  title: string;
  description: string | null;
  vesselCode: string;
  assetId: string;
  assetName: string | null;
  triggerType: string;
  triggerResultMode?: string;
  estimatedHours: number | null;
  executionStatus: string;
  nextDueDate: string | null;
  nextDueHours: number | null;
  lastExecutionDate: string | null;
  activeWorkOrderCode: string | null;
  taskType: "MAINTENANCE" | "INSPECTION";
}

// Roles que pueden reportar en nombre de otro usuario (espejo del desktop).
const ADMIN_ROLES = new Set(["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"]);

function needsHours(tt: string) { return tt === "HOURS" || tt === "RUNNING_HOURS"; }
function normalizeOptionalText(value: string): string | null {
  const t = value.trim();
  return t || null;
}

interface TeamMember { userId: string; firstName: string | null; lastName: string | null; formName: string | null; hasSignature: boolean }
const teamMemberName = (u: TeamMember) => (u.formName || [u.firstName, u.lastName].filter(Boolean).join(" ") || "").trim();

const STATUS_COLOR: Record<string, string> = {
  OVERDUE:   "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  DUE:       "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  IN_WINDOW: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  UPCOMING:  "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  FUTURE:    "bg-fg/5 text-text-industrial/40 border-fg/10",
  COMPLETED: "bg-success-sea/10 text-success-sea border-success-sea/30",
};
const STATUS_LABEL: Record<string, string> = {
  OVERDUE:   "Vencido",
  DUE:       "Próximo",
  IN_WINDOW: "OT abierta",
  UPCOMING:  "Por vencer",
  FUTURE:    "Futuro",
  COMPLETED: "Completado",
};

interface MobileExpressMaintenanceProps {
  /** Vuelve al Panel — esta pantalla se abre desde el FAB, sin tab en la barra. */
  onBack?: () => void;
}

export const MobileExpressMaintenance: React.FC<MobileExpressMaintenanceProps> = ({ onBack }) => {
  const { data, loading, reload } = useFetch<{ items: Plan[] }>("/app/pms/maintenance-plans?status=ACTIVE");
  const woTerms = useWoTerms();
  const statusLabel = (s: string) => s === "IN_WINDOW" ? `${woTerms.abbr} abierta` : (STATUS_LABEL[s] ?? s);
  const [search, setSearch] = useState("");
  const [reporting, setReporting] = useState<Plan | null>(null);

  const expressPlans = useMemo(() => {
    const items = (data?.items ?? []).filter(p => p.triggerResultMode === "EXPRESS");
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(p =>
      p.taskCode.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      (p.assetName ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const handleReported = useCallback(() => {
    setReporting(null);
    void reload();
  }, [reload]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 p-4 border-b border-fg/10">
        {onBack && (
          <button type="button" onClick={onBack} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <Zap className="w-5 h-5 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-fg truncate">Mantenimiento Express</h1>
          <p className="text-[10px] text-text-industrial/50">{expressPlans.length} tareas</p>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-2.5 border-b border-fg/10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-industrial/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por código, tarea o equipo…"
            className="w-full bg-fg/5 border border-fg/10 rounded-xl pl-9 pr-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-fg/5">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
        ) : expressPlans.length === 0 ? (
          <div className="text-center py-12 text-text-industrial/30 text-sm flex flex-col items-center gap-2">
            <Wrench className="w-6 h-6 text-text-industrial/20" />
            <span>Sin tareas de mantenimiento express</span>
          </div>
        ) : (
          expressPlans.map(plan => (
            <div key={plan.id} className="px-4 py-3.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-text-industrial/40">{plan.taskCode}</span>
                  <span className={`text-[9px] px-1.5 py-px rounded-full border font-bold ${STATUS_COLOR[plan.executionStatus] ?? ""}`}>
                    {statusLabel(plan.executionStatus)}
                  </span>
                </div>
                <p className="text-sm font-semibold text-fg leading-tight">{plan.title}</p>
                {plan.assetName && <p className="text-[11px] text-text-industrial/50 mt-0.5 truncate">{plan.assetName}</p>}
                <p className="text-[10px] font-mono text-text-industrial/30 mt-0.5">{plan.vesselCode}</p>
              </div>
              <button
                type="button"
                onClick={() => setReporting(plan)}
                className="shrink-0 self-center px-3 py-2 rounded-xl bg-success-sea/10 border border-success-sea/30 text-success-sea text-xs font-bold active:scale-95 transition-transform flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                Reportar
              </button>
            </div>
          ))
        )}
      </div>

      {reporting && (
        <ReportSheet plan={reporting} onClose={() => setReporting(null)} onSuccess={handleReported} />
      )}
    </div>
  );
};

// ─── Hoja de reporte (móvil) — espejo del ExecutionModal de escritorio ────────

interface ReportSheetProps {
  plan: Plan;
  onClose: () => void;
  onSuccess: () => void;
}

const ReportSheet: React.FC<ReportSheetProps> = ({ plan, onClose, onSuccess }) => {
  const t = useT();
  const { user } = useAuth();
  const userName = user?.name ?? user?.email ?? "";
  const userId = user?.id ?? null;
  const isAdmin = ADMIN_ROLES.has(user?.role ?? "");

  const [executedByName, setExecutedByName] = useState(userName);
  const [executedByUserId, setExecutedByUserId] = useState<string>(userId ?? "");
  const [teamUsers, setTeamUsers] = useState<TeamMember[]>([]);
  const [result, setResult] = useState<"SATISFACTORIO" | "CON_DEFICIENCIAS">("SATISFACTORIO");
  const [notes, setNotes] = useState("");
  const [deficienciesNotes, setDeficienciesNotes] = useState("");
  const [completedAt, setCompletedAt] = useState(new Date().toISOString().slice(0, 10));
  const [runningHours, setRunningHours] = useState("");
  const [spareUsages, setSpareUsages] = useState<SpareLine[]>([]);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingDefect, setOpeningDefect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const isHoursBased = needsHours(plan.triggerType);

  // Solo el admin puede reportar en nombre de otro usuario → carga el equipo.
  useEffect(() => {
    if (!isAdmin) return;
    api.get<TeamMember[]>("/app/team/members")
      .then(rows => setTeamUsers(Array.isArray(rows) ? rows : []))
      .catch(() => setTeamUsers([]));
  }, [isAdmin]);

  // Prellenar repuestos con los de la última ejecución (así no hay que reelegir
  // el mismo aceite cada vez). El SpareUsageEditor hidrata nombre/stock al cargar.
  useEffect(() => {
    let cancelled = false;
    api.get<{ lines: Array<{ spareId: string; qty: number; unit: string }> }>(
      `/app/pms/maintenance-plans/${plan.id}/last-spare-usage`,
    ).then(res => {
      if (cancelled || !res?.lines?.length) return;
      setSpareUsages(res.lines.map(l => ({
        spareId: l.spareId, spareName: "", unit: l.unit, qty: l.qty, criticality: "C", available: 0,
      })));
    }).catch(() => { /* sin previa → lista vacía */ });
    return () => { cancelled = true; };
  }, [plan.id]);

  // Análisis IA de deficiencias (debounced), igual que escritorio.
  useEffect(() => {
    if (result !== "CON_DEFICIENCIAS" || !deficienciesNotes.trim()) {
      setAiSuggestion(null); setAiLoading(false); return;
    }
    setAiLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.post<{ suggestion: string }>("/app/copiloto/analyze-deficiency", {
          planTitle: plan.title,
          vesselCode: plan.vesselCode,
          deficienciesNotes: deficienciesNotes.trim(),
        });
        setAiSuggestion(res.suggestion ?? null);
      } catch { setAiSuggestion(null); }
      finally { setAiLoading(false); }
    }, 1200);
    return () => clearTimeout(timer);
  }, [deficienciesNotes, result, plan.title, plan.vesselCode]);

  const doSave = async (): Promise<boolean> => {
    if (!executedByName.trim()) { setError(t("mp.exec.executorRequired")); return false; }
    if (result === "CON_DEFICIENCIAS" && !deficienciesNotes.trim()) {
      setError(t("mp.exec.deficienciesRequired")); return false;
    }
    setSaving(true); setError(null);
    try {
      if (docFile) {
        setUploading(true);
        await api.upload(`/app/pms/maintenance-plans/${plan.id}/upload-checklist`, docFile);
        setUploading(false);
      }
      await api.post(`/app/pms/maintenance-plans/${plan.id}/report-execution`, {
        executedByName: executedByName.trim(),
        executedByUserId: executedByUserId || null,
        result,
        notes: normalizeOptionalText(notes),
        deficienciesNotes: result === "CON_DEFICIENCIAS" ? normalizeOptionalText(deficienciesNotes) : null,
        completedAt,
        runningHoursAtExecution: isHoursBased && runningHours ? Number(runningHours) : null,
        spareUsages: spareUsages.map(u => ({ spareId: u.spareId, qty: u.qty, unit: u.unit })),
      });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("mp.exec.saveError"));
      return false;
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  const handleSave = async () => { if (await doSave()) onSuccess(); };

  const handleSaveAndPdf = async () => {
    if (!await doSave()) return;
    const token = localStorage.getItem("gpms_token");
    const slug  = localStorage.getItem("gpms_tenant_slug");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (slug)  headers["X-Tenant-Slug"] = slug;
    try {
      const res = await fetch(`/app/pms/maintenance-plans/${plan.id}/pdf`, { headers });
      if (res.ok) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        const prefix = plan.taskType === "INSPECTION" ? "INSP" : "MANT";
        const ymd = (completedAt || new Date().toISOString().slice(0, 10)).replace(/-/g, ".");
        const assetShort = (plan.assetName ?? "").split(",")[0]?.trim() ?? "";
        const ref = [plan.title, assetShort].filter(Boolean).join(" ").trim();
        const rawName = `${prefix}-${ymd}-${plan.taskCode ?? plan.id}${ref ? `-${ref}` : ""}`;
        const safeName = rawName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
        a.download = `${safeName}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch {
      window.alert(t("mp.exec.pdfFailed"));
    }
    onSuccess();
  };

  // Abrir registro DEF a partir de la deficiencia (crea el defecto y confirma).
  const handleOpenDef = async () => {
    if (!await doSave()) return;
    setOpeningDefect(true);
    try {
      const defect = await api.post<{ id: string; defectCode: string }>("/app/pms/defects", {
        vesselCode: plan.vesselCode,
        assetId: plan.assetId,
        classification: t("mp.exec.defectClassification"),
        description: deficienciesNotes.trim() || `${t("mp.exec.defectFromPlan")} ${plan.taskCode}`,
        severity: "LOW",
        operationalState: "NORMAL",
      });
      window.alert(`${t("mp.exec.defectClassification")}: ${defect.defectCode}`);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("mp.exec.defectFailed"));
    } finally {
      setOpeningDefect(false);
    }
  };

  const busy = saving || uploading || openingDefect;
  useEscapeGuard({ enabled: true, isDirty: false, onClose });

  const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
  const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider mb-1.5";

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-surface dark:bg-[#0A1A2A]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-fg/10">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-fg truncate">{t("mp.exec.reportTitle")}</h2>
          <p className="text-[11px] text-text-industrial/50 font-mono truncate">{plan.taskCode} · {plan.vesselCode}</p>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Result */}
        <div>
          <label className={labelCls}>{t("mp.exec.resultLabel")}</label>
          <div className="flex gap-2">
            {(["SATISFACTORIO", "CON_DEFICIENCIAS"] as const).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setResult(r)}
                className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                  result === r
                    ? r === "SATISFACTORIO"
                      ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                      : "bg-yellow-500/15 border-yellow-500/50 text-yellow-700 dark:text-yellow-400"
                    : "bg-fg/5 border-fg/10 text-text-industrial/50"
                }`}
              >
                {r === "SATISFACTORIO" ? t("mp.exec.satisfactory") : t("mp.exec.withDeficiencies")}
              </button>
            ))}
          </div>
        </div>

        {/* Executed by */}
        <div>
          <label className={labelCls}>{t("mp.exec.executedBy")}</label>
          {isAdmin && teamUsers.length > 0 ? (
            <select
              value={executedByUserId}
              onChange={e => {
                const uid = e.target.value;
                setExecutedByUserId(uid);
                const m = teamUsers.find(u => u.userId === uid);
                if (m) setExecutedByName(teamMemberName(m) || executedByName);
              }}
              className={inputCls}
            >
              {!teamUsers.some(u => u.userId === (userId ?? "")) && (
                <option value={userId ?? ""}>{userName}</option>
              )}
              {teamUsers.map(u => (
                <option key={u.userId} value={u.userId}>
                  {teamMemberName(u) || u.userId}{!u.hasSignature ? "  ·  (sin firma)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input value={executedByName} onChange={e => setExecutedByName(e.target.value)} className={inputCls} />
          )}
        </div>

        {/* Date */}
        <div>
          <label className={labelCls}>{t("mp.exec.executionDate")}</label>
          <input type="date" value={completedAt} onChange={e => setCompletedAt(e.target.value)} className={inputCls} />
        </div>

        {/* Running hours */}
        {isHoursBased && (
          <div>
            <label className={labelCls}>{t("mp.exec.runningHoursLabel")}</label>
            <input type="number" min="0" value={runningHours} onChange={e => setRunningHours(e.target.value)}
              className={inputCls} placeholder={t("wo.modal.runningHoursPlaceholder")} />
          </div>
        )}

        {/* Repuestos utilizados */}
        <SpareUsageEditor vesselCode={plan.vesselCode} value={spareUsages} onChange={setSpareUsages} />

        {/* Notes */}
        <div>
          <label className={labelCls}>{t("wo.modal.observations")}</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            className={inputCls} placeholder={t("mp.exec.notesPlaceholder")} />
        </div>

        {/* Deficiencies */}
        {result === "CON_DEFICIENCIAS" && (
          <div>
            <label className={labelCls + " text-yellow-700 dark:text-yellow-400"}>{t("mp.exec.deficienciesLabel")}</label>
            <textarea value={deficienciesNotes} onChange={e => setDeficienciesNotes(e.target.value)} rows={4}
              className={`${inputCls} border-yellow-500/30 focus:border-yellow-400/50`} placeholder={t("mp.exec.deficienciesPlaceholder")} />
          </div>
        )}

        {/* Checklist upload */}
        <div>
          <label className={labelCls}>{t("mp.exec.checklistLabel")}</label>
          {docFile ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20">
              <span className="text-xs text-accent flex-1 truncate">{docFile.name}</span>
              <button type="button" onClick={() => setDocFile(null)} className="text-text-industrial/40 hover:text-fg"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-fg/20 cursor-pointer hover:border-accent/40 transition-colors">
              <span className="text-xs text-text-industrial/50">{t("mp.exec.selectFile")}</span>
              <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                onChange={e => setDocFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        {/* DEF question — con IA */}
        {result === "CON_DEFICIENCIAS" && (
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
            <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 uppercase tracking-wider">{t("mp.exec.defLogQuestion")}</p>
            {aiLoading && (
              <div className="flex items-center gap-2 text-xs text-text-industrial/50">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                {t("mp.exec.copilotAnalyzing")}
              </div>
            )}
            {aiSuggestion && !aiLoading && (
              <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
                <p className="text-[10px] font-bold text-accent uppercase tracking-wider mb-1.5">{t("mp.exec.copilotSuggestion")}</p>
                <p className="text-xs text-fg/80 whitespace-pre-wrap">{aiSuggestion}</p>
              </div>
            )}
            <button type="button" onClick={() => void handleOpenDef()} disabled={busy}
              className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-400 font-bold text-xs disabled:opacity-50 flex items-center justify-center gap-2">
              {(saving || openingDefect) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {t("mp.exec.openDefRecord")}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-fg/10 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-xs text-text-industrial/60 hover:text-fg">{t("common.cancel")}</button>
        <button type="button" onClick={() => void handleSave()} disabled={busy}
          className="flex-1 py-2.5 rounded-xl bg-success-sea/15 border border-success-sea/40 text-success-sea font-bold text-xs disabled:opacity-50 flex items-center justify-center gap-1.5">
          {saving && !uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
        </button>
        <button type="button" onClick={() => void handleSaveAndPdf()} disabled={busy}
          className="flex-1 py-2.5 rounded-xl bg-accent text-accent-fg font-bold text-xs disabled:opacity-50 flex items-center justify-center gap-1.5">
          {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("mp.exec.uploading")}</>
            : saving ? <Loader2 className="w-4 h-4 animate-spin" />
            : <><FileDown className="w-3.5 h-3.5" /> {t("mp.exec.saveAndPdf")}</>}
        </button>
      </div>
    </div>
  );
};
