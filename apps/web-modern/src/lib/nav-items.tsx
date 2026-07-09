import React from "react";
import {
  LayoutDashboard, Ship, SlidersHorizontal, ClipboardList, Wrench, FileText,
  AlertTriangle, Clock, ShieldCheck, Package, Truck,
  UsersRound, ScrollText, Gauge, Bot,
  FlaskConical, FileBarChart, Activity, Users, CalendarCheck, ShieldAlert,
  ClipboardCheck, AlertOctagon, ListChecks, Grid3x3, GitBranch, HeartPulse, BadgeCheck,
  // Waypoints,  // DORMANTE: icono del módulo Modos de Falla (RCM) — reactivar junto con la ruta
} from "lucide-react";
import type { TranslationKey } from "./i18n";

// ---------------------------------------------------------------------------
// Estructura de navegación del menú lateral.
//
// Fuente única compartida por el Sidebar (render) y la página de Configuración
// (editor de visibilidad por tenant). No duplicar este array en otro lado.
// ---------------------------------------------------------------------------

export type Role = string;

export type NavItem = {
  icon: React.ElementType;
  labelKey: TranslationKey;
  path: string;
  end?: boolean;
  roles?: Role[];
};

export type NavSection = {
  titleKey: TranslationKey;
  items: NavItem[];
};

/** Paths que no se pueden ocultar desde Configuración (siempre visibles).
 *  Debe coincidir con LOCKED_PATHS del backend (nav-config-service.ts). */
export const LOCKED_NAV_PATHS: ReadonlySet<string> = new Set(["/", "/configuration"]);

export const NAV: NavSection[] = [
  {
    titleKey: "nav.section.operation",
    items: [
      { icon: LayoutDashboard, labelKey: "nav.dashboard",        path: "/",                   end: true },
      { icon: ClipboardList,   labelKey: "nav.maintenancePlans", path: "/maintenance-plans" },
      { icon: Activity,        labelKey: "nav.maintenanceWorkload", path: "/maintenance-workload" },
      { icon: HeartPulse,      labelKey: "nav.reliability",      path: "/reliability" },
      // DORMANTE — Modos de Falla (RCM): módulo listo pero oculto para no abrumar a
      // empresas que recién arrancan. Reactivar: descomentar la línea de abajo y el
      // import de `Waypoints`. Backend, página, tabla e i18n siguen intactos.
      // { icon: Waypoints,       labelKey: "nav.failureModes",     path: "/failure-modes" },
      { icon: Wrench,          labelKey: "nav.workOrders",       path: "/work-orders" },
      { icon: FileText,        labelKey: "nav.dailyReports",     path: "/daily-reports" },
      { icon: FileBarChart,    labelKey: "nav.monthlyReports",   path: "/reports" },
      { icon: BadgeCheck,      labelKey: "nav.tmsa",             path: "/tmsa",
        roles: ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"] },
      { icon: AlertTriangle,   labelKey: "nav.defects",          path: "/defects" },
      { icon: ScrollText,      labelKey: "nav.bitacora",         path: "/bitacora",
        roles: ["TENANT_ADMIN"] },
    ],
  },
  {
    titleKey: "nav.section.control",
    items: [
      { icon: Clock,           labelKey: "nav.deferrals",        path: "/deferrals" },
      // DORMANTE — CAPA: módulo oculto de la entrega (simplificación; el flujo correctivo
      // vive dentro del Defecto). Reactivar: descomentar esta línea + rutas /capa en App.tsx.
      // { icon: Microscope,      labelKey: "nav.capa",             path: "/capa" },
      { icon: ShieldCheck,     labelKey: "nav.certificates",     path: "/certificates" },
      { icon: FlaskConical,    labelKey: "nav.fluidAnalyses",    path: "/fluid-analyses" },
      { icon: Gauge,           labelKey: "nav.spareRequests",    path: "/spare-requests" },
      { icon: GitBranch,       labelKey: "nav.moc",              path: "/moc" },
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
      { icon: ClipboardList,     labelKey: "nav.requirementsMatrix", path: "/crew-requirements-matrix",
        roles: ["TENANT_ADMIN"] },
      { icon: SlidersHorizontal, labelKey: "nav.configuration",  path: "/configuration",
        roles: ["TENANT_ADMIN"] },
      { icon: UsersRound,        labelKey: "nav.team",           path: "/team",
        roles: ["TENANT_ADMIN", "FLEET_SUPERINTENDENT"] },
    ],
  },
];
