import React, { useState } from "react";
import {
  LayoutDashboard, Ship, Settings, ClipboardList, Wrench, FileText,
  AlertTriangle, Clock, ShieldCheck, Microscope, Sparkles,
  Package, Truck, ChevronRight, ShoppingCart, Bot,
  UsersRound, SlidersHorizontal, ChevronDown, UserCircle, ScrollText,
  CalendarRange,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useAuth } from "../lib/auth";
import { useT, type TranslationKey } from "../lib/i18n";
import { useResizable } from "../lib/hooks";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type NavItem = {
  icon: React.ElementType;
  labelKey: TranslationKey;
  path: string;
  special?: true;
};

const MAIN_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, labelKey: "nav.dashboard",        path: "/" },
  { icon: ClipboardList,   labelKey: "nav.maintenancePlans", path: "/maintenance-plans" },
  { icon: CalendarRange,   labelKey: "nav.maintenanceGantt", path: "/maintenance-gantt" },
  { icon: Wrench,          labelKey: "nav.workOrders",       path: "/work-orders" },
  { icon: FileText,        labelKey: "nav.dailyReports",     path: "/daily-reports" },
  { icon: AlertTriangle,   labelKey: "nav.defects",          path: "/defects" },
  { icon: Clock,           labelKey: "nav.deferrals",        path: "/deferrals" },
  { icon: Microscope,      labelKey: "nav.rca",              path: "/rca" },
  { icon: Microscope,      labelKey: "nav.capa",             path: "/capa" },
  { icon: FileText,        labelKey: "nav.certificates",     path: "/certificates" },
  { icon: ShoppingCart,    labelKey: "nav.spareOrders",      path: "/spare-orders" },
  { icon: Sparkles,        labelKey: "nav.aiInsights",       path: "/ai-insights", special: true },
  { icon: Bot,             labelKey: "nav.aiDocuments",      path: "/ai-documents", special: true },
];

const CONFIG_ITEMS: NavItem[] = [
  { icon: Ship,          labelKey: "nav.vessels",          path: "/vessels" },
  { icon: Settings,      labelKey: "nav.assets",           path: "/assets" },
  { icon: Package,       labelKey: "nav.spares",           path: "/spares" },
  { icon: Truck,      labelKey: "nav.providers", path: "/providers" },
  { icon: UsersRound, labelKey: "nav.team",      path: "/team" },
];

const CONFIG_PATHS = new Set(CONFIG_ITEMS.map(i => i.path));

export const Sidebar: React.FC = () => {
  const { tenant, user } = useAuth();
  const t = useT();
  const location = useLocation();
  const { width, startResize } = useResizable("gpms_sidebar_width", 240, 160, 360);

  const configActive = CONFIG_PATHS.has(location.pathname);
  const [configOpen, setConfigOpen] = useState(configActive);

  return (
    <aside
      className="relative z-70 h-screen border-r border-white/10 flex flex-col bg-primary-bg/50 backdrop-blur-xl shrink-0 overflow-hidden"
      style={{ width }}
    >
      {/* Logo */}
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <Ship className="text-primary-bg w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-white">GPMS Naval</span>
            {tenant && <p className="text-[10px] text-text-industrial/40 leading-tight truncate max-w-[120px]">{tenant.name}</p>}
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {/* Main items */}
        {MAIN_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) => cn(
              "flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-150 group",
              isActive
                ? "bg-accent/10 text-accent border border-accent/20"
                : "text-text-industrial/60 hover:text-white hover:bg-white/5",
              item.special && !isActive && "text-accent/80",
            )}
          >
            <div className="flex items-center gap-2.5">
              <item.icon className={cn("w-4 h-4 shrink-0", item.special ? "text-accent" : "")} />
              <span className="text-xs font-medium">{t(item.labelKey)}</span>
            </div>
            <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-30 transition-opacity" />
          </NavLink>
        ))}

        {/* Bitácora — solo TENANT_ADMIN */}
        {user?.role === "TENANT_ADMIN" && (
          <NavLink
            to="/bitacora"
            className={({ isActive }) => cn(
              "flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-150 group",
              isActive
                ? "bg-accent/10 text-accent border border-accent/20"
                : "text-text-industrial/60 hover:text-white hover:bg-white/5",
            )}
          >
            <div className="flex items-center gap-2.5">
              <ScrollText className="w-4 h-4 shrink-0" />
              <span className="text-xs font-medium">Bitácora</span>
            </div>
            <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-30 transition-opacity" />
          </NavLink>
        )}

        {/* Configuración group */}
        <div className="pt-1">
          <button
            onClick={() => setConfigOpen(o => !o)}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-150",
              configActive
                ? "bg-accent/10 text-accent border border-accent/20"
                : "text-text-industrial/60 hover:text-white hover:bg-white/5",
            )}
          >
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="w-4 h-4 shrink-0" />
              <span className="text-xs font-medium">Configuración</span>
            </div>
            <ChevronDown className={cn(
              "w-3 h-3 transition-transform duration-200",
              configOpen ? "rotate-180" : "",
            )} />
          </button>

          {configOpen && (
            <div className="mt-0.5 ml-3 pl-3 border-l border-white/10 space-y-0.5">
              {CONFIG_ITEMS.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => cn(
                    "flex items-center justify-between px-3 py-1.5 rounded-lg transition-all duration-150 group",
                    isActive
                      ? "bg-accent/10 text-accent border border-accent/20"
                      : "text-text-industrial/50 hover:text-white hover:bg-white/5",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <item.icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs font-medium">{t(item.labelKey)}</span>
                  </div>
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-30 transition-opacity" />
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className="p-3 border-t border-white/10 space-y-2">
        <NavLink
          to="/profile"
          className={({ isActive }) => cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-150",
            isActive
              ? "bg-accent/10 text-accent border border-accent/20"
              : "text-text-industrial/60 hover:text-white hover:bg-white/5",
          )}
        >
          <UserCircle className="w-4 h-4 shrink-0" />
          <span className="text-xs font-medium">{t("nav.profile")}</span>
        </NavLink>
        <div className="p-3 rounded-xl bg-linear-to-br from-accent/10 to-transparent border border-accent/10">
          <p className="text-[10px] uppercase tracking-widest text-accent font-bold mb-1">{t("nav.status")}</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success-sea animate-pulse" />
            <span className="text-xs text-text-industrial/60">{t("nav.statusOk")}</span>
          </div>
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10 group"
        onMouseDown={(e) => startResize(e, "right")}
      >
        <div className="absolute right-0 top-0 h-full w-px bg-white/10 group-hover:bg-accent/50 transition-colors duration-150" />
      </div>
    </aside>
  );
};
