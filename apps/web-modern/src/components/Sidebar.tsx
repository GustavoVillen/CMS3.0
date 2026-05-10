import React, { useState, useEffect } from "react";
import { api } from "../lib/api";
import {
  LayoutDashboard, Ship, SlidersHorizontal, ClipboardList, Wrench, FileText,
  AlertTriangle, Clock, ShieldCheck, Microscope, Package, Truck,
  UsersRound, UserCircle, ScrollText, ChevronLeft, ChevronRight, Gauge, Bot,
  FlaskConical, FileBarChart, Activity,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useResizable } from "../lib/hooks";
import { useT, type TranslationKey } from "../lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = string;

type NavItem = {
  icon: React.ElementType;
  labelKey: TranslationKey;
  path: string;
  end?: boolean;
  roles?: Role[];
};

type NavSection = {
  titleKey: TranslationKey;
  items: NavItem[];
};

// ---------------------------------------------------------------------------
// Navigation structure
// ---------------------------------------------------------------------------

const NAV: NavSection[] = [
  {
    titleKey: "nav.section.operation",
    items: [
      { icon: LayoutDashboard, labelKey: "nav.dashboard",        path: "/",                   end: true },
      { icon: ClipboardList,   labelKey: "nav.maintenancePlans", path: "/maintenance-plans" },
      { icon: Activity,        labelKey: "nav.maintenanceWorkload", path: "/maintenance-workload" },
      { icon: Wrench,          labelKey: "nav.workOrders",       path: "/work-orders" },
      { icon: FileText,        labelKey: "nav.dailyReports",     path: "/daily-reports" },
      { icon: FileBarChart,    labelKey: "nav.monthlyReports",   path: "/reports" },
      { icon: AlertTriangle,   labelKey: "nav.defects",          path: "/defects" },
      { icon: ScrollText,      labelKey: "nav.bitacora",         path: "/bitacora",
        roles: ["TENANT_ADMIN"] },
    ],
  },
  {
    titleKey: "nav.section.control",
    items: [
      { icon: Clock,           labelKey: "nav.deferrals",        path: "/deferrals" },
      { icon: Microscope,      labelKey: "nav.capa",             path: "/capa" },
      { icon: ShieldCheck,     labelKey: "nav.certificates",     path: "/certificates" },
      { icon: FlaskConical,    labelKey: "nav.fluidAnalyses",    path: "/fluid-analyses" },
      { icon: Gauge,           labelKey: "nav.spareRequests",    path: "/spare-requests" },
    ],
  },
  {
    titleKey: "nav.section.masters",
    items: [
      { icon: Ship,              labelKey: "nav.vessels",        path: "/vessels" },
      { icon: SlidersHorizontal, labelKey: "nav.assets",         path: "/assets" },
      { icon: Package,           labelKey: "nav.spares",         path: "/spares" },
      { icon: Truck,             labelKey: "nav.providers",      path: "/providers" },
    ],
  },
  {
    titleKey: "nav.section.system",
    items: [
      { icon: Bot,               labelKey: "nav.aiDocuments",    path: "/ai-documents",
        roles: ["TENANT_ADMIN"] },
      { icon: SlidersHorizontal, labelKey: "nav.configuration",  path: "/configuration",
        roles: ["TENANT_ADMIN"] },
      { icon: UsersRound,        labelKey: "nav.team",           path: "/team",
        roles: ["TENANT_ADMIN", "FLEET_SUPERINTENDENT"] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function navItemCls(isActive: boolean, collapsed: boolean) {
  return [
    "flex items-center gap-2.5 rounded-lg transition-all duration-150 group relative",
    collapsed ? "justify-center px-0 py-2 mx-1" : "px-3 py-2",
    isActive
      ? "bg-accent/10 text-accent border border-accent/20"
      : "text-white/50 hover:text-white hover:bg-white/5 border border-transparent",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

const COLLAPSED_W = 56;

export const Sidebar: React.FC = () => {
  const { tenant, user } = useAuth();
  const t = useT();
  const { width, startResize } = useResizable("gpms_sidebar_width", 240, 160, 360);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("gpms_sidebar_collapsed") === "true",
  );

  const toggle = () =>
    setCollapsed(v => {
      const next = !v;
      localStorage.setItem("gpms_sidebar_collapsed", String(next));
      return next;
    });

  // ── My AI usage (this month) — polled every 60s ────────────────────────────
  const [aiUsage, setAiUsage] = useState<{ totalTokens: number; costUsd: number } | null>(null);
  useEffect(() => {
    let stopped = false;
    const fetchUsage = () => {
      api.get<{ totalTokens: number; costUsd: number }>("/app/me/ai-usage")
        .then(s => { if (!stopped) setAiUsage({ totalTokens: s.totalTokens, costUsd: s.costUsd }); })
        .catch(() => { /* silent — no badge if it fails */ });
    };
    fetchUsage();
    const id = setInterval(fetchUsage, 60_000);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  const fmtTok = (n: number): string => {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
  };
  const aiBadgeText = aiUsage ? `IA ${fmtTok(aiUsage.totalTokens)} tok` : null;
  const aiBadgeTitle = aiUsage ? `Consumo IA del mes — ${aiUsage.totalTokens.toLocaleString("es-AR")} tokens (~US$ ${aiUsage.costUsd.toFixed(4)})` : "";

  const effectiveWidth = collapsed ? COLLAPSED_W : width;

  return (
    <aside
      className="relative z-70 h-screen border-r border-white/10 flex flex-col bg-primary-bg/50 backdrop-blur-xl shrink-0 overflow-hidden"
      style={{ width: effectiveWidth, transition: "width 200ms ease" }}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className={`flex items-center border-b border-white/10 shrink-0 ${collapsed ? "flex-col gap-2 py-3 px-0" : "justify-between px-4 py-4"}`}>
        <div className={`flex flex-col gap-2 min-w-0 ${collapsed ? "items-center" : "flex-1"}`}>
          {/* Tenant — arriba */}
          {tenant && !collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              {(tenant.logoUrlLight || tenant.logoUrl) && (
                <img
                  src={(tenant.logoUrlLight || tenant.logoUrl)!}
                  alt=""
                  className="w-16 h-16 object-contain shrink-0"
                />
              )}
              <p className="text-sm font-bold text-white leading-tight truncate">{tenant.name}</p>
            </div>
          )}
          {tenant && collapsed && (tenant.logoUrlLight || tenant.logoUrl) && (
            <img
              src={(tenant.logoUrlLight || tenant.logoUrl)!}
              alt=""
              className="w-16 h-16 object-contain shrink-0"
            />
          )}
          {/* Sistema — abajo */}
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/logo-white.png"
              alt="CMS"
              className="shrink-0 object-contain"
              style={{ width: 16, height: 16 }}
            />
            {!collapsed && (
              <div className="min-w-0">
                <p className="font-bold text-[8px] tracking-widest text-teal-400 leading-tight uppercase">CMS · Copilot Management System</p>
              </div>
            )}
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          title={collapsed ? t("header.expandMenu") : t("header.collapseMenu")}
          className="w-6 h-6 flex items-center justify-center rounded-md text-white/30 hover:text-white hover:bg-white/10 transition-all shrink-0"
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 space-y-3">
        {NAV.map(section => {
          const visible = section.items.filter(
            item => !item.roles || item.roles.includes(user?.role ?? ""),
          );
          if (visible.length === 0) return null;

          return (
            <div key={section.titleKey}>
              {/* Section header */}
              {collapsed ? (
                <div className="mx-3 border-t border-white/10 mb-2" />
              ) : (
                <p className="px-4 mb-1 text-[10px] font-bold uppercase tracking-widest text-white/25 select-none">
                  {t(section.titleKey)}
                </p>
              )}

              {/* Items */}
              <div className={collapsed ? "space-y-0.5" : "px-2 space-y-0.5"}>
                {visible.map(item => {
                  const label = t(item.labelKey);
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.end}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) => navItemCls(isActive, collapsed)}
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      {!collapsed && (
                        <span className="text-xs font-medium truncate">{label}</span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className={`border-t border-white/10 shrink-0 ${collapsed ? "py-3 px-0" : "p-2"}`}>
        <NavLink
          to="/profile"
          title={collapsed ? t("nav.profile") : undefined}
          className={({ isActive }) => navItemCls(isActive, collapsed)}
        >
          <UserCircle className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="text-xs font-medium">{t("nav.profile")}</span>}
        </NavLink>

        {!collapsed && (
          <div className="mt-2 px-3 py-2 rounded-xl bg-linear-to-br from-accent/10 to-transparent border border-accent/10">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success-sea animate-pulse shrink-0" />
              <span className="text-[11px] text-white/40">{t("nav.statusOk")}</span>
              {aiBadgeText && user?.role === "TENANT_ADMIN" && (
                <span className="text-[10px] text-white/30 ml-auto" title={aiBadgeTitle}>
                  {aiBadgeText}
                </span>
              )}
            </div>
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center mt-2">
            <div className="w-2 h-2 rounded-full bg-success-sea animate-pulse" title={t("nav.statusOk")} />
          </div>
        )}
      </div>

      {/* ── Resize handle (expanded only) ────────────────────────────────── */}
      {!collapsed && (
        <div
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10 group"
          onMouseDown={e => startResize(e, "right")}
        >
          <div className="absolute right-0 top-0 h-full w-px bg-white/10 group-hover:bg-accent/50 transition-colors duration-150" />
        </div>
      )}
    </aside>
  );
};
