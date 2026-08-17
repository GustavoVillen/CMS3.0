export const VALID_MODULES = [
  // Módulos originales (import + export)
  "vessels",
  "assets",
  "maintenance_plans",
  "work_orders",
  "spares",
  "providers",
  "certificates",
  // Módulos export-only — agregados en la tanda de "exportar a todos los módulos".
  // IMPORT_ROLES vacío para todos: no se cargan datos por Excel, el flujo es
  // mediante los formularios de cada página.
  "crew",
  "crew_certifications",     // Matriz de competencias
  "crew_rest_hours",
  "drills",
  "permits",
  "external_audits",
  "near_miss",
  "moc",
  "spare_requests",
  "fluid_samples",           // Muestreos y análisis (CBM)
  "capa",
  "deferrals",
  "defects",
  "daily_reports",
  "monthly_reports",
  "asset_hours",              // Lecturas de horómetro (Horas de Equipos)
] as const;

export type ExcelModule = (typeof VALID_MODULES)[number];

const IMPORT_ROLES: Record<ExcelModule, string[]> = {
  vessels:             ["TENANT_ADMIN", "MAINTENANCE_MANAGER"],
  assets:              ["TENANT_ADMIN", "MAINTENANCE_MANAGER"],
  maintenance_plans:   ["TENANT_ADMIN", "MAINTENANCE_MANAGER"],
  work_orders:         [],
  spares:              ["TENANT_ADMIN", "PROCUREMENT_STORE"],
  providers:           ["TENANT_ADMIN", "PROCUREMENT_STORE"],
  certificates:        ["TENANT_ADMIN", "INSPECTOR_COMPLIANCE"],
  // Export-only: sin import.
  crew:                [],
  crew_certifications: [],
  crew_rest_hours:     [],
  drills:              [],
  permits:             [],
  external_audits:     [],
  near_miss:           [],
  moc:                 [],
  spare_requests:      [],
  fluid_samples:       [],
  capa:                [],
  deferrals:           [],
  defects:             [],
  daily_reports:       [],
  monthly_reports:     [],
  asset_hours:         [],
};

const EXPORT_ROLES: Record<ExcelModule, string[]> = {
  vessels:             ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  assets:              ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  maintenance_plans:   ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  work_orders:         ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "FLEET_SUPERINTENDENT", "AUDITOR_READONLY"],
  spares:              ["TENANT_ADMIN", "PROCUREMENT_STORE", "AUDITOR_READONLY"],
  providers:           ["TENANT_ADMIN", "PROCUREMENT_STORE", "AUDITOR_READONLY"],
  certificates:        ["TENANT_ADMIN", "INSPECTOR_COMPLIANCE", "AUDITOR_READONLY"],
  // Para los nuevos: TENANT_ADMIN y AUDITOR_READONLY siempre. Después se agrega
  // el rol "natural" del módulo (quien lo maneja día a día).
  crew:                ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  crew_certifications: ["TENANT_ADMIN", "INSPECTOR_COMPLIANCE", "FLEET_SUPERINTENDENT", "AUDITOR_READONLY"],
  crew_rest_hours:     ["TENANT_ADMIN", "INSPECTOR_COMPLIANCE", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  // HSE_MANAGER (Jefe SSMA) baja las planillas de su area: simulacros, permisos,
  // auditorias externas y near miss.
  drills:              ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "FLEET_SUPERINTENDENT", "INSPECTOR_COMPLIANCE", "HSE_MANAGER", "AUDITOR_READONLY"],
  permits:             ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "INSPECTOR_COMPLIANCE", "HSE_MANAGER", "AUDITOR_READONLY"],
  external_audits:     ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "INSPECTOR_COMPLIANCE", "HSE_MANAGER", "AUDITOR_READONLY"],
  near_miss:           ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "FLEET_SUPERINTENDENT", "INSPECTOR_COMPLIANCE", "HSE_MANAGER", "AUDITOR_READONLY"],
  moc:                 ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  spare_requests:      ["TENANT_ADMIN", "PROCUREMENT_STORE", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  fluid_samples:       ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  capa:                ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  deferrals:           ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  defects:             ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "FLEET_SUPERINTENDENT", "AUDITOR_READONLY"],
  daily_reports:       ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "FLEET_SUPERINTENDENT", "AUDITOR_READONLY"],
  monthly_reports:     ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "FLEET_SUPERINTENDENT", "AUDITOR_READONLY"],
  // El tripulante es quien carga los horómetros: también puede bajarse la planilla.
  asset_hours:         ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "FLEET_SUPERINTENDENT", "TECHNICIAN_OPERATOR", "AUDITOR_READONLY"],
};

export function isValidModule(module: string): module is ExcelModule {
  return (VALID_MODULES as readonly string[]).includes(module);
}

export function canImport(module: ExcelModule, role: string): boolean {
  return IMPORT_ROLES[module].includes(role);
}

export function canExport(module: ExcelModule, role: string): boolean {
  return EXPORT_ROLES[module].includes(role);
}
