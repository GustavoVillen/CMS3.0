import React from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Ship, Sparkles, AlertCircle, Loader2, AlertTriangle, FileCheck, Clock, Droplets, FileText, ShieldAlert, ShieldCheck, CalendarClock, Zap, Handshake, Gauge, Wrench, ClipboardList, ClipboardCheck, Timer, LifeBuoy, LayoutGrid, Table2, PackageMinus, ListChecks } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api } from "../lib/api";
import { useNavigate } from "react-router-dom";
import { useT, useLocale, type TranslationKey } from "../lib/i18n";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { parseLocalDate, sfiGroupDigit } from "../lib/utils";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useVesselContext } from "../lib/vessel-context";
import { useAuth, useCan } from "../lib/auth";
import { useTheme } from "../lib/theme";
// import { MyDayPanel } from "../components/MyDayPanel"; // oculto — ver montaje comentado más abajo
import { AssetHoursQuickModal } from "../components/AssetHoursQuickModal";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";
import { NewWorkOrderWizard } from "../components/NewWorkOrderWizard";
import { AssetSearchDropdown } from "../components/AssetSearchDropdown";
import { EquipmentMaintenanceStatusModal } from "../components/EquipmentMaintenanceStatusModal";
import { OpenWorkOrdersPicker } from "../components/service-requests/OpenWorkOrdersPicker";
import { SsProgressFlow } from "../components/service-requests/SsProgressFlow";
import { SpareConsumptionFlow } from "../components/work-orders/SpareConsumptionFlow";
import { ChecklistTemplatePicker } from "../components/checklists/ChecklistTemplatePicker";
import { UpcomingTasksModal, type UpcomingTasksResponse } from "../components/UpcomingTasksModal";
import { NewPermitFlow } from "./Permits";
import { type HoursSheet } from "../components/AssetHoursGrid";

// Grupos SFI (0-9) — mismo criterio que la pestañas de Plan de Mantenimiento
// (MaintenancePlans.tsx). Los nombres salen de i18n `sfi.g.<n>`.
import { worstSeverity, worstOf, SEVERITY_STYLE, type Severity } from "../lib/maintenance-severity";

const SFI_GROUP_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

interface MpAsset { id: string; assetCode: string; name: string | null; sfiCode: string | null; }

// ---------------------------------------------------------------------------
// Types (minimal — only fields we render)
// ---------------------------------------------------------------------------

interface WorkOrder { id: string; status: string; criticality?: string; dueDate?: string; }
interface MpSummary { counts: { NEVER_EXECUTED: number; OVERDUE: number; DUE: number; IN_WINDOW: number; UPCOMING: number; FUTURE: number }; total: number; }
interface Defect { id: string; status: string; severity: string; }
interface Certificate { id: string; status: string; expiryDate?: string; }
interface Deferral   { id: string; status: string; sourceId: string; }
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
  /** ISM 10.2.3: cerrados hace 30+ días sin confirmar si la medida funcionó. */
  defectsToVerify: number;
}

// ---------------------------------------------------------------------------
// DonutLegend — leyenda compartida de los donuts del dashboard.
// La densidad se adapta a la cantidad de estados: con >4 ítems se compacta
// (menos gap, sin padding vertical, texto un punto más chico) para que TODOS
// entren en el alto fijo de la card sin recortarse. Sin esto, cards como
// "Planes de Mantenimiento" (hasta 6 estados) cortaban el último ítem.
// ---------------------------------------------------------------------------

interface LegendItem { key: string; name: string; value: number; fill: string; }

const DonutLegend: React.FC<{ items: LegendItem[]; onSelect: (item: LegendItem) => void }> = ({ items, onSelect }) => {
  const dense = items.length > 4;
  return (
    // flex-1 en vez de ancho fijo: la leyenda ocupa lo que sobra de la tarjeta,
    // así el nombre y el número quedan alineados contra los bordes y no queda
    // aire muerto a la derecha. min-w-0 es lo que permite que truncate funcione.
    <div className={`flex-1 min-w-0 flex flex-col ${dense ? "gap-0.5" : "gap-1.5"}`}>
      {items.map(s => (
        <button key={s.key} type="button" onClick={() => onSelect(s)}
          className={`w-full flex items-center gap-1.5 text-left rounded px-1 ${dense ? "py-0" : "py-0.5"} hover:bg-fg/5 transition-colors group`}>
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
          <span className={`${dense ? "text-[12px]" : "text-[13px]"} text-text-industrial/60 group-hover:text-fg transition-colors truncate flex-1`}>{s.name}</span>
          <span className={`${dense ? "text-[12px]" : "text-[13px]"} font-bold text-fg`}>{s.value}</span>
        </button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Ítem del plan de tipo Inspección, para el asistente "Generar una inspección". */
interface InspectionPlanOption {
  id: string;
  taskCode: string;
  title: string;
  vesselCode: string;
  assetName?: string | null;
  triggerType: string;
  nextDueDate: string | null;
  activeWorkOrderCode?: string | null;
  /** Grupo SFI: G0 es el de Inspecciones (ver sfiGroupDigit en lib/utils). */
  sfiGroupNumber?: number | null;
}

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
  // Solicitudes de Servicio: la lista es chica (no hay endpoint de resumen como
  // el de planes) y el conteo por estado se hace en cliente, igual que OT,
  // diferimientos y repuestos.
  const serviceRequests   = useFetch<ListResponse<{ id: string; status: string }>>("/app/pms/service-requests");
  const insights          = useFetch<ListResponse<AiInsight>>(insightsPath, [insightsPath]);
  const dailyReports      = useFetch<ListResponse<{ id: string; reportDate: string; createdAt: string }>>("/app/daily-reports");
  // Reportes sin procesar (drafts / estado inicial) — alerta superior del Dashboard.
  const pendingCounts     = useFetch<PendingCounts>("/app/dashboard/sidebar-counts");
  // Planes que vencen + OT abiertas, desde lo atrasado hasta el domingo de la
  // semana que viene (acceso grande "Tareas de la próxima semana").
  const upcomingTasks     = useFetch<UpcomingTasksResponse>("/app/dashboard/upcoming-tasks");
  // Lecturas de horómetro del buque seleccionado (widget "Horas de Equipos").
  // Sólo con buque elegido: la planilla de horas es siempre por buque. useFetch
  // inyecta el vesselCode del contexto, así que el path no lo lleva.
  const hoursDate         = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const assetHours        = useFetch<HoursSheet>(
    selectedVesselCode ? `/app/pms/asset-hours?date=${hoursDate}` : null,
    [selectedVesselCode, hoursDate],
  );
  const navigate     = useNavigate();
  const t            = useT();
  const locale       = useLocale();
  const { theme }    = useTheme();
  const { user }     = useAuth();
  const can          = useCan();
  // El backend exige `permit.manage` para crear un PTW: si el rol no lo tiene,
  // el acceso grande no se muestra (mismo criterio que el botón de TMSA).
  const canManagePermits = can("permit.manage");
  // Mismos roles que protegen /tmsa en App.tsx (RequireRole) — se oculta acá
  // para no mostrar un botón que termina en pantalla bloqueada.
  const canSeeTmsaAudit = user ? ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"].includes(user.role) : false;
  // Asentar novedades en la hoja de ruta: cualquiera menos el rol de sólo
  // lectura (mismo criterio que canManage del backend de SS).
  const canLogSsProgress = !!user && user.role !== "AUDITOR_READONLY";
  // El consumo se guarda con un PATCH de la OT: exige `wo.manage`, igual que el
  // backend (canManageWorkOrders). El tripulante lo carga al cerrar la orden.
  const canLogSpareUse = can("wo.manage");
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
  const [showHoursEntry, setShowHoursEntry] = React.useState(false);
  const [showCreateWo, setShowCreateWo] = React.useState(false);
  // "Nueva OT" en blanco (botón chico "Generar OT" y el grande "Nueva Orden de
  // Trabajo") pasa por el asistente categoría → equipo → ítem del plan. La SS
  // (createWoPreset + showCreateWo) sigue con su propio mecanismo, sin tocar.
  const [showNewWoWizard, setShowNewWoWizard] = React.useState(false);
  // Preset con el que se abre CreateWorkOrderModal cuando viene del chooser de
  // "Nueva Solicitud de Servicio" (null = alta libre, sin preset).
  const [createWoPreset, setCreateWoPreset] = React.useState<{ maintKind: string; title?: string; classAsset?: boolean } | null>(null);
  const [showSsChooser, setShowSsChooser] = React.useState(false);
  const [showNewPermit, setShowNewPermit] = React.useState(false);
  // Registrar el avance de una SS ya mandada al taller: elegir la solicitud en
  // ejecución y asentarle novedades en la hoja de ruta del pedido.
  const [showSsProgress, setShowSsProgress] = React.useState(false);
  // Consumo de repuestos sobre una OT abierta: descuenta stock del buque.
  const [showSpareUse, setShowSpareUse] = React.useState(false);
  // Completar un checklist: se elige el template y el alta sigue en /checklists.
  const [showChecklistPicker, setShowChecklistPicker] = React.useState(false);
  // Cuarto camino del asistente de SS: la OT ya existe. En vez de crear una
  // orden nueva, se elige entre las abiertas y se abre esa OT, que es donde vive
  // el alta de la solicitud.
  const [showWoPicker, setShowWoPicker] = React.useState(false);
  const [showMpChooser, setShowMpChooser] = React.useState(false);
  // ── Generar una inspección ────────────────────────────────────────────────
  // Dos pasos: qué clase de inspección (por evento / periódica) y después el
  // ítem del plan. Elegir el ítem abre su OT de inspección y lleva a ella.
  // "Por evento" = planes de inspección con disparador Por evento; "periódica"
  // = todos los demás (vencen por fecha u horas).
  const [inspKind, setInspKind] = React.useState<"none" | "chooser" | "EVENT" | "PERIODIC" | "CLASS">("none");
  const [inspPlans, setInspPlans] = React.useState<InspectionPlanOption[] | null>(null);
  const [inspLoading, setInspLoading] = React.useState(false);
  const [inspSearch, setInspSearch] = React.useState("");
  const [inspOpeningId, setInspOpeningId] = React.useState<string | null>(null);
  const [inspError, setInspError] = React.useState<string | null>(null);
  // Panel de equipos del grupo elegido (al lado de los grupos, dentro del
  // mismo chooser) + buscador inteligente por nombre/código. null = ningún
  // grupo elegido todavía; mpAllAssets = todo el catálogo del buque, pedido
  // una sola vez al abrir el chooser.
  const [mpGroup, setMpGroup] = React.useState<number | null>(null);
  const [mpAllAssets, setMpAllAssets] = React.useState<MpAsset[] | null>(null);
  // Semáforo por equipo del buque elegido. Solo se pide en el modo "estado":
  // es la lista de planes del buque y no hace falta para elegir un plan.
  const [mpSeverityByAsset, setMpSeverityByAsset] = React.useState<Map<string, Severity> | null>(null);
  const [mpLoadingAssets, setMpLoadingAssets] = React.useState(false);
  // Mismo chooser, dos finales posibles: "planList" (Plan de Mantenimiento,
  // navega a la lista filtrada) o "status" (Estado de mantenimiento de
  // equipos, abre el panel de semáforo + historial sin salir del Dashboard).
  const [mpChooserMode, setMpChooserMode] = React.useState<"planList" | "status">("planList");
  const [statusAssetId, setStatusAssetId] = React.useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = React.useState(false);

  // Densidad compacta fija — pensada para pantallas chicas. Con 4 tarjetas por
  // fila (ver la grilla principal) la dona baja de 128 a 108px: si se dejaba el
  // tamaño anterior, en pantallas medianas la leyenda quedaba sin lugar.
  // 172px es el alto que pide el peor caso: Planes de Mantenimiento tiene 6
  // estados y su leyenda necesita ~158px (encabezado 34 + 6 filas de ~15 +
  // separaciones + padding 24). Con 156 la última fila ("Al Día") se salía del
  // recuadro. La dona de 108px tampoco entraba. overflow-hidden es el seguro:
  // si algún día un módulo suma un estado más, se recorta adentro en vez de
  // desbordar sobre la tarjeta de al lado.
  const cardH    = "h-[172px] overflow-hidden";
  const cardPad  = "p-3!";
  const chartBox = "w-[108px] h-[108px]";
  const donut    = { inner: 29, outer: 49 };
  const gridGap  = "gap-3";
  const rootGap  = "space-y-4";

  // useFetch injects vesselCode automatically from VesselContext
  // Comentado junto con FuelConsumptionWidget: sin el widget, la llamada sólo
  // gastaba un request por carga del Dashboard.
  // const fuelData = useFetch<{ items: { date: string; liters: number }[] }>("/app/dashboard/fuel-consumption?days=30");

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

  // Donut de Solicitudes de Servicio, por estado de tramitación. Los colores
  // son los mismos que las columnas del tablero kanban de SS, para que el
  // dashboard y la pantalla se lean igual. Rechazadas y Canceladas van juntas:
  // operativamente son lo mismo (no siguen) y así la leyenda entra en la card.
  const ssCounts = React.useMemo(() => {
    const items = serviceRequests.data?.items ?? [];
    const map: Record<string, number> = {};
    for (const s of items) map[s.status] = (map[s.status] ?? 0) + 1;
    return [
      { key: "DRAFT",       name: t("dashboard.ss.draft"),      value: map.DRAFT ?? 0,       fill: "#64748b" },
      { key: "SOLICITADA",  name: t("dashboard.ss.solicitada"), value: map.SOLICITADA ?? 0,  fill: "#EAB308" },
      { key: "APROBADA",    name: t("dashboard.ss.aprobada"),   value: map.APROBADA ?? 0,    fill: "#3B82F6" },
      { key: "AUTORIZADA",  name: t("dashboard.ss.autorizada"), value: map.AUTORIZADA ?? 0,  fill: "#8B5CF6" },
      { key: "IN_PROGRESS", name: t("dashboard.ss.inProgress"), value: map.IN_PROGRESS ?? 0, fill: "#F59E0B" },
      { key: "COMPLETED",   name: t("dashboard.ss.completed"),  value: map.COMPLETED ?? 0,   fill: "#06D6A0" },
      { key: "REJECTED,CANCELLED", name: t("dashboard.ss.closed"),
        value: (map.REJECTED ?? 0) + (map.CANCELLED ?? 0), fill: "#EF4444" },
    ].filter(s => s.value > 0);
  }, [serviceRequests.data, t]);

  const insightCount = insights.data?.total ?? 0;

  // Todos los equipos del buque elegido arriba (header), para el chooser de
  // Plan de Mantenimiento: se piden una sola vez al abrirlo y de ahí salen
  // tanto el panel por grupo como el buscador inteligente.
  // `mode` llega por parámetro y no desde el estado: quien abre el modal hace
  // setMpChooserMode(...) e inmediatamente llama acá, y en ese momento el
  // estado todavía tiene el valor anterior.
  const loadMpAssets = async (mode: "planList" | "status") => {
    if (!selectedVesselCode) { setMpAllAssets(null); setMpSeverityByAsset(null); return; }
    setMpLoadingAssets(true);
    setMpSeverityByAsset(null);
    try {
      const res = await api.get<{ items: MpAsset[] }>(
        `/app/pms/assets?vesselCode=${encodeURIComponent(selectedVesselCode)}&limit=500`,
      );
      setMpAllAssets(res.items ?? []);

      if (mode === "status") {
        // Una sola consulta de los planes activos del buque; de ahí sale el
        // semáforo de cada equipo y, agrupando, el de cada grupo SFI.
        const plans = await api.get<{ items: Array<{ assetId: string; status: string; executionStatus: string }> }>(
          `/app/pms/maintenance-plans?vesselCode=${encodeURIComponent(selectedVesselCode)}&status=ACTIVE`,
        );
        const byAsset = new Map<string, Array<{ status: string; executionStatus: string }>>();
        for (const pl of plans.items ?? []) {
          if (!pl.assetId) continue;
          const list = byAsset.get(pl.assetId);
          if (list) list.push(pl); else byAsset.set(pl.assetId, [pl]);
        }
        const sev = new Map<string, Severity>();
        for (const [assetId, list] of byAsset) sev.set(assetId, worstSeverity(list));
        setMpSeverityByAsset(sev);
      }
    } catch {
      setMpAllAssets([]);
      setMpSeverityByAsset(null);   // sin datos no se pinta nada, en vez de mentir
    } finally {
      setMpLoadingAssets(false);
    }
  };

  const mpGroupOf = (a: MpAsset): number | null => {
    const n = a.sfiCode ? Number(a.sfiCode) : NaN;
    if (!Number.isFinite(n)) return null;
    return n < 10 ? n : Math.floor(n / 100);
  };
  const mpAssets = mpGroup === null ? [] : (mpAllAssets ?? []).filter(a => mpGroupOf(a) === mpGroup);

  // Semáforo de cada grupo SFI = el peor de sus equipos. Un grupo cuyos equipos
  // no tienen ningún plan queda SIN color: pintarlo de verde diría "está al
  // día" cuando en realidad no hay nada cargado, que es muy distinto.
  const mpSeverityByGroup = React.useMemo(() => {
    if (!mpSeverityByAsset) return null;
    const out = new Map<number, Severity>();
    for (const a of mpAllAssets ?? []) {
      const g = mpGroupOf(a);
      if (g === null) continue;
      const sev = mpSeverityByAsset.get(a.id);
      if (!sev) continue;
      const prev = out.get(g);
      out.set(g, prev ? worstOf([prev, sev]) : sev);
    }
    return out;
  }, [mpSeverityByAsset, mpAllAssets]);

  // Planes de inspección de la clase elegida. El backend filtra por tipo de
  // tarea y disparador; el buque sale del contexto (si hay uno elegido).
  const loadInspectionPlans = async (kind: "EVENT" | "PERIODIC" | "CLASS") => {
    setInspKind(kind);
    setInspSearch("");
    setInspError(null);
    setInspLoading(true);
    setInspPlans(null);
    try {
      const params = new URLSearchParams({ taskType: "INSPECTION", status: "ACTIVE" });
      // CLASE no discrimina por disparador: son todas las del grupo SFI G0,
      // periódicas o por evento. El filtro por grupo se hace acá porque el
      // endpoint de planes no filtra por sfiGroupNumber.
      if (kind === "EVENT") params.set("triggerType", "EVENT");
      else if (kind === "PERIODIC") params.set("triggerTypeNot", "EVENT");
      if (selectedVesselCode) params.set("vesselCode", selectedVesselCode);
      const res = await api.get<{ items: InspectionPlanOption[] }>(`/app/pms/maintenance-plans?${params.toString()}`);
      const items = res.items ?? [];
      setInspPlans(kind === "CLASS" ? items.filter(p => sfiGroupDigit(p.sfiGroupNumber) === 0) : items);
    } catch {
      setInspPlans([]);
      setInspError(t("dashboard.inspection.loadError"));
    } finally {
      setInspLoading(false);
    }
  };

  // Abre la OT de inspección de ese ítem del PDM y va a la orden. La OT nace
  // autorizada (las inspecciones no requieren aprobación ni autorización).
  const openInspectionWo = async (plan: InspectionPlanOption) => {
    setInspOpeningId(plan.id);
    setInspError(null);
    try {
      const wo = await api.post<{ workOrderCode: string }>(
        `/app/pms/maintenance-plans/${plan.id}/open-work-order`,
        {},
      );
      setInspKind("none");
      navigate(`/work-orders/${encodeURIComponent(wo.workOrderCode)}`);
    } catch (e) {
      setInspError(e instanceof Error ? e.message : t("dashboard.inspection.openError"));
    } finally {
      setInspOpeningId(null);
    }
  };

  const goToAsset = (assetId: string) => {
    setShowMpChooser(false);
    if (mpChooserMode === "status") {
      setStatusAssetId(assetId);
      return;
    }
    if (!selectedVesselCode) return;
    navigate(`/maintenance-plans?vesselCode=${encodeURIComponent(selectedVesselCode)}&assetId=${assetId}`);
  };

  return (
    <div className={`${rootGap} animate-in fade-in duration-500`}>

      {showNewWoWizard && (
        <NewWorkOrderWizard
          onClose={() => setShowNewWoWizard(false)}
          onSaved={(_woId, workOrderCode) => {
            setShowNewWoWizard(false);
            // Ruta directa del deep-link (no `?autoCode=`, que es sólo un puente
            // de compatibilidad y agrega un salto de más en el historial).
            navigate(workOrderCode ? `/work-orders/${encodeURIComponent(workOrderCode)}` : "/work-orders");
          }}
        />
      )}

      {showCreateWo && (
        <CreateWorkOrderModal
          initialVesselCode={selectedVesselCode ?? undefined}
          initialMaintKind={createWoPreset?.maintKind}
          initialTitle={createWoPreset?.title}
          autoSelectClassInspectionAsset={createWoPreset?.classAsset}
          requireProvider={!!createWoPreset}
          onClose={() => { setShowCreateWo(false); setCreateWoPreset(null); }}
          onSaved={(_woId, workOrderCode) => {
            const wasSsFlow = !!createWoPreset;
            setShowCreateWo(false);
            setCreateWoPreset(null);
            // El flujo de SS termina en la solicitud (es lo que se estaba
            // creando); el de OT abre la orden recién creada para completarla.
            if (wasSsFlow) { navigate("/service-requests"); return; }
            navigate(workOrderCode ? `/work-orders/${encodeURIComponent(workOrderCode)}` : "/work-orders");
          }}
        />
      )}

      {showNewPermit && (
        <NewPermitFlow
          onClose={() => setShowNewPermit(false)}
          onSaved={() => navigate("/permits")}
        />
      )}

      {showSsChooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowSsChooser(false)}>
          <div className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-fg">{t("dashboard.ssChooser.title")}</h2>
                <p className="text-xs text-text-industrial/50 mt-0.5">{t("dashboard.ssChooser.subtitle")}</p>
              </div>
              <ModalCloseButton onClose={() => setShowSsChooser(false)} />
            </div>
            <div className="grid grid-cols-1 gap-3">
              {/* La orden ya existe: se elige de la lista y la SS se carga desde
                  ahí. Va primero porque es el caso más común a bordo. */}
              <button
                onClick={() => { setShowSsChooser(false); setShowWoPicker(true); }}
                className="flex items-center gap-3 px-5 py-4 rounded-xl bg-accent/10 border border-accent/30 hover:border-accent/60 hover:bg-accent/15 transition-all text-left"
              >
                <ClipboardCheck className="w-6 h-6 text-accent shrink-0" />
                <span className="font-bold text-sm text-fg">{t("dashboard.ssChooser.fromOpenWo")}</span>
              </button>
              <button
                onClick={() => { setCreateWoPreset({ maintKind: "PREVENTIVO" }); setShowSsChooser(false); setShowCreateWo(true); }}
                className="flex items-center gap-3 px-5 py-4 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left"
              >
                <ClipboardList className="w-6 h-6 text-accent shrink-0" />
                <span className="font-bold text-sm text-fg">{t("dashboard.ssChooser.maintenance")}</span>
              </button>
              <button
                onClick={() => { setCreateWoPreset({ maintKind: "CORRECTIVO_NO_PROGRAMADO" }); setShowSsChooser(false); setShowCreateWo(true); }}
                className="flex items-center gap-3 px-5 py-4 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left"
              >
                <Wrench className="w-6 h-6 text-accent shrink-0" />
                <span className="font-bold text-sm text-fg">{t("dashboard.ssChooser.repair")}</span>
              </button>
              <button
                onClick={() => { setCreateWoPreset({ maintKind: "INSPECTION", title: t("dashboard.ssChooser.classInspection"), classAsset: true }); setShowSsChooser(false); setShowCreateWo(true); }}
                className="flex items-center gap-3 px-5 py-4 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left"
              >
                <ShieldAlert className="w-6 h-6 text-accent shrink-0" />
                <span className="font-bold text-sm text-fg">{t("dashboard.ssChooser.classInspection")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Generar una inspección ─────────────────────────────────────────
          Paso 1: por evento o periódica. Paso 2: el ítem del plan, como botón.
          Elegirlo abre su OT de inspección (nace autorizada) y lleva a ella. */}
      {inspKind !== "none" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setInspKind("none")}>
          <div className="w-full max-w-2xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-sm font-bold text-fg">{t("dashboard.inspection.title")}</h2>
                <p className="text-xs text-text-industrial/50 mt-0.5">
                  {inspKind === "chooser"
                    ? t("dashboard.inspection.subtitle")
                    : inspKind === "EVENT" ? t("dashboard.inspection.byEvent")
                    : inspKind === "CLASS" ? t("dashboard.inspection.classInspection")
                    : t("dashboard.inspection.periodic")}
                </p>
              </div>
              <ModalCloseButton onClose={() => setInspKind("none")} />
            </div>

            {inspKind === "chooser" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => { void loadInspectionPlans("EVENT"); }}
                  className="flex items-center gap-3 px-5 py-5 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left"
                >
                  <Zap className="w-6 h-6 text-accent shrink-0" />
                  <span className="font-bold text-sm text-fg">{t("dashboard.inspection.byEvent")}</span>
                </button>
                <button
                  onClick={() => { void loadInspectionPlans("PERIODIC"); }}
                  className="flex items-center gap-3 px-5 py-5 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left"
                >
                  <CalendarClock className="w-6 h-6 text-accent shrink-0" />
                  <span className="font-bold text-sm text-fg">{t("dashboard.inspection.periodic")}</span>
                </button>
                {/* Inspecciones de Clase = grupo SFI G0 del plan, sean
                    periódicas o por evento. Ocupa las dos columnas para no
                    dejar un hueco al lado. */}
                <button
                  onClick={() => { void loadInspectionPlans("CLASS"); }}
                  className="sm:col-span-2 flex items-center gap-3 px-5 py-5 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left"
                >
                  <ShieldAlert className="w-6 h-6 text-accent shrink-0" />
                  <span className="font-bold text-sm text-fg">{t("dashboard.inspection.classInspection")}</span>
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { setInspKind("chooser"); setInspPlans(null); setInspError(null); }}
                    className="px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:text-fg hover:border-accent/30 transition-all"
                  >
                    {t("common.back")}
                  </button>
                  <input
                    value={inspSearch}
                    onChange={e => setInspSearch(e.target.value)}
                    placeholder={t("dashboard.inspection.search")}
                    className="flex-1 bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
                  />
                </div>

                {inspError && <p className="text-xs text-red-700 dark:text-red-400 shrink-0">{inspError}</p>}

                {/* Inspección de Clase que no está en el plan: la sociedad de
                    clasificación puede pedir una fuera de programa. Abre la OT
                    directo, sin ítem del PDM, con el mismo preajuste que ya usa
                    "Nueva Solicitud de Servicio". */}
                {inspKind === "CLASS" && (
                  <button
                    onClick={() => {
                      setCreateWoPreset({
                        maintKind: "INSPECTION",
                        title: t("dashboard.inspection.classTitle"),
                        classAsset: true,
                      });
                      setInspKind("none");
                      setShowCreateWo(true);
                    }}
                    className="shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-accent/10 border border-accent/30 hover:border-accent/60 hover:bg-accent/15 transition-all text-left"
                  >
                    <Zap className="w-4 h-4 text-accent shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-fg">{t("dashboard.inspection.occasional")}</span>
                      <span className="block text-[10px] text-text-industrial/50">{t("dashboard.inspection.occasionalHint")}</span>
                    </span>
                  </button>
                )}

                <div className="flex-1 overflow-y-auto -mx-1 px-1">
                  {inspLoading ? (
                    <div className="flex items-center gap-2 text-xs text-text-industrial/50 py-4">
                      <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
                    </div>
                  ) : (inspPlans ?? []).length === 0 ? (
                    <p className="text-xs text-text-industrial/40 py-4">{t("dashboard.inspection.empty")}</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {(inspPlans ?? [])
                        .filter(p => {
                          const q = inspSearch.trim().toLowerCase();
                          if (!q) return true;
                          return `${p.taskCode} ${p.title} ${p.assetName ?? ""}`.toLowerCase().includes(q);
                        })
                        .map(p => (
                          <button
                            key={p.id}
                            disabled={inspOpeningId !== null}
                            onClick={() => { void openInspectionWo(p); }}
                            className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 disabled:opacity-50 transition-all text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-fg line-clamp-1">{p.title}</p>
                              <p className="text-[10px] text-text-industrial/50 mt-0.5 truncate">
                                <span className="font-mono">{p.taskCode}</span>
                                {p.assetName ? ` · ${p.assetName}` : ""}
                                {!selectedVesselCode ? ` · ${p.vesselCode}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              {/* Vencimiento: la lista viene ordenada por él, así
                                  que arriba quedan las que hay que hacer ya. */}
                              {p.nextDueDate && (
                                <span className={`text-[10px] whitespace-nowrap ${
                                  parseLocalDate(p.nextDueDate) < new Date()
                                    ? "text-red-700 dark:text-red-400 font-bold"
                                    : "text-text-industrial/50"
                                }`}>
                                  {parseLocalDate(p.nextDueDate).toLocaleDateString(locale)}
                                </span>
                              )}
                              {inspOpeningId === p.id
                                ? <Loader2 className="w-4 h-4 animate-spin text-accent" />
                                : <span className="text-[10px] font-bold text-accent uppercase tracking-wider">{t("dashboard.inspection.open")}</span>}
                            </div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showWoPicker && (
        <OpenWorkOrdersPicker
          onClose={() => setShowWoPicker(false)}
          onPick={wo => {
            setShowWoPicker(false);
            // La OT se abre en su pantalla: ahí está el recuadro de Solicitudes
            // de Servicio, que es donde se carga el pedido al taller.
            navigate(`/work-orders/${encodeURIComponent(wo.workOrderCode)}`);
          }}
        />
      )}

      {showSsProgress && <SsProgressFlow onClose={() => setShowSsProgress(false)} />}

      {showSpareUse && <SpareConsumptionFlow onClose={() => setShowSpareUse(false)} />}

      {showChecklistPicker && (
        <ChecklistTemplatePicker
          onClose={() => setShowChecklistPicker(false)}
          onPick={templateId => {
            setShowChecklistPicker(false);
            // El alta vive en /checklists: ahí se completa buque/fecha/puerto y
            // al crear se abre el checklist para responder los ítems.
            navigate(`/checklists?new=${encodeURIComponent(templateId)}`);
          }}
        />
      )}

      {showMpChooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowMpChooser(false)}>
          <div className="w-full max-w-3xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between shrink-0">
              <h2 className="text-sm font-bold text-fg">{t(mpChooserMode === "status" ? "dashboard.mpChooser.titleStatus" : "dashboard.mpChooser.title")}</h2>
              <ModalCloseButton onClose={() => setShowMpChooser(false)} />
            </div>

            {/* Buscador inteligente: escribí el equipo y salta directo, sin
                pasar por el grupo. Mismo componente que "Nueva OT". */}
            {selectedVesselCode && (
              <div className="shrink-0">
                <AssetSearchDropdown
                  assets={mpAllAssets ?? []}
                  value=""
                  onChange={id => { if (id) goToAsset(id); }}
                  placeholder={mpLoadingAssets ? t("common.loading") : t("dashboard.mpChooser.searchPlaceholder")}
                  disabled={mpLoadingAssets}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-hidden flex-1 min-h-0">
              {/* Grupos */}
              <div className="space-y-1.5 overflow-y-auto pr-1">
                {mpChooserMode === "planList" && (
                  <button
                    onClick={() => { setShowMpChooser(false); navigate("/maintenance-plans"); }}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left w-full"
                  >
                    <ClipboardList className="w-5 h-5 text-accent shrink-0" />
                    <span className="font-bold text-sm text-fg">{t("dashboard.mpChooser.all")}</span>
                  </button>
                )}
                {SFI_GROUP_NUMBERS.map(g => {
                  // El color sale del peor estado de los equipos del grupo. Si
                  // no hay dato (modo lista de planes, o ningún plan cargado)
                  // el botón queda como siempre, sin inventar un estado.
                  const sev = mpSeverityByGroup?.get(g) ?? null;
                  const style = sev ? SEVERITY_STYLE[sev] : null;
                  const selected = mpGroup === g;
                  return (
                    <button
                      key={g}
                      onClick={() => setMpGroup(g)}
                      title={style ? t(style.labelKey as TranslationKey) : undefined}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all text-left w-full ${
                        selected
                          ? "bg-accent/10 border-accent/40"
                          : style
                            ? `${style.chip} hover:brightness-110`
                            : "bg-fg/5 border-fg/10 hover:border-accent/40 hover:bg-fg/10"
                      }`}
                    >
                      <span className={`shrink-0 w-7 h-7 rounded-lg font-mono font-bold text-[11px] flex items-center justify-center ${
                        style && !selected ? "bg-fg/10" : "bg-accent/10 text-accent"
                      }`}>G{g}</span>
                      <span className="font-bold text-xs text-fg flex-1 truncate">{t(`sfi.g.${g}` as TranslationKey)}</span>
                      {/* El color solo no alcanza: el texto dice qué significa. */}
                      {style && (
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide">
                          {t(style.labelKey as TranslationKey)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Equipos del grupo elegido — "ventanita al lado". */}
              <div className="overflow-y-auto pl-1 border-l border-fg/10">
                {mpGroup === null ? (
                  <p className="text-xs text-text-industrial/40 px-2 py-4">{t("dashboard.mpChooser.pickGroupHint")}</p>
                ) : !selectedVesselCode ? (
                  <p className="text-xs text-text-industrial/40 px-2 py-4">{t("dashboard.mpChooser.pickVesselHint")}</p>
                ) : mpLoadingAssets ? (
                  <div className="flex items-center gap-2 text-xs text-text-industrial/40 px-2 py-4">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
                  </div>
                ) : mpAssets.length === 0 ? (
                  <p className="text-xs text-text-industrial/40 px-2 py-4">{t("common.noResults")}</p>
                ) : (
                  <div className="space-y-1.5 px-1">
                    {mpChooserMode === "planList" && (
                      <button
                        onClick={() => { setShowMpChooser(false); navigate(`/maintenance-plans?vesselCode=${encodeURIComponent(selectedVesselCode)}&sfiTab=${mpGroup}`); }}
                        className="w-full text-left px-3 py-1.5 text-[11px] text-accent hover:text-fg transition-colors"
                      >
                        {t("dashboard.mpChooser.viewGroup")}
                      </button>
                    )}
                    {mpAssets.map(a => {
                      const sev = mpSeverityByAsset?.get(a.id) ?? null;
                      const style = sev ? SEVERITY_STYLE[sev] : null;
                      return (
                        <button
                          key={a.id}
                          onClick={() => goToAsset(a.id)}
                          title={style ? t(style.labelKey as TranslationKey) : undefined}
                          className={`flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border transition-all text-left w-full ${
                            style ? `${style.chip} hover:brightness-110` : "bg-fg/5 border-fg/10 hover:border-accent/40 hover:bg-fg/10"
                          }`}
                        >
                          <span className="font-bold text-xs text-fg truncate">{a.name ?? a.assetCode}</span>
                          <span className="font-mono text-[10px] text-text-industrial/40 shrink-0">{a.assetCode}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* "Mi día" — unifica tareas personales / vista del vessel + KPI cards
       * (reporte diario, defectos abiertos, AI insights, certs por vencer).
       * Antes los KPI eran 4 cards sueltas debajo; consolidados acá.
       *
       * OCULTO por decisión de producto (2026-07-18, pedido del usuario). Se
       * deja el componente intacto y sólo se comenta el montaje: para volver a
       * activarlo, descomentar la línea de abajo y el import de MyDayPanel.
       * Mismo patrón que los módulos dormantes del Sidebar. */}
      {/* <MyDayPanel onShowInsights={() => setShowInsights(true)} /> */}

      {/* Accesos grandes, arriba de "Reportes sin procesar". El orden y el
          agrupado por fila los pidió el usuario (2026-08-29): horas de equipos,
          después lo que se crea, después lo que se consulta y al final las
          auditorías. Cada fila es su propia grilla de 3 columnas: así un botón
          que se oculta por permiso no descoloca a los de la fila siguiente. */}
      <div className="space-y-3">

        {/* Fila 1 — carga de horómetros. Mismo modal que el widget chico de
            "Horas de Equipos" más abajo (assetHours.data): sólo se ve con buque
            elegido y permiso de carga, igual que ese widget. */}
        {assetHours.data?.canWrite && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              onClick={() => setShowHoursEntry(true)}
              className="flex items-center gap-3 px-5 py-4 rounded-xl bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-left"
            >
              <Timer className="w-6 h-6 text-accent shrink-0" />
              <span className="font-bold text-sm text-fg">{t("dashboard.assetHoursButton")}</span>
            </button>
          </div>
        )}

        {/* Fila 2 — lo que se crea: OT, SS, inspección, permiso de trabajo y el
            registro de avance de una SS que ya está en el taller. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            onClick={() => setShowNewWoWizard(true)}
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-success-sea/10 border border-success-sea/30 hover:border-success-sea/60 hover:bg-success-sea/20 transition-all text-left"
          >
            <Wrench className="w-6 h-6 text-success-sea shrink-0" />
            <span className="font-bold text-sm text-fg">{t("dashboard.newWorkOrder")}</span>
          </button>
          <button
            onClick={() => setShowSsChooser(true)}
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-success-sea/10 border border-success-sea/30 hover:border-success-sea/60 hover:bg-success-sea/20 transition-all text-left"
          >
            <Handshake className="w-6 h-6 text-success-sea shrink-0" />
            <span className="font-bold text-sm text-fg">{t("dashboard.newServiceRequest")}</span>
          </button>
          <button
            onClick={() => { setInspKind("chooser"); setInspPlans(null); setInspError(null); }}
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-success-sea/10 border border-success-sea/30 hover:border-success-sea/60 hover:bg-success-sea/20 transition-all text-left"
          >
            <ShieldCheck className="w-6 h-6 text-success-sea shrink-0" />
            <span className="font-bold text-sm text-fg">{t("dashboard.generateInspection")}</span>
          </button>
          {canManagePermits && (
            <button
              onClick={() => setShowNewPermit(true)}
              className="flex items-center gap-3 px-5 py-4 rounded-xl bg-success-sea/10 border border-success-sea/30 hover:border-success-sea/60 hover:bg-success-sea/20 transition-all text-left"
            >
              <ShieldAlert className="w-6 h-6 text-success-sea shrink-0" />
              <span className="font-bold text-sm text-fg">{t("dashboard.newPermit")}</span>
            </button>
          )}
          {/* Asentar el avance de un pedido al taller. Se oculta al rol de sólo
              lectura: el backend rechaza la novedad (ver canManage en
              service-requests-service.ts). */}
          {canLogSsProgress && (
            <button
              onClick={() => setShowSsProgress(true)}
              className="flex items-center gap-3 px-5 py-4 rounded-xl bg-success-sea/10 border border-success-sea/30 hover:border-success-sea/60 hover:bg-success-sea/20 transition-all text-left"
            >
              <ClipboardCheck className="w-6 h-6 text-success-sea shrink-0" />
              <span className="font-bold text-sm text-fg">{t("dashboard.ssProgress.button")}</span>
            </button>
          )}
          {/* Registrar lo que se consumió en una OT. Descuenta stock, así que
              pide el mismo permiso que editar la orden. */}
          {canLogSpareUse && (
            <button
              onClick={() => setShowSpareUse(true)}
              className="flex items-center gap-3 px-5 py-4 rounded-xl bg-success-sea/10 border border-success-sea/30 hover:border-success-sea/60 hover:bg-success-sea/20 transition-all text-left"
            >
              <PackageMinus className="w-6 h-6 text-success-sea shrink-0" />
              <span className="font-bold text-sm text-fg">{t("dashboard.spareUse.button")}</span>
            </button>
          )}
          {/* Completar un checklist de a bordo. Mismo criterio de permiso que
              el resto de los registros: todos menos el rol de sólo lectura
              (canWrite en checklists-service.ts). */}
          {canLogSsProgress && (
            <button
              onClick={() => setShowChecklistPicker(true)}
              className="flex items-center gap-3 px-5 py-4 rounded-xl bg-success-sea/10 border border-success-sea/30 hover:border-success-sea/60 hover:bg-success-sea/20 transition-all text-left"
            >
              <ListChecks className="w-6 h-6 text-success-sea shrink-0" />
              <span className="font-bold text-sm text-fg">{t("dashboard.checklist.button")}</span>
            </button>
          )}
        </div>

        {/* Fila 3 — lo que se consulta: plan, agenda de la semana y estado. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            onClick={() => { setMpChooserMode("planList"); setMpGroup(null); void loadMpAssets("planList"); setShowMpChooser(true); }}
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-accent/10 border border-accent/30 hover:border-accent/60 hover:bg-accent/20 transition-all text-left"
          >
            <ClipboardList className="w-6 h-6 text-accent shrink-0" />
            <span className="font-bold text-sm text-fg">{t("nav.maintenancePlans")}</span>
          </button>
          {/* Qué hay que hacer hasta el domingo que viene: planes que vencen + OT
              abiertas, en una sola lista. El número de la derecha es el total, y
              se pinta en rojo si hay atrasos. */}
          <button
            onClick={() => setShowUpcoming(true)}
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-accent/10 border border-accent/30 hover:border-accent/60 hover:bg-accent/20 transition-all text-left"
          >
            <CalendarClock className="w-6 h-6 text-accent shrink-0" />
            <span className="font-bold text-sm text-fg flex-1 min-w-0">{t("dashboard.upcoming.button")}</span>
            {upcomingTasks.data && upcomingTasks.data.totals.total > 0 && (
              <span className={`shrink-0 px-2 py-0.5 rounded-lg text-[11px] font-bold border ${
                upcomingTasks.data.totals.overdue > 0
                  ? "bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-400"
                  : "bg-accent/10 border-accent/30 text-accent"
              }`}>
                {upcomingTasks.data.totals.total}
              </span>
            )}
          </button>
          <button
            onClick={() => { setMpChooserMode("status"); setMpGroup(null); void loadMpAssets("status"); setShowMpChooser(true); }}
            className="flex items-center gap-3 px-5 py-4 rounded-xl bg-accent/10 border border-accent/30 hover:border-accent/60 hover:bg-accent/20 transition-all text-left"
          >
            <Gauge className="w-6 h-6 text-accent shrink-0" />
            <span className="font-bold text-sm text-fg">{t("dashboard.equipmentStatusButton")}</span>
          </button>
        </div>

        {/* Fila 4 — auditorías. Checklist OCIMF Elemento 4/4A y las siete
            cláusulas del Capítulo 10 del Código ISM, ambas con datos en vivo del
            buque. Mismos roles que protegen /tmsa e /ism. */}
        {canSeeTmsaAudit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              onClick={() => navigate("/tmsa?tab=checklist")}
              className="flex items-center gap-3 px-5 py-4 rounded-xl bg-violet-500/10 border border-violet-500/30 hover:border-violet-500/60 hover:bg-violet-500/20 transition-all text-left"
            >
              <ClipboardCheck className="w-6 h-6 text-violet-600 dark:text-violet-400 shrink-0" />
              <span className="font-bold text-sm text-fg">{t("dashboard.tmsaAudit")}</span>
            </button>
            <button
              onClick={() => navigate("/ism?tab=checklist")}
              className="flex items-center gap-3 px-5 py-4 rounded-xl bg-violet-500/10 border border-violet-500/30 hover:border-violet-500/60 hover:bg-violet-500/20 transition-all text-left"
            >
              <LifeBuoy className="w-6 h-6 text-violet-600 dark:text-violet-400 shrink-0" />
              <span className="font-bold text-sm text-fg">{t("dashboard.ismAudit")}</span>
            </button>
          </div>
        )}
      </div>

      {statusAssetId && (
        <EquipmentMaintenanceStatusModal assetId={statusAssetId} onClose={() => setStatusAssetId(null)} />
      )}

      {showUpcoming && (
        <UpcomingTasksModal
          data={upcomingTasks.data}
          loading={upcomingTasks.loading}
          onClose={() => setShowUpcoming(false)}
        />
      )}

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
          // ISM 10.2.3: defectos esperando la confirmación de que el problema no volvió.
          { key: "defectsVerify", labelKey: "def.verify.stripTitle" as TranslationKey, count: pc.defectsToVerify, route: "/defects?verification=DUE" },
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

      {/* Carga rápida de horómetros (desde el widget "Horas de Equipos"). */}
      {showHoursEntry && assetHours.data && (
        <AssetHoursQuickModal
          sheet={assetHours.data}
          readingDate={hoursDate}
          vesselName={selectedVessel?.name ?? null}
          onSaved={() => { void assetHours.reload(); }}
          onClose={() => setShowHoursEntry(false)}
        />
      )}

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
      {/* 4 por fila en escritorio (antes 3): con 3 la tarjeta quedaba mucho más
          ancha que su contenido y sobraba medio widget vacío a la derecha.
          Son 8 widgets (el último es Horas de Equipos), así que entran en dos
          filas justas. Al sumar o quitar uno, revisar que la grilla no quede
          coja. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${gridGap}`}>
        {/* WO chart */}
        <div className={`bento-card ${cardPad} flex flex-col ${cardH}`}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xs font-bold text-fg">{t("dashboard.woTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.woSubtitle")}</p>
            </div>
            {/* Acceso directo al tablero Kanban de OT. /work-orders abre en
                Kanban por defecto y sin filtros: no hace falta pasar params. */}
            <div className="flex items-center gap-1.5 shrink-0">
              {workOrders.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
              <button
                type="button"
                onClick={() => navigate("/work-orders")}
                title={t("dashboard.woKanbanLink")}
                aria-label={t("dashboard.woKanbanLink")}
                className="p-1 rounded-md text-text-industrial/40 hover:text-accent hover:bg-fg/10 transition-colors"
              >
                <LayoutGrid className="w-7 h-7" />
              </button>
            </div>
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
              <DonutLegend items={statusCounts} onSelect={s => navigate(`/work-orders?view=${s.key}`)} />
            </div>
          )}
        </div>

        {/* Service Requests status chart */}
        <div className={`bento-card ${cardPad} flex flex-col ${cardH}`}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xs font-bold text-fg">{t("dashboard.ssTitle")}</h2>
              <p className="text-[10px] text-text-industrial/40">{t("dashboard.ssSubtitle")}</p>
            </div>
            {/* Acceso directo al tablero Kanban de SS: /service-requests abre
                en Kanban por defecto y sin filtros. */}
            <div className="flex items-center gap-1.5 shrink-0">
              {serviceRequests.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
              <button
                type="button"
                onClick={() => navigate("/service-requests")}
                title={t("dashboard.ssKanbanLink")}
                aria-label={t("dashboard.ssKanbanLink")}
                className="p-1 rounded-md text-text-industrial/40 hover:text-accent hover:bg-fg/10 transition-colors"
              >
                <LayoutGrid className="w-7 h-7" />
              </button>
            </div>
          </div>
          {serviceRequests.error ? <ErrorMsg msg={serviceRequests.error} /> : ssCounts.length === 0 && !serviceRequests.loading ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 opacity-40">
              <Handshake className="w-6 h-6 text-text-industrial/40" />
              <p className="text-xs text-text-industrial/40">{t("dashboard.ssEmpty")}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <div className={`${chartBox} shrink-0 relative`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={ssCounts} cx="50%" cy="50%" innerRadius={donut.inner} outerRadius={donut.outer} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {ssCounts.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={chartTooltip.contentStyle} itemStyle={chartTooltip.itemStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-fg">{ssCounts.reduce((a, s) => a + s.value, 0)}</span>
                  <span className="text-[11px] text-text-industrial/40 uppercase tracking-wider">{t("dashboard.totalLabel")}</span>
                </div>
              </div>
              <DonutLegend items={ssCounts} onSelect={s => navigate(`/service-requests?status=${s.key}`)} />
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
              <DonutLegend items={mpStatusCounts} onSelect={s => navigate(`/maintenance-plans?executionStatus=${s.key}`)} />
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
            {/* Acceso directo a la planilla de diferimientos, sin filtro de estado. */}
            <div className="flex items-center gap-1.5 shrink-0">
              {deferrals.loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
              <button
                type="button"
                onClick={() => navigate("/deferrals")}
                title={t("dashboard.deferralsSheetLink")}
                aria-label={t("dashboard.deferralsSheetLink")}
                className="p-1 rounded-md text-text-industrial/40 hover:text-accent hover:bg-fg/10 transition-colors"
              >
                <Table2 className="w-7 h-7" />
              </button>
            </div>
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
              <DonutLegend items={deferralCounts} onSelect={s => navigate(`/deferrals?status=${s.key}`)} />
            </div>
          )}
        </div>

        {/* Sacadas del Dashboard (ago 2026, pedido del usuario): Equipos fuera
            de servicio, Stock de Repuestos, Solicitudes de Repuestos y Horas de
            Equipos. Cada una vive en su propia pantalla; el botón "Cargar horas"
            de los accesos rápidos sigue arriba. */}

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

        {/* Consumo de combustible (últimos 30 días).
         * OCULTO por decisión de producto (2026-07-18, pedido del usuario). Se
         * deja el widget y su endpoint intactos; para reactivarlo, descomentar
         * este bloque y el useFetch de fuelData más arriba. */}
        {/* <div className="lg:col-span-3">
          <FuelConsumptionWidget
            data={fuelData.data?.items ?? []}
            loading={fuelData.loading}
            error={fuelData.error}
            vesselName={isVesselScoped ? (selectedVessel?.name ?? "") : t("dashboard.allVessels")}
          />
        </div> */}
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
