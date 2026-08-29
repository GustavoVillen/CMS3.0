// Auditoría de IA antes de cerrar una Orden de Trabajo.
//
// Se abre al apretar "Cerrar OT" y corre ANTES del cierre real: su informe puede
// terminar pegado en Observaciones, y Observaciones viaja en el cuerpo del
// cierre. El backend hace el análisis (work-order-close-audit.ts).
//
// La auditoría NO frena el cierre (decisión de producto): muestra, pregunta y
// recomienda; cerrar o no lo decide la persona. Si la IA falla, esta ventana lo
// dice y deja cerrar igual — un problema de la IA no puede trabar la operación.

import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2,
  HelpCircle, ArrowRight, Sparkles,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT, type TranslationKey } from "../../lib/i18n";
import { ModalCloseButton } from "../ModalCloseButton";
import { AutoTextArea } from "../AutoTextArea";

export interface WoCloseAuditDraft {
  woResult?: string | null;
  executedByName?: string | null;
  completedDate?: string | null;
  runningHoursAtExecution?: number | null;
  actualHours?: number | null;
  observations?: string | null;
  deficiencias?: string | null;
  pendingDetail?: string | null;
  taskCompleted?: string | null;
  spareUsages?: Array<{ name?: string | null; qty?: number | null; unit?: string | null }>;
}

interface Finding {
  criterion: string;
  evidence: string;
  recommendedAction: string;
  severity: "MAYOR" | "MENOR" | "OBSERVACION";
}

interface NextStep {
  action: string;
  why: string;
  module: string;
}

interface AuditResult {
  verdict: "CONFORME" | "CON_OBSERVACIONES" | "NO_CONFORME";
  summary: string;
  findings: Finding[];
  nextSteps: NextStep[];
  questions: string[];
  observationsText: string;
}

const VERDICT_STYLE: Record<AuditResult["verdict"], { cls: string; icon: React.ReactNode }> = {
  CONFORME: {
    cls: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    icon: <CheckCircle2 className="w-4 h-4 shrink-0" />,
  },
  CON_OBSERVACIONES: {
    cls: "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-300",
    icon: <ShieldAlert className="w-4 h-4 shrink-0" />,
  },
  NO_CONFORME: {
    cls: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300",
    icon: <AlertTriangle className="w-4 h-4 shrink-0" />,
  },
};

const SEVERITY_CLS: Record<Finding["severity"], string> = {
  MAYOR: "bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300",
  MENOR: "bg-orange-500/15 border-orange-500/30 text-orange-700 dark:text-orange-300",
  OBSERVACION: "bg-fg/10 border-fg/20 text-text-industrial/70",
};

export function WoCloseAuditModal({ workOrderId, workOrderCode, draft, onCancel, onConfirmClose }: {
  workOrderId: string;
  workOrderCode: string;
  draft: WoCloseAuditDraft;
  /** Volver a la OT sin cerrarla (para corregir lo que marcó la auditoría). */
  onCancel: () => void;
  /** Cerrar la OT. `observationsAppend` es el informe, si el usuario lo aceptó. */
  onConfirmClose: (observationsAppend: string | null) => void;
}) {
  const t = useT();
  const [result, setResult]   = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  // Las preguntas se muestran una sola vez: contestadas o salteadas, se pasa al
  // informe. Si no, una IA insistente dejaría al usuario en un bucle de dudas.
  const [answers, setAnswers]   = useState<Record<string, string>>({});
  const [asked, setAsked]       = useState(false);

  const runAudit = useCallback(async (withAnswers: Record<string, string>) => {
    setLoading(true); setError(null);
    try {
      const res = await api.post<AuditResult>(
        `/app/pms/work-orders/${workOrderId}/close-audit`,
        { draft, answers: withAnswers },
      );
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("wo.closeAudit.error"));
    } finally {
      setLoading(false);
    }
  }, [workOrderId, draft, t]);

  // Una sola corrida al abrir. `runAudit` queda fuera de las dependencias a
  // propósito: cambia con cada render del padre y re-dispararía la auditoría
  // (que es cara y lenta) sin que nadie la haya pedido.
  useEffect(() => {
    void runAudit({});
  }, []);

  const showQuestions = !loading && !error && !!result && result.questions.length > 0 && !asked;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90%] bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">
                {t("wo.closeAudit.eyebrow")}
              </p>
              <h2 className="text-sm font-bold text-fg font-mono truncate">{workOrderCode}</h2>
            </div>
          </div>
          <ModalCloseButton onClose={onCancel} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
              <p className="text-sm font-bold text-fg">{t("wo.closeAudit.running")}</p>
              <p className="text-xs text-text-industrial/50 max-w-md">{t("wo.closeAudit.runningHint")}</p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-4 space-y-1">
              <p className="text-xs font-bold text-red-700 dark:text-red-300">{t("wo.closeAudit.errorTitle")}</p>
              <p className="text-xs text-red-700 dark:text-red-300/80">{error}</p>
              <p className="text-[11px] text-text-industrial/50 pt-1">{t("wo.closeAudit.errorHint")}</p>
            </div>
          )}

          {/* Paso de dudas: la IA pregunta lo que la evidencia no resuelve. */}
          {showQuestions && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <HelpCircle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-fg">{t("wo.closeAudit.questionsTitle")}</p>
                  <p className="text-xs text-text-industrial/50">{t("wo.closeAudit.questionsHint")}</p>
                </div>
              </div>
              {result!.questions.map((q, i) => (
                <div key={i} className="space-y-1.5 rounded-xl border border-fg/10 bg-fg/5 p-3">
                  <p className="text-xs font-semibold text-fg">{q}</p>
                  <AutoTextArea
                    rows={2}
                    value={answers[q] ?? ""}
                    onChange={e => setAnswers(a => ({ ...a, [q]: e.target.value }))}
                    placeholder={t("wo.closeAudit.answerPlaceholder")}
                    className="w-full bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-lg px-2.5 py-1.5 text-xs text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Informe */}
          {!loading && !error && result && !showQuestions && (
            <div className="space-y-4">
              <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${VERDICT_STYLE[result.verdict].cls}`}>
                {VERDICT_STYLE[result.verdict].icon}
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider">
                    {t(`wo.closeAudit.verdict.${result.verdict}` as TranslationKey)}
                  </p>
                  {result.summary && <p className="text-xs leading-snug">{result.summary}</p>}
                </div>
              </div>

              {result.findings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">
                    {t("wo.closeAudit.findings")}
                  </p>
                  {result.findings.map((f, i) => (
                    <div key={i} className="rounded-xl border border-fg/10 bg-fg/5 p-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider ${SEVERITY_CLS[f.severity]}`}>
                          {t(`wo.closeAudit.severity.${f.severity}` as TranslationKey)}
                        </span>
                        <span className="text-[11px] font-bold text-accent">{f.criterion}</span>
                      </div>
                      <p className="text-xs text-fg/80 leading-snug">{f.evidence}</p>
                      {f.recommendedAction && (
                        <p className="flex items-start gap-1.5 text-xs text-text-industrial/70 leading-snug">
                          <ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-accent" />
                          <span>{f.recommendedAction}</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {result.nextSteps.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">
                    {t("wo.closeAudit.nextSteps")}
                  </p>
                  {result.nextSteps.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 p-3">
                      <Sparkles className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-semibold text-fg leading-snug">{s.action}</p>
                        <p className="text-[11px] text-text-industrial/60 leading-snug">{s.why}</p>
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded border border-fg/15 bg-fg/5 text-[9px] font-bold uppercase tracking-wider text-text-industrial/60">
                          {s.module.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result.observationsText && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40">
                    {t("wo.closeAudit.observationsPreview")}
                  </p>
                  <p className="rounded-xl border border-fg/10 bg-fg/5 p-3 text-xs text-fg/80 whitespace-pre-wrap leading-snug">
                    {result.observationsText}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-t border-fg/10 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-fg/10 text-xs font-bold text-text-industrial hover:border-accent/30 transition-colors"
          >
            {t("wo.closeAudit.back")}
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {showQuestions ? (
              <>
                <button
                  type="button"
                  onClick={() => { setAsked(true); }}
                  className="px-4 py-2 rounded-xl border border-fg/10 text-xs font-bold text-text-industrial hover:border-accent/30 transition-colors"
                >
                  {t("wo.closeAudit.skipQuestions")}
                </button>
                <button
                  type="button"
                  onClick={() => { setAsked(true); void runAudit(answers); }}
                  disabled={!Object.values(answers).some(v => v.trim())}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {t("wo.closeAudit.answerAndRerun")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onConfirmClose(null)}
                  className="px-4 py-2 rounded-xl border border-fg/10 text-xs font-bold text-text-industrial hover:border-accent/30 disabled:opacity-40 transition-colors"
                >
                  {t("wo.closeAudit.closeWithout")}
                </button>
                <button
                  type="button"
                  disabled={loading || !result?.observationsText}
                  onClick={() => onConfirmClose(result?.observationsText ?? null)}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {t("wo.closeAudit.appendAndClose")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
