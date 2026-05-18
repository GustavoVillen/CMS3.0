import React, { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api";
import {
  LayoutDashboard, Ship, SlidersHorizontal, ClipboardList, Wrench, FileText,
  AlertTriangle, Clock, ShieldCheck, Microscope, Package, Truck,
  UsersRound, UserCircle, ScrollText, ChevronLeft, ChevronRight, ChevronDown, Gauge, Bot,
  FlaskConical, FileBarChart, Activity, Users, CalendarCheck, ShieldAlert,
  ClipboardCheck, AlertOctagon, ListChecks, Grid3x3, GitBranch,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useResizable } from "../lib/hooks";
import { useT, type TranslationKey } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";

interface SidebarCounts {
  // Fase 1
  workOrdersOpen: number; defectsOpen: number; deferralsOpen: number; capaOpen: number;
  certsExpiringOrExpired: number; nearMissOpen: number; restHoursViolations: number;
  externalAuditsFindingsOpen: number; mocOpen: number;
  // Fase 2 — "acciones requeridas" en el resto del sidebar
  maintenancePlansOverdue: number; dailyReportsMissing: number;
  fluidAnalysisCritical: number; spareRequestsPending: number;
  cviqFindingsOpen: number; checklistsOverdue: number;
  permitsAttention: number; crewCertsAttention: number;
  drillsOverdue: number; sparesCriticalLow: number; providerNcOpen: number;
}

/** Mapeo path → key del counts object para mostrar badge.
 *  Todos los badges usan el mismo estilo ámbar — el badge sólo indica "hay
 *  acciones pendientes". La criticidad real del item se ve dentro de la pantalla. */
const BADGE_KEY: Record<string, keyof SidebarCounts> = {
  // Fase 1
  "/work-orders":      "workOrdersOpen",
  "/defects":          "defectsOpen",
  "/deferrals":        "deferralsOpen",
  "/capa":             "capaOpen",
  "/certificates":     "certsExpiringOrExpired",
  "/near-miss":        "nearMissOpen",
  "/rest-hours":       "restHoursViolations",
  "/external-audits":  "externalAuditsFindingsOpen",
  "/moc":              "mocOpen",
  // Fase 2
  "/maintenance-plans": "maintenancePlansOverdue",
  "/daily-reports":     "dailyReportsMissing",
  "/fluid-analyses":    "fluidAnalysisCritical",
  "/spare-requests":    "spareRequestsPending",
  "/cviq":              "cviqFindingsOpen",
  "/checklists":        "checklistsOverdue",
  "/permits":           "permitsAttention",
  "/crew":              "crewCertsAttention",
  "/drills":            "drillsOverdue",
  "/spares":            "sparesCriticalLow",
  "/providers":         "providerNcOpen",
};

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
      { icon: GitBranch,       labelKey: "nav.moc",              path: "/moc" },
      { icon: ShieldCheck,     labelKey: "nav.cviq",             path: "/cviq" },
      { icon: AlertOctagon,    labelKey: "nav.nearMiss",         path: "/near-miss" },
      { icon: ClipboardCheck,  labelKey: "nav.externalAudits",   path: "/external-audits" },
      { icon: ListChecks,      labelKey: "nav.checklists",       path: "/checklists" },
      { icon: ShieldAlert,     labelKey: "nav.permits",          path: "/permits" },
    ],
  },
  {
    titleKey: "nav.section.crew",
    items: [
      { icon: Users,           labelKey: "nav.crew",             path: "/crew" },
      { icon: CalendarCheck,   labelKey: "nav.drills",           path: "/drills" },
      { icon: Clock,           labelKey: "nav.restHours",        path: "/rest-hours" },
      { icon: Grid3x3,         labelKey: "nav.crewMatrix",       path: "/crew-matrix" },
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
  const { selectedVesselCode } = useVesselContext();
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

  // ── Sections expand/collapse state (persisted) ────────────────────────────
  // Default: todas las secciones expandidas.
  const [sectionsCollapsed, setSectionsCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("gpms_sidebar_sections") ?? "{}"); }
    catch { return {}; }
  });
  const toggleSection = (key: string) => {
    setSectionsCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("gpms_sidebar_sections", JSON.stringify(next));
      return next;
    });
  };

  // ── Sidebar counts (badges) — refreshed when vessel context changes ───────
  const [counts, setCounts] = useState<SidebarCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
    const fetchCounts = () => {
      api.get<SidebarCounts>(`/app/dashboard/sidebar-counts${qs}`)
        .then(c => { if (!cancelled) setCounts(c); })
        .catch(() => { /* silent */ });
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 120_000); // refresh cada 2 min
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedVesselCode]);

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

          // Suma de badges del header de la sección — para mostrar contador
          // agregado cuando la sección está colapsada.
          const sectionTotal = counts
            ? visible.reduce((acc, item) => {
                const key = BADGE_KEY[item.path];
                return key ? acc + (counts[key] ?? 0) : acc;
              }, 0)
            : 0;
          const isSectionCollapsed = !collapsed && !!sectionsCollapsed[section.titleKey];

          return (
            <div key={section.titleKey}>
              {/* Section header (clickeable cuando el sidebar está expandido) */}
              {collapsed ? (
                <div className="mx-3 border-t border-white/10 mb-2" />
              ) : (
                <button
                  onClick={() => toggleSection(section.titleKey)}
                  className="w-full px-4 mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/25 hover:text-white/60 transition-colors select-none"
                >
                  <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isSectionCollapsed ? "-rotate-90" : ""}`} />
                  <span>{t(section.titleKey)}</span>
                  {isSectionCollapsed && sectionTotal > 0 && (
                    <span className="ml-auto px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-[9px] font-bold normal-case tracking-normal">
                      {sectionTotal}
                    </span>
                  )}
                </button>
              )}

              {/* Items */}
              {!isSectionCollapsed && (
                <div className={collapsed ? "space-y-0.5" : "px-2 space-y-0.5"}>
                  {visible.map(item => {
                    const label = t(item.labelKey);
                    const badgeKey = BADGE_KEY[item.path];
                    const badge = badgeKey && counts ? counts[badgeKey] : 0;
                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.end}
                        title={collapsed ? `${label}${badge > 0 ? ` (${badge})` : ""}` : undefined}
                        className={({ isActive }) => navItemCls(isActive, collapsed)}
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="text-xs font-medium truncate flex-1">{label}</span>
                            {badge > 0 && (
                              <span className="shrink-0 ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-accent/15 text-accent border border-accent/30">
                                {badge > 99 ? "99+" : badge}
                              </span>
                            )}
                          </>
                        )}
                        {collapsed && badge > 0 && (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
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
