import React, { useState, useMemo } from "react";
import { ChevronLeft, Loader2, FileCheck, RefreshCw } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useEscapeGuard } from "../lib/escape-guard";

interface CrewCert {
  id: string;
  type: string;
  certificateNumber: string | null;
  issuingAuthority: string | null;
  expiryDate: string | null;
}
interface Crew {
  id: string;
  firstName: string;
  lastName: string;
  vesselCode: string;
  certifications?: CrewCert[];
}

/** Cert documental aplanada con su tripulante. */
interface FlatCert extends CrewCert {
  crewId: string;
  crewName: string;
  vesselCode: string;
}

export type CrewCertsFilter = "expired" | "expiring" | "all";

// Documentos personales del tripulante (CrewCertification). Los cursos STCW
// viven en la matriz de entrenamientos (desktop), no acá.
const CERT_TYPE_LABEL: Record<string, string> = {
  PASSPORT:     "Pasaporte",
  SEAMANS_BOOK: "Libreta de embarco",
  VISA:         "Visa",
  MEDICAL:      "Certificado médico",
  YELLOW_FEVER: "Fiebre amarilla",
  OTHER:        "Otro",
};

// Roles que pueden gestionar certificaciones (espejo de canManage en certifications-service).
const CERT_MANAGE_ROLES = new Set(["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"]);

type View = "list" | "renew";

interface MobileCrewCertsProps {
  /** Filtro inicial al montar — el dashboard entra en "expired" (vencidos). */
  initialFilter?: CrewCertsFilter;
  /** Vuelve al Panel — esta pantalla se abre desde el dashboard, sin tab en la barra. */
  onBack?: () => void;
}

type CertStatus = "expired" | "expiring" | "ok";
function certStatus(expiry: string | null): CertStatus {
  if (!expiry) return "ok";
  const diffDays = Math.floor((new Date(expiry).getTime() - Date.now()) / 86_400_000);
  if (diffDays < 0) return "expired";
  if (diffDays <= 30) return "expiring";
  return "ok";
}

export const MobileCrewCerts: React.FC<MobileCrewCertsProps> = ({ initialFilter, onBack }) => {
  const { user } = useAuth();
  const { vessels } = useVesselContext();
  const { data, loading, reload } = useFetch<{ items: Crew[] }>("/app/crew");

  const [filter, setFilter] = useState<CrewCertsFilter>(initialFilter ?? "expired");
  React.useEffect(() => {
    if (initialFilter && initialFilter !== filter) setFilter(initialFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilter]);
  const [view, setView]         = useState<View>("list");
  const [selected, setSelected] = useState<FlatCert | null>(null);
  const [newExpiry, setNewExpiry] = useState("");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const canManage = !!user && CERT_MANAGE_ROLES.has(user.role);
  const vesselName = (code: string) => vessels.find(v => v.code === code)?.name ?? code;
  const typeLabel  = (t: string) => CERT_TYPE_LABEL[t] ?? t;

  // Aplanar crew → certs documentales (solo las que tienen vencimiento).
  const flat = useMemo<FlatCert[]>(() => {
    const out: FlatCert[] = [];
    for (const c of data?.items ?? []) {
      for (const cert of c.certifications ?? []) {
        if (!cert.expiryDate) continue;
        out.push({ ...cert, crewId: c.id, crewName: `${c.firstName} ${c.lastName}`.trim(), vesselCode: c.vesselCode });
      }
    }
    return out.sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));
  }, [data]);

  const groups = useMemo(() => ({
    expired:  flat.filter(c => certStatus(c.expiryDate) === "expired"),
    expiring: flat.filter(c => certStatus(c.expiryDate) === "expiring"),
    all:      flat,
  }), [flat]);

  const visible = groups[filter];

  const openRenew = (c: FlatCert) => {
    setSelected(c);
    setNewExpiry(c.expiryDate ? String(c.expiryDate).slice(0, 10) : "");
    setErr(null);
    setView("renew");
  };
  const backToList = () => { setView("list"); setSelected(null); setErr(null); };

  const handleRenew = async () => {
    if (!selected || !newExpiry) return;
    setSaving(true); setErr(null);
    try {
      await api.patch(`/app/crew/${selected.crewId}/certifications/${selected.id}`, { expiryDate: newExpiry });
      await reload();
      backToList();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error al renovar la certificación");
    } finally {
      setSaving(false);
    }
  };

  useEscapeGuard({
    enabled: view === "renew",
    isDirty: !!selected && newExpiry !== (selected.expiryDate ? String(selected.expiryDate).slice(0, 10) : ""),
    onSave: handleRenew,
    onClose: backToList,
  });

  // ── Renew form ────────────────────────────────────────────────────────────────
  if (view === "renew" && selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-3 p-4 border-b border-fg/10">
          <button type="button" onClick={backToList} className="p-2 -ml-2 text-text-industrial/40 hover:text-fg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-fg truncate">Renovar {typeLabel(selected.type)}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-fg/5 border border-fg/10 rounded-xl p-3">
            <p className="text-sm font-bold text-fg">{selected.crewName}</p>
            <p className="text-xs text-text-industrial/40 mt-0.5">{vesselName(selected.vesselCode)}</p>
            <p className="text-xs text-text-industrial/40 mt-1">
              Vencimiento actual: {selected.expiryDate ? String(selected.expiryDate).slice(0, 10) : "—"}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-text-industrial/40">Nuevo vencimiento</label>
            <input
              type="date"
              value={newExpiry}
              onChange={e => setNewExpiry(e.target.value)}
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
            />
          </div>
          {err && <p className="text-xs text-red-700 dark:text-red-400">{err}</p>}
          <button
            type="button"
            onClick={handleRenew}
            disabled={saving || !newExpiry}
            className="w-full py-3 rounded-xl bg-accent text-accent-fg text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RefreshCw className="w-4 h-4" /> Guardar renovación</>}
          </button>
        </div>
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Filter chips */}
      <div className="shrink-0 px-3 py-2.5 border-b border-fg/10 flex items-center gap-1.5 overflow-x-auto">
        {onBack && (
          <button type="button" onClick={onBack} className="shrink-0 p-1 -ml-1 text-text-industrial/40 hover:text-fg" aria-label="Volver al panel">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {([
          ["expired",  "Vencidos",   groups.expired.length,  "text-red-700 dark:text-red-400"],
          ["expiring", "Por vencer", groups.expiring.length, "text-yellow-700 dark:text-yellow-400"],
          ["all",      "Todos",      groups.all.length,      "text-text-industrial/60"],
        ] as [CrewCertsFilter, string, number, string][]).map(([f, label, count, color]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ${
              filter === f
                ? "bg-accent/15 text-accent border-accent/40"
                : "bg-fg/5 text-text-industrial/60 border-fg/10"
            }`}
          >
            {label}
            <span className={`text-[10px] tabular-nums ${filter === f ? "text-accent" : color}`}>({count})</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-fg/5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-10 text-text-industrial/30 text-sm flex flex-col items-center gap-2">
            <FileCheck className="w-6 h-6 text-text-industrial/20" />
            <span>Sin certificados en esta categoría</span>
          </div>
        ) : (
          visible.map(c => {
            const st = certStatus(c.expiryDate);
            const dateColor =
              st === "expired"  ? "text-red-700 dark:text-red-400 font-bold" :
              st === "expiring" ? "text-yellow-700 dark:text-yellow-400 font-bold" :
              "text-text-industrial/30";
            const row = (
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg truncate">{c.crewName}</p>
                  <p className="text-xs text-text-industrial/40 truncate mt-0.5">
                    {typeLabel(c.type)} · {vesselName(c.vesselCode)}
                  </p>
                </div>
                <div className={`text-[10px] font-mono shrink-0 mt-0.5 ${dateColor}`}>
                  {c.expiryDate ? String(c.expiryDate).slice(0, 10) : "—"}
                </div>
              </div>
            );
            return canManage ? (
              <button
                key={c.id}
                type="button"
                onClick={() => openRenew(c)}
                className="w-full text-left px-4 py-3.5 hover:bg-fg/5 active:bg-fg/10 transition-colors"
              >
                {row}
              </button>
            ) : (
              <div key={c.id} className="px-4 py-3.5">{row}</div>
            );
          })
        )}
      </div>
    </div>
  );
};
