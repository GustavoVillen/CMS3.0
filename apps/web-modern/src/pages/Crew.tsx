import React, { useState, useMemo, useCallback } from "react";
import { Users, Plus, X, Loader2, AlertTriangle, CheckCircle, LogOut, FileText } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { VesselLabel } from "../components/EntityLabels";
import { useMocTrigger, MocTriggerHost, type MocTriggerEvent } from "../lib/use-moc-trigger";
import { useT, type TranslationKey } from "../lib/i18n";

// Roles clave de tripulación: cambios en estos dispara popup MOC ORGANIZATIONAL.
// Basado en SOLAS/ISM: el capitán, jefe de máquinas y primer oficial son los
// puestos de mayor responsabilidad operativa y de seguridad.
const KEY_RANK_CODES = ["CAPTAIN", "CHIEF_ENGINEER", "CHIEF_OFFICER"];

interface Rank {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

interface Certification {
  id: string;
  type: string;
  certificateNumber: string | null;
  issuingAuthority: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  docUrl: string | null;
  status: "VALID" | "EXPIRING_SOON" | "EXPIRED";
  notes: string | null;
}

interface Crew {
  id: string;
  tenantId: string;
  vesselCode: string;
  crewCode: string;
  firstName: string;
  lastName: string;
  rankId: string | null;
  rankDefinition?: Rank | null;
  nationality: string | null;
  dateOfBirth: string | null;
  passportNumber: string | null;
  signOnDate: string;
  signOffDate: string | null;
  status: "ONBOARD" | "SIGNED_OFF";
  notes: string | null;
  certifications: Certification[];
}

const RANK_TKEY: Record<string, string> = {
  CAPTAIN: "crew.rank.captain",
  CHIEF_OFFICER: "crew.rank.chief_officer",
  SECOND_OFFICER: "crew.rank.second_officer",
  THIRD_OFFICER: "crew.rank.third_officer",
  CHIEF_ENGINEER: "crew.rank.chief_engineer",
  SECOND_ENGINEER: "crew.rank.second_engineer",
  THIRD_ENGINEER: "crew.rank.third_engineer",
  FOURTH_ENGINEER: "crew.rank.fourth_engineer",
  ELECTRICIAN: "crew.rank.electrician",
  BOSUN: "crew.rank.bosun",
  AB_SEAMAN: "crew.rank.ab_seaman",
  OS_SEAMAN: "crew.rank.os_seaman",
  OILER: "crew.rank.oiler",
  WIPER: "crew.rank.wiper",
  COOK: "crew.rank.cook",
  STEWARD: "crew.rank.steward",
  CADET: "crew.rank.cadet",
  RADIO_OPERATOR: "crew.rank.radio_operator",
  PILOT: "crew.rank.pilot",
  PILOTIN: "crew.rank.pilotin",
  OTHER: "crew.rank.other",
};

// Solo documentos personales. Los cursos/entrenamientos regulatorios se
// gestionan en la Matriz de Entrenamientos.
const PERSONAL_DOC_TYPES = ["PASSPORT", "SEAMANS_BOOK", "VISA", "MEDICAL", "YELLOW_FEVER", "OTHER"] as const;
const CERT_TYPE_TKEY: Record<string, string> = {
  PASSPORT:     "cert.type.passport",
  SEAMANS_BOOK: "cert.type.seamans_book",
  VISA:         "cert.type.visa",
  MEDICAL:      "cert.type.medical",
  YELLOW_FEVER: "cert.type.yellow_fever",
  OTHER:        "cert.type.other",
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

function CertStatusBadge({ status }: { status: string }) {
  const t = useT();
  if (status === "EXPIRED") return <span className="inline-block text-[9px] px-2 py-0.5 rounded-full border font-bold bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">{t("cert.status.expired")}</span>;
  if (status === "EXPIRING_SOON") return <span className="inline-block text-[9px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">{t("cert.status.expiring")}</span>;
  return <span className="inline-block text-[9px] px-2 py-0.5 rounded-full border font-bold bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">{t("cert.status.valid")}</span>;
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider mb-1";

// ─── Crew Modal ──────────────────────────────────────────────────────────────

const CrewModal: React.FC<{ crew: Crew | null; onClose: () => void; onSaved: () => void; onMocTrigger?: (e: MocTriggerEvent) => void }> = ({ crew, onClose, onSaved, onMocTrigger }) => {
  const t = useT();
  const { vessels = [] } = useVesselContext();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const isNew = !crew;
  const isLocked = crew?.status === "SIGNED_OFF";

  const { data: ranksData } = useFetch<{ items: Rank[]; total: number }>("/app/crew/ranks", []);
  const ranks = ranksData?.items ?? [];
  const defaultRankId = ranks.length > 0 ? ranks.find(r => r.code === "AB_SEAMAN")?.id || ranks[0]?.id : "";

  const [vesselCode, setVesselCode] = useState(crew?.vesselCode ?? (vessels.length > 0 ? vessels[0]?.code : "") ?? "");
  const [firstName, setFirstName]   = useState(crew?.firstName ?? "");
  const [lastName, setLastName]     = useState(crew?.lastName ?? "");
  const [rankId, setRankId]         = useState(crew?.rankId ?? defaultRankId);
  const [nationality, setNationality] = useState(crew?.nationality ?? "");
  const [passportNumber, setPassportNumber] = useState(crew?.passportNumber ?? "");
  const [signOnDate, setSignOnDate] = useState((crew?.signOnDate ?? "").slice(0, 10));
  const [notes, setNotes]           = useState(crew?.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim() || !vesselCode || !signOnDate || !rankId) {
      setErr(t("crew.validation.required")); return;
    }
    setSaving(true); setErr(null);
    try {
      const payload = {
        vesselCode, firstName: firstName.trim(), lastName: lastName.trim(),
        rankId, nationality: nationality.trim() || null,
        passportNumber: passportNumber.trim() || null,
        signOnDate, notes: notes.trim() || null,
      };
      if (isNew) await api.post("/app/crew", payload);
      else await api.patch(`/app/crew/${crew!.id}`, payload);

      // Detector MOC ORGANIZATIONAL: cambios que afecten a un rol clave de
      // tripulación (Capitán / Jefe Máquinas / Primer Oficial) deben evaluarse
      // como MOC. Disparamos en alta con rol clave, en cambio de rango si
      // alguno de los lados es clave, y en traslado de buque si lo era/lo es.
      if (onMocTrigger) {
        const currentRank = ranks.find(r => r.id === rankId);
        const previousRank = crew?.rankDefinition || (crew?.rankId ? ranks.find(r => r.id === crew.rankId) : null);
        const isKeyNow = currentRank ? KEY_RANK_CODES.includes(currentRank.code) : false;
        const wasKey = previousRank ? KEY_RANK_CODES.includes(previousRank.code) : false;
        const rankChanged = crew ? crew.rankId !== rankId : false;
        const vesselChanged = crew ? crew.vesselCode !== vesselCode : false;

        // Helper to get localized rank name
        const getRankLabel = (rank: typeof currentRank) => {
          if (!rank) return t("crew.rank.other");
          const mapKey = RANK_TKEY[rank.code];
          if (mapKey) return t(mapKey as any);
          const tryKey1 = t(`crew.rank.${rank.code}` as any);
          if (!tryKey1.startsWith('[')) return tryKey1;
          const tryKey2 = t(`crew.rank.${rank.code.toLowerCase()}` as any);
          if (!tryKey2.startsWith('[')) return tryKey2;
          return t("crew.rank.other");
        };

        let reasonText: string | null = null;
        if (isNew && isKeyNow) {
          reasonText = t("crew.mocReason.new").replace("{rank}", getRankLabel(currentRank));
        } else if (!isNew && rankChanged && (wasKey || isKeyNow)) {
          reasonText = t("crew.mocReason.rankChange")
            .replace("{from}", getRankLabel(previousRank))
            .replace("{to}", getRankLabel(currentRank));
        } else if (!isNew && vesselChanged && (wasKey || isKeyNow)) {
          reasonText = t("crew.mocReason.vesselChange")
            .replace("{from}", crew!.vesselCode)
            .replace("{to}", vesselCode);
        }

        if (reasonText) {
          const fullName = `${firstName.trim()} ${lastName.trim()}`;
          const rankLabel = getRankLabel(currentRank);
          const vessel = vessels.find(v => v.code === vesselCode);
          const vesselName = vessel?.name ?? vesselCode;
          onMocTrigger({
            reason: "crewKeyRank",
            prefill: {
              category: "ORGANIZATIONAL",
              vesselCode,
              title: t("crew.mocPrefill.title").replace("{rank}", rankLabel).replace("{vessel}", vesselName),
              reasonForChange: t("crew.mocPrefill.reason").replace("{reason}", reasonText).replace("{name}", fullName),
              proposedChange: t("crew.mocPrefill.proposed").replace("{name}", fullName).replace("{rank}", rankLabel).replace("{vessel}", vesselName),
              sourceLabel: t("crew.mocPrefill.source").replace("{name}", fullName),
            },
          });
        }
      }

      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("crew.error.save"));
    } finally {
      setSaving(false);
    }
  }, [t, isNew, crew, vesselCode, firstName, lastName, rankId, nationality, passportNumber, signOnDate, notes, vessels, ranks, onSaved, onMocTrigger]);

  const onSignOff = useCallback(async () => {
    if (!crew) return;
    if (!confirm(t("crew.signOffConfirm").replace("{name}", `${crew.firstName} ${crew.lastName}`))) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/crew/${crew.id}/sign-off`, { signOffDate: new Date().toISOString().slice(0, 10) });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("crew.error.signOff")); }
    finally { setSaving(false); }
  }, [t, crew, onSaved]);

  const onReopen = useCallback(async () => {
    if (!crew) return;
    const reason = prompt(t("crew.reopenPrompt"));
    if (!reason || reason.trim().length < 5) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/crew/${crew.id}/reopen`, { reason: reason.trim() });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("crew.error.reopen")); }
    finally { setSaving(false); }
  }, [t, crew, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="flex items-center gap-3">
            <Users className="w-4 h-4 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("crew.singular")}</p>
              <h2 className="text-sm font-bold text-fg">{isNew ? t("crew.new") : `${crew!.crewCode} — ${crew!.firstName} ${crew!.lastName}`}</h2>
            </div>
            {crew?.status === "SIGNED_OFF" && <span className="text-[9px] px-2 py-0.5 rounded-full border font-bold bg-fg/5 text-text-industrial/50 border-fg/10">{t("crew.status.signedOff")}</span>}
            {crew?.status === "ONBOARD" && <span className="text-[9px] px-2 py-0.5 rounded-full border font-bold bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">{t("crew.status.onboard")}</span>}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {(
            <div className="space-y-4">
              {isLocked && (
                <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-orange-700 dark:text-orange-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-orange-200">{t("crew.lockedNotice")}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t("crew.field.vessel")}</label>
                  <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={!isNew || isLocked} className={inputCls}>
                    {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("crew.field.rank")}</label>
                  <select value={rankId} onChange={e => setRankId(e.target.value)} disabled={isLocked} className={inputCls}>
                    <option value="">{t("crew.selectRank")}</option>
                    {ranks.map(r => {
                      // Use RANK_TKEY map first (covers all old system ranks)
                      // Then try dynamic keys for new CEOP system
                      let label = r.name;
                      const mapKey = RANK_TKEY[r.code];
                      if (mapKey) {
                        label = t(mapKey as any);
                      } else {
                        const tryKey1 = t(`crew.rank.${r.code}` as any);
                        const tryKey2 = t(`crew.rank.${r.code.toLowerCase()}` as any);
                        // Only use if translation was found (doesn't start with '[')
                        if (!tryKey1.startsWith('[')) label = tryKey1;
                        else if (!tryKey2.startsWith('[')) label = tryKey2;
                      }
                      return <option key={r.id} value={r.id}>{label}</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("crew.field.firstName")}</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} disabled={isLocked} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("crew.field.lastName")}</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)} disabled={isLocked} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("crew.field.nationality")}</label>
                  <input value={nationality} onChange={e => setNationality(e.target.value)} disabled={isLocked} className={inputCls} placeholder="—" />
                </div>
                <div>
                  <label className={labelCls}>{t("crew.field.passport")}</label>
                  <input value={passportNumber} onChange={e => setPassportNumber(e.target.value)} disabled={isLocked} className={inputCls} placeholder="—" />
                </div>
                <div>
                  <label className={labelCls}>{t("crew.field.signOnDate")}</label>
                  <input type="date" value={signOnDate} onChange={e => setSignOnDate(e.target.value)} disabled={isLocked} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("crew.field.signOffDate")}</label>
                  <input type="date" value={(crew?.signOffDate ?? "").slice(0, 10)} disabled className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>{t("crew.field.notes")}</label>
                  <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} disabled={isLocked} className={inputCls} />
                </div>
              </div>
              {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
            </div>
          )}

        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-fg/10 shrink-0">
          <div className="flex gap-2">
            {!isNew && crew?.status === "ONBOARD" && (
              <button onClick={() => { void onSignOff(); }} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-700 dark:text-orange-400 font-bold text-xs hover:bg-orange-500/20 disabled:opacity-50">
                <LogOut className="w-3.5 h-3.5" /> {t("crew.signOff")}
              </button>
            )}
            {!isNew && crew?.status === "SIGNED_OFF" && isAdmin && (
              <button onClick={() => { void onReopen(); }} disabled={saving}
                className="px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-700 dark:text-orange-300 font-bold text-xs hover:bg-orange-500/20 disabled:opacity-50">
                {t("crew.reopen")}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.close")}</button>
            {!isLocked && (
              <button onClick={() => { void onSave(); }} disabled={saving}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Certifications Tab ──────────────────────────────────────────────────────

const CertificationsTab: React.FC<{ crew: Crew; isLocked: boolean; onChanged: () => void }> = ({ crew, isLocked, onChanged }) => {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Certification | null>(null);
  const [type, setType]               = useState<string>(PERSONAL_DOC_TYPES[0]);
  const [certificateNumber, setCN]    = useState("");
  const [issuingAuthority, setAuth]   = useState("");
  const [issuedDate, setIssued]       = useState("");
  const [expiryDate, setExpiry]       = useState("");
  const [docUrl, setDocUrl]           = useState("");
  const [notes, setNotes]             = useState("");
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  const resetForm = () => {
    setType(PERSONAL_DOC_TYPES[0]); setCN(""); setAuth(""); setIssued(""); setExpiry(""); setDocUrl(""); setNotes("");
    setAdding(false); setEditing(null); setErr(null);
  };

  const openEdit = (c: Certification) => {
    setEditing(c); setAdding(true);
    setType(c.type);
    setCN(c.certificateNumber ?? "");
    setAuth(c.issuingAuthority ?? "");
    setIssued((c.issuedDate ?? "").slice(0, 10));
    setExpiry((c.expiryDate ?? "").slice(0, 10));
    setDocUrl(c.docUrl ?? "");
    setNotes(c.notes ?? "");
  };

  const onSave = useCallback(async () => {
    setSaving(true); setErr(null);
    try {
      const payload = {
        type,
        certificateNumber: certificateNumber.trim() || null,
        issuingAuthority: issuingAuthority.trim() || null,
        issuedDate: issuedDate || null,
        expiryDate: expiryDate || null,
        docUrl: docUrl.trim() || null,
        notes: notes.trim() || null,
      };
      if (editing) await api.patch(`/app/crew/${crew.id}/certifications/${editing.id}`, payload);
      else await api.post(`/app/crew/${crew.id}/certifications`, payload);
      resetForm();
      onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("cert.error.save")); }
    finally { setSaving(false); }
  }, [t, editing, crew.id, type, certificateNumber, issuingAuthority, issuedDate, expiryDate, docUrl, notes, onChanged]);

  const onDelete = useCallback(async (certId: string) => {
    if (!confirm(t("cert.delete.confirm"))) return;
    try { await api.delete(`/app/crew/${crew.id}/certifications/${certId}`); onChanged(); }
    catch (e) { alert(e instanceof ApiError ? e.message : t("cert.error.delete")); }
  }, [t, crew.id, onChanged]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {!adding && !isLocked && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20">
            <Plus className="w-3.5 h-3.5" /> {t("cert.add")}
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-fg/5 border border-fg/10 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>{t("cert.type")}</label>
              <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
                {Object.entries(CERT_TYPE_TKEY).map(([v, tkey]) => <option key={v} value={v}>{t(tkey as any)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("cert.number")}</label>
              <input value={certificateNumber} onChange={e => setCN(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("cert.authority")}</label>
              <input value={issuingAuthority} onChange={e => setAuth(e.target.value)} className={inputCls} placeholder={t("cert.authorityPlaceholder")} />
            </div>
            <div>
              <label className={labelCls}>{t("cert.issued")}</label>
              <input type="date" value={issuedDate} onChange={e => setIssued(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("cert.expires")}</label>
              <input type="date" value={expiryDate} onChange={e => setExpiry(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{t("cert.url")}</label>
              <input value={docUrl} onChange={e => setDocUrl(e.target.value)} className={inputCls} placeholder={t("cert.urlPlaceholder")} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{t("crew.field.notes")}</label>
              <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} />
            </div>
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="px-3 py-1.5 rounded-lg text-xs text-text-industrial hover:text-fg">{t("common.cancel")}</button>
            <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-1.5 rounded-lg bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
            </button>
          </div>
        </div>
      )}

      {crew.certifications.length === 0 && !adding ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">{t("cert.empty")}</div>
      ) : (
        <div className="divide-y divide-fg/5">
          {crew.certifications.map(c => (
            <div key={c.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-sm font-medium text-fg">{t((CERT_TYPE_TKEY[c.type] ?? "cert.type.other") as TranslationKey)}</span>
                  <CertStatusBadge status={c.status} />
                  {c.certificateNumber && <span className="text-[10px] font-mono text-text-industrial/40">#{c.certificateNumber}</span>}
                </div>
                <div className="text-xs text-text-industrial/50 flex flex-wrap gap-3">
                  {c.issuingAuthority && <span>{c.issuingAuthority}</span>}
                  {c.issuedDate && <span>{t("cert.issuedLabel").replace("{date}", fmtDate(c.issuedDate))}</span>}
                  {c.expiryDate && <span>{t("cert.expiresLabel").replace("{date}", fmtDate(c.expiryDate))}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {c.docUrl && <a href={c.docUrl} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-fg/5 text-text-industrial/40 hover:text-accent" title={t("cert.viewDoc")}><FileText className="w-4 h-4" /></a>}
                {!isLocked && <button onClick={() => openEdit(c)} className="text-[10px] text-accent hover:underline">{t("common.edit")}</button>}
                {!isLocked && <button onClick={() => { void onDelete(c.id); }} className="text-[10px] text-red-700 dark:text-red-400 hover:underline ml-2">{t("common.delete")}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const CrewPage: React.FC = () => {
  const t = useT();
  const [status, setStatus] = useState<"ONBOARD" | "SIGNED_OFF" | "">("ONBOARD");
  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    return `/app/crew${p.toString() ? `?${p.toString()}` : ""}`;
  }, [status]);

  const { data, loading, reload } = useFetch<{ items: Crew[]; total: number }>(path, [path]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Crew | null>(null);
  const mocTrigger = useMocTrigger();

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={Users} title={t("crew.title")} total={data?.total} onReload={reload}>
        <ExportExcelButton module="crew" />
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110">
          <Plus className="w-3.5 h-3.5" /> {t("crew.new")}
        </button>
      </PageHeader>

      <div className="flex gap-2">
        {([["ONBOARD", t("crew.filter.onboard")], ["SIGNED_OFF", t("crew.filter.signedOff")], ["", t("crew.filter.all")]] as const).map(([v, l]) => (
          <button key={v || "all"} onClick={() => setStatus(v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
              status === v ? "bg-accent/15 text-accent border-accent/40" : "bg-fg/5 text-text-industrial/60 border-fg/10"
            }`}
          >{l}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : !data?.items?.length ? (
        <div className="text-center py-10 text-text-industrial/30 text-sm">{t("crew.empty")}</div>
      ) : (
        <div className="bg-fg/5 border border-fg/10 rounded-xl divide-y divide-fg/5">
          {data.items.map(c => {
            const expiringCount = c.certifications.filter(x => x.status === "EXPIRING_SOON" || x.status === "EXPIRED").length;
            return (
              <button key={c.id} onClick={() => setEditing(c)}
                className="w-full text-left px-4 py-2 hover:bg-fg/5 active:bg-fg/10 transition-colors flex items-center gap-3">
                <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                  <span className="text-[10px] font-mono text-text-industrial/40 shrink-0">{c.crewCode}</span>
                  {c.status === "ONBOARD"
                    ? <span className="text-[9px] px-2 py-0.5 rounded-full border font-bold bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 shrink-0">{t("crew.status.onboard")}</span>
                    : <span className="text-[9px] px-2 py-0.5 rounded-full border font-bold bg-fg/5 text-text-industrial/50 border-fg/10 shrink-0">{t("crew.status.signedOff")}</span>}
                  <p className="text-sm font-bold text-fg truncate">{c.firstName} {c.lastName}</p>
                  <p className="text-xs text-text-industrial/50 truncate">{c.rankDefinition?.name ?? "—"}</p>
                  <VesselLabel code={c.vesselCode} className="text-[10px]" showCode />
                  {expiringCount > 0 && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full border font-bold bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20 shrink-0">
                      {t("crew.attentionCerts").replace("{n}", String(expiringCount))}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-[10px] text-text-industrial/40 leading-tight">{t("crew.embarked")}</p>
                  <p className="text-xs text-fg font-mono leading-tight">{fmtDate(c.signOnDate)}</p>
                </div>
                {c.status === "ONBOARD" && expiringCount === 0 && <CheckCircle className="w-4 h-4 text-success-sea shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      {(showCreate || editing) && (
        <CrewModal
          crew={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); void reload(); }}
          onMocTrigger={mocTrigger.ask}
        />
      )}

      <MocTriggerHost controller={mocTrigger} />
    </div>
  );
};
