// Check list: elegir la lista, responder Sí / No / N/A y firmar.
//
// Cada respuesta se guarda en el momento (el servidor ya pre-crea los puntos en
// PENDIENTE al empezar), así que se puede cortar y seguir más tarde: queda en
// "Sin terminar". El "No" pide explicar qué pasa. El sistema guarda estado y
// nota, no fotos (decisión: fotos en otra etapa). El PDF sale desde la PC.

import React, { useCallback, useMemo, useRef, useState } from "react";
import { ClipboardCheck, ChevronRight, Check, X, Loader2, PenLine, CircleCheck, Monitor } from "lucide-react";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useFetch } from "../lib/hooks";
import { api } from "../lib/api";
import { useVesselContext } from "../lib/vessel-context";
import { AlertDialog } from "../components/AlertDialog";
import { Screen, Head, MainButton, DoneScreen, Sheet, SectionLabel, scrollToMissing } from "./ui";
import { errorText } from "./shared";

interface Template { id: string; name: string; type: string; itemsJson: Array<{ code: string; text: string }> }
interface ExecutionRow { id: string; executionCode: string; templateName: string | null; eventDateTime: string; totalItems: number }
interface Response { itemCode: string; itemText: string; status: string; notes: string | null }
interface Execution { id: string; executionCode: string; status: string; responses: Response[]; template: Template | null }

type Answer = "CONFORMING" | "NOT_CONFORMING" | "NOT_APPLICABLE";

export const OnboardChecklist: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const t = useT();
  const { user } = useAuth();
  const { selectedVesselCode, selectedVessel } = useVesselContext();
  const templates = useFetch<{ items: Template[] }>("/app/checklist-templates");
  const running = useFetch<{ items: ExecutionRow[] }>("/app/checklist-executions?status=IN_PROGRESS");
  const [exec, setExec] = useState<Execution | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const open = async (id: string) => {
    setOpening(id);
    try { setExec(await api.get<Execution>(`/app/checklist-executions/${id}`)); }
    catch (e) { setAlert(errorText(e, t("ob.loadFailed"))); }
    finally { setOpening(null); }
  };

  const start = async (tpl: Template) => {
    if (!selectedVesselCode) return;
    setOpening(tpl.id);
    try {
      const created = await api.post<{ id: string }>("/app/checklist-executions", {
        vesselCode: selectedVesselCode, templateId: tpl.id, eventDateTime: new Date().toISOString(), performedByName: user?.name ?? null,
      });
      setExec(await api.get<Execution>(`/app/checklist-executions/${created.id}`));
    } catch (e) {
      setAlert(errorText(e, t("ob.sendFailed")));
    } finally {
      setOpening(null);
    }
  };

  if (exec) {
    return <ChecklistRun exec={exec} onBack={() => { setExec(null); void running.reload(); }} onExit={onExit} />;
  }

  return (
    <Screen head={<Head title={t("ob.tile.checklist")} sub={selectedVessel?.name} onBack={onExit} />}>
      {(running.data?.items.length ?? 0) > 0 && <>
        <SectionLabel>{t("ob.check.unfinished")}</SectionLabel>
        {running.data!.items.map(r => (
          <button key={r.id} type="button" onClick={() => void open(r.id)}
            className="w-full text-left bg-surface border border-fg/10 rounded-2xl p-3.5 flex items-center gap-3 active:bg-fg/5">
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-text-industrial/60">
                {t("ob.check.startedAt").replace("{when}", new Date(r.eventDateTime).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}
              </span>
              <span className="block text-base font-extrabold">{r.templateName ?? r.executionCode}</span>
            </span>
            {opening === r.id ? <Loader2 className="w-5 h-5 animate-spin text-accent" /> : <span className="text-[13px] font-bold text-accent">{t("ob.check.resume")}</span>}
          </button>
        ))}
      </>}

      <SectionLabel>{t("ob.check.startNew")}</SectionLabel>
      {templates.loading && !templates.data ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
      ) : (
        <div className="bg-surface border border-fg/10 rounded-2xl overflow-hidden">
          {(templates.data?.items ?? []).map((tpl, i) => (
            <button key={tpl.id} type="button" onClick={() => void start(tpl)} disabled={!!opening}
              className={`w-full text-left flex items-center gap-3 px-3.5 py-3 min-h-[60px] active:bg-fg/5 ${i ? "border-t border-fg/10" : ""}`}>
              <span className="min-w-0 flex-1">
                <b className="block text-[15px] font-bold leading-snug">{tpl.name}</b>
                <span className="text-[12.5px] text-text-industrial/60">{t("ob.check.points").replace("{n}", String(tpl.itemsJson?.length ?? 0))}</span>
              </span>
              {opening === tpl.id ? <Loader2 className="w-5 h-5 animate-spin text-accent" /> : <ChevronRight className="w-[18px] h-[18px] text-text-industrial/40" />}
            </button>
          ))}
          {(templates.data?.items.length ?? 0) === 0 && <p className="p-4 text-center text-sm text-text-industrial/50">{t("ob.check.noTemplates")}</p>}
        </div>
      )}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
};

function ChecklistRun({ exec, onBack, onExit }: { exec: Execution; onBack: () => void; onExit: () => void }) {
  const t = useT();
  const { user } = useAuth();
  const { selectedVessel } = useVesselContext();

  // Orden de la plantilla (el servidor devuelve las respuestas por código).
  const items = useMemo(() => {
    const order = new Map((exec.template?.itemsJson ?? []).map((it, i) => [it.code, i]));
    return [...exec.responses].sort((a, b) => (order.get(a.itemCode) ?? 999) - (order.get(b.itemCode) ?? 999));
  }, [exec]);

  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>(() =>
    Object.fromEntries(exec.responses.filter(r => r.status !== "PENDING").map(r => [r.itemCode, r.status as Answer])));
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(exec.responses.map(r => [r.itemCode, r.notes ?? ""])));
  const [tried, setTried] = useState(false);
  const [sign, setSign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const saveResponse = useCallback(async (itemCode: string, status: Answer | "PENDING", note: string) => {
    try {
      await api.post(`/app/checklist-executions/${exec.id}/responses`, {
        itemCode, status, notes: note.trim() || null, reportedByName: user?.name ?? null,
      });
    } catch (e) {
      setAlert(errorText(e, t("ob.sendFailed")));
    }
  }, [exec.id, user?.name, t]);

  const answer = (code: string, a: Answer) => {
    const nextA = answers[code] === a ? undefined : a;
    setAnswers(prev => ({ ...prev, [code]: nextA }));
    void saveResponse(code, nextA ?? "PENDING", notes[code] ?? "");
  };

  const changeNote = (code: string, text: string) => {
    setNotes(prev => ({ ...prev, [code]: text }));
    clearTimeout(noteTimers.current[code]);
    noteTimers.current[code] = setTimeout(() => { void saveResponse(code, answers[code] ?? "PENDING", text); }, 700);
  };

  const answered = items.filter(i => answers[i.itemCode]).length;
  const noCount = items.filter(i => answers[i.itemCode] === "NOT_CONFORMING").length;
  const noteMissing = items.filter(i => answers[i.itemCode] === "NOT_CONFORMING" && !(notes[i.itemCode] ?? "").trim()).length;
  const missing = items.length - answered + noteMissing;
  const count = (a: Answer) => items.filter(i => answers[i.itemCode] === a).length;
  const title = exec.template?.name ?? exec.executionCode;

  const finish = async () => {
    setBusy(true);
    try {
      // Las notas pendientes de guardar salen antes de cerrar.
      for (const code of Object.keys(noteTimers.current)) clearTimeout(noteTimers.current[code]);
      for (const i of items) {
        if (answers[i.itemCode] === "NOT_CONFORMING") await saveResponse(i.itemCode, "NOT_CONFORMING", notes[i.itemCode] ?? "");
      }
      await api.patch(`/app/checklist-executions/${exec.id}`, { status: "COMPLETED", signedByName: user?.name ?? null });
      setDone(true);
    } catch (e) {
      setAlert(errorText(e, t("ob.sendFailed")));
    } finally {
      setBusy(false);
      setSign(false);
    }
  };

  if (done) {
    return (
      <DoneScreen
        icon={<ClipboardCheck className="w-10 h-10" />}
        title={t("ob.check.signed")}
        code={exec.executionCode}
        lines={[
          { icon: <CircleCheck className="w-[17px] h-[17px]" />, text: t("ob.check.summary").replace("{n}", String(items.length)).replace("{no}", String(noCount)) },
          { icon: <Monitor className="w-[17px] h-[17px]" />, text: t("ob.check.pdfOnPc") },
        ]}
        onHome={onExit}
      />
    );
  }

  const btn = (code: string, a: Answer, label: string, on: string, icon?: React.ReactNode) => (
    <button type="button" onClick={() => answer(code, a)} aria-pressed={answers[code] === a}
      className={`min-h-12 rounded-xl border-[1.5px] font-extrabold text-sm inline-flex items-center justify-center gap-1.5 ${answers[code] === a ? on : "bg-surface border-fg/10 text-fg"}`}>
      {icon}{label}
    </button>
  );

  return (
    <Screen
      head={<Head title={title} sub={selectedVessel?.name} onBack={onBack} />}
      foot={<>
        <MainButton missing={missing} label={t("ob.check.signFinish")} icon={<PenLine className="w-[18px] h-[18px]" />}
          onClick={() => setSign(true)} onMissing={() => { setTried(true); scrollToMissing(); }} />
        {missing > 0 && <p className="text-center text-[12.5px] text-text-industrial/60">{t("ob.check.autosave")}</p>}
      </>}
    >
      <div className="flex flex-col gap-1.5">
        <div className="h-2 rounded-full bg-fg/10 overflow-hidden"><div className="h-full bg-accent rounded-full transition-[width]" style={{ width: `${items.length ? (answered / items.length) * 100 : 0}%` }} /></div>
        <p className="flex justify-between text-[13px] text-text-industrial/60">
          <span>{t("ob.check.progress").replace("{n}", String(answered)).replace("{total}", String(items.length))}</span>
          <span>{t("ob.check.noCount").replace("{n}", String(noCount))}</span>
        </p>
      </div>
      {items.map(i => {
        const a = answers[i.itemCode];
        const miss = tried && (!a || (a === "NOT_CONFORMING" && !(notes[i.itemCode] ?? "").trim()));
        return (
          <div key={i.itemCode} data-missing={miss ? "1" : undefined}
            className={`rounded-2xl border p-3.5 flex flex-col gap-2.5 ${miss ? "bg-warning/10 border-warning" : "bg-surface border-fg/10"}`}>
            <p className="text-[15px] font-semibold leading-snug">{i.itemText}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {btn(i.itemCode, "CONFORMING", t("ob.yes"), "bg-success border-success text-white", <Check className="w-4 h-4" />)}
              {btn(i.itemCode, "NOT_CONFORMING", t("ob.no"), "bg-danger border-danger text-white", <X className="w-4 h-4" />)}
              {btn(i.itemCode, "NOT_APPLICABLE", t("ob.check.na"), "bg-text-industrial/60 border-transparent text-bg")}
            </div>
            {a === "NOT_CONFORMING" && (
              <textarea id={`ob-ck-${i.itemCode}`} value={notes[i.itemCode] ?? ""} onChange={e => changeNote(i.itemCode, e.target.value)}
                placeholder={t("ob.check.whatHappens")}
                className="w-full min-h-[70px] rounded-xl border-[1.5px] border-fg/10 bg-surface text-fg text-base p-3 resize-none focus:outline-none focus:border-accent" />
            )}
          </div>
        );
      })}

      {sign && (
        <Sheet title={t("ob.check.signTitle").replace("{name}", title)} onClose={() => setSign(false)}>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-success/15 text-success">{t("ob.check.okN").replace("{n}", String(count("CONFORMING")))}</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-danger/15 text-danger">{t("ob.check.noN").replace("{n}", String(count("NOT_CONFORMING")))}</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-fg/5 text-text-industrial/60">{t("ob.check.naN").replace("{n}", String(count("NOT_APPLICABLE")))}</span>
          </div>
          <div className="flex gap-2.5 items-start rounded-2xl p-3 bg-accent/10 text-[13.5px]">
            <PenLine className="w-[17px] h-[17px] shrink-0 text-accent mt-px" />
            <span>{t("ob.check.signNote").replace("{name}", user?.name ?? "")}</span>
          </div>
          <div className="grid grid-cols-[1fr_1.4fr] gap-2">
            <button type="button" onClick={() => setSign(false)} className="min-h-12 rounded-2xl border-[1.5px] border-fg/10 font-bold">{t("ob.check.review")}</button>
            <MainButton busy={busy} label={t("ob.check.sign")} onClick={() => void finish()} />
          </div>
        </Sheet>
      )}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </Screen>
  );
}
