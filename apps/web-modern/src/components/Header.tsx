import React, { useState } from "react";
import { Bell, User, LogOut, ChevronDown, Ship } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useNavigate } from "react-router-dom";

export const Header: React.FC<{ title: string }> = ({ title }) => {
  const { user, tenant, logout } = useAuth();
  const { vessels, selectedVesselCode, setSelectedVesselCode } = useVesselContext();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const showSelector = vessels.length > 1;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-primary-bg/30 backdrop-blur-md shrink-0 relative z-50">
      <div className="flex items-center gap-4">
        {tenant && (
          <span className="flex items-center gap-2 text-sm font-semibold text-white/80 border border-white/15 rounded-full px-3 py-1.5">
            {(tenant.logoUrlLight || tenant.logoUrl) && (
              <img
                src={(tenant.logoUrlLight || tenant.logoUrl)!}
                alt=""
                className="w-5 h-5 object-contain shrink-0"
              />
            )}
            {tenant.name}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Global vessel selector */}
        {showSelector && (
          <div className="flex items-center gap-2 border border-white/10 rounded-full px-3 py-1.5 bg-white/3 hover:bg-white/5 transition-colors">
            <Ship className="w-3.5 h-3.5 text-accent shrink-0" />
            <select
              value={selectedVesselCode ?? ""}
              onChange={e => setSelectedVesselCode(e.target.value || null)}
              className="text-xs bg-transparent text-white focus:outline-none cursor-pointer appearance-none pr-1"
            >
              <option value="">Todos los buques</option>
              {vessels.map(v => (
                <option key={v.code} value={v.code}>{v.name}</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-text-industrial/40 shrink-0 pointer-events-none" />
          </div>
        )}

        <button className="relative p-2 rounded-full hover:bg-white/5 transition-colors">
          <Bell className="w-5 h-5 text-text-industrial/60" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-3 hover:bg-white/5 p-1 pr-3 rounded-full transition-all"
          >
            <div className="w-8 h-8 rounded-full bg-linear-to-br from-accent/30 to-white/5 border border-accent/20 flex items-center justify-center">
              <User className="w-4 h-4 text-accent" />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-white leading-tight">
                {user?.name ?? user?.identifier ?? "Usuario"}
              </span>
              <span className="text-[10px] text-text-industrial/50 leading-tight">
                {user?.role?.replace(/_/g, " ") ?? ""}
              </span>
            </div>
            <ChevronDown className={`w-3 h-3 text-text-industrial/40 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 w-48 bg-surface border border-white/10 rounded-xl shadow-2xl overflow-hidden z-200">
              <div className="px-4 py-3 border-b border-white/10">
                <p className="text-xs text-text-industrial/50 uppercase tracking-wider">Sesión activa</p>
                <p className="text-sm font-medium text-white mt-0.5">{tenant?.name}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
