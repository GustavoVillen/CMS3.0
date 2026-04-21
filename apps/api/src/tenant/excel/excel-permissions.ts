export const VALID_MODULES = [
  "vessels",
  "assets",
  "maintenance_plans",
  "work_orders",
  "spares",
  "providers",
  "certificates",
] as const;

export type ExcelModule = (typeof VALID_MODULES)[number];

const IMPORT_ROLES: Record<ExcelModule, string[]> = {
  vessels:           ["TENANT_ADMIN", "MAINTENANCE_MANAGER"],
  assets:            ["TENANT_ADMIN", "MAINTENANCE_MANAGER"],
  maintenance_plans: ["TENANT_ADMIN", "MAINTENANCE_MANAGER"],
  work_orders:       [],
  spares:            ["TENANT_ADMIN", "PROCUREMENT_STORE"],
  providers:         ["TENANT_ADMIN", "PROCUREMENT_STORE"],
  certificates:      ["TENANT_ADMIN", "INSPECTOR_COMPLIANCE"],
};

const EXPORT_ROLES: Record<ExcelModule, string[]> = {
  vessels:           ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  assets:            ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  maintenance_plans: ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "AUDITOR_READONLY"],
  work_orders:       ["TENANT_ADMIN", "MAINTENANCE_MANAGER", "FLEET_SUPERINTENDENT", "AUDITOR_READONLY"],
  spares:            ["TENANT_ADMIN", "PROCUREMENT_STORE", "AUDITOR_READONLY"],
  providers:         ["TENANT_ADMIN", "PROCUREMENT_STORE", "AUDITOR_READONLY"],
  certificates:      ["TENANT_ADMIN", "INSPECTOR_COMPLIANCE", "AUDITOR_READONLY"],
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
