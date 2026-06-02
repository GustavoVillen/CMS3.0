import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import { usePlatformAuth } from "../../lib/platform-auth";
import { PasswordInput } from "../../components/PasswordInput";

export const PlatformLogin: React.FC = () => {
  const { login, loading, error, isAuthenticated } = usePlatformAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });

  useEffect(() => {
    if (isAuthenticated) navigate("/platform", { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login(form.email, form.password);
  };

  return (
    <div className="min-h-screen bg-primary-bg flex items-center justify-center p-4">
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }}
      />
      <div className="relative w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
            <ShieldCheck className="text-red-700 dark:text-red-400 w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-fg tracking-tight">Super Admin</h1>
            <p className="text-xs text-text-industrial/40 tracking-widest uppercase">GPMS Platform</p>
          </div>
        </div>

        <div className="bento-card">
          <h2 className="text-lg font-bold text-fg mb-1">Acceso restringido</h2>
          <p className="text-sm text-text-industrial/50 mb-8">Solo administradores de plataforma</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-4 py-3 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
                placeholder="admin@localhost" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Contraseña</label>
              <PasswordInput value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-4 py-3 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
                placeholder="••••••••" />
            </div>
            {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-red-500/80 text-fg font-bold text-sm hover:bg-red-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</> : "Ingresar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-industrial/20 mt-6">
          <a href="/" className="hover:text-text-industrial/40 transition-colors">← Volver al portal de tenant</a>
        </p>
      </div>
    </div>
  );
};
