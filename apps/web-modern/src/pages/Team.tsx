import React, { useState } from "react";
import { Anchor, Check, Copy, Eye, EyeOff, KeyRound, Loader2, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DataTable, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { fmtDate } from "../lib/utils";
import { useT } from "../lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  userId: string;
  email: string;
  legacyUserId: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  assignedVesselCodes: string[];
  joinedAt: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

interface Vessel {
  id: string;
  code: string;
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_ROLES = [
  "TENANT_ADMIN",
  "FLEET_SUPERINTENDENT",
  "MAINTENANCE_MANAGER",
  "TECHNICIAN_OPERATOR",
  "INSPECTOR_COMPLIANCE",
  "PROCUREMENT_STORE",
  "AUDITOR_READONLY",
];

const ROLE_LABELS: Record<string, string> = {
  TENANT_ADMIN:         "Administrador",
  FLEET_SUPERINTENDENT: "Superintendent de Flota",
  MAINTENANCE_MANAGER:  "Jefe de Mantenimiento",
  TECHNICIAN_OPERATOR:  "Técnico / Operador",
  INSPECTOR_COMPLIANCE: "Inspector / Cumplimiento",
  PROCUREMENT_STORE:    "Compras / Almacén",
  AUDITOR_READONLY:     "Auditor (solo lectura)",
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    "bg-success-sea/10 text-success-sea border-success-sea/20",
  INVITED:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
  REVOKED:   "bg-red-500/10 text-red-400 border-red-500/20",
  SUSPENDED: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};

const ROLE_COLORS: Record<string, string> = {
  TENANT_ADMIN:         "text-accent font-bold",
  FLEET_SUPERINTENDENT: "text-blue-400 font-semibold",
  MAINTENANCE_MANAGER:  "text-white",
  TECHNICIAN_OPERATOR:  "text-text-industrial/70",
  INSPECTOR_COMPLIANCE: "text-text-industrial/70",
  PROCUREMENT_STORE:    "text-text-industrial/70",
  AUDITOR_READONLY:     "text-text-industrial/40",
};

function fullName(m: Member): string {
  const parts = [m.firstName, m.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : m.email;
}

function isInternalEmail(email: string): boolean {
  return email.includes("@internal.") || email.includes("@named.");
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputCls  = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50";
const selectCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50";
const labelCls  = "block text-[10px] font-semibold text-text-industrial/60 uppercase tracking-wider";

// ─── Add Member Modal ─────────────────────────────────────────────────────────

interface AddMemberModalProps {
  onClose: () => void;
  onAdded: () => void;
}

const AddMemberModal: React.FC<AddMemberModalProps> = ({ onClose, onAdded }) => {
  const t = useT();
  const [tab, setTab] = useState<"direct" | "invite">("direct");

  // Direct create fields
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail]         = useState("");
  const [role, setRole]           = useState("FLEET_SUPERINTENDENT");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Invite link result
  const [inviteResult, setInviteResult] = useState<{ token: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const acceptUrl = inviteResult
    ? `${window.location.origin}/accept-invitation?token=${inviteResult.token}`
    : "";

  const handleCreate = async () => {
    if (!displayName.trim()) { setError("El USER es requerido."); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/app/team/members", { firstName: displayName.trim(), email: email.trim() || undefined, role });
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async () => {
    if (!email.trim()) { setError("El email es requerido para invitar."); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.post<{ token: string; email: string }>("/app/team/invitations", { email: email.trim(), role });
      setInviteResult(res);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(acceptUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">Agregar miembro</h2>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => { setTab("direct"); setError(null); }}
            className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${tab === "direct" ? "text-accent border-b-2 border-accent" : "text-text-industrial/50 hover:text-white"}`}
          >
            Crear directamente
          </button>
          <button
            onClick={() => { setTab("invite"); setError(null); }}
            className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${tab === "invite" ? "text-accent border-b-2 border-accent" : "text-text-industrial/50 hover:text-white"}`}
          >
            Invitar por email
          </button>
        </div>

        {inviteResult ? (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-success-sea">
              <Check className="w-5 h-5" />
              <p className="text-sm font-semibold">Invitación generada para {inviteResult.email}</p>
            </div>
            <p className="text-xs text-text-industrial/60">{t("team.tokenCopy")}</p>
            <div className="flex items-center gap-2">
              <input readOnly value={acceptUrl} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none" />
              <button
                onClick={() => { void handleCopy(); }}
                className={`shrink-0 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${copied ? "bg-success-sea/20 border-success-sea/40 text-success-sea" : "bg-white/5 border-white/10 text-text-industrial hover:border-accent/40 hover:text-white"}`}
              >
                {copied ? <div className="flex items-center gap-1"><Check className="w-3.5 h-3.5" />{t("team.copied")}</div>
                        : <div className="flex items-center gap-1"><Copy className="w-3.5 h-3.5" />{t("team.copyLink")}</div>}
              </button>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:text-white transition-colors">{t("common.close")}</button>
            </div>
          </div>
        ) : tab === "direct" ? (
          <>
            <div className="p-6 space-y-4">
              <p className="text-xs text-text-industrial/50">El miembro se crea activo inmediatamente. No necesita email ni contraseña.</p>
              <div className="space-y-1.5">
                <label className={labelCls}>USER *</label>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Ej: Superintendente Remolcadores" className={inputCls} autoFocus />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>Email (opcional)</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="opcional@empresa.com" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("team.role")}</label>
                <select value={role} onChange={e => setRole(e.target.value)} className={selectCls}>
                  {ALL_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
                </select>
              </div>
              {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
              <button onClick={() => { void handleCreate(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                Agregar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="p-6 space-y-4">
              <p className="text-xs text-text-industrial/50">Se genera un link de invitación. El usuario lo usa para registrarse.</p>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("team.inviteEmail")}</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void handleInvite(); }} placeholder="nombre@empresa.com" className={inputCls} autoFocus />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>{t("team.role")}</label>
                <select value={role} onChange={e => setRole(e.target.value)} className={selectCls}>
                  {ALL_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
                </select>
              </div>
              {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
              <button onClick={() => { void handleInvite(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                {t("team.sendInvite")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Fleet Assignment Panel ───────────────────────────────────────────────────

interface FleetAssignmentPanelProps {
  member: Member;
  onChanged: () => void;
}

const FleetAssignmentPanel: React.FC<FleetAssignmentPanelProps> = ({ member, onChanged }) => {
  const { data } = useFetch<{ items: Vessel[] }>("/app/vessels");
  const vessels = data?.items ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set(member.assignedVesselCodes));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      await api.put(`/app/team/members/${member.userId}/vessels`, { vesselCodes: [...selected] });
      setSaved(true);
      onChanged();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className={labelCls + " flex items-center gap-1.5"}><Anchor className="w-3 h-3 text-accent" />Asignación de Flota</p>
        <button
          onClick={() => { void handleSave(); }}
          disabled={saving}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent text-primary-bg text-[10px] font-bold hover:brightness-110 disabled:opacity-50 transition-all"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? <Check className="w-3 h-3" /> : null}
          {saved ? "Guardado" : "Guardar"}
        </button>
      </div>
      {vessels.length === 0 ? (
        <p className="text-xs text-text-industrial/30">No hay buques configurados.</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {vessels.map(v => {
            const active = selected.has(v.code);
            return (
              <button
                key={v.code}
                onClick={() => toggle(v.code)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  active
                    ? "bg-accent/15 border-accent/40 text-accent"
                    : "bg-white/3 border-white/10 text-text-industrial/50 hover:bg-white/8 hover:text-white"
                }`}
              >
                <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${active ? "bg-accent border-accent" : "border-white/20"}`}>
                  {active && <Check className="w-2.5 h-2.5 text-primary-bg" />}
                </div>
                <div>
                  <p className="text-[10px] font-mono font-bold leading-none">{v.code}</p>
                  <p className="text-[10px] text-text-industrial/40 leading-tight truncate max-w-[80px]">{v.name}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
};

// ─── Member Credentials Section ───────────────────────────────────────────────

const MemberCredentialsSection: React.FC<{ member: Member }> = ({ member }) => {
  const username = member.legacyUserId || member.email;
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [copied, setCopied]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSave = async () => {
    if (!password) return;
    setSaving(true); setError(null);
    try {
      await api.put(`/app/team/members/${member.userId}/password`, { password });
      setSaved(true);
      setPassword("");
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(username);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-accent/15 rounded-xl p-4 bg-accent/3 space-y-3">
      <p className={labelCls + " flex items-center gap-1.5"}>
        <KeyRound className="w-3 h-3 text-accent" />Credenciales de acceso
      </p>
      <div>
        <label className={labelCls + " mb-1"}>Usuario (para login)</label>
        <div className="flex items-center gap-2">
          <input readOnly value={username} className={`${inputCls} flex-1 opacity-70 cursor-default`} />
          <button type="button" onClick={() => { void handleCopy(); }} className="shrink-0 p-2 rounded-lg border border-white/10 text-text-industrial/40 hover:text-white transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-success-sea" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <div>
        <label className={labelCls + " mb-1"}>Establecer contraseña</label>
        <div className="relative">
          <input
            type={showPwd ? "text" : "password"}
            value={password}
            onChange={e => { setPassword(e.target.value); setSaved(false); }}
            placeholder="Nueva contraseña…"
            className={`${inputCls} pr-10`}
          />
          <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-industrial/30 hover:text-white transition-colors">
            {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="button"
        onClick={() => { void handleSave(); }}
        disabled={saving || !password}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg text-xs font-bold hover:brightness-110 disabled:opacity-40 transition-all"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
        {saved ? "Guardado" : "Guardar contraseña"}
      </button>
    </div>
  );
};

// ─── Member Detail Drawer ─────────────────────────────────────────────────────

interface MemberDrawerProps {
  member: Member;
  currentUserId: string | undefined;
  onClose: () => void;
  onChanged: () => void;
}

const MemberDrawer: React.FC<MemberDrawerProps> = ({ member, currentUserId, onClose, onChanged }) => {
  const t = useT();
  const [newRole, setNewRole]       = useState(member.role);
  const [saving, setSaving]         = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const isSelf    = member.userId === currentUserId;
  const isRevoked = member.status === "REVOKED";
  const isSuperintendent = member.role === "FLEET_SUPERINTENDENT";

  const handleRoleChange = async () => {
    if (newRole === member.role) return;
    setSaving(true); setError(null);
    try {
      await api.patch(`/app/team/members/${member.userId}/role`, { role: newRole });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeactivating(true); setError(null);
    try {
      await api.delete(`/app/team/members/${member.userId}`);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setDeactivating(false);
    }
  };

  const statusLabel: Record<string, string> = {
    ACTIVE: t("team.statusActive"),
    INVITED: t("team.statusInvited"),
    REVOKED: t("team.statusRevoked"),
    SUSPENDED: t("team.statusSuspended"),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">{fullName(member)}</h2>
            {!isInternalEmail(member.email) && (
              <p className="text-[10px] text-text-industrial/40">{member.email}</p>
            )}
            <p className="text-[10px] text-blue-400 font-semibold">{ROLE_LABELS[member.role] ?? member.role}</p>
          </div>
          <button onClick={onClose} className="text-text-industrial/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Status */}
          <div className="flex items-center gap-3">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLORS[member.status] ?? "bg-white/5 text-white border-white/10"}`}>
              {statusLabel[member.status] ?? member.status}
            </span>
            {member.joinedAt && (
              <span className="text-[10px] text-text-industrial/40">desde {fmtDate(member.joinedAt)}</span>
            )}
          </div>

          {/* Credentials */}
          {!isRevoked && !isSelf && (
            <MemberCredentialsSection member={member} />
          )}

          {/* Fleet assignment for superintendents */}
          {isSuperintendent && !isRevoked && (
            <div className="border border-accent/15 rounded-xl p-4 bg-accent/3">
              <FleetAssignmentPanel member={member} onChanged={onChanged} />
            </div>
          )}

          {/* Role change */}
          {!isSelf && !isRevoked && (
            <div className="space-y-2">
              <label className={labelCls}>{t("team.changeRole")}</label>
              <div className="flex items-center gap-2">
                <select value={newRole} onChange={e => setNewRole(e.target.value)} className={`flex-1 ${selectCls}`}>
                  {ALL_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
                </select>
                <button
                  onClick={() => { void handleRoleChange(); }}
                  disabled={saving || newRole === member.role}
                  className="shrink-0 px-3 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-40 flex items-center gap-1.5"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("common.save")}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}

          {/* Delete */}
          {!isSelf && (
            <div className="border-t border-white/10 pt-4">
              {!confirmDeactivate ? (
                <button onClick={() => setConfirmDeactivate(true)} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                  <UserMinus className="w-3.5 h-3.5" />
                  Eliminar miembro
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-text-industrial/60">¿Eliminar a <span className="text-white font-semibold">{fullName(member)}</span> del equipo? Esta acción no se puede deshacer.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDeactivate(false)} className="px-3 py-1.5 rounded-lg text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
                    <button
                      onClick={() => { void handleDelete(); }}
                      disabled={deactivating}
                      className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 font-bold text-xs hover:bg-red-500/30 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {deactivating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5" />}
                      Eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Pending Invitations Panel ────────────────────────────────────────────────

const PendingInvitationsPanel: React.FC<{ reload: number }> = ({ reload }) => {
  const t = useT();
  const { data, loading } = useFetch<PendingInvite[]>("/app/team/invitations", [reload]);
  const invites = data ?? [];

  if (loading || invites.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-text-industrial/40 uppercase tracking-widest">{t("team.pendingInvites")}</p>
      <div className="space-y-2">
        {invites.map(inv => (
          <div key={inv.id} className="flex items-center justify-between px-4 py-2.5 bg-blue-500/5 border border-blue-500/15 rounded-xl">
            <div>
              <p className="text-xs font-medium text-white">{inv.email}</p>
              <p className="text-[10px] text-text-industrial/40">{ROLE_LABELS[inv.role] ?? inv.role} · vence {fmtDate(inv.expiresAt)}</p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-400 border-blue-500/20 font-bold">{t("team.statusInvited")}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const TeamPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const [showAdd, setShowAdd]       = useState(false);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  const { data, loading, error, reload } = useFetch<Member[]>("/app/team/members", [reloadCount]);
  const members = data ?? [];

  const triggerReload = () => { setReloadCount(c => c + 1); reload(); };

  const columns: Column<Member>[] = [
    {
      key: "name",
      header: "Nombre",
      render: m => (
        <div>
          <p className="font-semibold text-white text-sm">{fullName(m)}</p>
          {!isInternalEmail(m.email) && <p className="text-[10px] text-text-industrial/40">{m.email}</p>}
        </div>
      ),
    },
    {
      key: "role",
      header: t("team.role"),
      render: m => <span className={`text-xs ${ROLE_COLORS[m.role] ?? "text-white"}`}>{ROLE_LABELS[m.role] ?? m.role}</span>,
    },
    {
      key: "status",
      header: t("col.status"),
      render: m => (
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${STATUS_COLORS[m.status] ?? "bg-white/5 text-white border-white/10"}`}>
          {m.status}
        </span>
      ),
    },
    {
      key: "vessels",
      header: "Flota asignada",
      render: m => m.assignedVesselCodes.length > 0
        ? <span className="text-xs font-mono text-accent">{m.assignedVesselCodes.join(", ")}</span>
        : <span className="text-text-industrial/20 text-xs">—</span>,
    },
    {
      key: "joinedAt",
      header: "Alta",
      render: m => <span className="text-xs text-text-industrial/40">{fmtDate(m.joinedAt)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={Users} title={t("page.team")} total={members.length} onReload={triggerReload}>
        {user?.role === "TENANT_ADMIN" && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg text-xs font-bold hover:brightness-110 transition-all"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Agregar
          </button>
        )}
      </PageHeader>

      <PendingInvitationsPanel reload={reloadCount} />

      <DataTable
        columns={columns}
        data={members.length > 0 ? members : null}
        loading={loading}
        error={error}
        keyFn={m => m.userId}
        emptyText={t("empty.team")}
        onRowClick={m => setEditMember(m)}
      />

      {showAdd && (
        <AddMemberModal onClose={() => setShowAdd(false)} onAdded={triggerReload} />
      )}

      {editMember && (
        <MemberDrawer
          member={editMember}
          currentUserId={user?.id}
          onClose={() => setEditMember(null)}
          onChanged={triggerReload}
        />
      )}
    </div>
  );
};
