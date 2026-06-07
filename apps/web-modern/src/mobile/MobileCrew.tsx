import React, { useState, useMemo } from "react";
import { ChevronLeft, Loader2, Search, UserMinus, Users } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useEscapeGuard } from "../lib/escape-guard";

interface CrewCert { id: string; type: string; expiryDate: string | null; status: string; }
interface Crew {
  id: string;
  crewCode: string;
  vesselCode: string;
  firstName: string;
  lastName: string;
  rankId: string | null;
  nationality: string | null;
  signOnDate: string;
  status: string;
  notes: string | null;
  certifications?: CrewCert[];
}
interface Rank { id: string; code: string; name: string; }

// Roles que pueden gestionar tripulación (espejo de canManage en crew-service).
const CREW_MANAGE_ROLES = new Set([
  "TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER",
  "TECHNICIAN_OPERATOR", "INSPECTOR_COMPLIANCE",
]);

type View = "list" | "detail" | "signoff";

interface MobileCrewProps {
  /** Vuelve al Panel — esta pantalla se abre desde el dashboard, sin tab en la barra. */
  onBack?: () => void;
}

export const MobileCrew: React.FC<MobileCrewProps> = ({ onBack }) => {
  const { user } = useAuth();
  const { vessels } = useVesselContext();
  const { data, loading, reload } = useFetch<{ items: Crew[] }>("/app/crew?status=ONBOARD");
  const { data: ranksData }       = useFetch<{ items: Rank[] }>("/app/crew/ranks");

  const [query, setQuery]       = useState("");
  const [view, setView]         = useState<View>("list");
  const [selected, setSelected] = useState<Crew | null>(null);
  const [signOffDate, setSignOffDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const canManage = !!user && CREW_MANAGE_ROLES.has(user.role);

  const rankName   = (id: string | null) => (id ? ranksData?.items.find(r => r.id === id)?.name ?? null : null);
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name ?? code;
  const fullName   = (c: Crew) => `${c.firstName} ${c.lastName}`.trim();

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const items = data?.items ?? [];
    if (!q) return items;
    return items.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      (c.crewCode ?? "").toLowerCase().includes(q),
    );
  }, [data, query]);

  const openDetail = (c: Crew) => { setSelected(c); setView("detail"); setErr(null); };
  const backToList = () => { setView("list"); setSelected(null); setErr(null); };

  const handleSignOff = async () => {
    if (!selected) return;
    setSaving(true); setErr(null);
    try {
      await api.post(`/app/crew/${selected.id}/sign-off`, {
        signOffDate: signOffDate || undefined,
        notes: notes.trim() || null,
      });
      await reload();
      backToList();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al desembarcar tripulante");
    } finally {
      setSaving(false);
    }
  };

  useEscapeGuard({ enabled: view === "detail", isDirty: false, onClose: backToList });
  useEscapeGuard({
    enabled: view === "signoff",
    isDirty: notes.trim() !== "",
    onSave: handleSignOff,
    onClose: () => setView("detail"),
  });

  // ── Sign-off form ───────────────────────────────────────────────────────────
  if (view === "signoff" && selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={() => setView("detail")} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg truncate">Desembarcar {fullName(selected)}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Fecha de desembarco</label>
            <input
              type="date"
              value={signOffDate}
              onChange={e => setSignOffDate(e.target.value)}
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Notas (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Motivo, observaciones…"
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
          <button
            type="button"
            onClick={handleSignOff}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-accent-fg text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserMinus className="w-4 h-4" /> Confirmar desembarco</>}
          </button>
        </div>
      </div>
    );
  }

  // ── Detail ──────────────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const rank = rankName(selected.rankId);
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={backToList} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg truncate flex-1">{fullName(selected)}</span>
          <span className="text-[10px] font-mono text-text-industrial/40 shrink-0">{selected.crewCode}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {rank && (
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Rango</p>
                <p className="text-sm font-bold text-fg">{rank}</p>
              </div>
            )}
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Buque</p>
              <p className="text-sm font-bold text-fg">{vesselName(selected.vesselCode)}</p>
            </div>
            {selected.nationality && (
              <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Nacionalidad</p>
                <p className="text-sm text-fg">{selected.nationality}</p>
              </div>
            )}
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-0.5">Embarque</p>
              <p className="text-sm text-fg">{String(selected.signOnDate).slice(0, 10)}</p>
            </div>
          </div>
          {selected.notes && (
            <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 mb-1">Notas</p>
              <p className="text-sm text-fg/80 leading-relaxed whitespace-pre-line">{selected.notes}</p>
            </div>
          )}
          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
          {canManage && (
            <button
              type="button"
              onClick={() => { setNotes(""); setSignOffDate(new Date().toISOString().slice(0, 10)); setView("signoff"); }}
              className="w-full py-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 text-sm font-bold flex items-center justify-center gap-2"
            >
              <UserMinus className="w-4 h-4" /> Desembarcar
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 p-3 border-b border-fg/10 space-y-2.5">
        <div className="flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className="p-1 -ml-1 text-text-industrial/40 hover:text-fg" aria-label="Volver al panel">
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <p className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">
            {filtered.length} tripulante{filtered.length !== 1 ? "s" : ""} a bordo
          </p>
        </div>
        <div className="flex items-center gap-2 bg-fg/5 border border-fg/10 rounded-xl px-3 py-2">
          <Search className="w-4 h-4 text-text-industrial/30 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre o código..."
            className="flex-1 bg-transparent text-sm text-fg placeholder-text-industrial/30 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-fg/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm flex flex-col items-center gap-2">
            <Users className="w-6 h-6 text-text-industrial/20" />
            <span>{query ? "Sin resultados" : "Sin tripulantes a bordo"}</span>
          </div>
        ) : (
          filtered.map(c => {
            const rank = rankName(c.rankId);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openDetail(c)}
                className="w-full text-left px-4 py-3.5 hover:bg-fg/5 active:bg-fg/10 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg truncate">{fullName(c)}</p>
                    <p className="text-xs text-text-industrial/40 truncate mt-0.5">
                      {rank ? `${rank} · ` : ""}{vesselName(c.vesselCode)}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-text-industrial/30 shrink-0 mt-0.5">{c.crewCode}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
