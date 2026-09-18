// Archivo automático de PDFs en Google Drive (Configuración → sección).
// Sólo TENANT_ADMIN: la pantalla no la renderiza para otros roles y el backend
// lo vuelve a chequear. El admin conecta la cuenta de Google de la empresa con
// un botón; no hay URLs ni claves que copiar (ver docs/drive-archive/).

import React, { useEffect, useState } from "react";
import { FolderUp, Loader2, CheckCircle, Link2, Unlink, ExternalLink, PlugZap, AlertTriangle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { AlertDialog } from "./AlertDialog";
import { ConfirmDialog } from "./ConfirmDialog";

const KINDS = ["OT", "SS", "DEF", "FA", "APL", "VAR", "REQ", "MOC", "PLAN", "OTHER"] as const;
type Kind = (typeof KINDS)[number];

interface PdfArchiveConfig {
  available: boolean;
  enabled: boolean;
  connected: boolean;
  account: string | null;
  folderUrl: string | null;
  folders: Record<Kind, string>;
  lastError: string | null;
  lastErrorAt: string | null;
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-xs text-fg placeholder:text-fg/30 focus:outline-none focus:border-accent/50";
const secondaryBtn =
  "px-3 py-1.5 rounded-lg border border-border text-xs text-fg/70 hover:text-fg hover:bg-fg/5 transition-all flex items-center gap-1.5 disabled:opacity-50 shrink-0";

export const PdfArchiveSettings: React.FC = () => {
  const t = useT();

  const [config, setConfig] = useState<PdfArchiveConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const flash = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  useEffect(() => {
    api.get<PdfArchiveConfig>("/app/tenant/pdf-archive-config")
      .then(setConfig)
      .catch((e) => setAlert(e instanceof ApiError ? e.message : t("config.saveError")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vuelta de Google: el backend redirige acá con el resultado en la URL.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("drive");
    if (!result) return;
    if (result === "ok") flash(t("config.pdfArchive.connected"));
    else setAlert(t(result === "cancelado" ? "config.pdfArchive.connectCancelled" : "config.pdfArchive.connectError"));
    const url = new URL(window.location.href);
    url.searchParams.delete("drive");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<PdfArchiveConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setSuccess(null);
  };

  async function save() {
    if (!config) return;
    setSaving(true);
    setSuccess(null);
    try {
      const saved = await api.patch<PdfArchiveConfig>("/app/tenant/pdf-archive-config", {
        enabled: config.enabled,
        folders: config.folders,
      });
      setConfig(saved);
      setDirty(false);
      flash(t("config.saved"));
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("config.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setSuccess(null);
    try {
      const { url } = await api.post<{ url: string }>("/app/tenant/pdf-archive/google/start", {});
      window.location.href = url;
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("config.pdfArchive.connectError"));
      setConnecting(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      setConfig(await api.post<PdfArchiveConfig>("/app/tenant/pdf-archive/google/disconnect", {}));
      setDirty(false);
      flash(t("config.pdfArchive.disconnected"));
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("config.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (dirty) { setAlert(t("config.pdfArchive.saveFirst")); return; }
    setTesting(true);
    setSuccess(null);
    try {
      await api.post("/app/tenant/pdf-archive-config/test", {});
      setConfig((prev) => (prev ? { ...prev, lastError: null, lastErrorAt: null } : prev));
      flash(t("config.pdfArchive.testOk"));
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : t("config.pdfArchive.testError"));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-fg flex items-center gap-2">
          <FolderUp className="w-4 h-4 text-accent" /> {t("config.pdfArchive.title")}
        </h3>
        <p className="text-xs text-fg/50 mt-1 max-w-xl">{t("config.pdfArchive.subtitle")}</p>
      </div>

      {loading || !config ? (
        <div className="flex items-center gap-2 text-fg/40 text-sm py-6">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />} {loading ? t("common.loading") : null}
        </div>
      ) : (
        <div className="space-y-4">
          {config.lastError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-warning/30 bg-warning/5 text-xs text-fg/80">
              <AlertTriangle className="w-4 h-4 shrink-0 text-warning mt-0.5" />
              <span>
                <b>{t("config.pdfArchive.lastError")}</b>
                {config.lastErrorAt && ` (${new Date(config.lastErrorAt).toLocaleString()})`}: {config.lastError}
              </span>
            </div>
          )}

          {/* Cuenta de Google: un botón, sin URLs ni claves. */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            {config.connected ? (
              <>
                <p className="text-xs text-fg/80 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-success-sea shrink-0" />
                  {t("config.pdfArchive.connectedAs")} <b className="text-fg">{config.account ?? t("config.pdfArchive.googleAccount")}</b>
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {config.folderUrl && (
                    <a href={config.folderUrl} target="_blank" rel="noreferrer" className={secondaryBtn}>
                      <ExternalLink className="w-3.5 h-3.5" /> {t("config.pdfArchive.openFolder")}
                    </a>
                  )}
                  <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={saving} className={secondaryBtn}>
                    <Unlink className="w-3.5 h-3.5" /> {t("config.pdfArchive.disconnect")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-fg/60">
                  {config.available ? t("config.pdfArchive.connectHint") : t("config.pdfArchive.unavailable")}
                </p>
                <button
                  type="button"
                  onClick={() => { void connect(); }}
                  disabled={connecting || !config.available}
                  className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {t("config.pdfArchive.connect")}
                </button>
              </>
            )}
          </div>

          <label
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border select-none ${
              config.connected ? "hover:bg-fg/5 cursor-pointer" : "opacity-50 cursor-not-allowed"
            }`}
          >
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={!config.connected}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="w-4 h-4 rounded accent-accent shrink-0"
            />
            <span className="text-xs font-medium text-fg/80">{t("config.pdfArchive.enable")}</span>
          </label>

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-fg/40">{t("config.pdfArchive.folders")}</p>
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-2">
              {KINDS.map((kind) => (
                <label key={kind} className="space-y-1">
                  <span className="block text-[11px] text-fg/60">{t(`config.pdfArchive.folder.${kind}`)}</span>
                  <input
                    type="text"
                    maxLength={100}
                    value={config.folders[kind] ?? ""}
                    onChange={(e) => update({ folders: { ...config.folders, [kind]: e.target.value } })}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-border flex-wrap">
            <button
              onClick={() => { void save(); }}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("config.save")}
            </button>
            <button type="button" onClick={() => { void test(); }} disabled={testing || !config.connected} className={secondaryBtn}>
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
              {t("config.pdfArchive.test")}
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
      {confirmDisconnect && (
        <ConfirmDialog
          message={t("config.pdfArchive.disconnectConfirm")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => { setConfirmDisconnect(false); void disconnect(); }}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
    </section>
  );
};
