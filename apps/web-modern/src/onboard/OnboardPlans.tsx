// Agenda de mantenimiento (Preview V31) → abrir la OT → mandarla a aprobar.
//
// La agenda reemplazó a la lista de "vencidos / por vencer": una sola lista por
// fecha, agrupada por mes, que muestra las DOS fechas de cada tarea — desde
// cuándo se puede hacer (apertura de la ventana) y cuándo vence. Lo vencido va
// agrupado arriba de todo; hacia adelante, seis meses.
//
// Al abrir la OT: el plan ya trae la tarea, el criterio de aceptación, el
// bloqueo de energía y el riesgo, así que acá sólo se completan los recuadros
// del formulario que el plan no define (solicitado por, asignado a, sistema,
// ubicación). Si al plan le falta alguno de los tres de seguridad, se piden
// también: la aprobación los necesita. Repuestos planificados, fechas y
// adjuntos quedan para la PC.

import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarRange, CircleCheck, Clock, ListChecks, Send, Sparkles, Loader2, Monitor, UserCheck, AlertTriangle, Building2, Wrench } from "lucide-react";
import { useT, useWoTerms, useLocale } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useFetch } from "../lib/hooks";
import { api } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { AlertDialog } from "../components/AlertDialog";
import { WO_REQUESTED_BY, WO_ASSIGNED_TO, WO_SYSTEM_AREAS } from "../lib/wo-form-catalog";
import {
  Screen, Head, Field, Chips, MainButton, DoneScreen, SectionLabel, Note, inputCls, textareaCls, scrollToMissing,
} from "./ui";
import { errorText, suggestWoSafety, RISK_LEVELS } from "./shared";
import { windowOpenOf, parseDateOrNull } from "../lib/maintenance-window";

export interface OnboardPlan {
  id: string;
  taskCode: string;
  title: string;
  assetId: string;
  assetName: string | null;
  taskType?: "MAINTENANCE" | "INSPECTION";
  department?: string | null;
  executionStatus: string;
  nextDueDate: string | null;
  nextDueHours: number | null;
  assetCurrentHours: number | null;
  activeWorkOrderCode: string | null;
  providerRequests?: Array<{ providerId: string; providerName: string | null }>;
  // Para la agenda: cuándo se abre la ventana y qué fecha usar en el renglón.
  lastExecutionDate?: string | null;
  /** Planes por horas sin fecha propia: la estima el backend por el uso del equipo. */
  projectedDueDate?: string | null;
  frequencyMonths?: number | null;
  windowMode?: "AUTO" | "MANUAL" | null;
  windowLeadDays?: number | null;
  windowOpenDate?: string | null;
}

interface PlanDetail {
  acceptanceCriteria: string | null;
  loto: string | null;
  riskLevel: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * En qué pestaña va un plan y cuánto le falta. Mismo criterio de "vencido" y
 * "por vencer" que el backend (deriveExecutionStatus): los DUE y UPCOMING son
 * "por vencer". Un plan con OT abierta (IN_WINDOW) se ubica por su vencimiento.
 */
export function classifyPlan(p: OnboardPlan): { group: "over" | "soon"; unit: "h" | "d"; amount: number; sort: number } | null {
  let unit: "h" | "d" = "d";
  let left: number | null = null;
  if (p.nextDueHours != null && p.assetCurrentHours != null) {
    unit = "h";
    left = Math.round(p.nextDueHours - p.assetCurrentHours);
  } else if (p.nextDueDate) {
    const due = new Date(p.nextDueDate.slice(0, 10) + "T00:00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    left = Math.round((due.getTime() - today.getTime()) / DAY_MS);
  }
  const sort = left == null ? 0 : unit === "h" ? left / 24 : left;
  const s = p.executionStatus;
  let group: "over" | "soon" | null = null;
  if (s === "OVERDUE") group = "over";
  else if (s === "DUE" || s === "UPCOMING") group = "soon";
  else if (s === "IN_WINDOW" && left != null) group = left < 0 ? "over" : (unit === "h" ? left <= 250 : left <= 30) ? "soon" : null;
  if (!group) return null;
  return { group, unit, amount: left ?? 0, sort };
}

export function useDueLabel() {
  const t = useT();
  return (c: NonNullable<ReturnType<typeof classifyPlan>>) => {
    const n = Math.abs(c.amount).toLocaleString();
    if (c.unit === "h") return (c.amount < 0 ? t("ob.due.overH") : t("ob.due.leftH")).replace("{n}", n);
    if (c.amount === 0) return t("ob.due.today");
    return (c.amount < 0 ? t("ob.due.overD") : t("ob.due.leftD")).replace("{n}", n);
  };
}

/** Hacia adelante la agenda llega hasta acá (decisión del usuario). */
const HORIZON_MONTHS = 6;

type AgendaState = "run" | "over" | "open" | "wait";

interface AgendaItem {
  plan: OnboardPlan;
  /** Vencimiento a mostrar. Null = plan por horas sin fecha ni estimación. */
  due: Date | null;
  /** Desde cuándo se puede hacer. Null = el plan no da con qué calcularlo. */
  open: Date | null;
  /** La fecha sale del uso promedio del equipo, no del plan. */
  estimated: boolean;
  state: AgendaState;
}

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/**
 * Arma la agenda: fecha de vencimiento, apertura de ventana y estado de cada
 * plan. La regla de la ventana es la misma del Gantt (lib/maintenance-window).
 */
function buildAgenda(plans: OnboardPlan[]): { dated: AgendaItem[]; undated: AgendaItem[] } {
  const today = startOfDay(new Date());
  const limit = new Date(today.getFullYear(), today.getMonth() + HORIZON_MONTHS, today.getDate());
  const dated: AgendaItem[] = [];
  const undated: AgendaItem[] = [];

  for (const plan of plans) {
    const real = parseDateOrNull(plan.nextDueDate);
    const projected = parseDateOrNull(plan.projectedDueDate ?? null);
    const due = real ? startOfDay(real) : projected ? startOfDay(projected) : null;
    const estimated = !real && !!projected;
    const open = due ? windowOpenOf(plan, due, parseDateOrNull(plan.lastExecutionDate ?? null)) : null;
    const state: AgendaState = plan.activeWorkOrderCode ? "run"
      : due && due < today ? "over"
      : !open || startOfDay(open) <= today ? "open"
      : "wait";
    const item: AgendaItem = { plan, due, open: open ? startOfDay(open) : null, estimated, state };

    if (!due) {
      // Plan por horas sin fecha: sólo entra si ya vence o está por vencer.
      if (classifyPlan(plan)) undated.push(item);
      continue;
    }
    // Lo vencido entra siempre; hacia adelante, hasta el horizonte.
    if (due < today || due <= limit) dated.push(item);
  }

  dated.sort((a, b) => (a.due!.getTime() - b.due!.getTime()) || a.plan.taskCode.localeCompare(b.plan.taskCode));
  undated.sort((a, b) => (classifyPlan(a.plan)?.sort ?? 0) - (classifyPlan(b.plan)?.sort ?? 0));
  return { dated, undated };
}

export const OnboardPlans: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const t = useT();
  const locale = useLocale();
  const woTerms = useWoTerms();
  const dueLabel = useDueLabel();
  const { selectedVessel } = useVesselContext();
  const { data, loading, reload } = useFetch<{ items: OnboardPlan[] }>("/app/pms/maintenance-plans?status=ACTIVE");
  const [onlyReady, setOnlyReady] = useState(false);
  const [open, setOpen] = useState<OnboardPlan | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const { dated, undated } = useMemo(() => buildAgenda(data?.items ?? []), [data]);
  const classified = useMemo(() => (data?.items ?? [])
    .map(p => ({ p, c: classifyPlan(p) }))
    .filter((x): x is Classified => !!x.c), [data]);

  const visible = onlyReady ? dated.filter(i => i.state === "over" || i.state === "open") : dated;
  const overdue = visible.filter(i => i.state === "over");
  const ahead = visible.filter(i => i.state !== "over");
  const undatedVisible = onlyReady ? undated.filter(i => i.state !== "wait") : undated;

  // Meses, en el idioma del tenant: "septiembre 2026".
  const monthFmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : locale === "pt" ? "pt-BR" : "es-AR", { month: "long", year: "numeric" });
  const months: Array<{ key: string; label: string; items: AgendaItem[] }> = [];
  for (const item of ahead) {
    const key = `${item.due!.getFullYear()}-${item.due!.getMonth()}`;
    const last = months[months.length - 1];
    if (last?.key === key) last.items.push(item);
    else months.push({ key, label: monthFmt.format(item.due!), items: [item] });
  }

  const openPlan = (p: OnboardPlan) => p.activeWorkOrderCode
    ? setAlert(t("ob.plans.hasWo").replace("{code}", p.activeWorkOrderCode))
    : setOpen(p);

  if (open) {
    const siblings = classified.filter(x => x.p.assetId === open.assetId && x.p.id !== open.id && !x.p.activeWorkOrderCode);
    return <PlanOpenForm plan={open} siblings={siblings} onBack={() => { setOpen(null); void reload(); }} onExit={onExit} />;
  }

  const groupLabel = (label: string, n: number) => (
    <p className="flex justify-between items-center text-xs font-extrabold uppercase tracking-[0.07em] text-text-industrial/45 mt-2 -mb-1.5 px-0.5">
      <span>{label}</span><span>{n}</span>
    </p>
  );

  return (
    <Screen head={<Head title={t("ob.plans.title")} sub={selectedVessel?.name} onBack={onExit} />}>
      <p className="text-[12.5px] text-text-industrial/60">{t("ob.ag.hint").replace("{wo}", woTerms.abbr)}</p>
      <div className="flex flex-wrap gap-2">
        {([[false, t("ob.ag.all")], [true, t("ob.ag.onlyReady")]] as const).map(([v, label]) => (
          <button key={String(v)} type="button" onClick={() => setOnlyReady(v)} aria-pressed={onlyReady === v}
            className={`min-h-10 px-3.5 rounded-xl border-[1.5px] text-[13.5px] font-bold ${
              onlyReady === v ? "bg-fg text-bg border-fg" : "bg-surface text-fg border-fg/10"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      ) : visible.length === 0 && undatedVisible.length === 0 ? (
        <div className="py-10 flex flex-col items-center gap-2 text-text-industrial/50 text-sm text-center">
          <CalendarClock className="w-7 h-7" />{onlyReady ? t("ob.ag.emptyReady") : t("ob.ag.empty")}
        </div>
      ) : (
        <>
          {overdue.length > 0 && groupLabel(t("ob.ag.overdue"), overdue.length)}
          {overdue.map(item => <AgendaRow key={item.plan.id} item={item} onOpen={openPlan} />)}
          {months.map(m => (
            <React.Fragment key={m.key}>
              {groupLabel(m.label, m.items.length)}
              {m.items.map(item => <AgendaRow key={item.plan.id} item={item} onOpen={openPlan} />)}
            </React.Fragment>
          ))}
          {undatedVisible.length > 0 && <>
            {groupLabel(t("ob.ag.byHours"), undatedVisible.length)}
            {undatedVisible.map(item => (
              <AgendaRow key={item.plan.id} item={item} onOpen={openPlan}
                hoursLabel={(() => { const c = classifyPlan(item.plan); return c ? dueLabel(c) : null; })()} />
            ))}
          </>}
          <p className="text-[12.5px] text-text-industrial/50 text-center mt-1">{t("ob.ag.horizon")}</p>
        </>
      )}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
};

const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Un renglón de la agenda: el día del vencimiento, la tarea y su ventana. */
function AgendaRow({ item, onOpen, hoursLabel }: {
  item: AgendaItem; onOpen: (p: OnboardPlan) => void; hoursLabel?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const { plan, due, open, estimated, state } = item;
  const monthShort = due
    ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : locale === "pt" ? "pt-BR" : "es-AR", { month: "short" })
        .format(due).replace(".", "").slice(0, 3)
    : null;

  const tone = state === "over" ? "bg-danger/5 border-danger/40"
    : state === "run" ? "bg-success/5 border-success/40"
    : "bg-surface border-fg/10 active:bg-fg/5";
  const badge = state === "over" ? "bg-danger/15 text-danger"
    : state === "run" ? "bg-success/15 text-success"
    : "bg-fg/5 text-text-industrial/70";

  const today = startOfDay(new Date());
  const pill = state === "run"
    ? { cls: "bg-success/15 text-success", icon: <Wrench className="w-3.5 h-3.5" />, text: t("ob.plans.hasWoShort").replace("{code}", plan.activeWorkOrderCode ?? "") }
    : state === "over"
      ? { cls: "bg-danger/15 text-danger", icon: <AlertTriangle className="w-3.5 h-3.5" />, text: hoursLabel ?? t("ob.ag.overdueOn").replace("{d}", due ? dm(due) : "") }
      : due && due.getTime() === today.getTime()
        ? { cls: "bg-warning/15 text-warning", icon: <AlertTriangle className="w-3.5 h-3.5" />, text: t("ob.ag.dueToday") }
        : state === "open"
          ? { cls: "bg-accent/15 text-accent", icon: <CircleCheck className="w-3.5 h-3.5" />, text: hoursLabel ?? t("ob.ag.canDoNow") }
          : { cls: "bg-fg/5 text-text-industrial/70", icon: <Clock className="w-3.5 h-3.5" />, text: t("ob.ag.fromDate").replace("{d}", open ? dm(open) : "") };

  // Cuánto de la ventana ya pasó (sólo cuando hay ventana y no está vencida).
  let progress: number | null = null;
  if (open && due && state !== "over" && state !== "run") {
    const total = Math.max(1, due.getTime() - open.getTime());
    progress = Math.min(100, Math.max(0, ((today.getTime() - open.getTime()) / total) * 100));
  }

  return (
    <button type="button" onClick={() => onOpen(plan)}
      className={`w-full text-left rounded-2xl border p-3 flex gap-3 items-stretch ${tone}`}>
      <span className={`w-[52px] shrink-0 rounded-xl flex flex-col items-center justify-center py-1.5 ${badge}`}>
        {due ? <>
          <b className="text-xl font-extrabold leading-none tabular-nums">{String(due.getDate()).padStart(2, "0")}</b>
          <span className="text-[10.5px] font-extrabold uppercase tracking-wide mt-0.5">{monthShort}</span>
        </> : <Clock className="w-5 h-5" />}
      </span>
      <span className="min-w-0 flex-1 flex flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold text-text-industrial/60 truncate">{plan.assetName ?? "—"}</span>
        <span className="text-[15px] font-extrabold leading-snug">{plan.title}</span>
        {open && due && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-text-industrial/60 mt-0.5">
            <CalendarRange className="w-3.5 h-3.5 shrink-0" />
            {t("ob.ag.window").replace("{from}", dm(open)).replace("{to}", dm(due))}
            {estimated && <span className="text-[11px] font-bold px-1.5 py-px rounded-full bg-warning/15 text-warning">{t("ob.ag.estimated")}</span>}
          </span>
        )}
        <span className={`self-start mt-1 text-xs font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${pill.cls}`}>
          {pill.icon}{pill.text}
        </span>
        {progress !== null && (
          <span className="block h-1.5 rounded-full bg-fg/10 mt-1.5 overflow-hidden">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}

type Classified = { p: OnboardPlan; c: NonNullable<ReturnType<typeof classifyPlan>> };

function PlanOpenForm({ plan, siblings, onBack, onExit }: {
  plan: OnboardPlan; siblings: Classified[]; onBack: () => void; onExit: () => void;
}) {
  const t = useT();
  const woTerms = useWoTerms();
  const dueLabel = useDueLabel();
  const { user } = useAuth();
  const { selectedVesselCode } = useVesselContext();
  const c = classifyPlan(plan);

  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const [requestedBy, setRequestedBy] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState<string | null>(plan.department === "PROVEEDOR" ? "TERCERIZADO" : "TRIPULACION");
  const [system, setSystem] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [criteria, setCriteria] = useState("");
  const [loto, setLoto] = useState("");
  const [risk, setRisk] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; warnings: string[]; srCount: number } | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<PlanDetail>(`/app/pms/maintenance-plans/${plan.id}`)
      .then(d => { if (alive) setDetail(d); })
      .catch(e => { if (alive) setAlert(errorText(e, t("ob.loadFailed"))); });
    return () => { alive = false; };
  }, [plan.id, t]);

  const needCriteria = !!detail && !detail.acceptanceCriteria?.trim();
  const needLoto = !!detail && !detail.loto?.trim();
  const needRisk = !!detail && !detail.riskLevel;
  const providers = (plan.providerRequests ?? []).map(r => r.providerName).filter(Boolean) as string[];

  const missing = {
    requestedBy: !requestedBy, assignedTo: !assignedTo, system: !system, location: !location.trim(),
    criteria: needCriteria && !criteria.trim(), loto: needLoto && !loto.trim(), risk: needRisk && !risk,
  };
  const missingCount = Object.values(missing).filter(Boolean).length + (detail ? 0 : 1);

  const askAi = async () => {
    setAiBusy(true);
    try {
      const r = await suggestWoSafety({
        assetLabel: plan.assetName, vesselCode: selectedVesselCode, taskDesc: plan.title,
        taskType: plan.taskType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
        want: { criteria: needCriteria && !criteria.trim(), loto: needLoto && !loto.trim(), risk: needRisk && !risk },
      });
      if (r.criteria) setCriteria(r.criteria);
      if (r.loto) setLoto(r.loto);
      if (r.risk) setRisk(r.risk);
    } catch (e) {
      setAlert(errorText(e, t("ob.aiFailed")));
    } finally {
      setAiBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    let created: { id: string; workOrderCode: string } | null = null;
    const warnings: string[] = [];
    let srCount = 0;
    try {
      created = await api.post<{ id: string; workOrderCode: string }>(`/app/pms/maintenance-plans/${plan.id}/open-work-order`, {
        requestedByArea: requestedBy,
        assignedToArea: assignedTo,
        systemArea: system,
        location: location.trim(),
        additionalPlanIds: [...extra],
        // Sólo lo que el plan no traía: undefined = heredar del plan.
        acceptanceCriteria: needCriteria ? criteria.trim() : undefined,
        loto: needLoto ? loto.trim() : undefined,
        riskLevel: needRisk ? risk : undefined,
      });
    } catch (e) {
      setBusy(false);
      setAlert(errorText(e, t("ob.sendFailed")));
      return;
    }
    const name = user?.name ?? "";
    try {
      await api.post(`/app/pms/work-orders/${created.id}/approval`, { step: "ENVIA", name });
    } catch (e) {
      warnings.push(t("ob.warn.woNotSent").replace("{code}", created.workOrderCode).replace("{msg}", errorText(e, "")));
    }
    // Un plan de proveedor abre sola su SS: se envía junto con la OT.
    try {
      const srs = await api.get<{ items: Array<{ id: string; serviceRequestCode: string; status: string }> }>(`/app/pms/work-orders/${created.id}/service-requests`);
      for (const sr of srs.items ?? []) {
        if (sr.status !== "DRAFT") continue;
        try {
          await api.post(`/app/pms/service-requests/${sr.id}/submit`, { name });
          srCount++;
        } catch (e) {
          warnings.push(t("ob.warn.srNotSent").replace("{code}", sr.serviceRequestCode).replace("{msg}", errorText(e, "")));
        }
      }
    } catch { /* la OT ya salió; las SS se ven desde la PC */ }
    setBusy(false);
    setDone({ code: created.workOrderCode, warnings, srCount });
  };

  if (done) {
    const n = 1 + extra.size;
    return (
      <DoneScreen
        icon={<Send className="w-10 h-10" />}
        title={done.warnings.length ? t("ob.done.woOpened").replace("{wo}", woTerms.abbr) : t("ob.done.woSent").replace("{wo}", woTerms.abbr)}
        code={done.code}
        lines={[
          { icon: <ListChecks className="w-[17px] h-[17px]" />, text: (n === 1 ? t("ob.done.tasksOne") : t("ob.done.tasksN")).replace("{n}", String(n)).replace("{asset}", plan.assetName ?? "") },
          ...(done.srCount ? [{ icon: <Building2 className="w-[17px] h-[17px]" />, text: t("ob.done.srAlso").replace("{n}", String(done.srCount)) }] : []),
          ...done.warnings.map(w => ({ icon: <AlertTriangle className="w-[17px] h-[17px]" />, text: w })),
          { icon: <UserCheck className="w-[17px] h-[17px]" />, text: t("ob.done.approver") },
          { icon: <Monitor className="w-[17px] h-[17px]" />, text: t("ob.done.restWo") },
        ]}
        onHome={onExit}
        again={{ label: t("ob.done.anotherPlan"), onClick: onBack }}
      />
    );
  }

  const req = (key: keyof typeof missing) => tried && missing[key];
  const okRow = (label: string, text: string) => (
    <div className="flex gap-2.5 py-3 border-t border-fg/10 first:border-t-0">
      <CircleCheck className="w-[18px] h-[18px] shrink-0 text-success mt-px" />
      <div className="min-w-0"><b className="block text-sm font-bold">{label}</b><span className="text-[13px] text-text-industrial/60 line-clamp-2">{text}</span></div>
    </div>
  );

  return (
    <Screen
      head={<Head title={t("ob.plans.openWo").replace("{wo}", woTerms.abbr)} sub={plan.assetName} onBack={onBack} />}
      foot={<>
        <MainButton missing={missingCount} label={t("ob.sendApproval")} icon={<Send className="w-[18px] h-[18px]" />}
          busy={busy} onClick={() => void send()} onMissing={() => { setTried(true); scrollToMissing(); }} />
        <p className="text-center text-[12.5px] text-text-industrial/60">{t("ob.signsAs").replace("{name}", user?.name ?? "")}</p>
      </>}
    >
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold text-text-industrial/60">{plan.taskCode}</span>
        <h2 className="text-[21px] font-extrabold leading-tight text-balance">{plan.title}</h2>
        {c && <span className={`self-start mt-1 text-xs font-bold px-2.5 py-1 rounded-full ${c.group === "over" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"}`}>{dueLabel(c)}</span>}
      </div>

      {siblings.length > 0 && (
        <div className="bg-surface border border-fg/10 rounded-2xl p-3.5 flex flex-col gap-2.5">
          <div className="flex gap-2.5">
            <ListChecks className="w-[18px] h-[18px] shrink-0 text-accent mt-px" />
            <div><b className="block text-sm font-bold">{t("ob.plans.siblingsTitle")}</b><span className="text-[13px] text-text-industrial/60">{t("ob.plans.siblingsHint").replace("{wo}", woTerms.abbr)}</span></div>
          </div>
          {siblings.map(({ p, c: sc }) => {
            const on = extra.has(p.id);
            return (
              <button key={p.id} type="button" aria-pressed={on}
                onClick={() => setExtra(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}
                className={`w-full text-left flex items-center gap-3 px-3.5 py-3 rounded-2xl border-[1.5px] ${on ? "border-accent bg-accent/10" : "border-fg/10"}`}>
                <span className={`w-[22px] h-[22px] shrink-0 rounded-md border-2 grid place-items-center ${on ? "border-accent bg-accent text-accent-fg" : "border-fg/30"}`}>{on && <CircleCheck className="w-3.5 h-3.5" />}</span>
                <span className="min-w-0"><b className="block text-[15px] font-bold leading-snug">{p.title}</b><small className="text-[12.5px] text-text-industrial/60">{dueLabel(sc)}</small></span>
              </button>
            );
          })}
        </div>
      )}

      {detail && (detail.acceptanceCriteria?.trim() || detail.loto?.trim() || detail.riskLevel || providers.length > 0) && (
        <>
          <SectionLabel>{t("ob.plans.fromPlan")}</SectionLabel>
          <div className="bg-surface border border-fg/10 rounded-2xl px-3.5">
            {detail.acceptanceCriteria?.trim() && okRow(t("ob.criteria"), detail.acceptanceCriteria)}
            {detail.loto?.trim() && okRow(t("ob.loto"), detail.loto)}
            {detail.riskLevel && okRow(t("ob.riskIs").replace("{level}", t(`mp.risk.${detail.riskLevel}` as never)), t("ob.plans.riskFromPlan"))}
            {providers.length > 0 && okRow(t("ob.plans.byProvider").replace("{name}", providers.join(", ")), t("ob.plans.srAuto"))}
          </div>
        </>
      )}
      {!detail && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}

      <SectionLabel>{t("ob.completeToSend")}</SectionLabel>
      <div>
        <Field label={t("wo.modal.requestedBy")} missing={req("requestedBy")}>
          <Chips options={WO_REQUESTED_BY} value={requestedBy} onChange={v => setRequestedBy(v === requestedBy ? null : v)} />
        </Field>
        <Field label={t("wo.modal.assignedTo")} missing={req("assignedTo")} hint={t("ob.plans.assignedHint")}>
          <Chips options={WO_ASSIGNED_TO} value={assignedTo} onChange={v => setAssignedTo(v === assignedTo ? null : v)} />
        </Field>
        <Field label={t("wo.modal.system")} missing={req("system")}>
          <Chips options={WO_SYSTEM_AREAS} value={system} onChange={v => setSystem(v === system ? null : v)} />
        </Field>
        <LocationField value={location} onChange={setLocation} missing={req("location")} />
        {needRisk && (
          <Field label={t("ob.risk")} missing={req("risk")}>
            <RiskButtons value={risk} onChange={setRisk} />
          </Field>
        )}
        {needLoto && (
          <Field label={t("ob.loto")} missing={req("loto")}>
            <textarea id="ob-plan-loto" className={textareaCls} value={loto} onChange={e => setLoto(e.target.value)} placeholder={t("ob.lotoPh")} />
          </Field>
        )}
        {needCriteria && (
          <Field label={t("ob.criteriaQ")} hint={t("ob.criteria")} missing={req("criteria")}>
            <textarea id="ob-plan-criteria" className={textareaCls} value={criteria} onChange={e => setCriteria(e.target.value)} placeholder={t("ob.criteriaPh")} />
          </Field>
        )}
        {(needCriteria || needLoto || needRisk) && (
          <button type="button" onClick={() => void askAi()} disabled={aiBusy}
            className="w-full min-h-11 rounded-xl border-[1.5px] border-violet-500/40 bg-violet-500/10 text-fg font-semibold text-[14.5px] inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-300" />}
            {t("ob.aiSuggest")}
          </button>
        )}
      </div>
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
}

const LOCATION_SUGGESTIONS = ["ob.loc.engineRoom", "ob.loc.mainDeck", "ob.loc.bridge", "ob.loc.bow", "ob.loc.stern"] as const;

export function LocationField({ value, onChange, missing }: { value: string; onChange: (v: string) => void; missing?: boolean }) {
  const t = useT();
  return (
    <Field label={t("wo.modal.location")} missing={missing}>
      <input id="ob-location" className={inputCls} value={value} onChange={e => onChange(e.target.value)} placeholder={t("ob.locationPh")} />
      <div className="flex flex-wrap gap-2">
        {LOCATION_SUGGESTIONS.map(k => (
          <button key={k} type="button" onClick={() => onChange(t(k))}
            className="min-h-9 px-3 rounded-xl border border-fg/10 bg-surface text-[13px] font-semibold text-fg">{t(k)}</button>
        ))}
      </div>
    </Field>
  );
}

const RISK_ON: Record<string, string> = {
  LOW: "bg-success border-success text-white",
  MEDIUM: "bg-warning border-warning text-black",
  HIGH: "bg-orange-600 border-orange-600 text-white",
  CRITICAL: "bg-danger border-danger text-white",
};

export function RiskButtons({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {RISK_LEVELS.map(r => (
        <button key={r} type="button" onClick={() => onChange(r)} aria-pressed={value === r}
          className={`min-h-[50px] rounded-xl border-[1.5px] text-[13.5px] font-extrabold ${value === r ? RISK_ON[r] : "bg-surface border-fg/10 text-fg"}`}>
          {t(`mp.risk.${r}` as never)}
        </button>
      ))}
    </div>
  );
}
