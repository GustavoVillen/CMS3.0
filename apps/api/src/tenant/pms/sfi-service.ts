import type { TenantAccessSession } from "../auth/session-store";
import path from "node:path";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import ExcelJS from "exceljs";

export interface SfiNodeFilters {
  groupNumber?: number | null;
}

export interface CreateSfiNodeInput {
  code: string;
  description: string;
  groupNumber: number;
  groupName: string;
  sortOrder?: number | null;
}

interface SfiNodeRecord {
  id: string;
  code: string;
  description: string;
  groupNumber: number;
  groupName: string;
  isGlobal: boolean;
  tenantId: string | null;
  sortOrder: number;
  createdAt: Date;
}

const DEFAULT_SFI_FALLBACK: SfiNodeRecord[] = [
  { id: "sfi-fallback-000", code: "000", description: "Documentación general", groupNumber: 0, groupName: "Documentación", isGlobal: true, tenantId: null, sortOrder: 0, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-100", code: "100", description: "Casco general", groupNumber: 1, groupName: "Casco", isGlobal: true, tenantId: null, sortOrder: 1000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-200", code: "200", description: "Equipo de carga general", groupNumber: 2, groupName: "Equipo de Carga", isGlobal: true, tenantId: null, sortOrder: 2000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-300", code: "300", description: "Manipulación de carga general", groupNumber: 3, groupName: "Equipo de Manipulación de Carga", isGlobal: true, tenantId: null, sortOrder: 3000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-400", code: "400", description: "Equipo de barco general", groupNumber: 4, groupName: "Equipo de Barco", isGlobal: true, tenantId: null, sortOrder: 4000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-500", code: "500", description: "Alojamiento general", groupNumber: 5, groupName: "Equipo para Tripulación y Pasajeros", isGlobal: true, tenantId: null, sortOrder: 5000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-600", code: "600", description: "Componentes principales general", groupNumber: 6, groupName: "Componentes Principales", isGlobal: true, tenantId: null, sortOrder: 6000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-700", code: "700", description: "Sistemas de maquinaria general", groupNumber: 7, groupName: "Sistemas para Componentes Principales", isGlobal: true, tenantId: null, sortOrder: 7000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-800", code: "800", description: "Sistemas eléctricos general", groupNumber: 8, groupName: "Instalaciones Eléctricas", isGlobal: true, tenantId: null, sortOrder: 8000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: "sfi-fallback-900", code: "900", description: "Automatización general", groupNumber: 9, groupName: "Automatización, Control y Monitoreo", isGlobal: true, tenantId: null, sortOrder: 9000, createdAt: new Date("2026-01-01T00:00:00.000Z") },
];

let cachedFallbackSfiNodes: SfiNodeRecord[] | null = null;

function normalizeCode(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return String(n).padStart(3, "0");
  }
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) return text.padStart(3, "0");
  return text;
}

function parseGroupHeader(raw: string): { groupNumber: number; groupName: string } | null {
  const text = raw.replace(/\r/g, "\n").trim();
  if (!text) return null;
  const match = text.match(/Grupo\s*(\d+)\s*([\s\S]*)/i);
  if (!match) return null;
  const groupNumber = Number(match[1]);
  if (!Number.isInteger(groupNumber)) return null;
  const groupName = match[2]?.replace(/\n+/g, " ").trim() || `Grupo ${groupNumber}`;
  return { groupNumber, groupName };
}

async function loadFallbackSfiNodesFromManual(): Promise<SfiNodeRecord[]> {
  if (cachedFallbackSfiNodes) return cachedFallbackSfiNodes;

  const workbookPathCandidates = [
    path.resolve(process.cwd(), "Manual", "SFI Codes.xlsx"),
    path.resolve(process.cwd(), "..", "Manual", "SFI Codes.xlsx"),
    path.resolve(process.cwd(), "..", "..", "Manual", "SFI Codes.xlsx"),
  ];

  const workbook = new ExcelJS.Workbook();
  let loaded = false;
  for (const candidate of workbookPathCandidates) {
    try {
      await workbook.xlsx.readFile(candidate);
      loaded = true;
      break;
    } catch {
      // try next candidate
    }
  }

  if (!loaded || workbook.worksheets.length === 0) {
    cachedFallbackSfiNodes = DEFAULT_SFI_FALLBACK;
    return cachedFallbackSfiNodes;
  }

  const ws = workbook.worksheets[0];
  const sections = [
    { headerRow: 3, dataStartRow: 5, dataEndRow: 14 },
    { headerRow: 16, dataStartRow: 18, dataEndRow: 27 },
  ];

  const items: SfiNodeRecord[] = [];
  const seenCodes = new Set<string>();
  let sortOrder = 0;

  for (const section of sections) {
    for (let codeCol = 1; codeCol <= 9; codeCol += 2) {
      const headerRaw = String(ws.getRow(section.headerRow).getCell(codeCol).text ?? "");
      const group = parseGroupHeader(headerRaw);
      if (!group) continue;

      for (let row = section.dataStartRow; row <= section.dataEndRow; row += 1) {
        const codeRaw = ws.getRow(row).getCell(codeCol).value;
        const descriptionRaw = ws.getRow(row).getCell(codeCol + 1).text;
        const code = normalizeCode(codeRaw);
        const description = String(descriptionRaw ?? "").trim();
        if (!code || !description) continue;
        if (seenCodes.has(code)) continue;

        seenCodes.add(code);
        items.push({
          id: `sfi-fallback-${code}`,
          code,
          description,
          groupNumber: group.groupNumber,
          groupName: group.groupName,
          isGlobal: true,
          tenantId: null,
          sortOrder,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        });
        sortOrder += 1;
      }
    }
  }

  if (items.length === 0) {
    cachedFallbackSfiNodes = DEFAULT_SFI_FALLBACK;
    return cachedFallbackSfiNodes;
  }

  cachedFallbackSfiNodes = items.sort((a, b) => {
    if (a.groupNumber !== b.groupNumber) return a.groupNumber - b.groupNumber;
    return a.code.localeCompare(b.code);
  });
  return cachedFallbackSfiNodes;
}

function applyGroupFilter(items: SfiNodeRecord[], groupNumber?: number | null): SfiNodeRecord[] {
  if (groupNumber === undefined || groupNumber === null) return items;
  return items.filter((item) => item.groupNumber === groupNumber);
}

type SfiNodeDelegate = {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<SfiNodeRecord[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<SfiNodeRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<SfiNodeRecord>;
};

interface SfiPrismaClient {
  tenant: NonNullable<ReturnType<typeof getPrismaClient>>["tenant"];
  sfiNode?: SfiNodeDelegate;
}

function sfiClient(prisma: NonNullable<ReturnType<typeof getPrismaClient>>): SfiPrismaClient {
  return prisma as unknown as SfiPrismaClient;
}

function hasSfiNodeDelegate(prisma: SfiPrismaClient): prisma is SfiPrismaClient & { sfiNode: SfiNodeDelegate } {
  return Boolean(prisma.sfiNode && typeof prisma.sfiNode.findMany === "function");
}

function ensureTenantAdmin(session: TenantAccessSession) {
  if (session.user.role !== "TENANT_ADMIN") {
    throw new RouteError(403, "FORBIDDEN", "Solo TENANT_ADMIN puede modificar nodos SFI.");
  }
}

function normalizeRequiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return text;
}

function normalizeInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new RouteError(400, "VALIDATION_ERROR", `${field} debe ser entero.`);
}

function normalizeOptionalInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  return normalizeInteger(value, field);
}

async function resolveTenantId(session: TenantAccessSession): Promise<string | null> {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) return null;
  const prisma = sfiClient(prismaRaw);
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  return tenant?.id ?? null;
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const tenantId = await resolveTenantId(session);
  if (!tenantId) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenantId;
}

export async function listSfiNodes(session: TenantAccessSession, filters: SfiNodeFilters = {}) {
  const prismaRaw = getPrismaClient();
  if (!prismaRaw) {
    const fallback = await loadFallbackSfiNodesFromManual();
    return applyGroupFilter(fallback, filters.groupNumber ?? null);
  }
  const prisma = sfiClient(prismaRaw);
  if (!hasSfiNodeDelegate(prisma)) {
    const fallback = await loadFallbackSfiNodesFromManual();
    return applyGroupFilter(fallback, filters.groupNumber ?? null);
  }

  const tenantId = await resolveTenantId(session);
  if (!tenantId) {
    const fallback = await loadFallbackSfiNodesFromManual();
    return applyGroupFilter(fallback, filters.groupNumber ?? null);
  }

  const where: Record<string, unknown> = {
    OR: [{ tenantId: null }, { tenantId }],
  };
  if (filters.groupNumber !== undefined && filters.groupNumber !== null) {
    where.groupNumber = filters.groupNumber;
  }

  const dbItems = await prisma.sfiNode.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  if (dbItems.length > 0) return dbItems;

  const fallback = await loadFallbackSfiNodesFromManual();
  return applyGroupFilter(fallback, filters.groupNumber ?? null);
}

export async function createSfiNode(session: TenantAccessSession, payload: CreateSfiNodeInput) {
  ensureTenantAdmin(session);

  const prismaRaw = getPrismaClient();
  if (!prismaRaw) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const prisma = sfiClient(prismaRaw);
  if (!hasSfiNodeDelegate(prisma)) {
    throw new RouteError(
      503,
      "SFI_MODEL_UNAVAILABLE",
      "Modelo SFI no disponible en el cliente Prisma actual. Ejecutar prisma generate.",
    );
  }

  const tenantId = await getTenantIdOrThrow(session);
  const code = normalizeRequiredText(payload.code, "code").toUpperCase();
  const existing = await prisma.sfiNode.findFirst({
    where: {
      tenantId,
      code,
    },
  });
  if (existing) throw new RouteError(409, "DUPLICATE_CODE", `Ya existe un nodo SFI con codigo ${code}.`);

  const sortOrder = normalizeOptionalInteger(payload.sortOrder, "sortOrder");
  return prisma.sfiNode.create({
    data: {
      tenantId,
      isGlobal: false,
      code,
      description: normalizeRequiredText(payload.description, "description"),
      groupNumber: normalizeInteger(payload.groupNumber, "groupNumber"),
      groupName: normalizeRequiredText(payload.groupName, "groupName"),
      sortOrder: sortOrder ?? 0,
    },
  });
}
