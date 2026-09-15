// Permiso de trabajo → pedir aprobación. Tres pasos:
//   1. Tipo (los seis formularios REGI-SYE de la empresa)
//   2. El trabajo: OT relacionada (opcional), lugar, qué se hace y horario
//   3. Seguridad: peligros, controles y EPP sugeridos por IA, a tildar o sumar
//
// Mismo alta que la PC (POST /app/permits + /request) y la misma exigencia para
// pedir aprobación: el análisis de riesgo completo. Participantes, pruebas de
// gas y adjuntos quedan para la PC. Lo aprueba el Superintendente o el Jefe SSMA.

import React, { useEffect, useRef, useState } from "react";
import {
  Flame, Wind, ArrowUp, Zap, Snowflake, Waves, ShieldCheck, ArrowRight, Send, Loader2, Sparkles, Plus, Check,
  UserCheck, Monitor, Clock,
} from "lucide-react";
import { useT, useWoTerms, type TranslationKey } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { AlertDialog } from "../components/AlertDialog";
import { Screen, Head, Field, MainButton, DoneScreen, RadioRow, OptionCard, Note, inputCls, textareaCls, scrollToMissing } from "./ui";
import { DictateButton, errorText, useOpenWorkOrders, splitBullets, joinBullets } from "./shared";

const TYPES: Array<{ v: string; key: TranslationKey; hint: TranslationKey; Icon: React.FC<{ className?: string }> }> = [
  { v: "HOT_WORK", key: "pm.type.hotWork", hint: "pm.wiz.hint.HOT_WORK", Icon: Flame },
  { v: "ENCLOSED_SPACE_ENTRY", key: "pm.type.enclosedSpace", hint: "pm.wiz.hint.ENCLOSED_SPACE_ENTRY", Icon: Wind },
  { v: "WORKING_ALOFT", key: "pm.type.workingAloft", hint: "pm.wiz.hint.WORKING_ALOFT", Icon: ArrowUp },
  { v: "ELECTRICAL_ISOLATION", key: "pm.type.electricalIso", hint: "pm.wiz.hint.ELECTRICAL_ISOLATION", Icon: Zap },
  { v: "COLD_WORK", key: "pm.type.coldWork", hint: "pm.wiz.hint.COLD_WORK", Icon: Snowflake },
  { v: "UNDERWATER_WORK", key: "pm.type.underwater", hint: "pm.wiz.hint.UNDERWATER_WORK", Icon: Waves },
];

type Group = "haz" | "ctl" | "ppe";
interface Suggestions { items: string[]; picked: string[] }
const emptyGroups = (): Record<Group, Suggestions> => ({ haz: { items: [], picked: [] }, ctl: { items: [], picked: [] }, ppe: { items: [], picked: [] } });

function atTime(dayOffset: number, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

export const OnboardPermit: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const t = useT();
  const woTerms = useWoTerms();
  const { user } = useAuth();
  const { selectedVesselCode } = useVesselContext();
  const openWos = useOpenWorkOrders();

  const [step, setStep] = useState(1);
  const [tried, setTried] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState(0);
  const [from, setFrom] = useState("08:00");
  const [to, setTo] = useState("12:00");
  const [groups, setGroups] = useState<Record<Group, Suggestions>>(emptyGroups);
  const [aiBusy, setAiBusy] = useState(false);
  const [adding, setAdding] = useState<{ group: Group; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const aiKey = useRef("");

  const T = TYPES.find(x => x.v === type);
  const timesOk = atTime(day, to).getTime() > atTime(day, from).getTime();

  // Al llegar a Seguridad se piden las sugerencias una vez por combinación de
  // tipo, lugar y trabajo (cada pedido consume crédito de IA).
  useEffect(() => {
    if (step !== 3 || !type) return;
    const key = `${type}|${location.trim()}|${description.trim()}`;
    if (aiKey.current === key) return;
    aiKey.current = key;
    let alive = true;
    (async () => {
      setAiBusy(true);
      const base = { type, vesselCode: selectedVesselCode, location: location.trim(), description: description.trim() };
      try {
        const haz = splitBullets((await api.post<{ text: string }>("/app/permits/suggest-hazards", base)).text ?? "");
        if (!alive) return;
        setGroups(g => ({ ...g, haz: { items: haz, picked: haz } }));
        const ctl = splitBullets((await api.post<{ text: string }>("/app/permits/suggest-controls", { ...base, hazardsIdentified: joinBullets(haz) })).text ?? "");
        if (!alive) return;
        setGroups(g => ({ ...g, ctl: { items: ctl, picked: ctl } }));
        const ppe = splitBullets((await api.post<{ text: string }>("/app/permits/suggest-ppe", { ...base, hazardsIdentified: joinBullets(haz), controlMeasures: joinBullets(ctl) })).text ?? "");
        if (!alive) return;
        setGroups(g => ({ ...g, ppe: { items: ppe, picked: ppe } }));
      } catch (e) {
        if (alive) setAlert(errorText(e, t("ob.permit.aiFailed")));
      } finally {
        if (alive) setAiBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [step, type, location, description, selectedVesselCode, t]);

  const missing2 = { location: !location.trim(), description: !description.trim(), times: !timesOk };
  const missing3 = { haz: groups.haz.picked.length === 0, ctl: groups.ctl.picked.length === 0, ppe: groups.ppe.picked.length === 0 };
  const missingNow = step === 2 ? Object.values(missing2).filter(Boolean).length : step === 3 ? Object.values(missing3).filter(Boolean).length : 0;

  const toggle = (g: Group, item: string) => setGroups(prev => {
    const s = prev[g];
    return { ...prev, [g]: { ...s, picked: s.picked.includes(item) ? s.picked.filter(x => x !== item) : [...s.picked, item] } };
  });

  const send = async () => {
    if (!selectedVesselCode || !type) return;
    setBusy(true);
    let created: { id: string; permitCode: string };
    try {
      created = await api.post<{ id: string; permitCode: string }>("/app/permits", {
        vesselCode: selectedVesselCode,
        type,
        workOrderId,
        location: location.trim(),
        description: description.trim(),
        plannedStart: atTime(day, from).toISOString(),
        plannedEnd: atTime(day, to).toISOString(),
        hazardsIdentified: joinBullets(groups.haz.picked),
        controlMeasures: joinBullets(groups.ctl.picked),
        ppeRequired: joinBullets(groups.ppe.picked),
        alarmOverride: false,
      });
    } catch (e) {
      setBusy(false);
      setAlert(errorText(e, t("ob.sendFailed")));
      return;
    }
    try {
      await api.post(`/app/permits/${created.id}/request`, {});
      setDone(created.permitCode);
    } catch (e) {
      setAlert(t("ob.permit.savedNotRequested").replace("{code}", created.permitCode).replace("{msg}", errorText(e, "")));
    } finally {
      setBusy(false);
    }
  };

  if (done && T) {
    return (
      <DoneScreen
        icon={<ShieldCheck className="w-10 h-10" />}
        title={t("ob.permit.sent")}
        code={done}
        lines={[
          { icon: <T.Icon className="w-[17px] h-[17px]" />, text: `${t(T.key)} · ${location.trim()}` },
          { icon: <Clock className="w-[17px] h-[17px]" />, text: `${day === 0 ? t("ob.today") : t("ob.tomorrow")} ${from}–${to}` },
          { icon: <UserCheck className="w-[17px] h-[17px]" />, text: t("ob.permit.approver") },
          { icon: <Monitor className="w-[17px] h-[17px]" />, text: t("ob.permit.restPc") },
        ]}
        onHome={onExit}
      />
    );
  }

  const stepNames = [t("ob.permit.step1"), t("ob.permit.step2"), t("ob.permit.step3")];
  const groupField = (g: Group, label: string) => (
    <Field label={label} missing={tried && missing3[g]}>
      <div className="flex flex-wrap gap-2">
        {[...new Set([...groups[g].items, ...groups[g].picked])].map(item => {
          const on = groups[g].picked.includes(item);
          return (
            <button key={item} type="button" onClick={() => toggle(g, item)} aria-pressed={on}
              className={`min-h-9 px-3 py-1.5 rounded-xl border text-[13px] font-semibold text-left inline-flex items-center gap-1.5 ${on ? "bg-violet-500/10 border-violet-500/60 text-fg" : "bg-surface border-fg/10 text-text-industrial/60"}`}>
              {on && <Check className="w-3.5 h-3.5 shrink-0" />}{item}
            </button>
          );
        })}
        <button type="button" onClick={() => setAdding({ group: g, text: "" })}
          className="min-h-9 px-3 rounded-xl border border-dashed border-fg/20 bg-surface text-[13px] font-semibold text-fg inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" />{t("ob.permit.other")}
        </button>
      </div>
      {adding?.group === g && (
        <div className="flex gap-2">
          <input id={`ob-ptw-add-${g}`} autoFocus className={inputCls} value={adding.text} onChange={e => setAdding({ group: g, text: e.target.value })} placeholder={t("ob.permit.otherPh")} />
          <button type="button" disabled={!adding.text.trim()}
            onClick={() => { const v = adding.text.trim(); setGroups(prev => ({ ...prev, [g]: { ...prev[g], picked: [...prev[g].picked, v] } })); setAdding(null); }}
            className="min-h-[50px] px-4 rounded-xl bg-accent text-accent-fg font-bold disabled:opacity-45">{t("ob.add")}</button>
        </div>
      )}
    </Field>
  );

  return (
    <Screen
      scrollKey={step}
      head={<Head title={t("ob.tile.permit")} sub={t("ob.stepOf").replace("{n}", String(step)).replace("{name}", stepNames[step - 1]!)} step={step}
        onBack={() => { if (step > 1) { setStep(step - 1); setTried(false); } else onExit(); }} />}
      foot={step === 1 ? undefined : (<>
        <MainButton missing={missingNow} busy={busy} disabled={step === 3 && aiBusy}
          label={step === 3 ? t("ob.permit.request") : t("ob.next")}
          icon={step === 3 ? <Send className="w-[18px] h-[18px]" /> : <ArrowRight className="w-[18px] h-[18px]" />}
          onClick={() => { if (step < 3) { setStep(3); setTried(false); } else void send(); }}
          onMissing={() => { setTried(true); scrollToMissing(); }} />
        {step === 3 && <p className="text-center text-[12.5px] text-text-industrial/60">{t("ob.signsAs").replace("{name}", user?.name ?? "")}</p>}
      </>)}
    >
      {step === 1 && <>
        <p className="text-[12.5px] text-text-industrial/60">{t("ob.permit.pickType")}</p>
        <div className="grid grid-cols-2 gap-2.5">
          {TYPES.map(x => (
            <OptionCard key={x.v} on={type === x.v} icon={<x.Icon className="w-[22px] h-[22px]" />} title={t(x.key)} sub={t(x.hint)}
              onClick={() => { setType(x.v); setStep(2); setTried(false); }} />
          ))}
        </div>
      </>}

      {step === 2 && T && <>
        <div className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-accent/10 border-[1.5px] border-accent">
          <T.Icon className="w-5 h-5 text-accent shrink-0" />
          <div className="min-w-0 flex-1"><b className="block text-[15px] font-bold">{t(T.key)}</b><span className="text-[12.5px] text-text-industrial/60">{t(T.hint)}</span></div>
          <button type="button" onClick={() => setStep(1)} className="min-h-9 px-3 rounded-xl border border-fg/10 bg-surface text-[13px] font-semibold">{t("ob.change")}</button>
        </div>
        <Field label={t("ob.permit.forWo").replace("{wo}", woTerms.abbr)} optional>
          <div className="flex flex-col gap-2">
            {openWos.items.map(w => (
              <RadioRow key={w.id} on={workOrderId === w.id} onClick={() => setWorkOrderId(workOrderId === w.id ? null : w.id)}
                title={w.title ?? w.workOrderCode} sub={`${w.workOrderCode} · ${w.assetName ?? ""}`} />
            ))}
            {!openWos.loading && openWos.items.length === 0 && <p className="text-[13px] text-text-industrial/50">{t("ob.noOpenWo").replace("{wo}", woTerms.abbr)}</p>}
          </div>
        </Field>
        <Field label={t("ob.permit.place")} missing={tried && missing2.location}>
          <input id="ob-ptw-place" className={inputCls} value={location} onChange={e => setLocation(e.target.value)} placeholder={t("ob.permit.placePh")} />
        </Field>
        <Field label={t("ob.permit.what")} missing={tried && missing2.description}>
          <textarea id="ob-ptw-what" className={textareaCls} value={description} onChange={e => setDescription(e.target.value)} placeholder={t("ob.permit.whatPh")} />
          <div className="flex gap-2"><DictateButton onText={chunk => setDescription(prev => [prev.trim(), chunk.trim()].filter(Boolean).join(" "))} /></div>
        </Field>
        <Field label={t("ob.permit.when")} missing={tried && missing2.times} hint={tried && missing2.times ? t("ob.permit.timesHint") : undefined}>
          <div className="flex gap-2">
            {[0, 1].map(d => (
              <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={day === d}
                className={`min-h-11 min-w-[96px] px-4 rounded-xl border-[1.5px] font-semibold text-[14.5px] ${day === d ? "bg-fg text-bg border-fg" : "bg-surface text-fg border-fg/10"}`}>
                {d === 0 ? t("ob.today") : t("ob.tomorrow")}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[12.5px] text-text-industrial/60">{t("ob.permit.from")}
              <input id="ob-ptw-from" type="time" className={`${inputCls} font-mono`} value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] text-text-industrial/60">{t("ob.permit.to")}
              <input id="ob-ptw-to" type="time" className={`${inputCls} font-mono`} value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </div>
        </Field>
      </>}

      {step === 3 && T && <>
        <Note tone="ai" icon={aiBusy ? <Loader2 className="w-[17px] h-[17px] shrink-0 mt-px animate-spin" /> : <Sparkles className="w-[17px] h-[17px] shrink-0 mt-px" />}>
          {aiBusy ? t("ob.permit.aiWorking") : t("ob.permit.aiDone").replace("{type}", t(T.key).toLowerCase())}
        </Note>
        {groupField("haz", t("ob.permit.hazards"))}
        {groupField("ctl", t("ob.permit.controls"))}
        {groupField("ppe", t("ob.permit.ppe"))}
      </>}

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
};
