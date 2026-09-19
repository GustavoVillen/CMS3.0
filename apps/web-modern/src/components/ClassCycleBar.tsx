import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Clock, FileText } from "lucide-react";
import { useT } from "../lib/i18n";
import { fmtDate } from "../lib/utils";
import { useFetch } from "../lib/hooks";

/**
 * Barra del ciclo de clase de un certificado (Preview certificados-ciclo V1).
 *
 * El ciclo termina en el vencimiento del certificado y dura 6 años en los
 * remolcadores y 8 en las barcazas. Encima se dibujan las ventanas de cada
 * inspección (± 6 meses), la de renovación (los últimos 12 meses), un ✓ donde
 * el plan de mantenimiento registra la inspección hecha y la marca de HOY.
 */

export interface ClassCycleInfo {
  vesselKind: "TUG" | "BARGE";
  cycleYears: number;
}

/** Fechas del certificado que usa la barra (casco; dique seco y eje no se dibujan). */
export interface ClassCycleDates {
  expiryDate: string;
  intermediateSurveyDate?: string | null;
  intermediateSurveyDueDate?: string | null;
  periodicSurveyDate?: string | null;
  periodicSurveyDueDate?: string | null;
}

type WindowKind = "per" | "int" | "ren";
interface CycleWindow { kind: WindowKind; target: Date; from: Date; to: Date; doneAt: Date | null }

export interface ClassCycleModel {
  start: Date;
  end: Date;
  windows: CycleWindow[];
  /** 4 vencido · 3 inspección sin registrar · 2 ventana abierta · 1 ventana abre en ≤ 6 meses · 0 al día */
  level: 0 | 1 | 2 | 3 | 4;
  /** La ventana que explica la situación (la abierta, la sin registrar o la próxima). */
  focus: CycleWindow | null;
}

/** Intermedias y periódicas: ± 6 meses de la fecha. Renovación: 12 meses antes del vencimiento. */
const WINDOW_MONTHS = 6;
const RENEWAL_WINDOW_MONTHS = 12;

/** Fecha ISO de la API → día local, sin corrimiento por zona horaria. */
function toDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthsBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / (86_400_000 * 30.44)));

export function computeClassCycle(cert: ClassCycleDates, info: ClassCycleInfo, today = new Date()): ClassCycleModel {
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = toDay(cert.expiryDate);
  const start = addMonths(end, -12 * info.cycleYears);
  const marks: { kind: WindowKind; at: number }[] = info.vesselKind === "TUG"
    ? [{ kind: "int", at: 36 }]
    : [{ kind: "per", at: 24 }, { kind: "int", at: 48 }, { kind: "per", at: 72 }];
  const day = (s?: string | null) => (s ? toDay(s) : null);
  // Fechas cargadas en el certificado (la fuente válida, sale del Ship Status).
  const done = { int: day(cert.intermediateSurveyDate), per: day(cert.periodicSurveyDate) };
  const due = { int: day(cert.intermediateSurveyDueDate), per: day(cert.periodicSurveyDueDate) };
  // Una fecha cargada corresponde a la inspección teórica si cae a menos de un
  // cuarto de ciclo: ClassNK programa la intermedia distinto que RINA.
  const margin = info.cycleYears * 3;
  const near = (d: Date | null, target: Date) => !!d && d >= addMonths(target, -margin) && d <= addMonths(target, margin);
  const windows: CycleWindow[] = marks.map(m => {
    const k = m.kind as "int" | "per";
    const rule = addMonths(start, m.at);
    // Con vencimiento cargado, la ventana se centra en esa fecha; si no, en la regla.
    const target = near(due[k], rule) ? due[k]! : rule;
    const doneAt = near(done[k], rule) ? done[k] : null;
    return { kind: m.kind, target, from: addMonths(target, -WINDOW_MONTHS), to: addMonths(target, WINDOW_MONTHS), doneAt };
  });
  windows.push({ kind: "ren", target: end, from: addMonths(end, -RENEWAL_WINDOW_MONTHS), to: end, doneAt: null });

  if (now > end) return { start, end, windows, level: 4, focus: windows[windows.length - 1] };

  const open = windows.find(w => now >= w.from && now <= w.to && !w.doneAt) ?? null;
  // Sin registrar: sólo la última ventana ya cerrada, y sólo si el certificado
  // tiene cargado ese tipo de inspección (ClassNK no informa periódicas; los
  // buques sin Ship Status cargado no informan ninguna).
  const closed = windows.filter(w => w.kind !== "ren" && w.to < now);
  const lastClosed = closed[closed.length - 1];
  const reported = lastClosed && (lastClosed.kind === "per"
    ? !!(done.per || due.per)
    : !!(done.int || due.int || done.per || due.per));
  if (lastClosed && !lastClosed.doneAt && reported && !(open && open.kind === lastClosed.kind)) {
    return { start, end, windows, level: 3, focus: lastClosed };
  }
  if (open) return { start, end, windows, level: 2, focus: open };
  const next = windows.find(w => w.from > now && !w.doneAt) ?? null;
  const level = next && monthsBetween(now, next.from) <= 6 ? 1 : 0;
  return { start, end, windows, level, focus: next };
}

const HATCH: Record<WindowKind, string> = {
  per: "repeating-linear-gradient(45deg,#9cc3ea 0 5px,#c5dcf3 5px 10px)",
  int: "repeating-linear-gradient(45deg,#f5b93b 0 5px,#f9d27f 5px 10px)",
  ren: "repeating-linear-gradient(45deg,#6d5bd0 0 5px,#9d91e3 5px 10px)",
};

function useLabels() {
  const t = useT();
  return (k: WindowKind) => t(k === "per" ? "cert.cycle.periodic" : k === "int" ? "cert.cycle.intermediate" : "cert.cycle.renewal");
}

export const ClassCycleBar: React.FC<{ model: ClassCycleModel; cycleYears: number }> = ({ model, cycleYears }) => {
  const t = useT();
  const label = useLabels();
  const { start, end, windows } = model;
  const now = new Date();
  const span = end.getTime() - start.getTime();
  const pos = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - start.getTime()) / span) * 100));
  const today = pos(now);
  const over = model.level === 4;

  // Todas las fechas exactas, al pasar el mouse.
  const tooltip = [
    `${t("cert.cycle.years").replace("{n}", String(cycleYears))} · ${t("cert.cycle.start")}: ${fmtDate(ymd(start))}`,
    ...windows.map(w => {
      const win = t("cert.cycle.window").replace("{from}", fmtDate(ymd(w.from))).replace("{to}", fmtDate(ymd(w.to)));
      const done = w.doneAt ? ` · ✓ ${t("cert.cycle.done").replace("{date}", fmtDate(ymd(w.doneAt)))}` : "";
      return `${label(w.kind)}${w.kind === "ren" ? "" : ` ${w.target.getFullYear()}`}: ${win}${done}`;
    }),
    t("cert.cycle.expires").replace("{date}", fmtDate(ymd(end))),
  ].join("\n");

  return (
    <div className="relative min-w-[22rem] pt-5 pb-9" title={tooltip}>
      <div className="relative h-3.5 rounded-full bg-fg/10">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-fg/15" style={{ width: `${today}%` }} />
        {windows.map((w, i) => (
          <div key={i} className={`absolute inset-y-0 ${w.kind === "ren" ? "rounded-r-full" : ""}`}
            style={{ left: `${pos(w.from)}%`, width: `${pos(w.to) - pos(w.from)}%`, background: HATCH[w.kind] }} />
        ))}
        {windows.filter(w => w.kind !== "ren").map((w, i) => (
          <React.Fragment key={`t${i}`}>
            <div className="absolute -top-1 h-5 w-0.5 -translate-x-1/2 bg-text-industrial/60" style={{ left: `${pos(w.target)}%` }} />
            <div className="absolute top-5 -translate-x-1/2 whitespace-nowrap text-[10px] text-text-industrial/60" style={{ left: `${pos(w.target)}%` }}>
              {t(w.kind === "int" ? "cert.cycle.intShort" : "cert.cycle.perShort")} {w.target.getFullYear()}
            </div>
          </React.Fragment>
        ))}
        {windows.filter(w => w.doneAt).map((w, i) => (
          <div key={`d${i}`} className="absolute top-1/2 z-[2] flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-surface bg-green-600 text-white"
            style={{ left: `${pos(w.doneAt!)}%` }}>
            <CheckCircle2 className="h-3 w-3" />
          </div>
        ))}
        <div className={`absolute -top-2.5 -bottom-1 z-[3] border-l-[2.5px] ${over ? "border-red-600" : "border-fg"}`} style={{ left: `${today}%` }}>
          <span className={`absolute -top-3.5 left-0 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-1 text-[10px] font-extrabold ${over ? "text-red-600" : "text-fg"}`}>
            ▼ {over ? t("cert.cycle.todayExpired") : t("cert.cycle.today")}
          </span>
        </div>
      </div>
      <div className="absolute left-0 bottom-1 text-[10px] font-semibold text-text-industrial/60">{fmtDate(ymd(start))}</div>
      <div className="absolute right-0 bottom-1 text-[10px] font-semibold text-text-industrial/60">
        {t("cert.cycle.expires").replace("{date}", fmtDate(ymd(end)))}
      </div>
    </div>
  );
};

/** La situación de hoy en palabras: color + ícono + texto. */
export const ClassCycleSituation: React.FC<{ model: ClassCycleModel }> = ({ model }) => {
  const t = useT();
  const label = useLabels();
  const now = new Date();
  const f = model.focus;
  let tone: string, Icon: typeof Circle, title: string, text = "";
  switch (model.level) {
    case 4:
      tone = "text-red-700 dark:text-red-400"; Icon = AlertTriangle; title = t("cert.cycle.expired");
      text = t("cert.cycle.expiredAgo").replace("{n}", String(monthsBetween(model.end, now))).replace("{date}", fmtDate(ymd(model.end)));
      break;
    case 3:
      tone = "text-red-700 dark:text-red-400"; Icon = AlertTriangle; title = t("cert.cycle.notRecorded").replace("{label}", label(f!.kind));
      text = t("cert.cycle.windowClosed").replace("{date}", fmtDate(ymd(f!.to)));
      break;
    case 2:
      tone = f!.kind === "ren" ? "text-violet-700 dark:text-violet-400" : "text-amber-700 dark:text-amber-400"; Icon = Circle;
      title = t("cert.cycle.inWindow").replace("{label}", label(f!.kind).toLowerCase());
      text = t("cert.cycle.closesOn").replace("{date}", fmtDate(ymd(f!.to))).replace("{n}", String(monthsBetween(now, f!.to)));
      break;
    default:
      tone = model.level === 1 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400";
      Icon = model.level === 1 ? Clock : CheckCircle2;
      title = model.level === 1 && f ? t("cert.cycle.opensSoon").replace("{label}", label(f.kind)) : t("cert.cycle.upToDate");
      if (f) text = t("cert.cycle.next").replace("{label}", label(f.kind).toLowerCase())
        .replace("{date}", fmtDate(ymd(f.from))).replace("{n}", String(monthsBetween(now, f.from)));
  }
  return (
    <div className="flex items-start gap-2 min-w-[12rem]">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <div className="leading-tight">
        <div className={`text-xs font-bold ${tone}`}>{title}</div>
        {text && <div className="text-[11px] text-text-industrial/60">{text}</div>}
      </div>
    </div>
  );
};

/** Referencias de colores de la barra, una sola vez arriba de la tabla. */
export const ClassCycleLegend: React.FC = () => {
  const t = useT();
  const sw = (bg: string) => <span className="inline-block h-2.5 w-4 rounded-sm align-[-1px]" style={{ background: bg }} />;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-text-industrial/60">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-fg/15 align-[-1px]" />{t("cert.cycle.legend.elapsed")}</span>
      <span className="inline-flex items-center gap-1.5">{sw(HATCH.per)}{t("cert.cycle.legend.periodic")}</span>
      <span className="inline-flex items-center gap-1.5">{sw(HATCH.int)}{t("cert.cycle.legend.intermediate")}</span>
      <span className="inline-flex items-center gap-1.5">{sw(HATCH.ren)}{t("cert.cycle.legend.renewal")}</span>
      <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />{t("cert.cycle.legend.done")}</span>
      <span className="font-extrabold text-fg">▼ {t("cert.cycle.today")}</span>
    </div>
  );
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Franja del Dashboard con el ciclo de clase del buque elegido. Sólo aparece
 * con un buque seleccionado y si tiene un certificado de clase con esquema
 * conocido (remolcador o barcaza). Un clic abre Certificados de ese buque.
 */
export const ClassCycleStrip: React.FC<{ vesselCode: string | null; vesselName?: string | null }> = ({ vesselCode, vesselName }) => {
  const t = useT();
  const navigate = useNavigate();
  const { data } = useFetch<{ items: Array<ClassCycleDates & { id: string; name: string; issuingAuthority: string; classCycle?: ClassCycleInfo | null }> }>(
    vesselCode ? `/app/certificates?vesselCode=${encodeURIComponent(vesselCode)}` : null,
    [vesselCode],
  );
  // El certificado de clase del buque: el de vencimiento más lejano.
  const cert = (data?.items ?? [])
    .filter(c => c.classCycle && /clasific|\bclase\b/.test(norm(c.name)))
    .sort((a, b) => b.expiryDate.localeCompare(a.expiryDate))[0];
  if (!vesselCode || !cert?.classCycle) return null;
  const model = computeClassCycle(cert, cert.classCycle);
  return (
    <button type="button" onClick={() => navigate(`/certificates?vesselCode=${encodeURIComponent(vesselCode)}`)}
      className="w-full text-left rounded-xl border border-fg/10 bg-surface px-4 pt-3 pb-1 hover:border-accent/40 transition-colors">
      <div className="flex items-center gap-2 text-xs">
        <FileText className="h-4 w-4 text-accent shrink-0" />
        <span className="font-bold text-fg">{t("cert.cycle.col")}</span>
        <span className="text-text-industrial/60">· {vesselName ?? vesselCode} · {cert.issuingAuthority}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
          {t("cert.cycle.open")} <ArrowRight className="h-3 w-3" />
        </span>
      </div>
      <div className="flex flex-col lg:flex-row lg:items-center gap-x-6">
        <div className="flex-1 min-w-0 overflow-x-auto"><ClassCycleBar model={model} cycleYears={cert.classCycle.cycleYears} /></div>
        <div className="pb-3 lg:pb-0 lg:w-72"><ClassCycleSituation model={model} /></div>
      </div>
    </button>
  );
};
