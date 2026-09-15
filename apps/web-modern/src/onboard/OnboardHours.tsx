// Horómetros: la lectura del día de cada equipo con horómetro.
//
// Mismos avisos que la planilla de escritorio (AssetHoursGrid): si la lectura es
// menor que la anterior o suma más horas de las que pasaron, se pide confirmar
// con una nota. No bloquea: puede haberse cambiado el horómetro. Corregir
// lecturas viejas y ver el historial queda para la PC.

import React, { useMemo, useState } from "react";
import { Gauge, Check, Loader2, AlertTriangle, CalendarClock, Monitor } from "lucide-react";
import { useT } from "../lib/i18n";
import { useFetch } from "../lib/hooks";
import { api } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { AlertDialog } from "../components/AlertDialog";
import { Screen, Head, MainButton, DoneScreen, Sheet, textareaCls, todayIso } from "./ui";
import { errorText } from "./shared";

export interface HoursRow {
  assetId: string;
  assetCode: string;
  assetName: string;
  lastReading: { runningHours: number; readingDate: string } | null;
  daysSinceReading: number | null;
  readingOnDate: { runningHours: number } | null;
}

/** Igual que la planilla de escritorio: a partir de una semana sin leer, atrasado. */
export const STALE_DAYS = 7;

function parseHours(v: string): number | null {
  const s = v.trim().replace(/\s/g, "");
  if (!s) return null;
  // "39.512" o "39,5": el punto de miles y la coma decimal del teclado del teléfono.
  const normalized = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/[.,](?=\d{3}(\D|$))/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const OnboardHours: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const t = useT();
  const { selectedVessel } = useVesselContext();
  const { data, loading } = useFetch<{ rows: HoursRow[]; canWrite: boolean }>("/app/pms/asset-hours");
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const rows = data?.rows ?? [];

  const check = (r: HoursRow, raw: string) => {
    const n = parseHours(raw);
    if (n === null) return null;
    const last = r.lastReading;
    if (!last) return { warn: false, text: t("ob.hours.first") };
    const diff = Math.round((n - last.runningHours) * 10) / 10;
    if (diff < 0) return { warn: true, text: t("ob.hours.lower").replace("{n}", Math.abs(diff).toLocaleString()) };
    const days = Math.max(1, r.daysSinceReading ?? 1);
    if (diff > days * 24) return { warn: true, text: t("ob.hours.tooMany").replace("{n}", diff.toLocaleString()).replace("{max}", String(days * 24)) };
    return { warn: false, text: t("ob.hours.delta").replace("{n}", diff.toLocaleString()) };
  };

  const entries = useMemo(() => rows
    .map(r => ({ r, n: parseHours(values[r.assetId] ?? ""), c: check(r, values[r.assetId] ?? "") }))
    .filter(x => x.n !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, values]);
  const warned = entries.filter(x => x.c?.warn);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/app/pms/asset-hours", {
        readingDate: todayIso(),
        entries: entries.map(x => ({
          assetId: x.r.assetId,
          runningHours: x.n,
          note: x.c?.warn && note.trim() ? note.trim() : null,
        })),
      });
      setSaved(entries.length);
    } catch (e) {
      setAlert(errorText(e, t("ob.sendFailed")));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (saved !== null) {
    return (
      <DoneScreen
        icon={<Gauge className="w-10 h-10" />}
        title={(saved === 1 ? t("ob.hours.savedOne") : t("ob.hours.savedN")).replace("{n}", String(saved))}
        lines={[
          { icon: <CalendarClock className="w-[17px] h-[17px]" />, text: t("ob.hours.recalc") },
          { icon: <Monitor className="w-[17px] h-[17px]" />, text: t("ob.hours.restPc") },
        ]}
        onHome={onExit}
      />
    );
  }

  const now = new Date();
  const sub = `${t("ob.hours.today")} · ${now.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })} · ${selectedVessel?.name ?? ""}`;

  return (
    <Screen
      head={<Head title={t("ob.tile.hours")} sub={sub} onBack={onExit} />}
      foot={data?.canWrite === false ? undefined : (
        <MainButton busy={busy} disabled={entries.length === 0}
          label={entries.length ? (entries.length === 1 ? t("ob.hours.saveOne") : t("ob.hours.saveN")).replace("{n}", String(entries.length)) : t("ob.hours.save")}
          icon={<Check className="w-5 h-5" />}
          onClick={() => warned.length ? setConfirm(true) : void save()} />
      )}
    >
      <p className="text-[12.5px] text-text-industrial/60">{t("ob.hours.hint")}</p>
      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-industrial/50">{t("ob.hours.empty")}</p>
      ) : rows.map(r => {
        const stale = r.daysSinceReading !== null && r.daysSinceReading >= STALE_DAYS;
        const raw = values[r.assetId] ?? "";
        const c = check(r, raw);
        return (
          <div key={r.assetId} className="bg-surface border border-fg/10 rounded-2xl pl-3.5 pr-3 py-3 flex items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <b className="block text-[15px] font-bold leading-snug">{r.assetName || r.assetCode}</b>
              <span className={`block text-[13px] ${stale ? "text-danger font-bold" : "text-text-industrial/60"}`}>
                {r.lastReading
                  ? `${t("ob.hours.last")}: ${r.lastReading.runningHours.toLocaleString()} h · ${(r.daysSinceReading === 1 ? t("ob.hours.agoOne") : t("ob.hours.agoN")).replace("{n}", String(r.daysSinceReading ?? 0))}${stale ? ` · ${t("ob.hours.stale")}` : ""}`
                  : t("ob.hours.never")}
              </span>
              <span className={`block text-[12.5px] font-bold min-h-[18px] ${c?.warn ? "text-warning" : "text-success"}`}>{c?.text ?? ""}</span>
            </div>
            <label className="flex items-center gap-1.5">
              <input id={`ob-h-${r.assetId}`} inputMode="decimal" autoComplete="off" value={raw}
                onChange={e => setValues(v => ({ ...v, [r.assetId]: e.target.value }))}
                placeholder={r.lastReading ? r.lastReading.runningHours.toLocaleString() : "0"}
                aria-label={r.assetName || r.assetCode}
                className="w-[122px] min-h-[54px] text-right font-mono text-[19px] font-semibold tabular-nums rounded-xl border-[1.5px] border-fg/10 bg-fg/5 text-fg px-2.5 focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15" />
              <span className="font-bold text-text-industrial/60">h</span>
            </label>
          </div>
        );
      })}

      {confirm && (
        <Sheet title={t("ob.hours.checkTitle")} onClose={() => setConfirm(false)}>
          {warned.map(x => (
            <div key={x.r.assetId} className="flex gap-2.5 rounded-2xl p-3 bg-warning/10 text-[13.5px]">
              <AlertTriangle className="w-[17px] h-[17px] shrink-0 text-warning mt-px" />
              <span><b>{x.r.assetName || x.r.assetCode}</b><br />{x.c?.text}</span>
            </div>
          ))}
          <textarea id="ob-h-note" className={textareaCls} value={note} onChange={e => setNote(e.target.value)} placeholder={t("ob.hours.notePh")} />
          <div className="grid grid-cols-[1fr_1.4fr] gap-2">
            <button type="button" onClick={() => setConfirm(false)} className="min-h-12 rounded-2xl border-[1.5px] border-fg/10 font-bold">{t("ob.hours.fix")}</button>
            <MainButton busy={busy} label={t("ob.hours.saveAnyway")} onClick={() => void save()} />
          </div>
        </Sheet>
      )}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
};
