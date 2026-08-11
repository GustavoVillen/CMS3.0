// Grilla de "qué puede hacer cada rol" (Equipo → Permisos por rol).
//
// Filas = autorizaciones agrupadas por área; columnas = roles. Lo que se tilda
// vale para TODOS los usuarios con ese rol. El servidor es el que manda: acá
// sólo se edita la configuración, cada endpoint la vuelve a validar.
//
// Dos columnas están bloqueadas a propósito (el servidor las recalcula siempre):
//   - Administrador: todo tildado.
//   - Auditor externo: nada tildado (el rol es de sólo lectura por definición).

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, RotateCcw } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT, type TranslationKey } from "../lib/i18n";
import { ModalCloseButton } from "./ModalCloseButton";
import { AlertDialog } from "./AlertDialog";

interface PermissionDef {
  key: string;
  group: string;
  labelKey: string;
}

interface Payload {
  catalog: PermissionDef[];
  roles: string[];
  editableRoles: string[];
  matrix: Record<string, string[]>;
  defaults: Record<string, string[]>;
  mine: string[];
}

interface Props {
  /** Etiqueta visible de cada rol (viene de Team.tsx, ya traducida). */
  roleLabels: Record<string, string>;
  onClose: () => void;
  /** Se llama después de guardar bien. */
  onSaved?: () => void;
}

const GROUP_KEYS: Record<string, TranslationKey> = {
  maintenance: "permGroup.maintenance",
  procurement: "permGroup.procurement",
  safety:      "permGroup.safety",
  crew:        "permGroup.crew",
  system:      "permGroup.system",
};

export const RolePermissionsModal: React.FC<Props> = ({ roleLabels, onClose, onSaved }) => {
  const t = useT();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [draft, setDraft]     = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [alert, setAlert]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Payload>("/app/tenant/role-permissions")
      .then(res => {
        if (cancelled) return;
        setPayload(res);
        setDraft(res.matrix ?? {});
      })
      .catch((err: unknown) => {
        if (!cancelled) setAlert(err instanceof ApiError ? err.message : "No se pudieron cargar los permisos.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const editable = useMemo(() => new Set(payload?.editableRoles ?? []), [payload]);

  const grouped = useMemo(() => {
    const out: { group: string; items: PermissionDef[] }[] = [];
    for (const def of payload?.catalog ?? []) {
      const last = out[out.length - 1];
      if (last && last.group === def.group) last.items.push(def);
      else out.push({ group: def.group, items: [def] });
    }
    return out;
  }, [payload]);

  const isChecked = (role: string, key: string) => (draft[role] ?? []).includes(key);

  const toggle = (role: string, key: string) => {
    if (!editable.has(role)) return;
    setDraft(prev => {
      const current = prev[role] ?? [];
      return {
        ...prev,
        [role]: current.includes(key) ? current.filter(k => k !== key) : [...current, key],
      };
    });
  };

  const restoreDefaults = () => {
    if (!payload) return;
    setDraft(prev => {
      const next = { ...prev };
      for (const role of payload.editableRoles) next[role] = [...(payload.defaults[role] ?? [])];
      return next;
    });
  };

  const handleSave = async () => {
    if (!payload) return;
    setSaving(true);
    try {
      const body: Record<string, string[]> = {};
      for (const role of payload.editableRoles) body[role] = draft[role] ?? [];
      await api.patch("/app/tenant/role-permissions", { rolePermissions: body });
      onSaved?.();
      onClose();
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : "No se pudieron guardar los permisos.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-6xl max-h-[90vh] flex flex-col bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-fg/10">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-fg">
              <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
              {t("team.rolePermissions")}
            </h2>
            <p className="mt-1 text-[11px] text-text-industrial/60">{t("team.rolePermissionsHint")}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-text-industrial/50">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : payload ? (
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-10 bg-surface dark:bg-[#0D1B2A]">
                <tr>
                  <th className="text-left font-semibold text-text-industrial/60 uppercase tracking-wider text-[10px] pb-2 pr-4 min-w-[240px]">
                    {t("team.rolePermissions")}
                  </th>
                  {payload.roles.map(role => (
                    <th key={role} className="pb-2 px-2 align-bottom">
                      <span className={`block text-[10px] font-semibold leading-tight ${editable.has(role) ? "text-fg" : "text-text-industrial/40"}`}>
                        {roleLabels[role] ?? role}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ group, items }) => (
                  <React.Fragment key={group}>
                    <tr>
                      <td
                        colSpan={payload.roles.length + 1}
                        className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-accent"
                      >
                        {GROUP_KEYS[group] ? t(GROUP_KEYS[group]) : group}
                      </td>
                    </tr>
                    {items.map(def => (
                      <tr key={def.key} className="hover:bg-fg/5">
                        <td className="py-1.5 pr-4 text-fg border-t border-fg/5">
                          {t(def.labelKey as TranslationKey)}
                        </td>
                        {payload.roles.map(role => (
                          <td key={role} className="py-1.5 px-2 text-center border-t border-fg/5">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-[var(--color-accent,#2563eb)] disabled:opacity-40"
                              checked={isChecked(role, def.key)}
                              disabled={!editable.has(role)}
                              onChange={() => toggle(role, def.key)}
                              aria-label={`${roleLabels[role] ?? role} — ${t(def.labelKey as TranslationKey)}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          ) : null}

          <div className="mt-5 space-y-1 text-[11px] text-text-industrial/50">
            <p>· {t("team.adminAlwaysAll")}</p>
            <p>· {t("team.auditorAlwaysNone")}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-fg/10">
          <button
            onClick={restoreDefaults}
            disabled={loading || saving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:text-fg transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t("team.restoreDefaults")}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-fg transition-colors">
              {t("common.cancel")}
            </button>
            <button
              onClick={() => { void handleSave(); }}
              disabled={loading || saving}
              className="px-4 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              {t("common.save")}
            </button>
          </div>
        </div>
      </div>

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};
