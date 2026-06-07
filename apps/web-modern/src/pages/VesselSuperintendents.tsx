import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, UserMinus, UserPlus, Users } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useEscapeGuard } from "../lib/escape-guard";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface Assignment {
  id: string;
  vesselCode: string;
  assignmentType: "PRIMARY" | "SECONDARY";
  isActive: boolean;
}

interface FleetSuperintendent {
  userId: string;
  user: User;
  assignedVesselCodes: string[];
  assignments: Assignment[];
}

interface Candidate {
  userId: string;
  role: string;
  user: User;
}

interface Vessel {
  id: string;
  code: string;
  name: string;
}

interface VesselsResponse {
  items: Vessel[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fullName(user: User): string {
  const parts = [user.firstName, user.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : user.email;
}

const DEMOTE_ROLES = [
  "MAINTENANCE_MANAGER",
  "TECHNICIAN_OPERATOR",
  "INSPECTOR_COMPLIANCE",
  "PROCUREMENT_STORE",
  "AUDITOR_READONLY",
];

// ─── Matrix Cell ──────────────────────────────────────────────────────────────

interface CellProps {
  superintendent: FleetSuperintendent;
  vesselCode: string;
  onAssign: (userId: string, vesselCode: string, type: "PRIMARY" | "SECONDARY") => Promise<void>;
  onDeactivate: (assignmentId: string, userId: string) => Promise<void>;
  busy: boolean;
}

const MatrixCell: React.FC<CellProps> = ({ superintendent, vesselCode, onAssign, onDeactivate, busy }) => {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);

  const assignment = superintendent.assignments.find(
    a => a.vesselCode === vesselCode && a.isActive,
  );

  const cellStyle = assignment
    ? assignment.assignmentType === "PRIMARY"
      ? "bg-accent/20 border-accent/40 text-accent"
      : "bg-blue-500/20 border-blue-500/40 text-blue-700 dark:text-blue-400"
    : "bg-fg/3 border-fg/10 text-text-industrial/20 hover:bg-fg/8 hover:border-fg/20 cursor-pointer";

  return (
    <div className="relative flex justify-center">
      <button
        ref={btnRef}
        disabled={busy}
        onClick={() => {
          if (btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setMenuPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
          }
          setMenuOpen(o => !o);
        }}
        className={`w-full text-center py-1.5 rounded-lg border text-[10px] font-bold transition-all ${cellStyle} ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
        title={assignment ? `${assignment.assignmentType} — click para cambiar` : "Click para asignar"}
      >
        {busy ? (
          <Loader2 className="w-3 h-3 animate-spin mx-auto" />
        ) : assignment ? (
          assignment.assignmentType === "PRIMARY" ? t("sup.primary") : t("sup.secondary")
        ) : (
          "—"
        )}
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div className="fixed z-200 w-44 bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-xl shadow-2xl overflow-hidden" style={{ top: menuPos.top, left: menuPos.left, transform: "translateX(-50%)" }}>
            {assignment?.assignmentType !== "PRIMARY" && (
              <button
                onClick={async () => { setMenuOpen(false); await onAssign(superintendent.userId, vesselCode, "PRIMARY"); }}
                className="w-full text-left px-3 py-2 text-xs text-accent hover:bg-accent/10 transition-colors"
              >
                {t("sup.assignPrimary")}
              </button>
            )}
            {assignment?.assignmentType !== "SECONDARY" && (
              <button
                onClick={async () => { setMenuOpen(false); await onAssign(superintendent.userId, vesselCode, "SECONDARY"); }}
                className="w-full text-left px-3 py-2 text-xs text-blue-700 dark:text-blue-400 hover:bg-blue-500/10 transition-colors"
              >
                {t("sup.assignSecondary")}
              </button>
            )}
            {assignment && (
              <button
                onClick={async () => { setMenuOpen(false); await onDeactivate(assignment.id, superintendent.userId); }}
                className="w-full text-left px-3 py-2 text-xs text-red-700 dark:text-red-400 hover:bg-red-500/10 transition-colors border-t border-fg/10"
              >
                {t("sup.removeAssign")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Add Superintendent Panel ─────────────────────────────────────────────────

interface AddPanelProps {
  onPromoted: () => void;
}

const AddSuperintendentPanel: React.FC<AddPanelProps> = ({ onPromoted }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: candidates, loading } = useFetch<Candidate[]>(
    open ? "/app/superintendents/candidates" : "",
    [open],
  );

  const handlePromote = async () => {
    if (!selectedUserId) return;
    setPromoting(true);
    setError(null);
    try {
      await api.post("/app/superintendents/promote", { userId: selectedUserId });
      setSelectedUserId("");
      onPromoted();
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="border border-fg/10 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-industrial/60 hover:text-fg hover:bg-fg/3 transition-all"
      >
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-accent" />
          <span>Agregar superintendente</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-2 border-t border-fg/10 space-y-4 bg-fg/2">
          <p className="text-xs text-text-industrial/40">
            Seleccioná un miembro activo del tenant para promoverlo al rol de Fleet Superintendent.
            Sus asignaciones de buques se configuran en la matriz de arriba.
          </p>

          {loading && (
            <div className="flex items-center gap-2 text-xs text-text-industrial/40">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando miembros…
            </div>
          )}

          {!loading && candidates && candidates.length === 0 && (
            <p className="text-xs text-text-industrial/30">
              No hay miembros disponibles para promover. Todos los usuarios activos ya son superintendentes o no hay miembros en el tenant.
            </p>
          )}

          {!loading && candidates && candidates.length > 0 && (
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="block text-[10px] font-semibold text-text-industrial/60 uppercase tracking-wider">
                  Miembro a promover
                </label>
                <select
                  value={selectedUserId}
                  onChange={e => setSelectedUserId(e.target.value)}
                  className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
                >
                  <option value="">— Seleccioná un miembro —</option>
                  {candidates.map(c => (
                    <option key={c.userId} value={c.userId}>
                      {fullName(c.user)} ({c.user.email}) · {c.role}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => { void handlePromote(); }}
                disabled={!selectedUserId || promoting}
                className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-40 transition-all flex items-center gap-1.5 shrink-0"
              >
                {promoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                Promover
              </button>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Demote Dialog ────────────────────────────────────────────────────────────

interface DemoteDialogProps {
  superintendent: FleetSuperintendent;
  onClose: () => void;
  onDemoted: () => void;
}

const DemoteDialog: React.FC<DemoteDialogProps> = ({ superintendent, onClose, onDemoted }) => {
  const t = useT();
  const [newRole, setNewRole] = useState("MAINTENANCE_MANAGER");
  const [demoting, setDemoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDemote = async () => {
    setDemoting(true);
    setError(null);
    try {
      await api.post("/app/superintendents/demote", { userId: superintendent.userId, newRole });
      onDemoted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setDemoting(false);
    }
  };

  // ESC: cerrar el diálogo (confirmación, sin guardado de registro)
  useEscapeGuard({ isDirty: false, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-fg/10">
          <h2 className="text-base font-bold text-fg">Remover superintendente</h2>
          <p className="text-xs text-text-industrial/40 mt-0.5">{fullName(superintendent.user)}</p>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-text-industrial/60">
            Se removerá el rol de Fleet Superintendent y se desactivarán todas sus asignaciones de buques.
            Seleccioná el nuevo rol que tendrá en el tenant.
          </p>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-semibold text-text-industrial/60 uppercase tracking-wider">Nuevo rol</label>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
            >
              {DEMOTE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {error && (
            <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-fg/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">
            {t("common.cancel")}
          </button>
          <button
            onClick={() => { void handleDemote(); }}
            disabled={demoting}
            className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-700 dark:text-red-400 font-bold text-xs hover:bg-red-500/30 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            {demoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5" />}
            Remover rol
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const VesselSuperintendentsPage: React.FC = () => {
  const t = useT();
  const [busyCells, setBusyCells] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [demoteTarget, setDemoteTarget] = useState<FleetSuperintendent | null>(null);

  const { data: supsData, loading: supsLoading, error: supsError, reload: reloadSups } =
    useFetch<FleetSuperintendent[]>("/app/superintendents", []);

  const { data: vesselsData, loading: vesselsLoading } =
    useFetch<VesselsResponse>("/app/vessels?status=ACTIVE&limit=200", []);

  const vessels = useMemo(() => vesselsData?.items ?? [], [vesselsData]);
  const superintendents = useMemo(() => supsData ?? [], [supsData]);

  const makeCellKey = (userId: string, vesselCode: string) => `${userId}:${vesselCode}`;

  const handleAssign = async (userId: string, vesselCode: string, type: "PRIMARY" | "SECONDARY") => {
    const key = makeCellKey(userId, vesselCode);
    setBusyCells(s => new Set(s).add(key));
    setActionError(null);
    try {
      await api.post("/app/superintendents/assignments", { userId, vesselCode, assignmentType: type });
      await reloadSups();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setBusyCells(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const handleDeactivate = async (assignmentId: string) => {
    const key = `deactivate:${assignmentId}`;
    setBusyCells(s => new Set(s).add(key));
    setActionError(null);
    try {
      await api.delete(`/app/superintendents/assignments/${assignmentId}`);
      await reloadSups();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setBusyCells(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const loading = supsLoading || vesselsLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title={t("page.superintendents")}
        total={superintendents.length}
        onReload={() => { void reloadSups(); }}
      />

      {actionError && (
        <p className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {actionError}
        </p>
      )}

      {/* Leyenda */}
      <div className="flex items-center gap-4 text-[10px] font-bold">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-4 rounded bg-accent/20 border border-accent/40" />
          <span className="text-text-industrial/60">{t("sup.primary")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-4 rounded bg-blue-500/20 border border-blue-500/40" />
          <span className="text-text-industrial/60">{t("sup.secondary")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-4 rounded bg-fg/3 border border-fg/10" />
          <span className="text-text-industrial/40">Sin asignación</span>
        </div>
        <span className="text-text-industrial/30 ml-2">· Click en celda para asignar</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      )}

      {supsError && (
        <p className="text-sm text-red-700 dark:text-red-400 text-center py-10">{supsError}</p>
      )}

      {!loading && !supsError && superintendents.length === 0 && (
        <p className="text-sm text-text-industrial/40 text-center py-10">{t("sup.noSuperintendents")}</p>
      )}

      {/* Matriz */}
      {!loading && !supsError && superintendents.length > 0 && vessels.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-fg/10">
          <table className="min-w-max w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-fg/10 bg-fg/3">
                <th className="text-left px-4 py-3 font-semibold text-text-industrial/60 sticky left-0 bg-surface dark:bg-[#0D1B2A] z-10 min-w-[200px]">
                  Superintendente
                </th>
                {vessels.map(v => (
                  <th key={v.code} className="px-2 py-3 font-mono text-accent text-center min-w-[90px]">
                    {v.code}
                  </th>
                ))}
                <th className="px-3 py-3 text-text-industrial/30 text-center w-10" />
              </tr>
            </thead>
            <tbody>
              {superintendents.map((sup, idx) => (
                <tr key={sup.userId} className={`border-b border-fg/5 ${idx % 2 === 0 ? "" : "bg-fg/2"}`}>
                  <td className="px-4 py-3 sticky left-0 bg-surface dark:bg-[#0D1B2A] z-10">
                    <div>
                      <p className="font-semibold text-fg">{fullName(sup.user)}</p>
                      <p className="text-text-industrial/40 text-[10px]">{sup.user.email}</p>
                    </div>
                  </td>
                  {vessels.map(v => {
                    const cellKey = makeCellKey(sup.userId, v.code);
                    const assignment = sup.assignments.find(a => a.vesselCode === v.code && a.isActive);
                    const deactivateKey = assignment ? `deactivate:${assignment.id}` : "";
                    const isBusy = busyCells.has(cellKey) || (deactivateKey ? busyCells.has(deactivateKey) : false);
                    return (
                      <td key={v.code} className="px-2 py-2">
                        <MatrixCell
                          superintendent={sup}
                          vesselCode={v.code}
                          onAssign={handleAssign}
                          onDeactivate={handleDeactivate}
                          busy={isBusy}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => setDemoteTarget(sup)}
                      title="Remover rol de superintendente"
                      className="text-text-industrial/20 hover:text-red-400 transition-colors"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel para agregar nuevo superintendente */}
      <AddSuperintendentPanel onPromoted={() => { void reloadSups(); }} />

      {/* Dialog de demote */}
      {demoteTarget && (
        <DemoteDialog
          superintendent={demoteTarget}
          onClose={() => setDemoteTarget(null)}
          onDemoted={() => { setDemoteTarget(null); void reloadSups(); }}
        />
      )}
    </div>
  );
};
