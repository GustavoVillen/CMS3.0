// Planes vencidos y por vencer → abrir la OT → mandarla a aprobar.
//
// El plan ya trae la tarea, el criterio de aceptación, el bloqueo de energía y
// el riesgo: acá sólo se completan los recuadros del formulario que el plan no
// define (solicitado por, asignado a, sistema, ubicación). Si al plan le falta
// alguno de los tres de seguridad, se piden también: la aprobación los necesita.
// Repuestos planificados, fechas y adjuntos quedan para la PC.

import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, CircleCheck, ListChecks, Send, Sparkles, Loader2, Monitor, UserCheck, AlertTriangle, Building2, Wrench } from "lucide-react";
import { useT, useWoTerms } from "../lib/i18n";
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

export const OnboardPlans: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const dueLabel = useDueLabel();
  const { selectedVessel } = useVesselContext();
  const { data, loading, reload } = useFetch<{ items: OnboardPlan[] }>("/app/pms/maintenance-plans?status=ACTIVE");
  const [tab, setTab] = useState<"over" | "soon">("over");
  const [open, setOpen] = useState<OnboardPlan | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const classified = useMemo(() => (data?.items ?? [])
    .map(p => ({ p, c: classifyPlan(p) }))
    .filter((x): x is { p: OnboardPlan; c: NonNullable<ReturnType<typeof classifyPlan>> } => !!x.c)
    .sort((a, b) => a.c.sort - b.c.sort), [data]);
  const over = classified.filter(x => x.c.group === "over");
  const soon = classified.filter(x => x.c.group === "soon");
  const list = tab === "over" ? over : soon;

  if (open) {
    const siblings = classified.filter(x => x.p.assetId === open.assetId && x.p.id !== open.id && !x.p.activeWorkOrderCode);
    return <PlanOpenForm plan={open} siblings={siblings} onBack={() => { setOpen(null); void reload(); }} onExit={onExit} />;
  }

  return (
    <Screen head={<Head title={t("ob.plans.title")} sub={selectedVessel?.name} onBack={onExit} />}>
      <div className="grid grid-cols-2 gap-1 bg-fg/5 p-1 rounded-2xl">
        {(["over", "soon"] as const).map(k => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`min-h-11 rounded-xl text-[14.5px] font-extrabold ${tab === k ? "bg-surface text-fg shadow-sm" : "text-text-industrial/60"}`}>
            {(k === "over" ? t("ob.plans.tabOver") : t("ob.plans.tabSoon")).replace("{n}", String(k === "over" ? over.length : soon.length))}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-text-industrial/60">{t("ob.plans.hint").replace("{wo}", woTerms.abbr)}</p>

      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      ) : list.length === 0 ? (
        <div className="py-10 flex flex-col items-center gap-2 text-text-industrial/50 text-sm text-center">
          <CalendarClock className="w-7 h-7" />{tab === "over" ? t("ob.plans.emptyOver") : t("ob.plans.emptySoon")}
        </div>
      ) : list.map(({ p, c }) => (
        // El trabajo YA EN MARCHA se distingue en verde: no es algo que falte
        // hacer, y tocarlo no abre otra orden (avisa cuál está abierta).
        <button key={p.id} type="button"
          onClick={() => p.activeWorkOrderCode ? setAlert(t("ob.plans.hasWo").replace("{code}", p.activeWorkOrderCode)) : setOpen(p)}
          className={`w-full text-left rounded-2xl p-3.5 flex flex-col gap-1 border ${
            p.activeWorkOrderCode ? "bg-success/5 border-success/40" : "bg-surface border-fg/10 active:bg-fg/5"
          }`}>
          <span className="text-[12.5px] font-semibold text-text-industrial/60">{p.assetName ?? "—"}</span>
          <span className="text-base font-extrabold leading-snug">{p.title}</span>
          <span className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${
              p.activeWorkOrderCode ? "bg-success/15 text-success" : c.group === "over" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"
            }`}>
              {p.activeWorkOrderCode && <Wrench className="w-3.5 h-3.5" />}
              {p.activeWorkOrderCode ? t("ob.plans.hasWoShort").replace("{code}", p.activeWorkOrderCode) : dueLabel(c)}
            </span>
            <span className="font-mono text-xs font-semibold text-text-industrial/60">{p.taskCode}</span>
          </span>
        </button>
      ))}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
};

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
