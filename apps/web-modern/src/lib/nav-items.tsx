import React from "react";
import {
  LayoutDashboard, Ship, SlidersHorizontal, ClipboardList, Wrench,
  // FileText,  // DORMANTE: icono de Reportes Diarios — reactivar junto con la ruta
  AlertTriangle, Clock, ShieldCheck, Package, Truck,
  UsersRound, ScrollText, Gauge, Bot, Handshake,
  FlaskConical, FileBarChart, Users, CalendarCheck, ShieldAlert,
  ClipboardCheck, AlertOctagon, ListChecks, Grid3x3, GitBranch, BadgeCheck, CalendarRange, Fuel,
  SearchCheck,
  Timer,
  Anchor,
  // Waypoints,  // DORMANTE: icono del módulo Modos de Falla (RCM) — reactivar junto con la ruta
  // Activity,   // DORMANTE: icono del módulo Carga de Mantenimiento — reactivar junto con la ruta
  // HeartPulse, // DORMANTE: icono del módulo Confiabilidad — reactivar junto con la ruta
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
      { icon: BadgeCheck,      labelKey: "nav.tmsa",             path: "/tmsa",
        roles: ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"] },
      { icon: ClipboardList,   labelKey: "nav.maintenancePlans", path: "/maintenance-plans" },
      { icon: CalendarRange,   labelKey: "nav.maintenanceGantt", path: "/maintenance-gantt" },
      // DORMANTE — Carga de Mantenimiento: módulo oculto a pedido del usuario. Reactivar:
      // descomentar la línea de abajo + el import de `Activity` + la ruta en App.tsx.
      // { icon: Activity,        labelKey: "nav.maintenanceWorkload", path: "/maintenance-workload" },
      // DORMANTE — Confiabilidad: módulo oculto a pedido del usuario. Reactivar:
      // descomentar la línea de abajo + el import de `HeartPulse` + la ruta en App.tsx.
      // { icon: HeartPulse,      labelKey: "nav.reliability",      path: "/reliability" },
      // DORMANTE — Modos de Falla (RCM): módulo listo pero oculto para no abrumar a
      // empresas que recién arrancan. Reactivar: descomentar la línea de abajo y el
      // import de `Waypoints`. Backend, página, tabla e i18n siguen intactos.
      // { icon: Waypoints,       labelKey: "nav.failureModes",     path: "/failure-modes" },
      { icon: Wrench,          labelKey: "nav.workOrders",       path: "/work-orders" },
      // Va pegado a Órdenes de Trabajo porque cuelga de ellas: una SS sólo se
      // abre desde una OT abierta. Esta pantalla es la vista de seguimiento.
      { icon: Handshake,       labelKey: "nav.serviceRequests",  path: "/service-requests" },
      // DORMANTE — Reportes Diarios: reemplazado por "Medición de Tanques" (M2) a
      // pedido del usuario. La operación diaria (horómetros, consumos) ahora se
      // carga en el M2, y sus horómetros avanzan los planes de mantenimiento al
      // enviarlo. La ruta /daily-reports y su pantalla siguen INTACTAS (accesibles
      // por link directo / móvil). Reactivar: descomentar la línea de abajo.
      // { icon: FileText,        labelKey: "nav.dailyReports",     path: "/daily-reports" },
      { icon: Fuel,            labelKey: "nav.voyageTankReports", path: "/voyage-tank-reports" },
      // Pegado a Medición de Tanques porque comparten el dato: el M2 asienta los
      // horómetros al enviarse y esta pantalla es la carga/corrección manual.
      { icon: Timer,           labelKey: "nav.assetHours",       path: "/asset-hours" },
      { icon: FileBarChart,    labelKey: "nav.monthlyReports",   path: "/reports" },
      { icon: AlertTriangle,   labelKey: "nav.defects",          path: "/defects" },
      { icon: ScrollText,      labelKey: "nav.bitacora",         path: "/bitacora",
        roles: ["TENANT_ADMIN"] },
    ],
  },
  {
    titleKey: "nav.section.control",
    items: [
      { icon: CalendarRange,   labelKey: "nav.weeklyReport",     path: "/weekly-report",
        roles: ["TENANT_ADMIN"] },
      { icon: Clock,           labelKey: "nav.deferrals",        path: "/deferrals" },
      // Pegada a Diferimientos: la especificación de varada es donde terminan
      // los trabajos diferidos, los defectos abiertos y las OT pendientes.
      { icon: Anchor,          labelKey: "nav.drydockSpecs",     path: "/drydock-specs" },
      // DORMANTE — CAPA: módulo oculto de la entrega (simplificación; el flujo correctivo
      // vive dentro del Defecto). Reactivar: descomentar esta línea + rutas /capa en App.tsx.
      // { icon: Microscope,      labelKey: "nav.capa",             path: "/capa" },
      { icon: ShieldCheck,     labelKey: "nav.certificates",     path: "/certificates" },
      { icon: FlaskConical,    labelKey: "nav.fluidAnalyses",    path: "/fluid-analyses" },
      { icon: Gauge,           labelKey: "nav.spareRequests",    path: "/spare-requests" },
      { icon: GitBranch,       labelKey: "nav.moc",              path: "/moc" },
      { icon: AlertOctagon,    labelKey: "nav.nearMiss",         path: "/near-miss" },
      { icon: ClipboardCheck,  labelKey: "nav.externalAudits",   path: "/external-audits" },
      { icon: SearchCheck,     labelKey: "nav.inspections",      path: "/inspections" },
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
