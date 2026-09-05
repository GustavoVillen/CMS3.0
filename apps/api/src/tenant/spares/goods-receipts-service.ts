// Recepción de repuestos contra remito.
//
// Dos caminos, un solo destino: el usuario sube el remito (PDF o foto) y la IA
// lo transcribe, o carga las líneas a mano. En los dos casos el sistema busca
// primero en el catálogo del buque y sólo deja crear un repuesto nuevo cuando
// ninguno de los parecidos es el que llegó — es la regla que evita que
// "Filtro de combustible generador" y "Filtro de combustible GEN" terminen
// siendo dos fichas distintas con el stock partido al medio.
//
// El escaneo NO escribe en la base: devuelve filas para revisar. Recién el
// commit crea la cabecera (GoodsReceipt), los repuestos nuevos que el usuario
// confirmó y un StockMovement RECEIPT por línea. El stock se sigue calculando
// desde los movimientos (stock-calc-service), acá no se toca ningún contador.

import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { hasPermission } from "../auth/role-permissions";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { serializeFileUrl } from "../files/files-router";
import { getOnHandMap } from "../pms/stock-calc-service";
import { saveGoodsReceiptFile } from "./goods-receipt-uploads-service";
import { extractGoodsReceipt } from "./goods-receipt-ai-extractor";
import { matchSparesByAi, type AiLineInput } from "./spare-ai-match";
import {
  matchSpare,
  normalizePartNumber,
  type SpareCandidate,
  MATCH_THRESHOLD,
} from "./spare-match";

/** Tope de líneas por remito: un remito real no tiene más. */
const MAX_LINES = 100;

// ── Tipos de la pantalla ─────────────────────────────────────────────────────

export type ScanLineStatus = "matched" | "ambiguous" | "new";

export interface ScanCandidate {
  id: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  score: number;
}

export interface ScanLine {
  line: number;
  description: string;
  quantity: number | null;
  unit: string | null;
  partNumber: string | null;
  manufacturer: string | null;
  confidence: "high" | "medium" | "low";
  status: ScanLineStatus;
  /** Repuesto propuesto (null si se propone alta nueva). */
  spareId: string | null;
  spareSku: string | null;
  spareName: string | null;
  spareUnit: string | null;
  spareOnHand: number | null;
  score: number;
  /** PART_NUMBER | TEXT | AI — por qué se propuso ese repuesto. */
  matchReason: string | null;
  aiReason: string | null;
  candidates: ScanCandidate[];
}

export interface ScanResult {
  vesselCode: string;
  documentNumber: string | null;
  providerName: string | null;
  providerId: string | null;
  receivedAt: string | null;
  notes: string | null;
  file: { url: string; name: string; mime: string };
  /** Remito ya cargado con el mismo proveedor y número. */
  duplicateOf: { id: string; receiptCode: string; receivedAt: string } | null;
  lines: ScanLine[];
}

export interface CommitLineInput {
  quantity: number;
  unit?: string | null;
  notes?: string | null;
  /** Repuesto existente al que se suma. */
  spareId?: string | null;
  /** Alta confirmada por el usuario ("ninguno de los parecidos es el mío"). */
  newSpare?: {
    sku: string;
    name: string;
    unit: string;
    criticality?: "A" | "B" | "C";
    manufacturer?: string | null;
    internalPartNumber?: string | null;
    manufacturerPartNumber?: string | null;
    longDescription?: string | null;
    minStock?: number;
    reorderPoint?: number;
  } | null;
}

export interface CommitInput {
  vesselCode: string;
  documentNumber?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  receivedAt?: string | null;
  notes?: string | null;
  file?: { url: string; name: string; mime: string } | null;
  lines: CommitLineInput[];
  /** El usuario vio el aviso de "remito ya cargado" y decidió seguir igual. */
  allowDuplicate?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireReceivePermission(session: TenantAccessSession): void {
  // Mismo permiso que el ajuste manual de stock: quien puede corregir el stock
  // puede registrar lo que entró (y dar de alta el repuesto que llegó).
  if (!hasPermission(session, "stock.manage")) {
    throw new RouteError(403, "FORBIDDEN", "No autorizado para registrar recepciones de repuestos.");
  }
}

function assertVesselInScope(session: TenantAccessSession, vesselCode: string): void {
  if (session.user.role === "TENANT_ADMIN") return;
  if (!session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel solicitado.");
  }
}

async function getTenantIdOrThrow(session: TenantAccessSession): Promise<string> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug }, select: { id: true } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

function normText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const t = String(value).trim();
  return t || null;
}

function requiredText(value: unknown, field: string): string {
  const t = normText(value);
  if (!t) throw new RouteError(400, "VALIDATION_ERROR", `El campo ${field} es requerido.`);
  return t;
}

function parseDate(value: unknown): Date {
  if (!value) return new Date();
  const d = new Date(String(value));
  if (isNaN(d.getTime())) throw new RouteError(400, "VALIDATION_ERROR", "Fecha inválida.");
  return d;
}

/** Catálogo del buque con su stock actual, que es lo que se compara y se muestra. */
async function loadVesselCatalog(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  vesselCode: string,
): Promise<SpareCandidate[]> {
  const spares = await prisma.spare.findMany({
    where: { tenantId, vesselCode, deletedAt: null },
    select: {
      id: true, sku: true, name: true, unit: true, longDescription: true,
      internalPartNumber: true, manufacturerPartNumber: true, manufacturer: true, model: true,
    },
    orderBy: { sku: "asc" },
  });
  const onHand = await getOnHandMap(prisma, spares.map(s => s.id));
  return spares.map(s => ({ ...s, onHand: onHand.get(s.id) ?? 0 }));
}

function toScanCandidate(c: SpareCandidate, score: number): ScanCandidate {
  return { id: c.id, sku: c.sku, name: c.name, unit: c.unit, onHand: c.onHand, score: Math.round(score * 100) / 100 };
}

// ── Escaneo del remito ───────────────────────────────────────────────────────

export async function scanGoodsReceipt(
  session: TenantAccessSession,
  input: { buffer: Buffer; originalName: string; vesselCode: string },
): Promise<ScanResult> {
  requireReceivePermission(session);
  const vesselCode = requiredText(input.vesselCode, "vesselCode").toUpperCase();
  assertVesselInScope(session, vesselCode);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await getTenantIdOrThrow(session);

  const saved = await saveGoodsReceiptFile(session.tenantSlug, input.originalName, input.buffer);
  const extracted = await extractGoodsReceipt(session, { buffer: input.buffer, mime: saved.mime, vesselCode });

  const catalog = await loadVesselCatalog(prisma, tenantId, vesselCode);
  const lines = await matchLines(
    session,
    vesselCode,
    catalog,
    extracted.lines.map(l => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      partNumber: l.partNumber,
      manufacturer: l.manufacturer,
      confidence: l.confidence,
    })),
  );

  // Proveedor: si el nombre que leyó la IA coincide con uno dado de alta, se
  // preselecciona; si no, queda el texto libre para que el usuario elija.
  let providerId: string | null = null;
  if (extracted.providerName) {
    const target = extracted.providerName.toLowerCase();
    const providers = await prisma.provider.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    providerId = providers.find(p => p.name.toLowerCase() === target)?.id
      ?? providers.find(p => target.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(target))?.id
      ?? null;
  }

  const duplicateOf = await findDuplicateReceipt(prisma, tenantId, {
    documentNumber: extracted.documentNumber,
    providerId,
    providerName: extracted.providerName,
  });

  return {
    vesselCode,
    documentNumber: extracted.documentNumber,
    providerName: extracted.providerName,
    providerId,
    receivedAt: extracted.receivedAt,
    notes: extracted.notes,
    file: { url: saved.url, name: saved.name, mime: saved.mime },
    duplicateOf,
    lines,
  };
}

interface RawLine {
  description: string;
  quantity: number | null;
  unit: string | null;
  partNumber: string | null;
  manufacturer: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Empareja cada línea del remito con el catálogo: primero por texto/part number
 * (determinístico) y después, para las dudosas, una sola consulta a la IA con
 * todas juntas.
 */
async function matchLines(
  session: TenantAccessSession,
  vesselCode: string,
  catalog: SpareCandidate[],
  raw: RawLine[],
): Promise<ScanLine[]> {
  const byId = new Map(catalog.map(c => [c.id, c]));
  const lines: ScanLine[] = raw.slice(0, MAX_LINES).map((l, i) => {
    const result = matchSpare({ description: l.description, partNumber: l.partNumber }, catalog);
    const best = result.best;
    return {
      line: i + 1,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      partNumber: l.partNumber,
      manufacturer: l.manufacturer,
      confidence: l.confidence,
      status: result.status === "matched" ? "matched" : result.status === "ambiguous" ? "ambiguous" : "new",
      spareId:     result.status === "matched" && best ? best.candidate.id   : null,
      spareSku:    result.status === "matched" && best ? best.candidate.sku  : null,
      spareName:   result.status === "matched" && best ? best.candidate.name : null,
      spareUnit:   result.status === "matched" && best ? best.candidate.unit : null,
      spareOnHand: result.status === "matched" && best ? best.candidate.onHand : null,
      score: best ? Math.round(best.score * 100) / 100 : 0,
      matchReason: result.status === "matched" && best ? best.reason : null,
      aiReason: null,
      candidates: result.candidates.map(c => toScanCandidate(c.candidate, c.score)),
    };
  });

  // Desempate por IA sólo de lo que quedó dudoso o sin match, y sólo si hay
  // candidatos para elegir: sin candidatos no hay nada que decidir.
  const pending: AiLineInput[] = lines
    .filter(l => l.status !== "matched" && l.candidates.length > 0)
    .map(l => ({
      line: l.line,
      description: l.description,
      partNumber: l.partNumber,
      candidates: l.candidates
        .map(c => byId.get(c.id))
        .filter((c): c is SpareCandidate => !!c),
    }));

  if (pending.length > 0) {
    const decisions = await matchSparesByAi(session, vesselCode, pending);
    for (const d of decisions) {
      const line = lines.find(l => l.line === d.line);
      if (!line) continue;
      line.aiReason = d.reason;
      if (!d.spareId) continue;
      const spare = byId.get(d.spareId);
      if (!spare) continue;
      // La IA propone; la fila queda "para confirmar" salvo que esté segura.
      line.spareId     = spare.id;
      line.spareSku    = spare.sku;
      line.spareName   = spare.name;
      line.spareUnit   = spare.unit;
      line.spareOnHand = spare.onHand;
      line.matchReason = "AI";
      // El score que se muestra sigue siendo el del parecido de texto contra el
      // repuesto elegido: la IA no puntúa, decide.
      line.score       = line.candidates.find(c => c.id === spare.id)?.score ?? line.score;
      line.status      = d.confidence === "high" ? "matched" : "ambiguous";
    }
  }

  return lines;
}

async function findDuplicateReceipt(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  input: { documentNumber: string | null; providerId: string | null; providerName: string | null },
): Promise<{ id: string; receiptCode: string; receivedAt: string } | null> {
  const documentNumber = normText(input.documentNumber);
  if (!documentNumber) return null;
  const where: Record<string, unknown> = { tenantId, documentNumber, deletedAt: null };
  if (input.providerId) where.providerId = input.providerId;
  else if (input.providerName) where.providerName = input.providerName;
  const found = await prisma.goodsReceipt.findFirst({
    where: where as never,
    select: { id: true, receiptCode: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
  });
  if (!found) return null;
  return { id: found.id, receiptCode: found.receiptCode, receivedAt: found.receivedAt.toISOString() };
}

// ── Búsqueda para el modo manual y para corregir un emparejamiento ───────────

export interface SpareSearchHit extends ScanCandidate {
  internalPartNumber: string | null;
  manufacturerPartNumber: string | null;
}

export async function searchSpares(
  session: TenantAccessSession,
  vesselCode: string,
  query: string,
): Promise<SpareSearchHit[]> {
  const code = requiredText(vesselCode, "vesselCode").toUpperCase();
  assertVesselInScope(session, code);
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await getTenantIdOrThrow(session);

  const catalog = await loadVesselCatalog(prisma, tenantId, code);
  const q = normText(query);
  const hits = q
    ? matchSpare({ description: q, partNumber: q }, catalog).candidates.map(c => ({ candidate: c.candidate, score: c.score }))
    : catalog.slice(0, 50).map(c => ({ candidate: c, score: 0 }));

  return hits.map(h => ({
    ...toScanCandidate(h.candidate, h.score),
    internalPartNumber: h.candidate.internalPartNumber ?? null,
    manufacturerPartNumber: h.candidate.manufacturerPartNumber ?? null,
  }));
}

// ── Confirmación ─────────────────────────────────────────────────────────────

export interface CommitResultLine {
  spareId: string;
  sku: string;
  name: string;
  quantity: number;
  unit: string;
  created: boolean;
  onHandBefore: number;
  onHandAfter: number;
}

export async function commitGoodsReceipt(
  session: TenantAccessSession,
  input: CommitInput,
): Promise<{ id: string; receiptCode: string; lines: CommitResultLine[] }> {
  requireReceivePermission(session);
  const vesselCode = requiredText(input.vesselCode, "vesselCode").toUpperCase();
  assertVesselInScope(session, vesselCode);

  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await getTenantIdOrThrow(session);

  const vessel = await prisma.vessel.findFirst({ where: { tenantId, code: vesselCode, deletedAt: null }, select: { code: true } });
  if (!vessel) throw new RouteError(404, "VESSEL_NOT_FOUND", "Buque no encontrado.");

  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) throw new RouteError(400, "VALIDATION_ERROR", "La recepción no tiene líneas.");
  if (rawLines.length > MAX_LINES) throw new RouteError(413, "BATCH_TOO_LARGE", `Máximo ${MAX_LINES} líneas por remito.`);

  const documentNumber = normText(input.documentNumber);
  const providerId     = normText(input.providerId);
  const providerName   = normText(input.providerName);
  const receivedAt     = parseDate(input.receivedAt);

  // El archivo tiene que ser uno que este mismo tenant acaba de subir en el
  // escaneo: sin esto, un cliente podría hacer apuntar el remito a cualquier
  // path del servidor.
  const fileUrl = normText(input.file?.url);
  if (fileUrl && !fileUrl.startsWith(`/uploads/goods-receipts/${session.tenantSlug}/`)) {
    throw new RouteError(400, "VALIDATION_ERROR", "Archivo de remito inválido.");
  }

  if (providerId) {
    const provider = await prisma.provider.findFirst({ where: { id: providerId, tenantId, deletedAt: null }, select: { id: true } });
    if (!provider) throw new RouteError(404, "PROVIDER_NOT_FOUND", "Proveedor no encontrado.");
  }

  if (!input.allowDuplicate) {
    const dup = await findDuplicateReceipt(prisma, tenantId, { documentNumber, providerId, providerName });
    if (dup) {
      throw new RouteError(409, "DUPLICATE_RECEIPT", `El remito ${documentNumber} de este proveedor ya fue cargado (${dup.receiptCode}).`);
    }
  }

  const catalog = await loadVesselCatalog(prisma, tenantId, vesselCode);
  const byId = new Map(catalog.map(c => [c.id, c]));

  // Resolución de cada línea ANTES de escribir: repuesto existente o alta nueva.
  interface Resolved {
    spareId: string | null;
    newSpare: NonNullable<CommitLineInput["newSpare"]> | null;
    quantity: number;
    unit: string;
    notes: string | null;
  }
  const resolved: Resolved[] = [];
  for (const [i, line] of rawLines.entries()) {
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new RouteError(400, "VALIDATION_ERROR", `La cantidad de la línea ${i + 1} debe ser mayor a cero.`);
    }

    if (line.spareId) {
      const spare = byId.get(String(line.spareId));
      if (!spare) throw new RouteError(404, "SPARE_NOT_FOUND", `El repuesto de la línea ${i + 1} no existe en este buque.`);
      resolved.push({ spareId: spare.id, newSpare: null, quantity, unit: normText(line.unit) ?? spare.unit, notes: normText(line.notes) });
      continue;
    }

    if (!line.newSpare) {
      throw new RouteError(400, "VALIDATION_ERROR", `La línea ${i + 1} no tiene repuesto asignado.`);
    }

    const sku  = requiredText(line.newSpare.sku, `sku (línea ${i + 1})`).toUpperCase();
    const name = requiredText(line.newSpare.name, `nombre (línea ${i + 1})`);
    const unit = requiredText(line.newSpare.unit ?? line.unit, `unidad (línea ${i + 1})`);

    // Bloqueos duros contra el duplicado, del lado del servidor: el mismo SKU o
    // el mismo part number en el buque significan que el repuesto ya existe.
    if (catalog.some(c => c.sku.toUpperCase() === sku)) {
      throw new RouteError(409, "DUPLICATE_SKU", `Ya existe un repuesto con el código ${sku} en este buque (línea ${i + 1}).`);
    }
    const pn = normalizePartNumber(line.newSpare.manufacturerPartNumber ?? line.newSpare.internalPartNumber);
    if (pn.length >= 3) {
      const clash = catalog.find(c =>
        normalizePartNumber(c.manufacturerPartNumber) === pn || normalizePartNumber(c.internalPartNumber) === pn,
      );
      if (clash) {
        throw new RouteError(409, "DUPLICATE_PART_NUMBER", `El part number de la línea ${i + 1} ya está cargado en "${clash.name}" (${clash.sku}). Sumale el stock a ese repuesto.`);
      }
    }
    // Dos altas nuevas con el mismo SKU dentro del mismo remito.
    if (resolved.some(r => r.newSpare && r.newSpare.sku.toUpperCase() === sku)) {
      throw new RouteError(409, "DUPLICATE_SKU", `El código ${sku} está repetido en dos líneas del remito.`);
    }

    resolved.push({
      spareId: null,
      newSpare: { ...line.newSpare, sku, name, unit },
      quantity,
      unit,
      notes: normText(line.notes),
    });
  }

  // Dos líneas contra el mismo repuesto: se suman en una sola.
  const merged: Resolved[] = [];
  for (const r of resolved) {
    const prev = r.spareId ? merged.find(m => m.spareId === r.spareId) : null;
    if (prev) {
      prev.quantity += r.quantity;
      if (r.notes) prev.notes = prev.notes ? `${prev.notes} | ${r.notes}` : r.notes;
      continue;
    }
    merged.push(r);
  }

  const receiptCode = await generateReceiptCode(prisma, tenantId, vesselCode);
  const userId = session.user.id;
  const now = Date.now();

  const result = await prisma.$transaction(async (tx) => {
    const receipt = await tx.goodsReceipt.create({
      data: {
        tenantId,
        vesselCode,
        receiptCode,
        documentNumber,
        providerId,
        providerName,
        receivedAt,
        fileUrl,
        fileName: normText(input.file?.name),
        fileMime: normText(input.file?.mime),
        notes: normText(input.notes),
        createdByUserId: userId,
      },
    });

    const out: CommitResultLine[] = [];
    for (const [i, line] of merged.entries()) {
      let spareId = line.spareId;
      let sku: string;
      let name: string;
      let onHandBefore = 0;
      let created = false;

      if (spareId) {
        const spare = byId.get(spareId)!;
        sku = spare.sku;
        name = spare.name;
        onHandBefore = spare.onHand;
      } else {
        const ns = line.newSpare!;
        const spare = await tx.spare.create({
          data: {
            tenantId,
            vesselCode,
            sku: ns.sku,
            name: ns.name,
            unit: ns.unit,
            criticality: ns.criticality ?? "B",
            manufacturer: normText(ns.manufacturer),
            internalPartNumber: normText(ns.internalPartNumber),
            manufacturerPartNumber: normText(ns.manufacturerPartNumber),
            longDescription: normText(ns.longDescription),
            minStock: ns.minStock ?? 0,
            reorderPoint: ns.reorderPoint ?? 0,
            createdByUserId: userId,
            updatedByUserId: userId,
          },
        });
        spareId = spare.id;
        sku = spare.sku;
        name = spare.name;
        created = true;
      }

      await tx.stockMovement.create({
        data: {
          tenantId,
          vesselCode,
          spareId,
          movementCode: `MOV-${vesselCode}-${now + i}`,
          movementType: "RECEIPT",
          quantity: line.quantity,
          unit: line.unit,
          occurredAt: receivedAt,
          referenceType: "GOODS_RECEIPT",
          referenceId: receipt.id,
          notes: line.notes ?? (documentNumber ? `Remito ${documentNumber}` : null),
          createdByUserId: userId,
        },
      });

      out.push({
        spareId,
        sku,
        name,
        quantity: line.quantity,
        unit: line.unit,
        created,
        onHandBefore,
        onHandAfter: onHandBefore + line.quantity,
      });
    }

    return { id: receipt.id, receiptCode: receipt.receiptCode, lines: out };
  });

  void publishAudit(prisma, {
    tenantId,
    actorUserId: userId,
    action: "GoodsReceipt.created",
    entityType: "GoodsReceipt",
    entityId: result.id,
    metadata: {
      receiptCode: result.receiptCode,
      vesselCode,
      documentNumber,
      providerName,
      lines: result.lines.length,
      createdSpares: result.lines.filter(l => l.created).length,
    },
  });

  return result;
}

async function generateReceiptCode(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  tenantId: string,
  vesselCode: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const count = await prisma.goodsReceipt.count({
    where: { tenantId, vesselCode, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  });
  // Colisión posible si dos recepciones entran en el mismo instante: se busca
  // el primer código libre en vez de fallar.
  for (let n = count + 1; n < count + 50; n++) {
    const code = `RCP-${vesselCode}-${yy}-${String(n).padStart(4, "0")}`;
    const taken = await prisma.goodsReceipt.findFirst({ where: { tenantId, receiptCode: code }, select: { id: true } });
    if (!taken) return code;
  }
  return `RCP-${vesselCode}-${yy}-${Date.now()}`;
}

// ── Listado ──────────────────────────────────────────────────────────────────

export async function listGoodsReceipts(
  session: TenantAccessSession,
  filters: { vesselCode?: string | null } = {},
) {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const tenantId = await getTenantIdOrThrow(session);

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (session.user.role === "TENANT_ADMIN") {
    if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  } else if (filters.vesselCode) {
    assertVesselInScope(session, filters.vesselCode);
    where.vesselCode = filters.vesselCode;
  } else {
    where.vesselCode = { in: session.user.assignedVesselCodes.length ? session.user.assignedVesselCodes : ["__NO_MATCH__"] };
  }

  const receipts = await prisma.goodsReceipt.findMany({
    where: where as never,
    orderBy: { receivedAt: "desc" },
    take: 200,
    include: { provider: { select: { name: true } } },
  });

  // Líneas de cada recepción: son los movimientos que la referencian.
  const movements = await prisma.stockMovement.findMany({
    where: { tenantId, referenceType: "GOODS_RECEIPT", referenceId: { in: receipts.map(r => r.id) } },
    select: { referenceId: true, quantity: true, unit: true, spare: { select: { sku: true, name: true } } },
  });

  return receipts.map(r => {
    const lines = movements.filter(m => m.referenceId === r.id);
    return {
      id: r.id,
      receiptCode: r.receiptCode,
      vesselCode: r.vesselCode,
      documentNumber: r.documentNumber,
      providerName: r.provider?.name ?? r.providerName,
      receivedAt: r.receivedAt.toISOString(),
      fileUrl: serializeFileUrl(r.fileUrl),
      fileName: r.fileName,
      notes: r.notes,
      lineCount: lines.length,
      lines: lines.map(l => ({
        sku: l.spare?.sku ?? null,
        name: l.spare?.name ?? null,
        quantity: l.quantity,
        unit: l.unit,
      })),
    };
  });
}
