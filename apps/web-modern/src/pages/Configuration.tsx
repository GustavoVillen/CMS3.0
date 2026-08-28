import React, { useEffect, useState } from "react";
import { SlidersHorizontal, CheckCircle, AlertCircle, Loader2, Lock } from "lucide-react";
import { ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";
import { NAV, LOCKED_NAV_PATHS } from "../lib/nav-items";
import { fetchHiddenNavPaths, saveHiddenNavPaths } from "../lib/nav-config";
import { WeeklyReportSettings } from "../components/WeeklyReportSettings";
import { useAuth } from "../lib/auth";

export const ConfigurationPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";

  const [hidden, setHidden] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHiddenNavPaths()
      .then(setHidden)
      .finally(() => setLoading(false));
  }, []);

  const isVisible = (path: string) => !hidden.includes(path);

  const toggle = (path: string) => {
    if (LOCKED_NAV_PATHS.has(path)) return; // no se puede ocultar
    setSuccess(false);
    setHidden((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  };

  const enableAll = () => { setSuccess(false); setHidden([]); };

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const saved = await saveHiddenNavPaths(hidden);
      setHidden(saved);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("config.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader icon={SlidersHorizontal} title={t("page.configuration")} />

      <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-fg">{t("config.navTitle")}</h3>
            <p className="text-xs text-fg/50 mt-1 max-w-xl">{t("config.navSubtitle")}</p>
          </div>
          <button
            onClick={enableAll}
            className="text-xs px-3 py-1.5 rounded-lg border border-border text-fg/60 hover:text-fg hover:bg-fg/5 transition-all shrink-0"
          >
            {t("config.enableAll")}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-fg/40 text-sm py-6">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : (
          <div className="space-y-5">
            {NAV.map((section) => (
              <div key={section.titleKey}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-fg/40 mb-2">
                  {t(section.titleKey)}
                </p>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {section.items.map((item) => {
                    const locked = LOCKED_NAV_PATHS.has(item.path);
                    const visible = isVisible(item.path);
                    return (
                      <label
                        key={item.path}
                        className={[
                          "flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all select-none",
                          locked
                            ? "border-transparent opacity-60 cursor-default"
                            : "border-border hover:bg-fg/5 cursor-pointer",
                        ].join(" ")}
                        title={locked ? t("config.locked") : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={locked ? true : visible}
                          disabled={locked}
                          onChange={() => toggle(item.path)}
                          className="w-4 h-4 rounded accent-accent shrink-0"
                        />
                        <item.icon className="w-4 h-4 shrink-0 text-fg/50" />
                        <span className="text-xs font-medium text-fg/80 flex-1 truncate">
                          {t(item.labelKey)}
                        </span>
                        {locked && <Lock className="w-3 h-3 shrink-0 text-fg/30" />}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("config.save")}
          </button>
          {success && (
            <span className="flex items-center gap-1.5 text-xs text-success-sea font-medium">
              <CheckCircle className="w-4 h-4" /> {t("config.saved")}
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1.5 text-xs text-danger font-medium">
              <AlertCircle className="w-4 h-4" /> {error}
            </span>
          )}
        </div>
      </section>

      {/* El backend vuelve a chequear el rol: esto solo evita mostrar controles
          que el usuario no puede usar. */}
      {isAdmin && <WeeklyReportSettings />}
    </div>
  );
};
