import React, { useEffect, useState } from "react";
import { User, Lock, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { PasswordInput } from "../components/PasswordInput";

interface ProfileData {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  preferredLocale: string;
}

const LOCALES = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
];

export const ProfilePage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();

  // ── Info state ──────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [locale, setLocale]       = useState("es");
  const [infoSaving, setInfoSaving]   = useState(false);
  const [infoSuccess, setInfoSuccess] = useState(false);
  const [infoError, setInfoError]     = useState<string | null>(null);

  // ── Password state ──────────────────────────────────────────────────────────
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd]         = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving]   = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [pwdError, setPwdError]     = useState<string | null>(null);

  useEffect(() => {
    api.get<ProfileData>("/app/profile").then(data => {
      setProfile(data);
      setFirstName(data.firstName ?? "");
      setLastName(data.lastName ?? "");
      setLocale(data.preferredLocale ?? "es");
    }).catch(() => {});
  }, []);

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setInfoSaving(true);
    setInfoError(null);
    setInfoSuccess(false);
    try {
      const updated = await api.patch<ProfileData>("/app/profile", { firstName, lastName, preferredLocale: locale });
      setProfile(updated);
      setInfoSuccess(true);
      setTimeout(() => setInfoSuccess(false), 3000);
    } catch (err) {
      setInfoError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setInfoSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(false);
    if (newPwd !== confirmPwd) { setPwdError(t("profile.pwdMismatch")); return; }
    setPwdSaving(true);
    try {
      await api.post("/app/profile/change-password", { currentPassword: currentPwd, newPassword: newPwd });
      setPwdSuccess(true);
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      setTimeout(() => setPwdSuccess(false), 3000);
    } catch (err) {
      setPwdError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setPwdSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader icon={User} title={t("profile.title")} />

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6">

        {/* Personal info */}
        <section className="bg-fg/3 border border-fg/10 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
            <User className="w-4 h-4 text-accent" />
            Información personal
          </h2>

          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div>
              <label className="block text-xs text-text-industrial/60 mb-1">{t("profile.email")}</label>
              <input
                readOnly
                value={profile?.email ?? user?.email ?? ""}
                className="w-full bg-fg/3 border border-fg/10 rounded-lg px-3 py-2 text-sm text-text-industrial/40 cursor-not-allowed"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-industrial/60 mb-1">{t("profile.firstName")}</label>
                <input
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="block text-xs text-text-industrial/60 mb-1">{t("profile.lastName")}</label>
                <input
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-industrial/60 mb-1">{t("profile.locale")}</label>
              <select
                value={locale}
                onChange={e => setLocale(e.target.value)}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
              >
                {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>

            {infoError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />{infoError}
              </p>
            )}
            {infoSuccess && (
              <p className="text-xs text-green-400 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" />{t("profile.savedOk")}
              </p>
            )}

            <button
              type="submit"
              disabled={infoSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-primary-bg text-xs font-semibold hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {infoSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("profile.saveInfo")}
            </button>
          </form>
        </section>

        {/* Change password */}
        <section className="bg-fg/3 border border-fg/10 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
            <Lock className="w-4 h-4 text-accent" />
            {t("profile.changePassword")}
          </h2>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-xs text-text-industrial/60 mb-1">{t("profile.currentPwd")}</label>
              <PasswordInput
                value={currentPwd}
                onChange={e => setCurrentPwd(e.target.value)}
                required
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-industrial/60 mb-1">{t("profile.newPwd")}</label>
                <PasswordInput
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  required
                  minLength={8}
                  className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="block text-xs text-text-industrial/60 mb-1">{t("profile.confirmPwd")}</label>
                <PasswordInput
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  required
                  className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>

            {pwdError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />{pwdError}
              </p>
            )}
            {pwdSuccess && (
              <p className="text-xs text-green-400 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" />{t("profile.pwdChangedOk")}
              </p>
            )}

            <button
              type="submit"
              disabled={pwdSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-fg/5 border border-fg/10 text-fg text-xs font-semibold hover:bg-fg/10 disabled:opacity-50 transition-colors"
            >
              {pwdSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("profile.changePassword")}
            </button>
          </form>
        </section>

      </div>
    </div>
  );
};
