// Piezas del asesor técnico que se abren DENTRO del tema, sin ventanas aparte
// (Preview V2, 19/09/2026): la evidencia, el correo listo para mandar y el
// seguimiento en un clic.

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Copy, Mail, Sparkles, Pin } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useT, type TranslationKey } from "../../lib/i18n";
import { AlertDialog } from "../AlertDialog";
import { RequiredMark } from "../GuideKit";
import { EVIDENCE_ICON, type AdvisorMessage, type EvidenceItem, type FindingPriority } from "./advisor-types";

const labelCls = "block text-[11.5px] font-bold text-text-industrial/80 mb-1 mt-2";
const inputCls = "w-full bg-surface border border-fg/15 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-violet-500";
const btnCls = "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-fg/15 bg-surface text-[13px] font-bold text-fg hover:bg-fg/5 disabled:opacity-40";
const btnDark = "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-fg text-surface text-[13px] font-bold hover:opacity-90 disabled:opacity-40";

// ─── Evidencia (registros reales, con link) ──────────────────────────────────

export const EvidenceList: React.FC<{ items: EvidenceItem[] }> = ({ items }) => {
  const t = useT();
  const navigate = useNavigate();
  if (items.length === 0) return <p className="text-xs text-text-industrial/60">{t("advisor.evidence.none")}</p>;
  return (
    <div className="space-y-1.5">
      {items.map(e => (
        <div key={e.id} className="flex items-start gap-2 bg-surface border border-fg/10 rounded-xl px-2.5 py-2">
          <span className="text-sm leading-none mt-0.5" aria-hidden>{EVIDENCE_ICON[e.kind] ?? "•"}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-fg leading-snug">{[e.assetName, e.title].filter(Boolean).join(" — ")}</p>
            <p className="text-[11.5px] text-text-industrial/70 leading-snug">{[e.detail, e.code].filter(Boolean).join(" · ")}</p>
          </div>
          {e.link && (
            <button className="text-[12px] font-bold text-blue-700 dark:text-blue-400 hover:underline shrink-0" onClick={() => navigate(e.link!)}>
              {t("advisor.open")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

// ─── Contestarle al asesor (Preview V3) ──────────────────────────────────────

const TALK_TEXT: Record<"WHAT" | "DO", { label: TranslationKey; ph: TranslationKey }> = {
  WHAT: { label: "advisor.talk.whatLabel", ph: "advisor.talk.whatPh" },
  DO: { label: "advisor.talk.doLabel", ph: "advisor.talk.doPh" },
};

/**
 * Campo para que el Director le conteste al asesor en "Qué pasa" o en "Qué
 * hacer". La charla queda guardada en el tema; si el asesor propone otro plan,
 * el Director decide si lo usa.
 */
export const TalkBox: React.FC<{
  reportId: string;
  findingKey: string;
  step: "WHAT" | "DO";
  messages: AdvisorMessage[];
  appliedId: string | null;
  onChanged: (items: AdvisorMessage[]) => void;
}> = ({ reportId, findingKey, step, messages, appliedId, onChanged }) => {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const base = `/app/maintenance-advisor/reports/${encodeURIComponent(reportId)}/messages`;

  const send = async () => {
    const text = draft.trim();
    if (!text) { setAlert(t("advisor.talk.textRequired")); return; }
    setSending(true);
    try {
      const r = await api.post<{ items: AdvisorMessage[] }>(base, { findingKey, step, text });
      setDraft("");
      setShowOlder(false);
      setShowAll(false);
      onChanged(r.items);
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("advisor.error.generic"));
    } finally {
      setSending(false);
    }
  };

  const apply = async (id: string) => {
    setApplying(id);
    try {
      const m = await api.post<AdvisorMessage>(`${base}/${encodeURIComponent(id)}/apply`);
      setShowAll(false);
      onChanged([m]);
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("advisor.error.generic"));
    } finally {
      setApplying(null);
    }
  };

  // Sólo el último intercambio queda a la vista (Preview V4): lo anterior se
  // pliega en "Ver conversación (N)". Si ese intercambio terminó con la
  // propuesta adoptada, todo se reduce a una línea: el plan ya está arriba.
  const exchanges: AdvisorMessage[][] = [];
  for (const m of messages) {
    if (m.role === "DIRECTOR" || exchanges.length === 0) exchanges.push([m]);
    else exchanges[exchanges.length - 1]!.push(m);
  }
  const last = exchanges[exchanges.length - 1] ?? [];
  const older = exchanges.slice(0, -1).flat();
  const folded = !!appliedId && last.some(m => m.id === appliedId);
  const adjustedHere = !!appliedId && messages.some(m => m.id === appliedId);

  const renderMsg = (m: AdvisorMessage) => m.role === "DIRECTOR" ? (
    <div key={m.id} className="ml-5 mb-2 rounded-xl bg-fg/5 px-3 py-2 text-[12.5px] leading-relaxed text-fg">
      <span className="block text-[10.5px] font-extrabold uppercase tracking-wide text-text-industrial/60">{m.createdByName ?? t("advisor.talk.you")}</span>
      {m.text}
    </div>
  ) : (
    <div key={m.id} className="mr-3 mb-2 rounded-xl border border-violet-200 dark:border-violet-500/40 bg-violet-500/5 px-3 py-2 text-[12.5px] leading-relaxed text-fg">
      <span className="block text-[10.5px] font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">{t("advisor.talk.advisor")}</span>
      {m.text}
      {m.proposal && (
        <div className="mt-2 rounded-lg border border-violet-200 dark:border-violet-500/40 bg-surface px-2.5 py-2">
          <p className="text-[12px] font-extrabold text-fg mb-1">{t("advisor.talk.proposal")}</p>
          <p className="text-[12.5px] text-fg mb-1">{m.proposal.action}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            <dt className="text-text-industrial/70 font-bold">{t("advisor.kv.who")}</dt><dd className="font-bold text-fg">{m.proposal.who}</dd>
            <dt className="text-text-industrial/70 font-bold">{t("advisor.kv.when")}</dt><dd className="font-bold text-fg">{m.proposal.when}</dd>
            <dt className="text-text-industrial/70 font-bold">{t("advisor.kv.closeWith")}</dt><dd className="font-bold text-fg">{m.proposal.verify}</dd>
          </dl>
        </div>
      )}
      {m.warning && <p className="mt-1.5 text-[12px] text-orange-800 dark:text-orange-300"><b>{t("advisor.talk.warning")}</b> {m.warning}</p>}
      {m.proposal && (
        <div className="mt-2">
          {appliedId === m.id ? (
            <span className="inline-flex items-center rounded-full bg-violet-600 text-white px-3 py-1 text-[12px] font-extrabold">✔ {t("advisor.talk.applied")}</span>
          ) : (
            <button className="inline-flex items-center gap-1 rounded-full bg-violet-600 text-white px-3 py-1 text-[12px] font-extrabold hover:bg-violet-700 disabled:opacity-50"
              disabled={applying === m.id} onClick={() => { void apply(m.id); }}>
              {applying === m.id && <Loader2 className="w-3 h-3 animate-spin" />}✔ {t("advisor.talk.use")}
            </button>
          )}
        </div>
      )}
    </div>
  );

  const linkCls = "mb-1.5 text-[12px] font-extrabold text-violet-700 dark:text-violet-300 hover:underline";

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-fg/15">
      {folded ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 dark:border-violet-500/40 bg-violet-500/5 px-3 py-2 text-[12px] font-extrabold text-violet-700 dark:text-violet-300">
            ✏️ {t("advisor.talk.adjusted")}
            <button className="underline" onClick={() => setShowAll(v => !v)}>
              {t(showAll ? "advisor.talk.hideConversation" : "advisor.talk.seeConversation")}
            </button>
          </div>
          {showAll && messages.map(renderMsg)}
        </>
      ) : (
        <>
          {older.length > 0 && (
            <button className={linkCls} onClick={() => setShowOlder(v => !v)}>
              💬 {showOlder ? t("advisor.talk.hideOlder") : t("advisor.talk.seeOlder").replace("{n}", String(older.length))}
            </button>
          )}
          {showOlder && older.map(renderMsg)}
          {last.map(renderMsg)}
        </>
      )}
      <label className="block text-[12px] font-extrabold text-violet-700 dark:text-violet-300 mb-1.5">
        💬 {t(adjustedHere ? "advisor.talk.moreLabel" : TALK_TEXT[step].label)}
      </label>
      <div className="flex gap-1.5 items-end">
        <textarea
          className="flex-1 min-h-[54px] rounded-xl border-[1.5px] border-violet-200 dark:border-violet-500/40 bg-surface px-2.5 py-2 text-[12.5px] text-fg focus:outline-none focus:border-violet-500 resize-y"
          placeholder={t(TALK_TEXT[step].ph)}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send(); }}
        />
        <button className="rounded-xl bg-violet-600 text-white px-3 py-2 text-[12.5px] font-extrabold hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1"
          disabled={sending} onClick={() => { void send(); }}>
          {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t("advisor.talk.send")}
        </button>
      </div>
      {sending && <p className="mt-1.5 text-[12px] font-bold text-violet-700 dark:text-violet-300">{t("advisor.talk.thinking")}</p>}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};

// ─── Correo listo para mandar ────────────────────────────────────────────────

const RECIPIENT_KEYS: TranslationKey[] = [
  "advisor.recipient.chiefEngineer", "advisor.recipient.master", "advisor.recipient.superintendent",
  "advisor.recipient.procurement", "advisor.recipient.warehouse", "advisor.recipient.safety",
  "advisor.recipient.supplier", "advisor.recipient.contractor", "advisor.recipient.classSociety",
  "advisor.recipient.management",
];

export const DraftPanel: React.FC<{
  reportId: string;
  findingKey: string;
  defaultRecipient: string;
  kind: "REQUEST_INFO" | "FOLLOW_UP";
}> = ({ reportId, findingKey, defaultRecipient, kind }) => {
  const t = useT();
  const recipients = useMemo(() => {
    const list = RECIPIENT_KEYS.map(k => t(k));
    return defaultRecipient ? [defaultRecipient, ...list.filter(r => r !== defaultRecipient)] : list;
  }, [t, defaultRecipient]);
  const [recipient, setRecipient] = useState(defaultRecipient || recipients[0] || "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const draft = async (to: string) => {
    if (!to.trim()) { setAlert(t("advisor.draft.recipientRequired")); return; }
    setLoading(true);
    try {
      const r = await api.post<{ subject: string; body: string }>(
        `/app/maintenance-advisor/reports/${encodeURIComponent(reportId)}/draft`, { findingKey, recipient: to, kind });
      setSubject(r.subject); setBody(r.body);
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("advisor.error.generic"));
    } finally {
      setLoading(false);
    }
  };
  // Se redacta apenas se abre: es lo que se pidió al tocar el botón.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void draft(recipient); }, []);

  const copy = async () => {
    const text = `${subject}\n\n${body}`;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-2 rounded-xl border-[1.5px] border-violet-300 dark:border-violet-500/50 bg-surface p-3">
      <label className={labelCls}>{t("advisor.draft.to")}</label>
      <div className="flex gap-2">
        <input className={inputCls} list={`adv-to-${findingKey}`} value={recipient} onChange={e => setRecipient(e.target.value)} />
        <datalist id={`adv-to-${findingKey}`}>{recipients.map(r => <option key={r} value={r} />)}</datalist>
        <button className={btnCls} disabled={loading} onClick={() => { void draft(recipient); }} title={t("advisor.draft.redo")}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        </button>
      </div>
      {loading && !body ? (
        <p className="flex items-center gap-2 text-sm text-text-industrial/70 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> {t("advisor.draft.writing")}</p>
      ) : (
        <>
          <label className={labelCls}>{t("advisor.draft.subject")}</label>
          <input className={inputCls} value={subject} onChange={e => setSubject(e.target.value)} />
          <label className={labelCls}>{t("advisor.draft.body")} <span className="font-normal text-text-industrial/60">· {t("advisor.draft.editable")}</span></label>
          <textarea className={`${inputCls} min-h-[180px] leading-relaxed`} value={body} onChange={e => setBody(e.target.value)} />
        </>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
        {copied && <span className="text-[12px] font-bold text-emerald-700 dark:text-emerald-400 mr-auto">✔ {t("advisor.draft.copied")}</span>}
        <button className={btnCls} disabled={!body || loading} onClick={() => { void copy(); }}><Copy className="w-3.5 h-3.5" /> {t("advisor.draft.copy")}</button>
        <a className={`${btnDark} ${!body || loading ? "pointer-events-none opacity-40" : ""}`}
          href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
          <Mail className="w-3.5 h-3.5" /> {t("advisor.draft.openMail")}
        </a>
      </div>
      <p className="text-[11px] text-text-industrial/60 mt-1.5">{t("advisor.draft.hint")}</p>
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};

// ─── Seguimiento en un clic ──────────────────────────────────────────────────

const WHEN_OPTIONS: Array<{ days: number; label: TranslationKey }> = [
  { days: 3, label: "advisor.follow.in3" },
  { days: 7, label: "advisor.follow.in7" },
  { days: 30, label: "advisor.follow.in30" },
];

export const FollowPanel: React.FC<{
  reportId: string;
  findingKey: string;
  title: string;
  priority: FindingPriority;
  vesselCode: string | null;
  defaultWho: string;
  targetDays: number | null;
  verify: string;
  evidenceIds: string[];
  onDone: () => void;
}> = ({ reportId, findingKey, title, priority, vesselCode, defaultWho, targetDays, verify, evidenceIds, onDone }) => {
  const t = useT();
  // Por defecto, la opción más cercana al plazo que propuso el asesor.
  const initialDays = WHEN_OPTIONS.reduce((best, o) =>
    Math.abs(o.days - (targetDays ?? 7)) < Math.abs(best - (targetDays ?? 7)) ? o.days : best, 7);
  const [who, setWho] = useState(defaultWho);
  const [days, setDays] = useState(initialDays);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const save = async () => {
    if (!who.trim()) { setAlert(t("advisor.follow.whoRequired")); return; }
    setSaving(true);
    try {
      await api.post("/app/maintenance-advisor/actions", {
        reportId, findingKey, title, priority, vesselCode, evidenceIds,
        responsibleName: who.trim(),
        targetDate: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10),
        verificationCriteria: verify || null,
      });
      onDone();
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("advisor.error.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl border-[1.5px] border-violet-300 dark:border-violet-500/50 bg-surface p-3">
      <label className={labelCls}>{t("advisor.follow.who")}<RequiredMark /></label>
      <input className={inputCls} value={who} onChange={e => setWho(e.target.value)} />
      <label className={labelCls}>{t("advisor.follow.when")}<RequiredMark /></label>
      <div className="flex flex-wrap gap-1.5">
        {WHEN_OPTIONS.map(o => (
          <button key={o.days} onClick={() => setDays(o.days)}
            className={`px-3 py-1.5 rounded-full border-[1.5px] text-[12.5px] font-bold ${days === o.days ? "bg-fg text-surface border-fg" : "bg-surface text-fg border-fg/15 hover:bg-fg/5"}`}>
            {t(o.label)}
          </button>
        ))}
      </div>
      <div className="flex justify-end mt-3">
        <button className={btnDark} disabled={saving} onClick={() => { void save(); }}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pin className="w-3.5 h-3.5" />} {t("advisor.follow.save")}
        </button>
      </div>
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};
