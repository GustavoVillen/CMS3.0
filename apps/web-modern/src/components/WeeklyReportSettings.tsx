// Configuración del parte semanal de flota por correo (Configuración → sección).
// Sólo TENANT_ADMIN: la pantalla ya no la renderiza para otros roles, y el
// backend lo vuelve a chequear.

import React, { useEffect, useState } from "react";
import { Mail, Loader2, CheckCircle, Plus, X, Eye, Send } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { AlertDialog } from "./AlertDialog";

interface WeeklyReportConfig {
  enabled: boolean;
  recipients: string[];
}

export const WeeklyReportSettings: React.FC = () => {
  const t = useT();

  const [enabled, setEnabled] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    api.get<WeeklyReportConfig>("/app/tenant/weekly-report-config")
      .then((c) => { setEnabled(!!c.enabled); setRecipients(c.recipients ?? []); })
      .catch(() => { /* fail-open: queda apagado y sin destinatarios */ })
      .finally(() => setLoading(false));
  }, []);

  const addRecipient = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setAlert(t("config.weeklyReport.invalidEmail"));
      return;
    }
    if (recipients.includes(value)) { setDraft(""); return; }
    setRecipients((prev) => [...prev, value]);
    setDraft("");
    setSuccess(null);
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
    setSuccess(null);
  };

  async function save() {
    setSaving(true);
    setSuccess(null);
    try {
      const saved = await api.patch<WeeklyReportConfig>("/app/tenant/weekly-report-config", {
        enabled, recipients,
      });
      setEnabled(!!saved.enabled);
      setRecipients(saved.recipients ?? []);
      setSuccess(t("config.saved"));
      setTimeout(() => setSuccess(null), 2500);
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("config.saveError"));
    } finally {
      setSaving(false);
    }
  }

  // La sesión viaja por cabecera Authorization, así que abrir la URL directo en
  // una pestaña daría 401: hay que traer el HTML con fetch y abrirlo como blob.
  // Mismo patrón que la descarga de plantillas en ExcelPanel.
  const [previewing, setPreviewing] = useState(false);
  async function preview(kind: "WEEKLY_OPENING" | "WEEKLY_CLOSING") {
    setPreviewing(true);
    setSuccess(null);
    try {
      const res = await fetch(`/app/tenant/weekly-report/preview?kind=${kind}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("gpms_token") ?? ""}`,
          "X-Tenant-Slug": localStorage.getItem("gpms_tenant_slug") ?? "",
        },
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener");
      if (!win) { setAlert(t("config.weeklyReport.popupBlocked")); }
      // El navegador necesita la URL viva hasta que la pestaña carga.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setAlert(t("config.weeklyReport.previewError"));
    } finally {
      setPreviewing(false);
    }
  }

  async function sendTest(kind: "WEEKLY_OPENING" | "WEEKLY_CLOSING") {
    setSending(true);
    setSuccess(null);
    try {
      const res = await api.post<{ sent: boolean; to: string[] }>("/app/tenant/weekly-report/send-test", { kind });
      setSuccess(t("config.weeklyReport.testSent").replace("{email}", res.to?.[0] ?? ""));
      setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("config.weeklyReport.testError"));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
          <Mail className="w-4 h-4 text-accent" /> {t("config.weeklyReport.title")}
        </h3>
        <p className="text-xs text-fg/50 mt-1 max-w-xl">{t("config.weeklyReport.subtitle")}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-fg/40 text-sm py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border hover:bg-fg/5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => { setEnabled(e.target.checked); setSuccess(null); }}
              className="w-4 h-4 rounded accent-accent shrink-0"
            />
            <span className="text-xs font-medium text-fg/80">{t("config.weeklyReport.enable")}</span>
          </label>

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-fg/40">
              {t("config.weeklyReport.recipients")}
            </p>

            {recipients.length === 0 ? (
              <p className="text-xs text-fg/40 py-1">{t("config.weeklyReport.noRecipients")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((r) => (
                  <span key={r} className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg border border-border bg-fg/[0.03] text-xs text-fg/80">
                    {r}
                    <button
                      type="button"
                      onClick={() => removeRecipient(r)}
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
                placeholder={t("config.weeklyReport.emailPlaceholder")}
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

          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-fg/40">
              {t("config.weeklyReport.checkIt")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { void preview("WEEKLY_OPENING"); }} disabled={previewing}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-fg/70 hover:text-fg hover:bg-fg/5 transition-all flex items-center gap-1.5 disabled:opacity-50">
                {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                {t("config.weeklyReport.previewMonday")}
              </button>
              <button type="button" onClick={() => { void preview("WEEKLY_CLOSING"); }} disabled={previewing}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-fg/70 hover:text-fg hover:bg-fg/5 transition-all flex items-center gap-1.5 disabled:opacity-50">
                {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                {t("config.weeklyReport.previewFriday")}
              </button>
              <button type="button" onClick={() => { void sendTest("WEEKLY_OPENING"); }} disabled={sending}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-fg/70 hover:text-fg hover:bg-fg/5 transition-all flex items-center gap-1.5 disabled:opacity-50">
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {t("config.weeklyReport.sendTest")}
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
        </div>
      )}

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </section>
  );
};
