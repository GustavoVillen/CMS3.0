// Crew Capability Matrix — qué tarea crítica puede hacer cada tripulante.
// Grilla crew (filas) × capability area (columnas).

import React, { useCallback, useEffect, useState } from "react";
import { Grid3x3, Loader2, X, AlertCircle } from "lucide-react";
import { useVesselContext } from "../lib/vessel-context";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";

const AREA_LABEL: Record<string, string> = {
  ECDIS: "ECDIS",
  BWMS: "BWMS",
  IG_SYSTEM: "Inert Gas",
  CARGO_HANDLING: "Carga",
  MOORING_MASTER: "Mooring master",
  ENCLOSED_SPACE_ENTRY: "Esp. confinado",
  HOT_WORK: "Hot work",
  RADAR_ARPA: "Radar/ARPA",
  GMDSS: "GMDSS",
  BRIDGE_RESOURCE_MGMT: "BRM",
  ENGINE_ROOM_RESOURCE: "ERM",
  FIRE_FIGHTING: "Incendio avanzado",
  SURVIVAL_CRAFT: "Bote/Balsa",
  MEDICAL_FIRST_AID: "Primeros auxilios",
  HIGH_VOLTAGE: "Alta tensión",
  CRANE_OPERATION: "Grúa",
  OTHER: "Otro",
};

const LEVEL_LABEL: Record<string, string> = {
  TRAINED: "Entrenado",
  CERTIFIED: "Certificado",
  EXPERT: "Experto",
};

const LEVEL_COLOR: Record<string, string> = {
  TRAINED:   "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  CERTIFIED: "bg-success-sea/15 text-success-sea border-success-sea/40",
  EXPERT:    "bg-accent/20 text-accent border-accent/50",
};

interface CrewMember {
  id: string;
  firstName: string;
  lastName: string;
  rank: string;
  vesselCode: string;
}

interface Capability {
  id: string;
  crewId: string;
  area: string;
  level: string;
  certificationId: string | null;
  notes: string | null;
  validUntil: string | null;
}

interface Matrix {
  crew: CrewMember[];
  capabilities: Capability[];
  areas: string[];
}

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-bold text-text-industrial/40 uppercase tracking-widest mb-1.5";

// ─── Cell editor ─────────────────────────────────────────────────────────────

interface CellEditorProps {
  crew: CrewMember;
  area: string;
  existing: Capability | null;
  onClose: () => void;
  onSaved: () => void;
}

const CellEditor: React.FC<CellEditorProps> = ({ crew, area, existing, onClose, onSaved }) => {
  const [level, setLevel]         = useState(existing?.level ?? "CERTIFIED");
  const [notes, setNotes]         = useState(existing?.notes ?? "");
  const [validUntil, setValidUntil] = useState(existing?.validUntil?.slice(0, 10) ?? "");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const onSave = async () => {
    setSaving(true); setErr(null);
    try {
      await api.post("/app/crew-matrix", {
        crewId: crew.id, area, level,
        notes: notes.trim() || null,
        validUntil: validUntil || null,
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
    finally { setSaving(false); }
  };
  const onRemove = async () => {
    if (!existing) return;
    if (!window.confirm(`¿Quitar capability ${AREA_LABEL[area]} de ${crew.firstName} ${crew.lastName}?`)) return;
    try {
      await api.delete(`/app/crew-matrix/${crew.id}/${area}`);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#0D1B2A] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{AREA_LABEL[area]}</p>
            <h2 className="text-sm font-bold text-white">{crew.firstName} {crew.lastName} <span className="text-text-industrial/40 font-normal text-xs">— {crew.rank}</span></h2>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-3">
          <div>
            <label className={labelCls}>Nivel</label>
            <div className="flex gap-1.5">
              {Object.entries(LEVEL_LABEL).map(([v, l]) => (
                <button key={v} onClick={() => setLevel(v)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-xs font-bold transition-colors ${
                    level === v ? LEVEL_COLOR[v] : "bg-white/5 text-text-industrial/60 border-white/10"
                  }`}
                >{l}</button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Válido hasta</label>
            <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Notas / evidencia</label>
            <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls + " resize-y"} placeholder="Curso XYZ, fecha, instituto, número de certificado…" />
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>
        <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10">
          <div>
            {existing && (
              <button onClick={() => { void onRemove(); }} className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">Quitar</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial">Cerrar</button>
            <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs disabled:opacity-50">
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
  const { vessels, selectedVesselCode } = useVesselContext();
  const [vesselCode, setVesselCode] = useState(selectedVesselCode ?? "");
  const [data, setData] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ crew: CrewMember; area: string; existing: Capability | null } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const qs = vesselCode ? `?vesselCode=${encodeURIComponent(vesselCode)}` : "";
      const r = await api.get<Matrix>(`/app/crew-matrix${qs}`);
      setData(r);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [vesselCode]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (selectedVesselCode && selectedVesselCode !== vesselCode) setVesselCode(selectedVesselCode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVesselCode]);

  const capByCrewArea = new Map<string, Capability>();
  for (const c of data?.capabilities ?? []) capByCrewArea.set(`${c.crewId}|${c.area}`, c);

  const now = new Date();

  function openCell(crew: CrewMember, area: string) {
    setEditing({ crew, area, existing: capByCrewArea.get(`${crew.id}|${area}`) ?? null });
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={Grid3x3} title="Matriz de Competencias" total={data?.capabilities.length ?? 0} onReload={reload} />

      <div className="flex flex-wrap items-center gap-2">
        <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
          <option value="">Todos los buques</option>
          {vessels.map(v => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
        </select>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : !data || data.crew.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/40 text-sm">Sin tripulación ONBOARD.</div>
      ) : (
        <div className="overflow-x-auto bg-white/[0.03] border border-white/10 rounded-xl">
          <table className="text-[10px] min-w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="sticky left-0 z-10 bg-[#0D1B2A] text-left px-3 py-2 font-bold uppercase tracking-widest text-text-industrial/60 min-w-[200px]">Tripulante</th>
                {data.areas.map(a => (
                  <th key={a} className="px-2 py-2 text-center font-bold uppercase tracking-wider text-text-industrial/50 min-w-[80px] whitespace-nowrap">
                    <span title={AREA_LABEL[a] ?? a}>{AREA_LABEL[a] ?? a}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.crew.map(c => (
                <tr key={c.id} className="border-b border-white/5 last:border-b-0">
                  <td className="sticky left-0 z-10 bg-[#0D1B2A] px-3 py-2">
                    <div className="text-xs font-bold text-white">{c.firstName} {c.lastName}</div>
                    <div className="text-[9px] text-text-industrial/40 uppercase tracking-wider">{c.rank} · {c.vesselCode}</div>
                  </td>
                  {data.areas.map(a => {
                    const cap = capByCrewArea.get(`${c.id}|${a}`);
                    const expired = !!cap?.validUntil && new Date(cap.validUntil) < now;
                    return (
                      <td key={a} className="px-1 py-1 text-center">
                        <button
                          onClick={() => openCell(c, a)}
                          title={cap ? `${LEVEL_LABEL[cap.level]}${cap.validUntil ? ` · vence ${new Date(cap.validUntil).toLocaleDateString("es-AR")}` : ""}${cap.notes ? ` · ${cap.notes}` : ""}` : "Sin asignar — click para agregar"}
                          className={`w-full h-7 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 ${
                            !cap ? "bg-white/[0.02] text-text-industrial/30 border-white/5 hover:bg-white/10" :
                            expired ? "bg-red-500/15 text-red-300 border-red-500/40 hover:bg-red-500/25" :
                            LEVEL_COLOR[cap.level]
                          }`}
                        >
                          {!cap ? "·" : expired ? <><AlertCircle className="w-2.5 h-2.5" /> EXP</> : cap.level === "EXPERT" ? "★" : cap.level === "CERTIFIED" ? "✓" : "T"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 px-3 py-2 border-t border-white/10 text-[10px] text-text-industrial/50">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-success-sea/40" /> Certificado</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-accent/40" /> Experto</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-yellow-500/40" /> Entrenado</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500/40" /> Vencido</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-white/10" /> Sin asignar</span>
          </div>
        </div>
      )}

      {editing && (
        <CellEditor
          crew={editing.crew}
          area={editing.area}
          existing={editing.existing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
};
