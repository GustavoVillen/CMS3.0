// App a bordo (Preview V30, aprobada 2026-09-15).
//
// La app de celular del Capitán y del Jefe de Máquinas: siete funciones, cada
// una resuelta en pocos toques, y "lo demás se completa en la PC". No agrega
// reglas ni permisos: usa los mismos endpoints que el sistema de escritorio y el
// servidor valida todo igual. Las funciones que el rol no tiene no se muestran.
//
// Quién la ve: cualquier usuario del tenant puede abrir /abordo; al Capitán /
// Jefe de Máquinas (MAINTENANCE_MANAGER) se lo manda acá directo cuando entra
// desde un celular (ver entry.tsx). La vista móvil de la tripulación (/m) sigue
// como estaba.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Ship, CalendarClock, ChevronRight, Plus, MessageSquarePlus, Gauge, ShieldCheck,
  ClipboardCheck, PackageMinus, Monitor, LogOut,
} from "lucide-react";
import { useAuth, useCan } from "../lib/auth";
import { useT, useWoTerms, type TranslationKey } from "../lib/i18n";
import { useFetch } from "../lib/hooks";
import { useVesselContext } from "../lib/vessel-context";
import { AlertDialog } from "../components/AlertDialog";
import { ProgressFlow } from "../components/ProgressFlow";
import { useOpenWorkOrders } from "./shared";
import { classifyPlan, type OnboardPlan } from "./OnboardPlans";
import { OnboardPlans } from "./OnboardPlans";
import { OnboardNewWorkOrder } from "./OnboardNewWorkOrder";
import { OnboardHours, type HoursRow, STALE_DAYS } from "./OnboardHours";
import { OnboardPermit } from "./OnboardPermit";
import { OnboardChecklist } from "./OnboardChecklist";
import { OnboardSpares } from "./OnboardSpares";
import { OB_DESKTOP_KEY } from "./entry";

type View = "home" | "plans" | "newwo" | "hours" | "permit" | "checklist" | "spares";

interface Submission {
  kind: "WO" | "SR" | "PTW";
  id: string;
  code: string;
  title: string | null;
  permitType: string | null;
  state: "PENDING" | "APPROVED" | "AUTHORIZED" | "REJECTED" | "ACTIVE" | "CLOSED";
  reason: string | null;
}

const STATE_STYLE: Record<Submission["state"], { cls: string; key: TranslationKey }> = {
  PENDING:    { cls: "bg-warning/15 text-warning", key: "ob.sent.PENDING" },
  APPROVED:   { cls: "bg-success/15 text-success", key: "ob.sent.APPROVED" },
  AUTHORIZED: { cls: "bg-success/15 text-success", key: "ob.sent.AUTHORIZED" },
  ACTIVE:     { cls: "bg-accent/15 text-accent",   key: "ob.sent.ACTIVE" },
  REJECTED:   { cls: "bg-danger/15 text-danger",   key: "ob.sent.REJECTED" },
  CLOSED:     { cls: "bg-fg/5 text-text-industrial/60", key: "ob.sent.CLOSED" },
};

/** role → etiqueta (claves role.* ya existentes; se ve la persona típica del rol). */
const ROLE_KEY: Record<string, TranslationKey> = {
  TENANT_ADMIN: "role.tenantAdmin",
  FLEET_SUPERINTENDENT: "role.fleetSuperintendent",
  MAINTENANCE_MANAGER: "role.maintenanceManager",
  TECHNICIAN_OPERATOR: "role.technicianOperator",
  INSPECTOR_COMPLIANCE: "role.inspectorCompliance",
  PROCUREMENT_STORE: "role.procurementStore",
  AUDITOR_READONLY: "role.auditorReadonly",
  HSE_MANAGER: "role.hseManager",
};

const PERMIT_TYPE_KEY: Record<string, TranslationKey> = {
  HOT_WORK: "pm.type.hotWork",
  ENCLOSED_SPACE_ENTRY: "pm.type.enclosedSpace",
  WORKING_ALOFT: "pm.type.workingAloft",
  ELECTRICAL_ISOLATION: "pm.type.electricalIso",
  COLD_WORK: "pm.type.coldWork",
  UNDERWATER_WORK: "pm.type.underwater",
};

export const OnboardApp: React.FC = () => {
  const [view, setView] = useState<View>("home");
  const [showProgress, setShowProgress] = useState(false);

  // Botón "atrás" del teléfono: desde cualquier función vuelve al inicio en
  // vez de salir de la app.
  useEffect(() => {
    if (view === "home") return;
    window.history.pushState({ onboard: view }, "");
    const onPop = () => setView("home");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [view]);

  const home = useCallback(() => {
    if (window.history.state?.onboard) window.history.back();
    else setView("home");
  }, []);

  switch (view) {
    case "plans":     return <OnboardPlans onExit={home} />;
    case "newwo":     return <OnboardNewWorkOrder onExit={home} />;
    case "hours":     return <OnboardHours onExit={home} />;
    case "permit":    return <OnboardPermit onExit={home} />;
    case "checklist": return <OnboardChecklist onExit={home} />;
    case "spares":    return <OnboardSpares onExit={home} />;
    default:
      return (
        <>
          <OnboardHome onOpen={setView} onProgress={() => setShowProgress(true)} />
          {showProgress && <ProgressFlow onClose={() => setShowProgress(false)} />}
        </>
      );
  }
};

function OnboardHome({ onOpen, onProgress }: { onOpen: (v: View) => void; onProgress: () => void }) {
  const t = useT();
  const woTerms = useWoTerms();
  const can = useCan();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { vessels, selectedVesselCode, setSelectedVesselCode, selectedVessel } = useVesselContext();
  const [alert, setAlert] = useState<string | null>(null);

  const vesselReady = !!selectedVesselCode;
  const readOnly = user?.role === "AUDITOR_READONLY";
  const canWo = can("wo.manage") || can("wo.operate");

  const plans = useFetch<{ items: OnboardPlan[] }>(vesselReady && canWo ? "/app/pms/maintenance-plans?status=ACTIVE" : null);
  const hours = useFetch<{ rows: HoursRow[] }>(vesselReady && can("assetHours.write") ? "/app/pms/asset-hours" : null);
  const checks = useFetch<{ items: unknown[] }>(vesselReady && !readOnly ? "/app/checklist-executions?status=IN_PROGRESS" : null);
  const mine = useFetch<{ items: Submission[] }>(vesselReady ? "/app/pms/approvals/mine?limit=5" : null);
  const openWos = useOpenWorkOrders(vesselReady);

  const planCounts = useMemo(() => {
    let over = 0, soon = 0;
    for (const p of plans.data?.items ?? []) {
      const c = classifyPlan(p);
      if (c?.group === "over") over++; else if (c?.group === "soon") soon++;
    }
    return { over, soon };
  }, [plans.data]);
  const staleHours = (hours.data?.rows ?? []).filter(r => r.daysSinceReading !== null && r.daysSinceReading >= STALE_DAYS).length;
  const openChecks = checks.data?.items.length ?? 0;

  const go = (v: View | "progress") => {
    if (!vesselReady) { setAlert(t("ob.pickVesselFirst")); return; }
    if (v === "progress") onProgress(); else onOpen(v);
  };

  const firstName = (user?.name ?? "").split(" ")[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "numeric" });

  // Orden de la pantalla por uso real (Preview V36, aprobada 2026-09-16):
  //   1. Planes para abrir y Horómetros — lo de todos los días, arriba y grandes.
  //   2. Registrar avance.
  //   3. "Lo demás", chico y en gris (incluida Nueva OT/SS, que dejó de ser el
  //      botón destacado: si todo resalta, no resalta nada).
  const mainTiles: Array<{ v: View; show: boolean; icon: React.ReactNode; tone: string; title: string; lines: React.ReactNode }> = [
    {
      v: "plans", show: canWo, tone: "bg-danger/15 text-danger",
      icon: <CalendarClock className="w-[26px] h-[26px]" />, title: t("ob.plans.title"),
      lines: <>
        <span className="block text-sm font-extrabold text-danger">{t("ob.plans.overN").replace("{n}", String(planCounts.over))}</span>
        <span className="block text-sm font-extrabold text-warning">{t("ob.plans.soonN").replace("{n}", String(planCounts.soon))}</span>
      </>,
    },
    {
      v: "hours", show: can("assetHours.write"), tone: "bg-accent/10 text-accent",
      icon: <Gauge className="w-[26px] h-[26px]" />, title: t("ob.tile.hours"),
      lines: staleHours
        ? <span className="block text-sm font-extrabold text-warning">{t("ob.tile.hoursStale").replace("{n}", String(staleHours))}</span>
        : <span className="block text-sm font-semibold text-text-industrial/60">{t("ob.tile.hoursSub")}</span>,
    },
  ];
  const visibleMain = mainTiles.filter(x => x.show);

  const tiles: Array<{ v: View | "progress"; show: boolean; icon: React.ReactNode; title: string; sub: string; warn?: boolean }> = [
    { v: "newwo", show: canWo, icon: <Plus className="w-[22px] h-[22px]" />, title: t("ob.tile.newWo").replace("{wo}", woTerms.abbr), sub: t("ob.tile.newWoSub") },
    { v: "permit", show: can("permit.manage"), icon: <ShieldCheck className="w-[22px] h-[22px]" />, title: t("ob.tile.permit"), sub: t("ob.tile.permitSub") },
    { v: "checklist", show: !readOnly, icon: <ClipboardCheck className="w-[22px] h-[22px]" />, title: t("ob.tile.checklist"),
      sub: openChecks ? t("ob.tile.checklistOpen").replace("{n}", String(openChecks)) : t("ob.tile.checklistSub"), warn: openChecks > 0 },
    { v: "spares", show: can("stock.manage"), icon: <PackageMinus className="w-[22px] h-[22px]" />, title: t("ob.tile.spares"), sub: t("ob.tile.sparesSub") },
  ];
  const restTiles = tiles.filter(x => x.show);

  const openDesktop = () => {
    try { sessionStorage.setItem(OB_DESKTOP_KEY, "1"); } catch { /* sin storage: igual navega */ }
    navigate("/");
  };

  return (
    <div className="h-dvh overflow-y-auto overscroll-contain bg-bg text-fg">
      {/* Encabezado: buque, saludo y fecha */}
      <section className="bg-[#0D1B2A] text-[#E0E1DD] px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-14">
        <div className="flex items-center justify-between gap-3">
          {vessels.length > 1 ? (
            <label className="min-w-0 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.08em]">
              <Ship className="w-4 h-4 shrink-0 opacity-80" />
              <select value={selectedVesselCode ?? ""} onChange={e => setSelectedVesselCode(e.target.value || null)}
                aria-label={t("ob.vessel")}
                className="min-w-0 max-w-full [color-scheme:dark] bg-white/15 border border-white/25 rounded-lg px-2 py-2 text-xs font-extrabold uppercase tracking-[0.06em] text-white focus:outline-none focus:border-white/60">
                <option value="">{t("ob.pickVessel")}</option>
                {vessels.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
              </select>
            </label>
          ) : (
            <span className="min-w-0 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.08em] opacity-85 truncate">
              <Ship className="w-4 h-4 shrink-0" />{selectedVessel?.name ?? "—"}
            </span>
          )}
          <button type="button" onClick={() => void logout()} aria-label={t("ob.logout")}
            className="w-10 h-10 shrink-0 rounded-full bg-white/10 grid place-items-center">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-4 text-[27px] font-extrabold tracking-tight leading-none">{t("ob.hello").replace("{name}", firstName)}</p>
        <p className="mt-1 text-sm opacity-70 first-letter:uppercase">{user?.role && ROLE_KEY[user.role] ? `${t(ROLE_KEY[user.role]!)} · ` : ""}{today}</p>
      </section>

      <div className="px-4 pb-8 -mt-11 flex flex-col gap-3.5">
        {/* El agente de voz (Preview V34) queda FUERA de la pantalla: el
            mantener-apretado no funcionó bien en el teléfono real y Gustavo
            pidió sacarlo (2026-09-16). El componente y el modo "agent" del
            copiloto siguen en el código: para volver a probarlo, alcanza con
            renderizar <OnboardAgent /> acá. */}
        {/* 1 · Lo de todos los días: lado a lado. Si el rol sólo ve uno de los
            dos, ocupa el ancho completo en vez de quedar media tarjeta suelta. */}
        {visibleMain.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {visibleMain.map(x => (
              <button key={x.v} type="button" onClick={() => go(x.v)}
                className={`min-h-[158px] rounded-[20px] border-[1.5px] border-fg/10 bg-surface p-3.5 flex flex-col items-start justify-between gap-2.5 text-left active:bg-fg/5 shadow-[0_14px_30px_-18px_rgba(13,27,42,0.45)] ${
                  visibleMain.length === 1 ? "col-span-2" : ""
                }`}>
                <span className={`w-[54px] h-[54px] rounded-2xl grid place-items-center ${x.tone}`}>{x.icon}</span>
                <span className="w-full min-w-0">
                  <b className="block text-[16.5px] font-extrabold leading-tight">{x.title}</b>
                  <span className="block mt-1">{x.lines}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* 2 · Registrar avance */}
        {!readOnly && (
          <button type="button" onClick={() => go("progress")}
            className="w-full bg-surface border border-fg/10 rounded-2xl p-3 flex items-center gap-3 text-left active:bg-fg/5">
            <span className="w-[42px] h-[42px] shrink-0 rounded-xl bg-accent/10 text-accent grid place-items-center"><MessageSquarePlus className="w-[21px] h-[21px]" /></span>
            <span className="min-w-0 flex-1">
              <b className="block text-[15.5px] font-bold leading-tight">{t("ob.tile.progress")}</b>
              <small className="block text-[12.5px] text-text-industrial/60 mt-0.5">
                {openWos.items.length ? t("ob.tile.progressSub").replace("{n}", String(openWos.items.length)).replace("{wo}", woTerms.abbr) : t("ob.tile.progressNone")}
              </small>
            </span>
            <ChevronRight className="w-5 h-5 shrink-0 text-text-industrial/40" />
          </button>
        )}

        {/* 3 · Lo demás */}
        {restTiles.length > 0 && <>
          <p className="text-xs font-extrabold uppercase tracking-[0.07em] text-text-industrial/45 mt-1.5 -mb-1.5 px-0.5">{t("ob.home.rest")}</p>
          <div className="grid grid-cols-2 gap-2.5">
            {restTiles.map(x => (
              <button key={x.v} type="button" onClick={() => go(x.v)}
                className="min-h-[100px] rounded-[18px] border border-fg/10 bg-surface text-fg p-3 flex flex-col items-start justify-between gap-2 text-left active:bg-fg/5">
                <span className="w-[38px] h-[38px] rounded-xl bg-fg/5 text-text-industrial/70 grid place-items-center">{x.icon}</span>
                <span>
                  <b className="block text-[14.5px] font-bold leading-tight">{x.title}</b>
                  <small className={`block text-xs mt-0.5 ${x.warn ? "text-warning font-bold" : "text-text-industrial/50"}`}>{x.sub}</small>
                </span>
              </button>
            ))}
          </div>
        </>}

        {(mine.data?.items.length ?? 0) > 0 && (
          <>
            <p className="text-xs font-extrabold uppercase tracking-[0.07em] text-text-industrial/45 mt-1.5 -mb-1.5 px-0.5">{t("ob.sent.title")}</p>
            <div className="bg-surface border border-fg/10 rounded-2xl overflow-hidden">
              {mine.data!.items.map((s, i) => {
                const st = STATE_STYLE[s.state];
                const title = s.kind === "PTW" && s.permitType && PERMIT_TYPE_KEY[s.permitType]
                  ? `${t(PERMIT_TYPE_KEY[s.permitType]!)}${s.title ? ` · ${s.title}` : ""}`
                  : (s.title ?? "—");
                return (
                  <div key={`${s.kind}-${s.id}`} className={`flex items-center gap-3 px-3.5 py-3 ${i ? "border-t border-fg/10" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-xs font-semibold text-text-industrial/60">{s.code}</span>
                      <b className="block text-[14.5px] font-bold leading-snug truncate">{title}</b>
                      {s.reason && <span className="block text-[12.5px] text-danger">{t("ob.sent.reason").replace("{reason}", s.reason)}</span>}
                    </div>
                    <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${st.cls}`}>{t(st.key)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <button type="button" onClick={openDesktop}
          className="mt-1 self-center min-h-11 px-4 inline-flex items-center gap-2 text-[13px] font-semibold text-text-industrial/60">
          <Monitor className="w-4 h-4" />{t("ob.restOnPc")}
        </button>
      </div>

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
}
