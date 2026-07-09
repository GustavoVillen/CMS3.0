// Secciones del formulario controlado de Gestión de Cambios (REGI-GES-06.1).
// Se montan dentro de MocModal (Moc.tsx). Mantiene el estado "extra" del MOC
// (todo lo que va más allá de los campos base) y aplica revelado progresivo:
// las secciones pesadas (opinión técnica, plan de acción, análisis de eficacia)
// solo aparecen cuando la evaluación marca impacto o el riesgo es Alto/Crítico.

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Lock } from "lucide-react";
import {
  EVAL_GROUPS, EVAL_QUESTIONS, EFFECTIVENESS_QUESTIONS,
  EVALUATOR_AREAS, CHANGE_TYPES, LOCATION_TYPES,
} from "../../lib/moc-form-catalog";

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-2.5 py-1.5 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1";

// ─── Tipos del estado "REGI" ──────────────────────────────────────────────────

export type YesNo = "" | "YES" | "NO";
export type YesNoUnknown = "" | "YES" | "NO" | "UNKNOWN";

export interface RegiTechReview {
  team: "SSMA" | "SUPPORT";
  evaluatorName: string;
  methodology: string;
  impact: "" | "WITH" | "WITHOUT";   // Con / Sin impacto para SSMA
  viable: YesNo;
  justification: string;
  riskClassification: string;         // Calif. de riesgo (NFN…) — sobre todo Apoyo
}
export interface RegiActionRow {
  impact: string; action: string; responsible: string;
  dueDate: string; status: string; observations: string;
}
export interface RegiForm {
  // Identificación ampliada
  requesterName: string; requesterRegistration: string;
  changeManagerName: string; changeManagerRegistration: string;
  requestingArea: string; areaSupervisor: string; managementName: string; managerName: string;
  // Dimensión
  changeTypes: string[]; duration: "" | "PERMANENT" | "TEMPORARY"; temporaryUntil: string;
  locationType: string; locationUnit: string; physicalArea: string;
  // Descripción
  currentSituation: string; expectedResult: string;
  // Evaluación previa (24) + áreas evaluadoras
  evaluationAnswers: Record<number, { answer: YesNoUnknown; canImpact: boolean }>;
  evaluatorAreas: string[];
  // Opinión técnica + plan de acción
  technicalReviews: RegiTechReview[];
  actionPlan: RegiActionRow[];
  // Aprobación final
  finalRiskLevel: string; recommendationsBeforeChange: string; additionalInfo: string;
  // Análisis de eficacia (7)
  effectivenessAnswers: Record<number, { answer: YesNo; detail: string }>;
}

const emptyTechReview = (team: "SSMA" | "SUPPORT"): RegiTechReview => ({
  team, evaluatorName: "", methodology: "", impact: "", viable: "", justification: "", riskClassification: "",
});
export const emptyActionRow = (): RegiActionRow => ({
  impact: "", action: "", responsible: "", dueDate: "", status: "Abierto", observations: "",
});

/** Estado inicial desde un MOC existente (record crudo con los *Json) o vacío. */
export function initRegiForm(moc: Record<string, unknown> | null): RegiForm {
  const g = <T,>(k: string, fallback: T): T => (moc?.[k] as T) ?? fallback;
  const arr = (k: string): unknown[] => (Array.isArray(moc?.[k]) ? (moc![k] as unknown[]) : []);
  const evalAns: RegiForm["evaluationAnswers"] = {};
  for (const a of arr("evaluationAnswersJson") as { n: number; answer?: YesNoUnknown; canImpact?: boolean }[]) {
    if (typeof a?.n === "number") evalAns[a.n] = { answer: a.answer ?? "", canImpact: !!a.canImpact };
  }
  const effAns: RegiForm["effectivenessAnswers"] = {};
  for (const a of arr("effectivenessAnswersJson") as { n: number; answer?: YesNo; detail?: string }[]) {
    if (typeof a?.n === "number") effAns[a.n] = { answer: a.answer ?? "", detail: a.detail ?? "" };
  }
  const reviews = arr("technicalReviewsJson") as RegiTechReview[];
  const byTeam = (team: "SSMA" | "SUPPORT") => reviews.find(r => r?.team === team) ?? emptyTechReview(team);
  return {
    requesterName: g("requesterName", ""), requesterRegistration: g("requesterRegistration", ""),
    changeManagerName: g("changeManagerName", ""), changeManagerRegistration: g("changeManagerRegistration", ""),
    requestingArea: g("requestingArea", ""), areaSupervisor: g("areaSupervisor", ""),
    managementName: g("managementName", ""), managerName: g("managerName", ""),
    changeTypes: arr("changeTypesJson") as string[],
    duration: (g("duration", "") as RegiForm["duration"]) || "",
    temporaryUntil: (g<string | null>("temporaryUntil", null) ?? "").slice(0, 10),
    locationType: g("locationType", ""), locationUnit: g("locationUnit", ""), physicalArea: g("physicalArea", ""),
    currentSituation: g("currentSituation", ""), expectedResult: g("expectedResult", ""),
    evaluationAnswers: evalAns,
    evaluatorAreas: arr("evaluatorAreasJson") as string[],
    technicalReviews: [byTeam("SSMA"), byTeam("SUPPORT")],
    actionPlan: (arr("actionPlanJson") as RegiActionRow[]).map(r => ({ ...emptyActionRow(), ...r })),
    finalRiskLevel: g("finalRiskLevel", ""), recommendationsBeforeChange: g("recommendationsBeforeChange", ""),
    additionalInfo: g("additionalInfo", ""),
    effectivenessAnswers: effAns,
  };
}

/** Serializa el estado a lo que espera el backend (payload de create/update). */
export function serializeRegi(f: RegiForm) {
  return {
    requesterName: f.requesterName || null,
    requesterRegistration: f.requesterRegistration || null,
    changeManagerName: f.changeManagerName || null,
    changeManagerRegistration: f.changeManagerRegistration || null,
    requestingArea: f.requestingArea || null,
    areaSupervisor: f.areaSupervisor || null,
    managementName: f.managementName || null,
    managerName: f.managerName || null,
    changeTypes: f.changeTypes,
    duration: f.duration || null,
    temporaryUntil: f.temporaryUntil || null,
    locationType: f.locationType || null,
    locationUnit: f.locationUnit || null,
    physicalArea: f.physicalArea || null,
    currentSituation: f.currentSituation || null,
    expectedResult: f.expectedResult || null,
    evaluationAnswers: EVAL_QUESTIONS.map(q => ({
      n: q.n, group: q.group,
      answer: f.evaluationAnswers[q.n]?.answer || null,
      canImpact: !!f.evaluationAnswers[q.n]?.canImpact,
    })),
    evaluatorAreas: f.evaluatorAreas,
    technicalReviews: f.technicalReviews.filter(r => r.evaluatorName || r.justification || r.methodology || r.viable),
    actionPlan: f.actionPlan.filter(r => r.impact || r.action || r.responsible),
    finalRiskLevel: f.finalRiskLevel || null,
    recommendationsBeforeChange: f.recommendationsBeforeChange || null,
    additionalInfo: f.additionalInfo || null,
    effectivenessAnswers: EFFECTIVENESS_QUESTIONS.map(q => ({
      n: q.n,
      answer: f.effectivenessAnswers[q.n]?.answer || null,
      detail: f.effectivenessAnswers[q.n]?.detail || "",
    })),
  };
}

/** Screening: la gestión completa aplica si alguna pregunta marca impacto o
 * "No sabe", o si el riesgo es Alto/Crítico. */
export function computeRequiresFull(f: RegiForm, riskLevel: string): boolean {
  const anyImpact = Object.values(f.evaluationAnswers).some(a => a.canImpact || a.answer === "UNKNOWN");
  return anyImpact || riskLevel === "HIGH" || riskLevel === "CRITICAL";
}

// ─── UI primitives ────────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, subtitle, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-fg/10 bg-fg/[0.02] overflow-hidden">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-fg/[0.03] transition-colors">
        {open ? <ChevronDown className="w-4 h-4 text-accent shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-industrial/50 shrink-0" />}
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-wider text-fg truncate">{title}</h3>
          {subtitle && <p className="text-[10px] text-text-industrial/40 truncate">{subtitle}</p>}
        </div>
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-3">{children}</div>}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className = "" }) => (
  <div className={className}><label className={labelCls}>{label}</label>{children}</div>
);

const Text: React.FC<{ value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; type?: string }> = ({ value, onChange, disabled, placeholder, type = "text" }) => (
  <input type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} className={inputCls} />
);
const Area: React.FC<{ value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; rows?: number }> = ({ value, onChange, disabled, placeholder, rows = 2 }) => (
  <textarea value={value} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} rows={rows} className={inputCls + " resize-y"} />
);

// Selector Sí / No / (No sabe) compacto.
const YNButtons: React.FC<{ value: string; onChange: (v: string) => void; disabled?: boolean; withUnknown?: boolean }> = ({ value, onChange, disabled, withUnknown }) => {
  const opts: { v: string; label: string; on: string }[] = [
    { v: "YES", label: "Sí", on: "bg-green-500/15 border-green-500/40 text-green-700 dark:text-green-400" },
    { v: "NO",  label: "No", on: "bg-fg/10 border-fg/20 text-fg" },
    ...(withUnknown ? [{ v: "UNKNOWN", label: "No sabe", on: "bg-yellow-500/15 border-yellow-500/40 text-yellow-700 dark:text-yellow-400" }] : []),
  ];
  return (
    <div className="flex gap-1">
      {opts.map(o => (
        <button key={o.v} type="button" disabled={disabled}
          onClick={() => onChange(value === o.v ? "" : o.v)}
          className={`px-2 py-1 rounded-md border text-[11px] font-bold transition-colors disabled:opacity-50 ${value === o.v ? o.on : "bg-transparent border-fg/15 text-text-industrial/50 hover:border-fg/30"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
};

const Chips: React.FC<{ options: { key: string; label: string }[]; selected: string[]; onToggle: (k: string) => void; disabled?: boolean }> = ({ options, selected, onToggle, disabled }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map(o => {
      const on = selected.includes(o.key);
      return (
        <button key={o.key} type="button" disabled={disabled} onClick={() => onToggle(o.key)}
          className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors disabled:opacity-50 ${on ? "bg-accent/15 border-accent/40 text-accent" : "bg-transparent border-fg/15 text-text-industrial/50 hover:border-fg/30"}`}>
          {o.label}
        </button>
      );
    })}
  </div>
);

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  form: RegiForm;
  onChange: (patch: Partial<RegiForm>) => void;
  disabled?: boolean;
  requiresFull: boolean;
  /** Buques/unidades del tenant para el selector de "Lugar" (unidad RE). */
  units: { code: string; name: string }[];
}

export const MocRegiSections: React.FC<Props> = ({ form, onChange, disabled, requiresFull, units }) => {
  const setEval = (n: number, patch: Partial<{ answer: YesNoUnknown; canImpact: boolean }>) =>
    onChange({ evaluationAnswers: { ...form.evaluationAnswers, [n]: { answer: "", canImpact: false, ...form.evaluationAnswers[n], ...patch } } });
  const setEff = (n: number, patch: Partial<{ answer: YesNo; detail: string }>) =>
    onChange({ effectivenessAnswers: { ...form.effectivenessAnswers, [n]: { answer: "", detail: "", ...form.effectivenessAnswers[n], ...patch } } });
  const toggle = (list: string[], k: string) => list.includes(k) ? list.filter(x => x !== k) : [...list, k];
  const setReview = (i: number, patch: Partial<RegiTechReview>) => {
    const next = form.technicalReviews.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    onChange({ technicalReviews: next });
  };
  const setAction = (i: number, patch: Partial<RegiActionRow>) => {
    onChange({ actionPlan: form.actionPlan.map((r, idx) => idx === i ? { ...r, ...patch } : r) });
  };

  return (
    <div className="space-y-3">
      {/* 1 · Identificación ampliada */}
      <Section title="Identificación del cambio" subtitle="Responsables y solicitud">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Solicitante"><Text value={form.requesterName} onChange={v => onChange({ requesterName: v })} disabled={disabled} /></Field>
          <Field label="Matrícula solicitante"><Text value={form.requesterRegistration} onChange={v => onChange({ requesterRegistration: v })} disabled={disabled} /></Field>
          <Field label="Gestor del cambio"><Text value={form.changeManagerName} onChange={v => onChange({ changeManagerName: v })} disabled={disabled} /></Field>
          <Field label="Matrícula gestor"><Text value={form.changeManagerRegistration} onChange={v => onChange({ changeManagerRegistration: v })} disabled={disabled} /></Field>
          <Field label="Área"><Text value={form.requestingArea} onChange={v => onChange({ requestingArea: v })} disabled={disabled} /></Field>
          <Field label="Supervisor del área"><Text value={form.areaSupervisor} onChange={v => onChange({ areaSupervisor: v })} disabled={disabled} /></Field>
          <Field label="Gerencia"><Text value={form.managementName} onChange={v => onChange({ managementName: v })} disabled={disabled} /></Field>
          <Field label="Gerente"><Text value={form.managerName} onChange={v => onChange({ managerName: v })} disabled={disabled} /></Field>
        </div>
      </Section>

      {/* 1 · Dimensión del cambio */}
      <Section title="Dimensión del cambio" subtitle="Tipo, duración y lugar">
        <Field label="Tipo de cambio (uno o varios)">
          <Chips options={CHANGE_TYPES} selected={form.changeTypes} onToggle={k => onChange({ changeTypes: toggle(form.changeTypes, k) })} disabled={disabled} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Duración">
            <div className="flex gap-1">
              {[{ v: "PERMANENT", label: "Permanente" }, { v: "TEMPORARY", label: "Temporal" }].map(o => (
                <button key={o.v} type="button" disabled={disabled}
                  onClick={() => onChange({ duration: (form.duration === o.v ? "" : o.v) as RegiForm["duration"] })}
                  className={`px-2.5 py-1.5 rounded-md border text-[11px] font-bold transition-colors disabled:opacity-50 ${form.duration === o.v ? "bg-accent/15 border-accent/40 text-accent" : "bg-transparent border-fg/15 text-text-industrial/50 hover:border-fg/30"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          {form.duration === "TEMPORARY" && (
            <Field label="Temporal hasta"><Text type="date" value={form.temporaryUntil} onChange={v => onChange({ temporaryUntil: v })} disabled={disabled} /></Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Lugar">
            <Chips options={LOCATION_TYPES} selected={form.locationType ? [form.locationType] : []} onToggle={k => onChange({ locationType: form.locationType === k ? "" : k })} disabled={disabled} />
          </Field>
          <Field label="Unidad / embarcación">
            <select value={form.locationUnit} onChange={e => onChange({ locationUnit: e.target.value })} disabled={disabled} className={inputCls}>
              <option value="">—</option>
              {units.map(u => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}
            </select>
          </Field>
        </div>
        <Field label="Especificar / describir el área física"><Text value={form.physicalArea} onChange={v => onChange({ physicalArea: v })} disabled={disabled} /></Field>
      </Section>

      {/* 1 · Descripción detallada (situación actual + resultado esperado) */}
      <Section title="Descripción — contexto" subtitle="Situación actual y resultado esperado">
        <Field label="Situación actual"><Area value={form.currentSituation} onChange={v => onChange({ currentSituation: v })} disabled={disabled} rows={2} /></Field>
        <Field label="Resultado esperado"><Area value={form.expectedResult} onChange={v => onChange({ expectedResult: v })} disabled={disabled} rows={2} /></Field>
      </Section>

      {/* 2 · Evaluación previa (24 preguntas) */}
      <Section title="Evaluación previa al cambio" subtitle="24 preguntas · marcá impacto donde corresponda">
        <p className="text-[10px] text-text-industrial/50 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2.5 py-1.5">
          Si respondés <b>Sí</b> o <b>No sabe</b> en la columna de impacto, se aplica la gestión completa del cambio.
        </p>
        {EVAL_GROUPS.map(group => (
          <div key={group.key} className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent/80 pt-1">{group.label}</p>
            {EVAL_QUESTIONS.filter(q => q.group === group.key).map(q => {
              const a = form.evaluationAnswers[q.n];
              return (
                <div key={q.n} className="flex items-start gap-2 rounded-lg border border-fg/10 px-2 py-1.5">
                  <span className="text-[10px] font-mono text-text-industrial/40 w-5 shrink-0 pt-0.5">{q.n}</span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-[11px] text-text-industrial/80 leading-snug">{q.text}</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <YNButtons value={a?.answer ?? ""} onChange={v => setEval(q.n, { answer: v as YesNoUnknown })} disabled={disabled} withUnknown />
                      <label className="flex items-center gap-1.5 text-[10px] text-text-industrial/60 cursor-pointer select-none">
                        <input type="checkbox" checked={!!a?.canImpact} onChange={e => setEval(q.n, { canImpact: e.target.checked })} disabled={disabled} className="accent-red-500" />
                        ¿Puede impactar?
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <Field label="Áreas / personas que deberán evaluar">
          <Chips options={EVALUATOR_AREAS} selected={form.evaluatorAreas} onToggle={k => onChange({ evaluatorAreas: toggle(form.evaluatorAreas, k) })} disabled={disabled} />
        </Field>
      </Section>

      {/* Aviso de revelado progresivo */}
      {!requiresFull && (
        <div className="flex items-center gap-2 text-[11px] text-text-industrial/50 px-3 py-2 rounded-xl border border-dashed border-fg/15">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Opinión técnica, plan de acción y análisis de eficacia se habilitan si la evaluación marca impacto o el riesgo es Alto/Crítico.
        </div>
      )}

      {/* 3 · Clasificación, viabilidad y opinión técnica */}
      {requiresFull && (
        <Section title="Clasificación, viabilidad y opinión técnica" subtitle="Equipos SSMA y de Apoyo">
          {form.technicalReviews.map((r, i) => (
            <div key={r.team} className="rounded-lg border border-fg/10 p-2.5 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-accent/80">{r.team === "SSMA" ? "Equipo de SSMA" : "Equipo de Apoyo"}</p>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Evaluador"><Text value={r.evaluatorName} onChange={v => setReview(i, { evaluatorName: v })} disabled={disabled} /></Field>
                <Field label="Metodología"><Text value={r.methodology} onChange={v => setReview(i, { methodology: v })} disabled={disabled} placeholder="APR-LAIA-ART…" /></Field>
                <Field label="Impacto para SSMA">
                  <div className="flex gap-1">
                    {[{ v: "WITH", label: "Con impacto" }, { v: "WITHOUT", label: "Sin impacto" }].map(o => (
                      <button key={o.v} type="button" disabled={disabled}
                        onClick={() => setReview(i, { impact: (r.impact === o.v ? "" : o.v) as RegiTechReview["impact"] })}
                        className={`px-2 py-1 rounded-md border text-[11px] font-bold transition-colors disabled:opacity-50 ${r.impact === o.v ? "bg-accent/15 border-accent/40 text-accent" : "bg-transparent border-fg/15 text-text-industrial/50 hover:border-fg/30"}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="¿Es viable?"><YNButtons value={r.viable} onChange={v => setReview(i, { viable: v as YesNo })} disabled={disabled} /></Field>
                {r.team === "SUPPORT" && (
                  <Field label="Calif. de riesgo"><Text value={r.riskClassification} onChange={v => setReview(i, { riskClassification: v })} disabled={disabled} placeholder="NFN…" /></Field>
                )}
              </div>
              <Field label="Parecer técnico y recomendaciones"><Area value={r.justification} onChange={v => setReview(i, { justification: v })} disabled={disabled} rows={3} /></Field>
            </div>
          ))}
        </Section>
      )}

      {/* 4 · Plan de acción */}
      {requiresFull && (
        <Section title="Plan de acción para la implementación" subtitle="Impacto · acción · responsable · fecha · estatus">
          <div className="space-y-2">
            {form.actionPlan.length === 0 && <p className="text-[11px] text-text-industrial/40">Sin acciones cargadas.</p>}
            {form.actionPlan.map((row, i) => (
              <div key={i} className="rounded-lg border border-fg/10 p-2.5 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-mono text-text-industrial/40 pt-1.5">{i + 1}</span>
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <Field label="Impacto en el proceso/tarea"><Text value={row.impact} onChange={v => setAction(i, { impact: v })} disabled={disabled} /></Field>
                    <Field label="Acción a realizar"><Text value={row.action} onChange={v => setAction(i, { action: v })} disabled={disabled} /></Field>
                    <Field label="Responsable"><Text value={row.responsible} onChange={v => setAction(i, { responsible: v })} disabled={disabled} /></Field>
                    <Field label="Fecha de conclusión"><Text type="date" value={row.dueDate} onChange={v => setAction(i, { dueDate: v })} disabled={disabled} /></Field>
                    <Field label="Estatus"><Text value={row.status} onChange={v => setAction(i, { status: v })} disabled={disabled} /></Field>
                    <Field label="Observaciones"><Text value={row.observations} onChange={v => setAction(i, { observations: v })} disabled={disabled} /></Field>
                  </div>
                  {!disabled && (
                    <button type="button" onClick={() => onChange({ actionPlan: form.actionPlan.filter((_, idx) => idx !== i) })} className="text-text-industrial/40 hover:text-red-500 transition-colors pt-1.5">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!disabled && (
            <button type="button" onClick={() => onChange({ actionPlan: [...form.actionPlan, emptyActionRow()] })}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-accent/30 text-accent text-[11px] font-bold hover:bg-accent/10 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Agregar acción
            </button>
          )}
        </Section>
      )}

      {/* 5 · Aprobación / clasificación final */}
      <Section title="Aprobación para la implantación" subtitle="Clasificación final y recomendaciones" defaultOpen={requiresFull}>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Clasificación final del riesgo">
            <select value={form.finalRiskLevel} onChange={e => onChange({ finalRiskLevel: e.target.value })} disabled={disabled} className={inputCls}>
              <option value="">—</option>
              <option value="LOW">Bajo</option>
              <option value="MEDIUM">Medio</option>
              <option value="HIGH">Alto</option>
              <option value="CRITICAL">Crítico</option>
            </select>
          </Field>
        </div>
        <Field label="Recomendaciones realizadas antes del cambio"><Area value={form.recommendationsBeforeChange} onChange={v => onChange({ recommendationsBeforeChange: v })} disabled={disabled} rows={2} /></Field>
        <Field label="Informaciones adicionales"><Area value={form.additionalInfo} onChange={v => onChange({ additionalInfo: v })} disabled={disabled} rows={2} /></Field>
      </Section>

      {/* 6 · Análisis de eficacia */}
      {requiresFull && (
        <Section title="Análisis de eficacia" subtitle="Verificación posterior al cambio" defaultOpen={false}>
          {EFFECTIVENESS_QUESTIONS.map(q => {
            const a = form.effectivenessAnswers[q.n];
            return (
              <div key={q.n} className="rounded-lg border border-fg/10 px-2 py-1.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-mono text-text-industrial/40 w-5 shrink-0 pt-0.5">{q.n}</span>
                  <p className="flex-1 text-[11px] text-text-industrial/80 leading-snug">{q.text}</p>
                  <YNButtons value={a?.answer ?? ""} onChange={v => setEff(q.n, { answer: v as YesNo })} disabled={disabled} />
                </div>
                <Text value={a?.detail ?? ""} onChange={v => setEff(q.n, { detail: v })} disabled={disabled} placeholder="Detalles / fundamento" />
              </div>
            );
          })}
        </Section>
      )}
    </div>
  );
};
