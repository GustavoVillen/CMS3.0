// Informe de salud del equipo (Preview V43).
//
// Ventana grande encima de la ficha del equipo: a la izquierda el historial de
// informes (inmutables, el más nuevo arriba), a la derecha el informe elegido.
// "Generar nuevo" y el arranque automático sólo para quien tiene
// `assetHealth.generate`; el resto (Capitán / Jefe de Máquinas) lee y descarga.
//
// Los números de las tarjetas vienen de `metrics` (los calcula el backend); el
// texto de las secciones es de la IA y se rotula como tal.
import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, FileDown, Loader2, Wrench, FlaskConical, AlertTriangle, Lightbulb, Paperclip, Info } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT, type TranslationKey } from "../../lib/i18n";
import { fmtDate } from "../../lib/utils";
import { ModalCloseButton } from "../ModalCloseButton";
import { AlertDialog } from "../AlertDialog";

export type HealthState = "GOOD" | "ATTENTION" | "RISK";

export interface HealthReportSummary {
  id: string;
  healthState: HealthState;
  periodFrom: string;
  periodTo: string;
  createdAt: string;
  createdByName: string | null;
}

interface HealthReportFull extends HealthReportSummary {
  metrics: {
    plansActive: number; plansOverdue: number; plansDueSoon: number;
    defectsOpen: number; labBad: number; labCaution: number;
    currentHours: number | null; currentHoursDate: string | null;
  };
  report: {
    summary: string; maintenance: string; lab: string; defects: string;
    recommendations: string[]; limitations: string;
  };
  sources: {
    plans: number; workOrders: number; workLogs: number; labAnalyses: number; defects: number;
    deferrals: number; inspections: number; mocs: number; hoursReadings: number; alerts: number;
  };
}

export const HEALTH_STATE_STYLE: Record<HealthState, { dot: string; box: string; title: string }> = {
  GOOD:      { dot: "bg-emerald-500", box: "border-emerald-400/60 bg-emerald-500/[0.07]", title: "text-emerald-700 dark:text-emerald-400" },
  ATTENTION: { dot: "bg-amber-500",   box: "border-amber-400/60 bg-amber-500/[0.08]",     title: "text-amber-800 dark:text-amber-300" },
  RISK:      { dot: "bg-red-500",     box: "border-red-400/60 bg-red-500/[0.07]",         title: "text-red-700 dark:text-red-400" },
};

interface Props {
  asset: { id: string; assetCode: string; name: string | null };
  vesselName: string;
  canGenerate: boolean;
  /** Historial ya cargado por la ficha (evita un segundo pedido al abrir). */
  initialItems: HealthReportSummary[];
  /** Sin informes y con permiso: se abre generando. */
  generateOnOpen: boolean;
  onClose: () => void;
  /** Avisar a la ficha que cambió el historial (para refrescar el botón). */
  onChanged: (items: HealthReportSummary[]) => void;
}

export const AssetHealthReportModal: React.FC<Props> = ({ asset, vesselName, canGenerate, initialItems, generateOnOpen, onClose, onChanged }) => {
  const t = useT();
  const [items, setItems] = useState<HealthReportSummary[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [report, setReport] = useState<HealthReportFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const assetLabel = asset.name ?? asset.assetCode;
  const base = `/app/pms/assets/${asset.id}/health-reports`;

  const openReport = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    try {
      setReport(await api.get<HealthReportFull>(`${base}/${id}`));
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("asset.health.loadError"));
    } finally {
      setLoading(false);
    }
  }, [base, t]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const created = await api.post<HealthReportFull>(base);
      const next = [{
        id: created.id, healthState: created.healthState, periodFrom: created.periodFrom, periodTo: created.periodTo,
        createdAt: created.createdAt, createdByName: created.createdByName,
      }, ...items];
      setItems(next);
      setSelectedId(created.id);
      setReport(created);
      onChanged(next);
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("asset.health.error"));
    } finally {
      setGenerating(false);
    }
  }, [base, items, onChanged, t]);

  // Al abrir: el más nuevo, o generar si no hay ninguno y se puede.
  useEffect(() => {
    if (initialItems[0]) void openReport(initialItems[0].id);
    else if (generateOnOpen && canGenerate) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadPdf = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      const token = localStorage.getItem("gpms_token") ?? "";
      const slug = localStorage.getItem("gpms_tenant_slug") ?? "";
      const res = await fetch(`${base}/${report.id}/pdf`, { headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug } });
      if (!res.ok) throw new Error("pdf");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe-salud-${asset.assetCode.replace(/[^A-Za-z0-9._-]+/g, "")}-${report.createdAt.slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setAlert(t("asset.health.pdfError"));
    } finally {
      setDownloading(false);
    }
  };

  const fill = (key: TranslationKey, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), t(key));
  const dateTime = (iso: string) =>
    `${fmtDate(iso)} ${new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}`;
  const stateLabel = (s: HealthState) => t(`asset.health.state.${s}` as TranslationKey);

  // Portal al body: la ficha del equipo tiene backdrop-blur y overflow-hidden, y un
  // `fixed` adentro quedaría atado a esa caja en vez de a la pantalla.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-6xl max-h-[92vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 border-t-4 border-t-violet-600 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          {/* Encabezado */}
          <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-fg/10 shrink-0">
            <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-violet-500/15 text-violet-700 dark:text-violet-300"><Sparkles className="w-6 h-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-violet-700 dark:text-violet-300 truncate">
                {fill("asset.health.kicker", { asset: assetLabel, vessel: vesselName })}
              </p>
              {report ? (
                <>
                  <h2 className="text-base font-black text-fg leading-tight">{fill("asset.health.generatedBy", { date: dateTime(report.createdAt), name: report.createdByName ?? "—" })}</h2>
                  <p className="text-xs text-text-industrial/60">{fill("asset.health.period", { from: fmtDate(report.periodFrom), to: fmtDate(report.periodTo) })}</p>
                </>
              ) : (
                <h2 className="text-base font-black text-fg leading-tight">{assetLabel}</h2>
              )}
            </div>
            {report && (
              <button type="button" onClick={() => { void downloadPdf(); }} disabled={downloading || generating}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-fg/10 text-xs font-bold text-fg hover:border-accent/30 disabled:opacity-50">
                {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5 text-accent" />} {t("asset.health.downloadPdf")}
              </button>
            )}
            {canGenerate && (
              <button type="button" onClick={() => { void generate(); }} disabled={generating}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:brightness-110 disabled:opacity-50">
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} {t("asset.health.generateNew")}
              </button>
            )}
            <ModalCloseButton onClose={onClose} />
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[230px_1fr]">
            {/* Historial */}
            <aside className="border-b md:border-b-0 md:border-r border-fg/10 bg-fg/[0.02] p-3 overflow-y-auto max-h-48 md:max-h-none">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-text-industrial/50 mb-2">{t("asset.health.history")}</p>
              <div className="space-y-1.5">
                {items.map(it => (
                  <button key={it.id} type="button" onClick={() => { void openReport(it.id); }} disabled={generating}
                    className={`w-full text-left rounded-xl border px-2.5 py-2 text-[11.5px] transition-colors ${
                      it.id === selectedId ? "border-violet-500 ring-2 ring-violet-500/15 bg-surface" : "border-fg/10 bg-surface hover:border-violet-400/50"
                    }`}>
                    <span className="block text-xs font-bold text-fg">{fmtDate(it.createdAt)}</span>
                    <span className="inline-flex items-center gap-1 text-text-industrial/70">
                      <span className={`inline-block w-2 h-2 rounded-full ${HEALTH_STATE_STYLE[it.healthState]?.dot ?? "bg-slate-400"}`} />
                      {stateLabel(it.healthState)} · {it.createdByName ?? "—"}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            {/* Informe */}
            <div className="min-w-0 overflow-y-auto px-4 sm:px-6 py-4">
              {generating ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <Loader2 className="w-9 h-9 animate-spin text-violet-600" />
                  <p className="text-sm font-bold text-fg">{fill("asset.health.generating", { asset: assetLabel })}</p>
                  <p className="text-xs text-text-industrial/60 max-w-md">{t("asset.health.generatingSub")}</p>
                </div>
              ) : loading || !report ? (
                <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-text-industrial/40" /></div>
              ) : (
                <ReportBody report={report} t={t} fill={fill} stateLabel={stateLabel} />
              )}
            </div>
          </div>
        </div>
      </div>
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </>,
    document.body,
  );
};

const ReportBody: React.FC<{
  report: HealthReportFull;
  t: (k: TranslationKey) => string;
  fill: (k: TranslationKey, v: Record<string, string | number>) => string;
  stateLabel: (s: HealthState) => string;
}> = ({ report, t, fill, stateLabel }) => {
  const m = report.metrics;
  const s = report.sources;
  const style = HEALTH_STATE_STYLE[report.healthState] ?? HEALTH_STATE_STYLE.ATTENTION;
  const aiTag = (key: TranslationKey) => (
    <span className="ml-1.5 rounded-full border border-violet-400/40 bg-violet-500/[0.07] px-2 py-0.5 text-[10px] font-extrabold text-violet-700 dark:text-violet-300 align-middle">{t(key)}</span>
  );
  const kpis: Array<[string, string]> = [
    [fill("asset.health.kpiOf", { n: m.plansOverdue, total: m.plansActive }), t("asset.health.kpiOverdue")],
    [String(m.defectsOpen), t("asset.health.kpiDefects")],
    [`${m.labBad} / ${m.labCaution}`, t("asset.health.kpiLab")],
    [
      m.currentHours != null ? `${Math.round(m.currentHours).toLocaleString("es-AR")} h` : "—",
      m.currentHoursDate ? fill("asset.health.kpiHoursAt", { date: fmtDate(m.currentHoursDate) }) : t("asset.health.kpiHours"),
    ],
  ];

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-2xl border-[1.5px] px-3.5 py-3 ${style.box}`}>
        <Info className={`w-6 h-6 shrink-0 mt-0.5 ${style.title}`} />
        <div className="min-w-0">
          <p className={`text-base font-black ${style.title}`}>{stateLabel(report.healthState)}{aiTag("asset.health.aiReading")}</p>
          <p className="text-[13px] text-fg/85 leading-relaxed mt-0.5">{report.report.summary}</p>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {kpis.map(([value, label]) => (
            <div key={label} className="rounded-xl border border-fg/10 px-3 py-2">
              <p className="text-xl font-black text-fg">{value}</p>
              <p className="text-[11px] text-text-industrial/60">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10.5px] text-text-industrial/45">{t("asset.health.numbersNote")}</p>
      </div>

      <Section icon={<Wrench className="w-4 h-4 text-sky-600" />} title={t("asset.health.secMaintenance")} text={report.report.maintenance} />
      <Section icon={<FlaskConical className="w-4 h-4 text-violet-600" />} title={t("asset.health.secLab")} text={report.report.lab} />
      <Section icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} title={t("asset.health.secDefects")} text={report.report.defects} />

      <div>
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-black text-fg mb-1.5"><Lightbulb className="w-4 h-4 text-violet-600" />{t("asset.health.secRecommendations")}{aiTag("asset.health.aiSuggestions")}</h3>
        <div className="space-y-1.5">
          {report.report.recommendations.map((r, i) => (
            <div key={i} className="rounded-lg border-l-[3px] border-violet-500 bg-violet-500/[0.05] px-3 py-2 text-[13px] text-fg/85">
              <b>{i + 1}.</b> {r}
            </div>
          ))}
        </div>
      </div>

      {report.report.limitations && (
        <Section icon={<Info className="w-4 h-4 text-text-industrial/50" />} title={t("asset.health.secLimitations")} text={report.report.limitations} />
      )}

      <div>
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-black text-fg mb-1.5"><Paperclip className="w-4 h-4 text-text-industrial/50" />{t("asset.health.secSources")}</h3>
        <div className="rounded-xl border border-fg/10 bg-fg/[0.03] px-3 py-2 text-[11.5px] text-text-industrial/70 leading-relaxed">
          {fill("asset.health.sources", {
            plans: s.plans, wos: s.workOrders, logs: s.workLogs, lab: s.labAnalyses, defects: s.defects,
            deferrals: s.deferrals, insp: s.inspections, moc: s.mocs, hours: s.hoursReadings, alerts: s.alerts,
          })}
          <br />{t("asset.health.disclaimer")}
        </div>
      </div>
    </div>
  );
};

/** Sección de texto de la IA: las líneas "- " se muestran como viñetas. */
const Section: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => {
  const lines = (text || "—").split("\n").map(l => l.trim()).filter(Boolean);
  const bullets = lines.every(l => /^[-•*]\s+/.test(l));
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-black text-fg mb-1.5">{icon}{title}</h3>
      {bullets ? (
        <ul className="list-disc pl-5 space-y-1 text-[13px] text-fg/85 leading-relaxed">
          {lines.map((l, i) => <li key={i}>{l.replace(/^[-•*]\s+/, "").replace(/\*\*/g, "")}</li>)}
        </ul>
      ) : (
        <div className="space-y-1 text-[13px] text-fg/85 leading-relaxed">
          {lines.map((l, i) => <p key={i}>{l.replace(/\*\*/g, "")}</p>)}
        </div>
      )}
    </div>
  );
};
