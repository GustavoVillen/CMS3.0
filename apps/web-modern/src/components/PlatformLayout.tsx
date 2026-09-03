import React, { Suspense } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { PageLoader } from "./PageLoader";
import { ShieldCheck, Building2, Users, ScrollText, Activity, MessageSquare, MessageCircleQuestion, LogOut, ChevronRight, Map, Radar, Fingerprint } from "lucide-react";
import { usePlatformAuth } from "../lib/platform-auth";

const NAV = [
  { icon: Building2,    label: "Tenants",        path: "/platform/tenants" },
  { icon: Users,        label: "Platform Users",  path: "/platform/users" },
  { icon: Radar,        label: "Accesos",         path: "/platform/access" },
  { icon: Fingerprint,  label: "Auditoría usuario", path: "/platform/user-activity" },
  { icon: ScrollText,   label: "Audit Events",    path: "/platform/audit" },
  { icon: Activity,     label: "Consumo IA + Sat", path: "/platform/usage" },
  { icon: MessageCircleQuestion, label: "Preguntas Copiloto", path: "/platform/copilot-questions" },
  { icon: Map,          label: "Mapa Buques",      path: "/platform/vessel-map" },
  { icon: MessageSquare,label: "Prompts",         path: "/platform/prompts" },
];

export const PlatformLayout: React.FC = () => {
  const { user, logout } = usePlatformAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate("/platform/login", { replace: true }); };

  return (
    <div className="flex h-screen bg-primary-bg text-text-industrial overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 h-screen border-r border-red-500/10 flex flex-col bg-primary-bg/80 shrink-0">
        <div className="p-5 border-b border-red-500/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center">
              <ShieldCheck className="text-red-700 dark:text-red-400 w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-fg">Super Admin</p>
              <p className="text-[10px] text-text-industrial/40">CMS3.0 Platform</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(item => (
            <NavLink key={item.path} to={item.path}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-150 group text-xs font-medium ${
                  isActive ? "bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20" : "text-text-industrial/60 hover:text-fg hover:bg-fg/5"
                }`
              }
            >
              <div className="flex items-center gap-2.5">
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </div>
              <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-30 transition-opacity" />
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-red-500/10 space-y-2">
          <div className="px-3 py-2">
            <p className="text-[10px] text-text-industrial/30 truncate">{user?.email}</p>
            <p className="text-[10px] text-red-700 dark:text-red-400 font-bold">{user?.role}</p>
          </div>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-700 dark:text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all">
            <LogOut className="w-3.5 h-3.5" /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-red-500/10 flex items-center px-6 bg-primary-bg/30 backdrop-blur-md shrink-0 relative z-50">
          <span className="text-xs text-red-700 dark:text-red-400/60 font-mono">PLATFORM ADMIN CONSOLE</span>
        </header>
        <main className="flex-1 overflow-y-auto p-6 bg-surface dark:bg-[#080D1D]">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
};
