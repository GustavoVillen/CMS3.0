import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Ship, Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";

export const Login: React.FC = () => {
  const { login, loading, error, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ tenantSlug: "demo", identifier: "", password: "" });

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(form.tenantSlug, form.identifier, form.password);
  };

  return (
    <div className="min-h-screen bg-primary-bg flex items-center justify-center p-4">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }}
      />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20">
            <Ship className="text-primary-bg w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">GPMS Naval</h1>
            <p className="text-xs text-text-industrial/40 tracking-widest uppercase">Industrial Edition</p>
          </div>
        </div>

        {/* Card */}
        <div className="bento-card">
          <h2 className="text-lg font-bold text-white mb-1">Iniciar sesión</h2>
          <p className="text-sm text-text-industrial/50 mb-8">Accede a tu espacio de gestión naval</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Empresa / Tenant</label>
              <input
                type="text"
                value={form.tenantSlug}
                onChange={e => setForm(f => ({ ...f, tenantSlug: e.target.value }))}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="demo"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Email / Usuario</label>
              <input
                type="text"
                value={form.identifier}
                onChange={e => setForm(f => ({ ...f, identifier: e.target.value }))}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="usuario@empresa.local"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-industrial/60 mb-1.5 uppercase tracking-wider">Contraseña</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-accent text-primary-bg font-bold text-sm hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</> : "Ingresar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-industrial/20 mt-6">
          GPMS Naval Industrial · Gestión de Flota
        </p>
      </div>
    </div>
  );
};
