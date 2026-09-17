// Casilla de Compras para "Enviar a Compras" de las Solicitudes de repuestos
// (Configuración → sección). Sólo TENANT_ADMIN: la pantalla no la muestra a otros
// roles y el backend lo vuelve a chequear.

import React, { useEffect, useState } from "react";
import { CheckCircle, Loader2, ShoppingCart } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { AlertDialog } from "./AlertDialog";

export const SpareRequestSettings: React.FC = () => {
  const t = useT();
  const [mailbox, setMailbox] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ mailbox: string | null }>("/app/tenant/spare-request-config")
      .then(c => setMailbox(c.mailbox ?? ""))
      .catch(() => { /* fail-open: queda vacío */ })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    const value = mailbox.trim().toLowerCase();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setAlert(t("config.weeklyReport.invalidEmail"));
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.patch<{ mailbox: string | null }>("/app/tenant/spare-request-config", { mailbox: value });
      setMailbox(res.mailbox ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("config.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-accent" /> {t("config.spareRequest.title")}
        </h3>
        <p className="text-xs text-fg/50 mt-1 max-w-xl">{t("config.spareRequest.subtitle")}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-fg/40 text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-fg/40">{t("config.spareRequest.mailbox")}</p>
            <input
              type="email"
              value={mailbox}
              onChange={e => { setMailbox(e.target.value); setSaved(false); }}
              placeholder={t("config.spareRequest.mailboxPh")}
              className="w-full max-w-md px-3 py-2 rounded-lg border border-border bg-transparent text-xs text-fg placeholder:text-fg/30 focus:outline-none focus:border-accent/50"
            />
            {!mailbox.trim() && <p className="text-[11px] text-amber-700 dark:text-amber-400">{t("config.spareRequest.empty")}</p>}
          </div>
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <button
              onClick={() => { void save(); }}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("config.save")}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs text-success-sea font-medium">
                <CheckCircle className="w-4 h-4" /> {t("config.saved")}
              </span>
            )}
          </div>
        </div>
      )}

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </section>
  );
};
