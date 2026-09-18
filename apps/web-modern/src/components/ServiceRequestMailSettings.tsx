// A quién se le manda la Solicitud de Servicio (Configuración → sección).
// Sólo TENANT_ADMIN: la pantalla no la renderiza para otros roles y el backend
// lo vuelve a chequear. Mismo patrón que WeeklyReportSettings.

import React, { useEffect, useState } from "react";
import { Send, Loader2, CheckCircle, Plus, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { AlertDialog } from "./AlertDialog";

interface ServiceRequestMailConfig {
  toProvider: boolean;
  ccRecipients: string[];
}

export const ServiceRequestMailSettings: React.FC = () => {
  const t = useT();

  const [toProvider, setToProvider] = useState(false);
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    api.get<ServiceRequestMailConfig>("/app/tenant/service-request-mail-config")
      .then((c) => { setToProvider(!!c.toProvider); setCcRecipients(c.ccRecipients ?? []); })
      .catch(() => { /* fail-open: queda como está hoy (casilla interna, sin copias) */ })
      .finally(() => setLoading(false));
  }, []);

  const addRecipient = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setAlert(t("config.ssMail.invalidEmail"));
      return;
    }
    if (ccRecipients.includes(value)) { setDraft(""); return; }
    setCcRecipients((prev) => [...prev, value]);
    setDraft("");
    setSuccess(null);
  };

  async function save() {
    setSaving(true);
    setSuccess(null);
    try {
      const saved = await api.patch<ServiceRequestMailConfig>("/app/tenant/service-request-mail-config", {
        toProvider, ccRecipients,
      });
      setToProvider(!!saved.toProvider);
      setCcRecipients(saved.ccRecipients ?? []);
      setSuccess(t("config.saved"));
      setTimeout(() => setSuccess(null), 2500);
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
          <Send className="w-4 h-4 text-accent" /> {t("config.ssMail.title")}
        </h3>
        <p className="text-xs text-fg/50 mt-1 max-w-xl">{t("config.ssMail.subtitle")}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-fg/40 text-sm py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-border hover:bg-fg/5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={toProvider}
              onChange={(e) => { setToProvider(e.target.checked); setSuccess(null); }}
              className="w-4 h-4 mt-0.5 rounded accent-accent shrink-0"
            />
            <span>
              <span className="block text-xs font-medium text-fg/80">{t("config.ssMail.toProvider")}</span>
              <span className="block text-[11px] text-fg/50 mt-0.5">
                {toProvider ? t("config.ssMail.toProviderOn") : t("config.ssMail.toProviderOff")}
              </span>
            </span>
          </label>

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-fg/40">{t("config.ssMail.cc")}</p>

            {ccRecipients.length === 0 ? (
              <p className="text-xs text-fg/40 py-1">{t("config.ssMail.noCc")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ccRecipients.map((r) => (
                  <span key={r} className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg border border-border bg-fg/[0.03] text-xs text-fg/80">
                    {r}
                    <button
                      type="button"
                      onClick={() => { setCcRecipients((prev) => prev.filter((x) => x !== r)); setSuccess(null); }}
                      aria-label={t("common.delete")}
                      className="w-5 h-5 rounded-md flex items-center justify-center text-fg/40 hover:text-danger hover:bg-danger/10 transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="email"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
                placeholder={t("config.ssMail.emailPlaceholder")}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-transparent text-xs text-fg placeholder:text-fg/30 focus:outline-none focus:border-accent/50"
              />
              <button
                type="button"
                onClick={addRecipient}
                className="px-3 py-2 rounded-lg border border-border text-xs text-fg/70 hover:text-fg hover:bg-fg/5 transition-all flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> {t("config.weeklyReport.add")}
              </button>
            </div>
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
            {success && (
              <span className="flex items-center gap-1.5 text-xs text-success-sea font-medium">
                <CheckCircle className="w-4 h-4" /> {success}
              </span>
            )}
          </div>

          {toProvider && <p className="text-[11px] text-fg/45 border-l-2 border-border pl-2.5">{t("config.ssMail.fallbackNote")}</p>}
        </div>
      )}

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </section>
  );
};
