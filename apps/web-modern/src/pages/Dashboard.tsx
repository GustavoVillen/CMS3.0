import React from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Ship, Sparkles, AlertCircle, Loader2, AlertTriangle, FileCheck, FileCode, Clock, Package, Droplets, FileText, ShieldAlert } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useNavigate } from "react-router-dom";
import { useT, useLocale, translate, type TranslationKey } from "../lib/i18n";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { parseLocalDate } from "../lib/utils";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useVesselContext } from "../lib/vessel-context";
import { useTheme } from "../lib/theme";
import { MyDayPanel } from "../components/MyDayPanel";
import { ComplianceDashboard } from "../components/ComplianceDashboard";
import { domToPng } from "modern-screenshot";

// ---------------------------------------------------------------------------
// Types (minimal — only fields we render)
// ---------------------------------------------------------------------------

interface WorkOrder { id: string; status: string; criticality?: string; dueDate?: string; }
interface MpSummary { counts: { NEVER_EXECUTED: number; OVERDUE: number; DUE: number; IN_WINDOW: number; UPCOMING: number; FUTURE: number }; total: number; }
interface Defect { id: string; status: string; severity: string; }
interface Certificate { id: string; status: string; expiryDate?: string; }
interface Deferral   { id: string; status: string; sourceId: string; }
interface CritSpare  { id: string; available: number; reorderPoint: number | null; }
interface SpareRequest { id: string; status: string; items: { id: string; status: string; quantity: number; quantityFulfilled: number }[]; }
interface AiInsight {
  id: string;
  insightType: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  summary: string;
  targetType: string;
}

interface ListResponse<T> { items: T[]; total: number; }

// Conteos de reportes "sin procesar" (estado inicial de cada módulo) que el
// Dashboard resalta como alerta. Subconjunto del endpoint sidebar-counts.
interface PendingCounts {
  fluidSamplesDraft: number;
  permitsDraft: number;
  defectsNew: number;
  deferralsNew: number;
  mocNew: number;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const Dashboard: React.FC = () => {
  const { vessels: contextVessels, selectedVessel, selectedVesselCode, isVesselScoped } = useVesselContext();
  const insightsPath = selectedVesselCode
    ? `/app/ai-insights?status=OPEN&vesselCode=${encodeURIComponent(selectedVesselCode)}`
    : "/app/ai-insights?status=OPEN";

  const workOrders        = useFetch<ListResponse<WorkOrder>>("/app/work-orders");
  const mpSummary         = useFetch<MpSummary>("/app/dashboard/mp-summary");
  const defects           = useFetch<ListResponse<Defect>>("/app/defects");
  const certificates      = useFetch<ListResponse<Certificate>>("/app/certificates");
  const deferrals         = useFetch<ListResponse<Deferral>>("/app/pms/deferrals");
  const insights          = useFetch<ListResponse<AiInsight>>(insightsPath, [insightsPath]);
  // Todos los repuestos (no solo criticidad A): el widget muestra el estado de
  // stock global — sin stock / bajo reorden / OK — para seguimiento completo.
  const criticalSpares    = useFetch<ListResponse<CritSpare>>("/app/pms/spares");
  const spareRequests     = useFetch<ListResponse<SpareRequest>>("/app/pms/spare-requests");
  const dailyReports      = useFetch<ListResponse<{ id: string; reportDate: string; createdAt: string }>>("/app/daily-reports");
  // Equipos fuera de servicio (OUT_OF_SERVICE) — para identificarlos de un vistazo.
  const oosAssets         = useFetch<ListResponse<{ id: string; assetCode: string; name: string; vesselCode: string; criticality: string }>>("/app/pms/assets?status=OUT_OF_SERVICE");
  // Reportes sin procesar (drafts / estado inicial) — alerta superior del Dashboard.
  const pendingCounts     = useFetch<PendingCounts>("/app/dashboard/sidebar-counts");
  const navigate     = useNavigate();
  const t            = useT();
  const locale       = useLocale();
  const { theme }    = useTheme();
  const isDark       = theme === "dark";
  // Tooltip de los gráficos, theme-aware (navy+claro en dark / blanco+oscuro en light).
  const chartTooltip = {
    contentStyle: {
      backgroundColor: isDark ? "#1C2541" : "#FFFFFF",
      border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
      borderRadius: "12px",
    },
    itemStyle: { color: isDark ? "#E0E1DD" : "#1A1D24" },
  };
  const [showInsights, setShowInsights] = React.useState(false);

  // Densidad compacta fija (~20% menos) — pensada para pantallas chicas.
  const cardH    = "h-[184px]";
  const cardPad  = "p-3!";
  const chartBox = "w-[128px] h-[128px]";
  const donut    = { inner: 35, outer: 58 };
  const legendW  = "w-[112px]";
  const gridGap  = "gap-3";
  const rootGap  = "space-y-4";

  // useFetch injects vesselCode automatically from VesselContext
  const fuelData = useFetch<{ items: { date: string; liters: number }[] }>("/app/dashboard/fuel-consumption?days=30");

  useCopilotEmitter({ module: "DASHBOARD", screen: "DASHBOARD" });

  // KPIs derived from fetched data
  // Latest daily report info: timestamp of the most recent submission and
  // a flag indicating whether today's report (in browser local time) is
  // already submitted. The list comes ordered by reportDate desc.
  const dailyReportsInfo = React.useMemo(() => {
    const items = dailyReports.data?.items ?? [];
    if (items.length === 0) return { lastAt: null as string | null, hasToday: false };
    const latest = items[0];
    const todayStr = new Date().toISOString().slice(0, 10);
    const hasToday = items.some(r => String(r.reportDate).slice(0, 10) === todayStr);
    return { lastAt: latest.createdAt ?? null, hasToday };
  }, [dailyReports.data]);
const defectsOpen   = defects.data?.items.filter(d => d.status === "OPEN" || d.status === "IN_PROGRESS").length ?? 0;
  const certsExpired  = certificates.data?.items.filter(c => c.status === "EXPIRED").length ?? 0;
  const certsExpiring = certificates.data?.items.filter(c => c.status === "EXPIRING_SOON").length ?? 0;
  // Show expired count with priority; only fall back to expiring when there are none expired.
  const certsBadge = certsExpired > 0
    ? { value: certsExpired,  label: t("dashboard.certificatesExpired") }
    : { value: certsExpiring, label: t("dashboard.certificates") };

  // Donut chart: Planificadas / En Progreso / Vencidas / Postergadas / Posterg. rechazadas
  const statusCounts = React.useMemo(() => {
    const items = workOrders.data?.items ?? [];
    const now = new Date();
    const CLOSED_STATUSES = new Set(["CLOSED", "CANCELLED"]);
    const deferralStatusByWo = new Map<string, string>();
    for (const d of deferrals.data?.items ?? []) {
      const prev = deferralStatusByWo.get(d.sourceId);
      if (!prev || prev === "CLOSED") deferralStatusByWo.set(d.sourceId, d.status);
    }
    let planificadas = 0, enProgreso = 0, vencidas = 0, postergadas = 0, postergadasRechazadas = 0;
    for (const w of items) {
      if (CLOSED_STATUSES.has(w.status)) continue;
      if (w.status === "ON_HOLD") {
        if (deferralStatusByWo.get(w.id) === "REJECTED") postergadasRechazadas++;
        else postergadas++;
        continue;
      }
      const overdue = !!w.dueDate && parseLocalDate(w.dueDate) < now;
      if (overdue) { vencidas++; continue; }
      if (w.status === "IN_PROGRESS") enProgreso++;
      else planificadas++;
    }
    return [
      { key: "planned",           name: "Planificadas",                      value: planificadas,          fill: "#60A5FA" },
      { key: "inProgress",        name: "En Progreso",                       value: enProgreso,            fill: "#06D6A0" },
      { key: "overdue",           name: t("dashboard.wo.overdue"),           value: vencidas,              fill: "#EF4444" },
      { key: "postponed",         name: t("dashboard.wo.postponed"),         value: postergadas,           fill: "#EAB308" },
      { key: "postponedRejected", name: t("dashboard.wo.postponedRejected"), value: postergadasRechazadas, fill: "#F97316" },
    ].filter(s => s.value > 0);
  }, [workOrders.data, deferrals.data, t]);

  // Donut chart: deferrals by status (excluding CLOSED)
  const deferralCounts = React.useMemo(() => {
    const items = (deferrals.data?.items ?? []).filter(d => d.status !== "CLOSED");
    const map: Record<string, number> = { REQUESTED: 0, UNDER_REVIEW: 0, APPROVED: 0, ACTIVE: 0, REJECTED: 0 };
    for (const d of items) if (d.status in map) map[d.status]++;
    return [
      { key: "REQUESTED",    name: t("dashboard.def.requested"),    value: map.REQUESTED,    fill: "#60A5FA" },
      { key: "UNDER_REVIEW", name: t("dashboard.def.underReview"),  value: map.UNDER_REVIEW, fill: "#EAB308" },
      { key: "APPROVED",     name: t("dashboard.def.approved"),     value: map.APPROVED,     fill: "#06D6A0" },
      { key: "ACTIVE",       name: t("dashboard.def.active"),       value: map.ACTIVE,       fill: "#A78BFA" },
      { key: "REJECTED",     name: t("dashboard.def.rejected"),     value: map.REJECTED,     fill: "#EF4444" },
    ].filter(s => s.value > 0);
  }, [deferrals.data, t]);

  // Donut chart: maintenance plans by execution status — counts come directly
  // from /app/dashboard/mp-summary (server-side computation). ~50 bytes vs
  // 755 KB of the full plan list.
  const mpStatusCounts = React.useMemo(() => {
    const map = mpSummary.data?.counts ?? { NEVER_EXECUTED: 0, OVERDUE: 0, DUE: 0, IN_WINDOW: 0, UPCOMING: 0, FUTURE: 0 };
    return [
      { key: "NEVER_EXECUTED", name: t("dashboard.mp.neverExecuted"), value: map.NEVER_EXECUTED, fill: "#64748b" },
      { key: "OVERDUE",        name: t("dashboard.mp.overdue"),        value: map.OVERDUE,        fill: "#EF4444" },
      { key: "DUE",            name: t("dashboard.mp.due"),            value: map.DUE,            fill: "#F97316" },
      { key: "IN_WINDOW",      name: t("dashboard.mp.inWindow"),       value: map.IN_WINDOW,      fill: "#EAB308" },
      { key: "UPCOMING",       name: t("dashboard.mp.upcoming"),       value: map.UPCOMING,       fill: "#F97316" },
      { key: "FUTURE",         name: t("dashboard.mp.future"),         value: map.FUTURE,         fill: "#06D6A0" },
    ].filter(s => s.value > 0);
  }, [mpSummary.data, t]);

  const spareReqCounts = React.useMemo(() => {
    const allItems = (spareRequests.data?.items ?? []).flatMap(r => r.items);
    const map: Record<string, number> = { PENDING: 0, FULFILLED: 0, CANCELLED: 0 };
    for (const i of allItems) {
      if (i.status === "FULFILLED") map.FULFILLED++;
      else if (i.status === "CANCELLED") map.CANCELLED++;
      else map.PENDING++;
    }
    return [
      { key: "PENDING",   name: t("dashboard.sr.pending"),   value: map.PENDING,   fill: "#EAB308" },
      { key: "FULFILLED", name: t("dashboard.sr.fulfilled"), value: map.FULFILLED, fill: "#06D6A0" },
      { key: "CANCELLED", name: t("dashboard.sr.cancelled"), value: map.CANCELLED, fill: "#475569" },
    ].filter(s => s.value > 0);
  }, [spareRequests.data, t]);

  const critSparesCounts = React.useMemo(() => {
    const items = criticalSpares.data?.items ?? [];
    let sinStock = 0, bajoReorden = 0, ok = 0;
    for (const s of items) {
      if (s.available <= 0) { sinStock++; continue; }
      if (s.reorderPoint !== null && s.reorderPoint > 0 && s.available < s.reorderPoint) { bajoReorden++; continue; }
      ok++;
    }
    return [
      { key: "sin_stock",    name: t("dashboard.cs.outOfStock"),   value: sinStock,    fill: "#EF4444" },
      { key: "bajo_reorden", name: t("dashboard.cs.belowReorder"), value: bajoReorden, fill: "#F97316" },
      { key: "ok",           name: t("dashboard.cs.ok"),           value: ok,          fill: "#06D6A0" },
    ].filter(s => s.value > 0);
  }, [criticalSpares.data, t]);

  const insightCount = insights.data?.total ?? 0;

  // Snapshot HTML del dashboard: captura visual fiel de lo que se ve en pantalla
  // (gráficos Recharts/SVG, tema oscuro, colores) usando modern-screenshot, y lo
  // baja como imagen PNG embebida en un HTML. No usa el endpoint backend para que
  // el export coincida exactamente con la UI renderizada.
  const dashboardRef = React.useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = React.useState(false);

  const exportDashboardHtml = async () => {
    const node = dashboardRef.current;
    if (!node || exporting) return;
    setExporting(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor || "#0D1B2A";
      const dataUrl = await domToPng(node, {
        backgroundColor: bg,
        scale: 2,
        // Excluir la barra de herramientas (el propio botón de export) del snapshot.
        filter: (el) => !(el instanceof HTMLElement && el.dataset.exportExclude === "true"),
      });
      const today = new Date().toISOString().slice(0, 10);
      const scope = (isVesselScoped ? selectedVessel?.name : null) ?? t("dashboard.allVessels");
      const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard — ${scope} — ${today}</title>
<style>html,body{margin:0;background:${bg};}img{display:block;width:100%;height:auto;}</style>
</head>
<body><img src="${dataUrl}" alt="Dashboard ${scope} ${today}"></body>
</html>`;
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard_${today}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error("[dashboard] export HTML failed", err);
      alert(t("dashboard.exportHtmlError"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div ref={dashboardRef} className={`${rootGap} animate-in fade-in duration-500`}>
      {/* Botón discreto para descargar snapshot HTML del dashboard. Útil para
          archivar o mandar por email un estado puntual de la flota. */}
      <div className="flex justify-end" data-export-exclude="true">
        <button
          onClick={() => { void exportDashboardHtml(); }}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all disabled:opacity-50"
          title={t("dashboard.exportHtmlTitle")}
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" /> : <FileCode className="w-3.5 h-3.5 text-accent" />}
          {t("dashboard.exportHtml")}
        </button>
      </div>

      {/* Compliance score + smart alerts (sólo managers) */}
      <ComplianceDashboard />

      {/* "Mi día" — unifica tareas personales / vista del vessel + KPI cards
       * (reporte diario, defectos abiertos, AI insights, certs por vencer).
       * Antes los KPI eran 4 cards sueltas debajo; consolidados acá. */}
      <MyDayPanel onShowInsights={() => setShowInsights(true)} />

      {/* Reportes sin procesar (drafts / estado inicial) por módulo. Ubicado
          debajo de "Mi día". Solo se muestra si hay algo pendiente; cada badge
          navega a la lista filtrada del módulo para que se procesen. */}
      {(() => {
        const pc = pendingCounts.data;
        if (!pc) return null;
        const items = [
          { key: "fluidSamples", labelKey: "nav.fluidAnalyses" as TranslationKey, count: pc.fluidSamplesDraft, route: "/fluid-analyses?status=DRAFT" },
          { key: "permits",      labelKey: "nav.permits" as TranslationKey,       count: pc.permitsDraft,      route: "/permits?status=DRAFT" },
          { key: "defects",      labelKey: "nav.defects" as TranslationKey,        count: pc.defectsNew,        route: "/defects?status=OPEN" },
          { key: "deferrals",    labelKey: "nav.deferrals" as TranslationKey,      count: pc.deferralsNew,      route: "/deferrals?status=REQUESTED" },
          { key: "moc",          labelKey: "nav.moc" as TranslationKey,            count: pc.mocNew,            route: "/moc?status=REQUESTED" },
        ].filter(i => i.count > 0);
        if (items.length === 0) return null;
        return (
          <div className="flex items-center gap-3 flex-wrap px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="shrink-0">
              <span className="text-xs font-bold text-amber-700 dark:text-amber-300">{t("dashboard.pending.title")}</span>
              <span className="hidden sm:inline text-[10px] text-text-industrial/50 ml-2">{t("dashboard.pending.hint")}</span>
            </div>
            <div className="flex flex-wrap gap-2 flex-1">
              {items.map(i => (
                <button
                  key={i.key}
                  type="button"
                  onClick={() => navigate(i.route)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-[11px] font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 hover:border-amber-500/60 transition-colors"
                >
                  {t(i.labelKey)}
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-600 text-white text-[10px] font-bold tabular-nums">{i.count}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* AI Insights modal */}
      {showInsights && (
        <InsightsModal
          insights={insights.data?.items ?? []}
          loading={insights.loading}
          onClose={() => setShowInsights(false)}
          onNavigate={() => { setShowInsights(false); navigate("/ai-insights"); }}
          t={t}
        />
      )}

      {/* Main grid */}
      <div className={`grid grid-cols-1 lg:grid-cols-3 ${gridGap}`}>
        {/* WO chart */}
        <div className={`bento-card ${cardPad} flex flex-col ${cardH}`}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xs font-bold text-fg">{t("dashboard.woTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.woSubtitle")}</p>
            </div>
            {workOrders.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {workOrders.error ? <ErrorMsg msg={workOrders.error} /> : (
            <div className="flex items-center gap-2 flex-1">
              <div className={`${chartBox} shrink-0 relative`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusCounts} cx="50%" cy="50%" innerRadius={donut.inner} outerRadius={donut.outer} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {statusCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={chartTooltip.contentStyle} itemStyle={chartTooltip.itemStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-fg">{workOrders.data?.items.length ?? 0}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">{t("dashboard.totalLabel")}</span>
                </div>
              </div>
              <div className={`${legendW} space-y-2`}>
                {statusCounts.map(s => (
                  <button key={s.name} type="button" onClick={() => navigate(`/work-orders?view=${s.key}`)}
                    className="w-full flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-fg/5 transition-colors group">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                    <span className="text-[13px] text-text-industrial/60 group-hover:text-fg transition-colors truncate flex-1">{s.name}</span>
                    <span className="text-[13px] font-bold text-fg">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Maintenance Plans status chart */}
        {(() => {
          const mpAlert = (mpStatusCounts.find(s => s.key === "OVERDUE")?.value ?? 0) > 0;
          const mpStyle: React.CSSProperties | undefined = mpAlert
            ? { background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.3)" }
            : undefined;
          return (
        <div className={`bento-card ${cardPad} flex flex-col ${cardH}`} style={mpStyle}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xs font-bold text-fg">{t("dashboard.mpTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.mpSubtitle")}</p>
            </div>
            {mpSummary.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {mpSummary.error ? <ErrorMsg msg={mpSummary.error} /> : (
            <div className="flex items-center gap-2 flex-1">
              <div className={`${chartBox} shrink-0 relative`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mpStatusCounts} cx="50%" cy="50%" innerRadius={donut.inner} outerRadius={donut.outer} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {mpStatusCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={chartTooltip.contentStyle} itemStyle={chartTooltip.itemStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-fg">{mpSummary.data?.total ?? 0}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">{t("dashboard.totalLabel")}</span>
                </div>
              </div>
              <div className={`${legendW} space-y-2`}>
                {mpStatusCounts.map(s => (
                  <button key={s.key} type="button" onClick={() => navigate(`/maintenance-plans?executionStatus=${s.key}`)}
                    className="w-full flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-fg/5 transition-colors group">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                    <span className="text-[13px] text-text-industrial/60 group-hover:text-fg transition-colors truncate flex-1">{s.name}</span>
                    <span className="text-[13px] font-bold text-fg">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
          );
        })()}

        {/* Deferrals status chart */}
        <div className={`bento-card ${cardPad} flex flex-col ${cardH}`}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xs font-bold text-fg">{t("dashboard.deferralsTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.deferralsSubtitle")}</p>
            </div>
            {deferrals.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {deferrals.error ? <ErrorMsg msg={deferrals.error} /> : deferralCounts.length === 0 && !deferrals.loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
              <Clock className="w-6 h-6 text-text-industrial/40" />
              <p className="text-xs text-text-industrial/40">{t("dashboard.deferralsEmpty")}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <div className={`${chartBox} shrink-0 relative`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={deferralCounts} cx="50%" cy="50%" innerRadius={donut.inner} outerRadius={donut.outer} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {deferralCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={chartTooltip.contentStyle} itemStyle={chartTooltip.itemStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-fg">{deferralCounts.reduce((a, s) => a + s.value, 0)}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">{t("dashboard.totalLabel")}</span>
                </div>
              </div>
              <div className={`${legendW} space-y-2`}>
                {deferralCounts.map(s => (
                  <button key={s.key} type="button" onClick={() => navigate(`/deferrals?status=${s.key}`)}
                    className="w-full flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-fg/5 transition-colors group">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                    <span className="text-[13px] text-text-industrial/60 group-hover:text-fg transition-colors truncate flex-1">{s.name}</span>
                    <span className="text-[13px] font-bold text-fg">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Equipos fuera de servicio (OUT_OF_SERVICE) */}
        {(() => {
          const oosList = oosAssets.data?.items ?? [];
          const oosStyle: React.CSSProperties | undefined = oosList.length > 0
            ? { background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.3)" }
            : undefined;
          return (
        <div className={`bento-card ${cardPad} flex flex-col ${cardH}`} style={oosStyle}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xs font-bold text-fg">{t("dashboard.oosTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.oosSubtitle")}</p>
            </div>
            {oosAssets.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {oosAssets.error ? <ErrorMsg msg={oosAssets.error} /> : oosList.length === 0 && !oosAssets.loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
              <ShieldAlert className="w-6 h-6 text-text-industrial/40" />
              <p className="text-xs text-text-industrial/40">{t("dashboard.oosEmpty")}</p>
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              <button type="button" onClick={() => navigate("/assets?status=OUT_OF_SERVICE")}
                className="flex items-baseline gap-2 mb-1.5 text-left shrink-0">
                <span className="text-2xl font-bold text-red-600 dark:text-red-400">{oosList.length}</span>
                <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">{t("dashboard.oosCountLabel")}</span>
              </button>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {oosList.map(a => (
                  <button key={a.id} type="button" onClick={() => navigate("/assets?status=OUT_OF_SERVICE")}
                    className="w-full flex items-center gap-2 text-left rounded px-1.5 py-1 hover:bg-fg/5 transition-colors group">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                    <span className="text-[12px] font-mono text-text-industrial/50 shrink-0">{a.assetCode}</span>
                    <span className="text-[12px] text-text-industrial/70 group-hover:text-fg transition-colors truncate flex-1">{a.name}</span>
                    <span className="text-[10px] text-text-industrial/40 shrink-0">{a.vesselCode}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
          );
        })()}

        {/* Critical Spares stock status chart */}
        {(() => {
          const csAlert = (critSparesCounts.find(s => s.key === "sin_stock")?.value ?? 0) > 0;
          const csStyle: React.CSSProperties | undefined = csAlert
            ? { background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.3)" }
            : undefined;
          return (
        <div className={`bento-card ${cardPad} flex flex-col ${cardH}`} style={csStyle}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xs font-bold text-fg">{t("dashboard.criticalSparesTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.criticalSparesSubtitle")}</p>
            </div>
            {criticalSpares.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {criticalSpares.error ? <ErrorMsg msg={criticalSpares.error} /> : critSparesCounts.length === 0 && !criticalSpares.loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
              <Package className="w-6 h-6 text-text-industrial/40" />
              <p className="text-xs text-text-industrial/40">{t("dashboard.criticalSparesEmpty")}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <div className={`${chartBox} shrink-0 relative`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={critSparesCounts} cx="50%" cy="50%" innerRadius={donut.inner} outerRadius={donut.outer} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {critSparesCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={chartTooltip.contentStyle} itemStyle={chartTooltip.itemStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-fg">{criticalSpares.data?.total ?? 0}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">{t("dashboard.totalLabel")}</span>
                </div>
              </div>
              <div className={`${legendW} space-y-2`}>
                {critSparesCounts.map(s => (
                  <button key={s.key} type="button" onClick={() => navigate(`/spares?stockStatus=${s.key}`)}
                    className="w-full flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-fg/5 transition-colors group">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                    <span className="text-[13px] text-text-industrial/60 group-hover:text-fg transition-colors truncate flex-1">{s.name}</span>
                    <span className="text-[13px] font-bold text-fg">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
          );
        })()}

        {/* Spare Requests status chart */}
        <div className={`bento-card ${cardPad} flex flex-col ${cardH}`}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xs font-bold text-fg">{t("dashboard.spareReqTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.spareReqSubtitle")}</p>
            </div>
            {spareRequests.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          </div>
          {spareRequests.error ? <ErrorMsg msg={spareRequests.error} /> : spareReqCounts.length === 0 && !spareRequests.loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
              <Package className="w-6 h-6 text-text-industrial/40" />
              <p className="text-xs text-text-industrial/40">{t("dashboard.spareReqEmpty")}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <div className={`${chartBox} shrink-0 relative`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={spareReqCounts} cx="50%" cy="50%" innerRadius={donut.inner} outerRadius={donut.outer} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {spareReqCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={chartTooltip.contentStyle} itemStyle={chartTooltip.itemStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-fg">{spareReqCounts.reduce((a, s) => a + s.value, 0)}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">{t("dashboard.itemsLabel")}</span>
                </div>
              </div>
              <div className={`${legendW} space-y-2`}>
                {spareReqCounts.map(s => (
                  <button key={s.key} type="button" onClick={() => navigate(`/spare-requests?status=${s.key}`)}
                    className="w-full flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-fg/5 transition-colors group">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                    <span className="text-[13px] text-text-industrial/60 group-hover:text-fg transition-colors truncate flex-1">{s.name}</span>
                    <span className="text-[13px] font-bold text-fg">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Inactive vessels — compact alert strip */}
        {(() => {
          const inactive = contextVessels.filter(v => v.status !== "ACTIVE");
          if (inactive.length === 0) return null;
          return (
            <div className="lg:col-span-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-fg/3 border border-fg/8">
              <Ship className="w-4 h-4 text-text-industrial/40 shrink-0" />
              <span className="text-xs text-text-industrial/50">{t("dashboard.inactiveVessels")}</span>
              <div className="flex flex-wrap gap-2 flex-1">
                {inactive.map(v => (
                  <span key={v.code} className="text-[10px] px-2 py-0.5 rounded-full bg-fg/5 border border-fg/10 text-text-industrial/50 font-medium cursor-pointer hover:border-accent/30 transition-all" onClick={() => navigate("/vessels")}>
                    {v.code} · {v.status}
                  </span>
                ))}
              </div>
              <button onClick={() => navigate("/vessels")} className="text-[10px] text-accent hover:underline shrink-0">{t("dashboard.viewAll")}</button>
            </div>
          );
        })()}

        {/* Droplets consumption trend */}
        <div className="lg:col-span-3">
          <FuelConsumptionWidget
            data={fuelData.data?.items ?? []}
            loading={fuelData.loading}
            error={fuelData.error}
            vesselName={isVesselScoped ? (selectedVessel?.name ?? "") : t("dashboard.allVessels")}
          />
        </div>
      </div>

    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  HIGH:     "bg-accent/10 text-accent border-accent/20",
  MEDIUM:   "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  LOW:      "bg-fg/5 text-text-industrial/40 border-fg/10",
};

const InsightItem = ({ insight }: { insight: AiInsight }) => (
  <div className="p-3 rounded-xl border border-fg/5 bg-fg/2 hover:bg-fg/4 transition-all cursor-pointer group">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[9px] font-bold tracking-widest text-text-industrial/30 uppercase">{insight.targetType}</span>
      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${PRIORITY_STYLES[insight.priority]}`}>
        {insight.priority}
      </span>
    </div>
    <h3 className="text-xs font-bold text-fg group-hover:text-accent transition-colors line-clamp-1">{insight.title}</h3>
    <p className="text-[10px] text-text-industrial/50 mt-0.5 line-clamp-2">{insight.summary}</p>
  </div>
);

const ErrorMsg = ({ msg }: { msg: string }) => (
  <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-xs p-3 bg-red-500/10 rounded-lg">
    <AlertCircle className="w-4 h-4 shrink-0" />
    {msg}
  </div>
);


// ---------------------------------------------------------------------------
// Droplets consumption helpers
// ---------------------------------------------------------------------------

interface ChartPoint {
  date: string;
  label: string;
  realValue: number | null;
  interpolatedValue: number | null;
}

function buildDropletsChartData(raw: { date: string; liters: number }[]): ChartPoint[] {
  const DAYS = 30;
  const today = new Date();
  const realMap = new Map(raw.map(r => [r.date, r.liters]));

  const points: ChartPoint[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("es", { day: "numeric", month: "short" });
    points.push({ date, label, realValue: realMap.get(date) ?? null, interpolatedValue: null });
  }

  // Linear interpolation between real points — only for interior gaps
  let i = 0;
  while (i < points.length) {
    if (points[i]!.realValue !== null) { i++; continue; }
    const gapStart = i;
    while (i < points.length && points[i]!.realValue === null) i++;
    const gapEnd = i;
    const leftIdx = gapStart - 1;
    const rightIdx = gapEnd;
    if (leftIdx >= 0 && rightIdx < points.length) {
      const leftVal = points[leftIdx]!.realValue!;
      const rightVal = points[rightIdx]!.realValue!;
      // Include boundary real points in the interpolated series for seamless join
      points[leftIdx]!.interpolatedValue = leftVal;
      for (let j = gapStart; j < gapEnd; j++) {
        const t = (j - leftIdx) / (rightIdx - leftIdx);
        points[j]!.interpolatedValue = Math.round(leftVal + t * (rightVal - leftVal));
      }
      points[rightIdx]!.interpolatedValue = rightVal;
    }
  }

  return points;
}

const FuelConsumptionWidget = ({
  data, loading, error, vesselName,
}: {
  data: { date: string; liters: number }[];
  loading: boolean;
  error: string | null;
  vesselName: string;
}) => {
  const t = useT();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const gridStroke  = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
  const axisTick    = isDark ? "rgba(224,225,221,0.35)" : "rgba(26,29,36,0.5)";
  const tooltipBg     = isDark ? "#1C2541" : "#FFFFFF";
  const tooltipBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const tooltipText   = isDark ? "#E0E1DD" : "#1A1D24";
  const tooltipLabel  = isDark ? "rgba(224,225,221,0.5)" : "rgba(26,29,36,0.6)";
  const chartData = React.useMemo(() => buildDropletsChartData(data), [data]);
  const hasData = data.length > 0;

  return (
    <div className="bento-card p-3! flex flex-col h-[152px]">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-xs font-bold text-fg flex items-center gap-2">
            <Droplets className="w-3.5 h-3.5 text-accent" />
            {t("dashboard.fuelTitle")}
          </h2>
          <p className="text-[10px] text-text-industrial/40">{t("dashboard.fuelLast30")} · {vesselName}</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          {!loading && hasData && (
            <div className="flex items-center gap-3 text-[10px] text-text-industrial/50">
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 h-0.5 bg-[#4FC3F7] rounded" />
                {t("dashboard.fuelReal")}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 h-0.5 bg-[#94A3B8] rounded" style={{ borderTop: "2px dashed #94A3B8", height: 0 }} />
                {t("dashboard.fuelEstimated")}
              </span>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <ErrorMsg msg={error} />
      ) : !loading && !hasData ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
          <Droplets className="w-6 h-6 text-text-industrial/40" />
          <p className="text-xs text-text-industrial/40">{t("dashboard.fuelEmpty")}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: axisTick, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fill: axisTick, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={v => `${(v as number).toLocaleString("es")}L`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: "12px" }}
                itemStyle={{ color: tooltipText }}
                labelStyle={{ color: tooltipLabel, fontSize: 11 }}
                formatter={(value, name) => [
                  `${Number(value).toLocaleString("es")} L`,
                  name === "realValue" ? t("dashboard.fuelReal") : t("dashboard.fuelEstimated"),
                ]}
              />
              {/* Solid line for real data */}
              <Line
                dataKey="realValue"
                stroke="#4FC3F7"
                strokeWidth={2}
                dot={{ r: 3, fill: "#4FC3F7", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#4FC3F7" }}
                connectNulls={false}
                isAnimationActive={false}
              />
              {/* Dashed line for interpolated gaps */}
              <Line
                dataKey="interpolatedValue"
                stroke="#94A3B8"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 4, fill: "#94A3B8" }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

const InsightsModal = ({ insights, loading, onClose, onNavigate, t }: {
  insights: AiInsight[];
  loading: boolean;
  onClose: () => void;
  onNavigate: () => void;
  t: (k: TranslationKey) => string;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
    <div
      className="relative z-10 w-full max-w-lg bg-surface border border-border rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-fg/10 shrink-0">
        <div className="flex items-center gap-2 text-accent">
          <Sparkles className="w-4 h-4" />
          <h2 className="text-sm font-bold">AI Insights</h2>
          <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 font-bold text-accent">{insights.length}</span>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
          </div>
        ) : insights.length === 0 ? (
          <p className="text-xs text-text-industrial/30 text-center py-8">{t("dashboard.noInsights")}</p>
        ) : (
          insights.map(ins => <InsightItem key={ins.id} insight={ins} />)
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-fg/10 shrink-0">
        <button onClick={onNavigate}
          className="w-full py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 transition-all">
          {t("dashboard.viewAllInsights")}
        </button>
      </div>
    </div>
  </div>
);
