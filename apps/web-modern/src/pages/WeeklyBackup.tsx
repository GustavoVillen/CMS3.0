import React, { useEffect, useState } from "react";
import { Archive, AlertCircle, CheckCircle, Loader2, Send, Save, Mail } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { useT, type TranslationKey } from "../lib/i18n";

interface WeeklyBackupConfig {
  enabled: boolean;
  email: string | null;
  dayOfWeek: number;
  hourLocal: number;
  mailProviderConfigured: boolean;
  datasetLabels: string[];
}

interface WeeklyBackupRunSummary {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "SUCCESS" | "FAILED";
  recipientEmail: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
}

function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export const WeeklyBackupPage: React.FC = () => {
  const t = useT();

  const [config, setConfig] = useState<WeeklyBackupConfig | null>(null);
  const [runs, setRuns] = useState<WeeklyBackupRunSummary[]>([]);

  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [hourLocal, setHourLocal] = useState(3);

  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function loadConfig() {
    try {
      const c = await api.get<WeeklyBackupConfig>("/app/settings/weekly-backup");
      setConfig(c);
      setEnabled(c.enabled);
      setEmail(c.email ?? "");
      setDayOfWeek(c.dayOfWeek);
      setHourLocal(c.hourLocal);
    } catch {
      // ignore — surfacing here would be noise; failed fetch leaves form empty
    }
  }

  async function loadRuns() {
    try {
      const res = await api.get<{ items: WeeklyBackupRunSummary[] }>("/app/settings/weekly-backup/runs?limit=20");
      setRuns(res.items);
    } catch {
      setRuns([]);
    }
  }

  useEffect(() => {
    loadConfig();
    loadRuns();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const updated = await api.put<WeeklyBackupConfig>("/app/settings/weekly-backup", {
        enabled,
        email: email.trim() || null,
        dayOfWeek,
        hourLocal,
      });
      setConfig(updated);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    setRunMessage(null);
    try {
      const res = await api.post<{ status: "SUCCESS" | "FAILED"; errorMessage: string | null }>(
        "/app/settings/weekly-backup/run-now",
        {},
      );
      if (res.status === "SUCCESS") {
        setRunMessage({ kind: "ok", text: t("weeklyBackup.runOk") });
      } else {
        setRunMessage({ kind: "err", text: `${t("weeklyBackup.runFailed")}: ${res.errorMessage ?? ""}` });
      }
      await loadRuns();
    } catch (err) {
      setRunMessage({
        kind: "err",
        text: err instanceof ApiError ? err.message : t("weeklyBackup.runFailed"),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader icon={Archive} title={t("weeklyBackup.title")} />

      <div className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-6">
        <p className="text-xs text-text-industrial/70">{t("weeklyBackup.description")}</p>

        {config && !config.mailProviderConfigured && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200/90 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t("weeklyBackup.mailNotConfigured")}</span>
          </div>
        )}

        {/* Configuration */}
        <section className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Mail className="w-4 h-4 text-accent" />
            {t("weeklyBackup.title")}
          </h2>

          <form onSubmit={handleSave} className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 accent-accent"
              />
              <span className="text-xs text-white">{t("weeklyBackup.enabledLabel")}</span>
            </label>

            <div>
              <label className="block text-xs text-text-industrial/60 mb-1">{t("weeklyBackup.email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@example.com"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-industrial/60 mb-1">{t("weeklyBackup.dayOfWeek")}</label>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50"
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                    <option key={d} value={d}>
                      {t(`weeklyBackup.day.${d}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-industrial/60 mb-1">{t("weeklyBackup.hourLocal")}</label>
                <select
                  value={hourLocal}
                  onChange={(e) => setHourLocal(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50"
                >
                  {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-text-industrial/40">{t("weeklyBackup.timezoneNote")}</p>
              </div>
            </div>

            {saveError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                {saveError}
              </p>
            )}
            {savedOk && (
              <p className="text-xs text-green-400 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" />
                {t("weeklyBackup.savedOk")}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-primary-bg text-xs font-semibold hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {t("weeklyBackup.save")}
              </button>

              <button
                type="button"
                disabled={running || !config?.mailProviderConfigured}
                onClick={handleRunNow}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-semibold hover:bg-white/10 disabled:opacity-50 transition-colors"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {running ? t("weeklyBackup.running") : t("weeklyBackup.runNow")}
              </button>
            </div>

            {runMessage && (
              <p
                className={`text-xs flex items-center gap-1.5 ${
                  runMessage.kind === "ok" ? "text-green-400" : "text-red-400"
                }`}
              >
                {runMessage.kind === "ok" ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                {runMessage.text}
              </p>
            )}
          </form>
        </section>

        {/* Datasets included */}
        {config && config.datasetLabels.length > 0 && (
          <section className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-3">
            <h2 className="text-sm font-semibold text-white">{t("weeklyBackup.includes")}</h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-industrial/80">
              {config.datasetLabels.map((label) => (
                <li key={label} className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-accent/60" />
                  {label}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* History */}
        <section className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-white">{t("weeklyBackup.history")}</h2>
          {runs.length === 0 ? (
            <p className="text-xs text-text-industrial/50">{t("weeklyBackup.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-text-industrial/50 border-b border-white/10">
                    <th className="py-2 font-medium">{t("weeklyBackup.startedAt")}</th>
                    <th className="py-2 font-medium">{t("common.status")}</th>
                    <th className="py-2 font-medium">{t("weeklyBackup.recipient")}</th>
                    <th className="py-2 font-medium">{t("weeklyBackup.size")}</th>
                    <th className="py-2 font-medium">{t("weeklyBackup.error")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 last:border-0">
                      <td className="py-2 text-white/80 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                      <td className="py-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${
                            r.status === "SUCCESS"
                              ? "bg-green-500/10 text-green-400 border border-green-500/20"
                              : "bg-red-500/10 text-red-400 border border-red-500/20"
                          }`}
                        >
                          {r.status === "SUCCESS"
                            ? t("weeklyBackup.statusSuccess")
                            : t("weeklyBackup.statusFailed")}
                        </span>
                      </td>
                      <td className="py-2 text-white/70">{r.recipientEmail ?? "—"}</td>
                      <td className="py-2 text-white/70 whitespace-nowrap">{formatBytes(r.fileSizeBytes)}</td>
                      <td className="py-2 text-white/50 max-w-[260px] truncate" title={r.errorMessage ?? ""}>
                        {r.errorMessage ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
