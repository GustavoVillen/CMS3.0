// Crew Training Matrix — qué entrenamientos completó cada tripulante.
// Grilla crew (filas) × training items (columnas).
// Reemplaza el sistema viejo de CrewCapability con TrainingItem + CrewTrainingRecord.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Grid3x3, Loader2, X, AlertCircle, FileText } from "lucide-react";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT } from "../lib/i18n";

// Niveles de requirement según matriz CEOP:
//   OBRIGATORIO — el rango debe tener este entrenamiento sí o sí
//   VALIDO     — el rango puede operar con este entrenamiento
//   DESEJAVEL  — recomendable pero no exigido
const REQ_LEVEL_LABEL: Record<string, string> = {
  OBRIGATORIO: "Obligatorio",
  VALIDO: "Válido",
  DESEJAVEL: "Deseable",
};

interface CrewMember {
  id: string;
  firstName: string;
  lastName: string;
  vesselCode: string;
  rankId: string | null;
  rankCode: string | null;
  rankName: string | null;
}

interface TrainingItem {
  id: string;
  code: string;
  name: string;
  regulation: string | null;
  category: string | null;
  validityYears: number | null;
  sortOrder: number;
}

interface TrainingRecord {
  id: string;
  crewId: string;
  trainingItemId: string;
  completedAt: string;
  expiryDate: string | null;
  docUrl: string | null;
  notes: string | null;
}

interface RankRequirement {
  rankDefinitionId: string;
  trainingItemId: string;
  level: string; // OBRIGATORIO | VALIDO | DESEJAVEL
}

interface MatrixData {
  crew: CrewMember[];
  trainingItems: TrainingItem[];
  records: TrainingRecord[];
  categories: string[];
  requirements: RankRequirement[];
}

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

// ─── Cell editor ─────────────────────────────────────────────────────────────

interface CellEditorProps {
  crew: CrewMember;
  item: TrainingItem;
  existing: TrainingRecord | null;
  requirementLevel: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const CellEditor: React.FC<CellEditorProps> = ({ crew, item, existing, requirementLevel, onClose, onSaved }) => {
  const t = useT();
  const [completedAt, setCompletedAt] = useState(existing?.completedAt?.slice(0, 10) ?? "");
  const [expiryDate, setExpiryDate]   = useState(existing?.expiryDate?.slice(0, 10) ?? "");
  const [docUrl, setDocUrl]           = useState(existing?.docUrl ?? "");
  const [notes, setNotes]             = useState(existing?.notes ?? "");
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  // Auto-completar expiry si el item tiene validityYears y no hay expiry seteada
  useEffect(() => {
    if (!expiryDate && completedAt && item.validityYears) {
      const d = new Date(completedAt);
      d.setFullYear(d.getFullYear() + item.validityYears);
      setExpiryDate(d.toISOString().slice(0, 10));
    }
  }, [completedAt, item.validityYears]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = async () => {
    if (!completedAt) { setErr("Fecha de realización requerida."); return; }
    setSaving(true); setErr(null);
    try {
      const payload: Record<string, unknown> = {
        trainingItemId: item.id,
        completedAt,
        expiryDate: expiryDate || null,
        docUrl: docUrl.trim() || null,
        notes: notes.trim() || null,
      };
      if (existing) {
        await api.patch(`/app/crew/${crew.id}/training-records/${existing.id}`, payload);
      } else {
        await api.post(`/app/crew/${crew.id}/training-records`, payload);
      }
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };

  const onRemove = async () => {
    if (!existing) return;
    if (!window.confirm(t("confirm.removeMatrixRecord").replace("{item}", item.name).replace("{name}", `${crew.firstName} ${crew.lastName}`))) return;
    try {
      await api.delete(`/app/crew/${crew.id}/training-records/${existing.id}`);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  const isMandatory = requirementLevel === "OBRIGATORIO";

  // ESC: cerrar / preguntar guardar si hay cambios
  const isDirty = useDirtyTracker({ completedAt, expiryDate, docUrl, notes });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">
              {item.code}{item.regulation ? ` · ${item.regulation}` : ""}
            </p>
            <h2 className="text-sm font-bold text-fg">{item.name}</h2>
            <p className="text-[11px] text-text-industrial/60 mt-0.5">
              {crew.firstName} {crew.lastName}
              <span className="text-text-industrial/40"> — {crew.rankName ?? "—"}</span>
            </p>
            {requirementLevel && (
              <span className={`inline-block mt-1.5 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                isMandatory
                  ? "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/40"
                  : requirementLevel === "VALIDO"
                  ? "bg-success-sea/15 text-success-sea border border-success-sea/40"
                  : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border border-yellow-500/40"
              }`}>
                {REQ_LEVEL_LABEL[requirementLevel] ?? requirementLevel}
              </span>
            )}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-fg" /></button>
        </div>
        <div className="p-6 space-y-3">
          <div>
            <label className={labelCls}>{t("cm.cellDate")}</label>
            <input type="date" value={completedAt} onChange={e => setCompletedAt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>
              Vencimiento {item.validityYears ? <span className="text-text-industrial/40 normal-case">(auto: {item.validityYears} años)</span> : null}
            </label>
            <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("cm.docUrl")}</label>
            <input type="url" value={docUrl} onChange={e => setDocUrl(e.target.value)} className={inputCls} placeholder="https://…" />
          </div>
          <div>
            <label className={labelCls}>{t("common.notesObs")}</label>
            <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls + " resize-y"} placeholder={t("cm.notesPh")} />
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
        </div>
        <div className="flex justify-between gap-2 px-6 py-4 border-t border-fg/10">
          <div>
            {existing && (
              <button onClick={() => { void onRemove(); }} className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-xs">{t("common.remove")}</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial">{t("common.close")}</button>
            <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const CrewMatrixPage: React.FC = () => {
  const { vessels = [], selectedVesselCode } = useVesselContext();
  const t = useT();
  const [vesselCode, setVesselCode] = useState(selectedVesselCode ?? "");
  const [category, setCategory]     = useState<string>("");
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ crew: CrewMember; item: TrainingItem; existing: TrainingRecord | null; requirementLevel: string | null } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (vesselCode) params.set("vesselCode", vesselCode);
      if (category)   params.set("category", category);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const r = await api.get<MatrixData>(`/app/crew-training-matrix${qs}`);
      setData(r);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [vesselCode, category]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (selectedVesselCode && selectedVesselCode !== vesselCode) setVesselCode(selectedVesselCode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVesselCode]);

  // Index records y requirements para lookup O(1) por crewId|itemId
  const recordByCrewItem = useMemo(() => {
    const m = new Map<string, TrainingRecord>();
    for (const r of data?.records ?? []) m.set(`${r.crewId}|${r.trainingItemId}`, r);
    return m;
  }, [data?.records]);

  const reqByRankItem = useMemo(() => {
    const m = new Map<string, string>(); // rankId|itemId → level
    for (const r of data?.requirements ?? []) m.set(`${r.rankDefinitionId}|${r.trainingItemId}`, r.level);
    return m;
  }, [data?.requirements]);

  const now = new Date();
  const soonThreshold = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 días

  function openCell(crew: CrewMember, item: TrainingItem) {
    const existing = recordByCrewItem.get(`${crew.id}|${item.id}`) ?? null;
    const requirementLevel = crew.rankId ? (reqByRankItem.get(`${crew.rankId}|${item.id}`) ?? null) : null;
    setEditing({ crew, item, existing, requirementLevel });
  }

  // Total de registros (para el contador del header)
  const totalRecords = data?.records.length ?? 0;

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={Grid3x3} title={t("nav.crewMatrix")} total={totalRecords} onReload={reload}>
        <ExportExcelButton module="crew_certifications" />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg">
          <option value="">{t("common.allVessels")}</option>
          {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg">
          <option value="">{t("common.allCategories")}</option>
          {(data?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-3 text-[10px] text-text-industrial/60">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-sea/40 border border-success-sea/60" /> Válido</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-500/40 border border-yellow-500/60" /> Por vencer</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/40 border border-red-500/60" /> Vencido / Faltante OBL.</span>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : !data || data.crew.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/40 text-sm">{t("common.noCrewOnboard")}</div>
      ) : data.trainingItems.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/40 text-sm">
          Sin items de entrenamiento configurados.
          {category && <span className="block mt-1">{t("common.tryRemoveFilter")}</span>}
        </div>
      ) : (
        <div className="overflow-x-auto bg-fg/[0.03] border border-fg/10 rounded-xl">
          <table className="text-[10px] min-w-full">
            <thead>
              <tr className="border-b border-fg/10">
                <th className="sticky left-0 z-10 bg-surface dark:bg-[#0D1B2A] text-left px-3 py-2 font-bold uppercase tracking-widest text-text-industrial/60 min-w-[220px]">{t("common.crewMember")}</th>
                {data.trainingItems.map(it => (
                  <th key={it.id} className="px-2 py-2 text-center font-bold uppercase tracking-wider text-text-industrial/50 min-w-[80px] whitespace-nowrap">
                    <span title={`${it.name}${it.regulation ? " — " + it.regulation : ""}`}>{it.code}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.crew.map(c => (
                <tr key={c.id} className="border-b border-fg/5 last:border-b-0">
                  <td className="sticky left-0 z-10 bg-surface dark:bg-[#0D1B2A] px-3 py-2">
                    <div className="text-xs font-bold text-fg">{c.firstName} {c.lastName}</div>
                    <div className="text-[9px] text-text-industrial/40 uppercase tracking-wider">{c.rankName ?? "—"} · {c.vesselCode}</div>
                  </td>
                  {data.trainingItems.map(it => {
                    const rec = recordByCrewItem.get(`${c.id}|${it.id}`);
                    const reqLevel = c.rankId ? reqByRankItem.get(`${c.rankId}|${it.id}`) : null;
                    const isMandatory = reqLevel === "OBRIGATORIO";

                    let cls = "bg-fg/[0.02] text-text-industrial/30 border-fg/5 hover:bg-fg/10";
                    let symbol: React.ReactNode = "·";

                    if (rec) {
                      const expiry = rec.expiryDate ? new Date(rec.expiryDate) : null;
                      const expired = !!expiry && expiry < now;
                      const soon    = !!expiry && !expired && expiry < soonThreshold;
                      if (expired) {
                        cls = "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40 hover:bg-red-500/25";
                        symbol = <><AlertCircle className="w-2.5 h-2.5 inline" /> EXP</>;
                      } else if (soon) {
                        cls = "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/40 hover:bg-yellow-500/25";
                        symbol = "⚠";
                      } else {
                        cls = "bg-success-sea/15 text-success-sea border-success-sea/40 hover:bg-success-sea/25";
                        symbol = rec.docUrl ? <FileText className="w-2.5 h-2.5 inline" /> : "✓";
                      }
                    } else if (isMandatory) {
                      // No tiene el entrenamiento y es obligatorio: rojo apagado
                      cls = "bg-red-500/5 text-red-700 dark:text-red-400/60 border-red-500/20 hover:bg-red-500/15";
                      symbol = "!";
                    } else if (reqLevel === "DESEJAVEL") {
                      cls = "bg-fg/[0.02] text-yellow-500/40 border-yellow-500/10 hover:bg-yellow-500/5";
                      symbol = "·";
                    }

                    const titleParts: string[] = [];
                    titleParts.push(it.name);
                    if (reqLevel) titleParts.push(`Requerimiento: ${REQ_LEVEL_LABEL[reqLevel] ?? reqLevel}`);
                    if (rec) {
                      titleParts.push(`Realizado: ${rec.completedAt.slice(0, 10)}`);
                      if (rec.expiryDate) titleParts.push(`Vence: ${rec.expiryDate.slice(0, 10)}`);
                      if (rec.notes) titleParts.push(rec.notes);
                    } else if (isMandatory) {
                      titleParts.push("FALTA — entrenamiento obligatorio para este rango");
                    } else {
                      titleParts.push("Sin registro — click para agregar");
                    }

                    return (
                      <td key={it.id} className="px-1 py-1 text-center">
                        <button
                          onClick={() => openCell(c, it)}
                          title={titleParts.join(" · ")}
                          className={`w-full h-7 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 ${cls}`}
                        >
                          {symbol}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CellEditor
          crew={editing.crew}
          item={editing.item}
          existing={editing.existing}
          requirementLevel={editing.requirementLevel}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
};
