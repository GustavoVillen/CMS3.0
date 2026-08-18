// Fuzzy-match de un texto libre (mención de un equipo en un documento
// escaneado por IA) contra los Asset reales del tenant. Compartido entre los
// extractores de IA que leen fotos/PDF (fluid-analyses, work-orders): nunca
// devuelve un id inventado, sólo el activo real más parecido por texto, con
// su score — el llamador decide si el score alcanza para preseleccionarlo.
import { getPrismaClient } from "../../platform/data/prisma-client";
import type { TenantAccessSession } from "../auth/session-store";

export interface AssetMatchSuggestion {
  id: string;
  name: string;
  score: number;
}

// Umbral 0.5: requiere al menos 50% de tokens compartidos (Jaccard). Un
// umbral más bajo matchea falsos positivos (ej. "Motor Port" con "Pump
// Motor" por compartir un solo token), y un match falso lleva a registrar
// el documento contra el activo equivocado.
const DEFAULT_THRESHOLD = 0.5;

export async function suggestAssetByFuzzyText(
  session: TenantAccessSession,
  vesselCode: string | null,
  referenceText: string,
  threshold = DEFAULT_THRESHOLD,
): Promise<AssetMatchSuggestion | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const tenant = await (prisma as any).tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) return null;

  const where: any = { tenantId: tenant.id, deletedAt: null };
  if (vesselCode) where.vesselCode = vesselCode;
  const assets: Array<{ id: string; name: string | null; assetCode: string | null }> = await (prisma as any).asset.findMany({
    where, select: { id: true, name: true, assetCode: true }, take: 500,
  });

  const ref = normalize(referenceText);
  let best: AssetMatchSuggestion | null = null;
  for (const a of assets) {
    const candidate = `${a.name ?? ""} ${a.assetCode ?? ""}`;
    const score = jaccard(ref, normalize(candidate));
    if (!best || score > best.score) best = { id: a.id, name: a.name ?? a.assetCode ?? a.id, score };
  }
  if (best && best.score >= threshold) return best;
  return null;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function jaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
