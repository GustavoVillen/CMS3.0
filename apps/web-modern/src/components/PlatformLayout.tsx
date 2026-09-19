import React, { Suspense } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { PageLoader } from "./PageLoader";
import { ShieldCheck, Building2, Users, ScrollText, Activity, MessageSquare, MessageCircleQuestion, LogOut, ChevronRight, Map, Radar, Fingerprint, Menu, MoreHorizontal } from "lucide-react";
import { usePlatformAuth } from "../lib/platform-auth";
import { ModalCloseButton } from "./ModalCloseButton";

// `short` es el rótulo de la barra inferior del celular, donde no entra el largo.
const NAV = [
  { icon: Building2,    label: "Tenants",        short: "Empresas",  path: "/platform/tenants" },
  { icon: Users,        label: "Platform Users",  short: "Usuarios",  path: "/platform/users" },
  { icon: Radar,        label: "Accesos",         short: "Accesos",   path: "/platform/access" },
  { icon: Fingerprint,  label: "Auditoría usuario", short: "Auditoría", path: "/platform/user-activity" },
  { icon: ScrollText,   label: "Audit Events",    short: "Eventos",   path: "/platform/audit" },
  { icon: Activity,     label: "Consumo IA + Sat", short: "Consumo",  path: "/platform/usage" },
  { icon: MessageCircleQuestion, label: "Preguntas Copiloto", short: "Preguntas", path: "/platform/copilot-questions" },
  { icon: Map,          label: "Mapa Buques",      short: "Mapa",     path: "/platform/vessel-map" },
  { icon: MessageSquare,label: "Prompts",         short: "Prompts",   path: "/platform/prompts" },
];

// Accesos directos de la barra inferior en el celular; el resto va en "Más".
const BOTTOM_NAV = ["/platform/tenants", "/platform/access", "/platform/user-activity", "/platform/usage"];

const Brand: React.FC = () => (
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center">
      <ShieldCheck className="text-red-700 dark:text-red-400 w-4 h-4" />
    </div>
    <div>
      <p className="text-xs font-bold text-fg">Super Admin</p>
      <p className="text-[10px] text-text-industrial/40">CMS3.0 Platform</p>
    </div>
  </div>
);

export const PlatformLayout: React.FC = () => {
  const { user, logout } = usePlatformAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Al elegir una pantalla desde el menú del celular, el menú se cierra solo.
  React.useEffect(() => { setMenuOpen(false); }, [pathname]);

  const handleLogout = () => { logout(); navigate("/platform/login", { replace: true }); };

  const navItems = (
    <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
      {NAV.map(item => (
        <NavLink key={item.path} to={item.path}
          className={({ isActive }) =>
            `flex items-center justify-between px-3 py-3 md:py-2 rounded-lg transition-all duration-150 group text-sm md:text-xs font-medium ${
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
  );

  const account = (
    <div className="p-3 border-t border-red-500/10 space-y-2">
      <div className="px-3 py-2">
        <p className="text-[10px] text-text-industrial/30 truncate">{user?.email}</p>
        <p className="text-[10px] text-red-700 dark:text-red-400 font-bold">{user?.role}</p>
      </div>
      <button onClick={handleLogout}
        className="w-full flex items-center gap-2 px-3 py-3 md:py-2 rounded-lg text-sm md:text-xs text-red-700 dark:text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all">
        <LogOut className="w-3.5 h-3.5" /> Cerrar sesión
      </button>
    </div>
  );

  const inBottomNav = BOTTOM_NAV.includes(pathname);

  return (
    <div className="flex h-dvh bg-primary-bg text-text-industrial overflow-hidden">
      {/* Sidebar (escritorio) */}
      <aside className="hidden md:flex w-56 h-full border-r border-red-500/10 flex-col bg-primary-bg/80 shrink-0">
        <div className="p-5 border-b border-red-500/10"><Brand /></div>
        {navItems}
        {account}
      </aside>

      {/* Menú completo (celular) */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex">
          <aside className="w-[82%] max-w-xs h-full bg-surface dark:bg-[#0A1020] border-r border-fg/10 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-red-500/10">
              <Brand />
              <ModalCloseButton onClose={() => setMenuOpen(false)} />
            </div>
            {navItems}
            {account}
          </aside>
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-red-500/10 flex items-center gap-2 px-2 md:px-6 bg-primary-bg/30 backdrop-blur-md shrink-0 relative z-50">
          <button onClick={() => setMenuOpen(true)} aria-label="Menú"
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-xl text-text-industrial/60 hover:bg-fg/5">
            <Menu className="w-5 h-5" />
          </button>
          <div className="md:hidden"><Brand /></div>
          <span className="hidden md:inline text-xs text-red-700 dark:text-red-400/60 font-mono">PLATFORM ADMIN CONSOLE</span>
        </header>
        <main className="flex-1 overflow-y-auto p-3 md:p-6 bg-surface dark:bg-[#080D1D]">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>

        {/* Barra inferior (celular) */}
        <nav className="md:hidden flex border-t border-fg/10 bg-surface dark:bg-[#0A1020] shrink-0 pb-[env(safe-area-inset-bottom)]">
          {BOTTOM_NAV.map(path => {
            const item = NAV.find(n => n.path === path)!;
            return (
              <NavLink key={path} to={path}
                className={({ isActive }) =>
                  `flex-1 min-h-14 flex flex-col items-center justify-center gap-1 text-[10px] ${isActive ? "text-red-700 dark:text-red-400 font-bold" : "text-text-industrial/50"}`
                }
              >
                <item.icon className="w-5 h-5" />
                {item.short}
              </NavLink>
            );
          })}
          <button onClick={() => setMenuOpen(true)}
            className={`flex-1 min-h-14 flex flex-col items-center justify-center gap-1 text-[10px] ${!inBottomNav ? "text-red-700 dark:text-red-400 font-bold" : "text-text-industrial/50"}`}>
            <MoreHorizontal className="w-5 h-5" />
            Más
          </button>
        </nav>
      </div>
    </div>
  );
};
