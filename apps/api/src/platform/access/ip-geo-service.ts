/**
 * Geolocalización por IP — traduce la IP de un acceso a un lugar legible
 * (ciudad, país, proveedor de internet) para la consola SUPERADMIN.
 *
 * Reglas:
 *  - Todo se cachea en la tabla `IpGeo`: cada IP se consulta UNA vez contra el
 *    servicio externo y se reusa por 30 días. El volumen real es de decenas de
 *    IPs únicas por día, así que la carga externa es despreciable.
 *  - Las IPs privadas / loopback NUNCA salen a internet: se marcan `isPrivate`
 *    y se rotulan "Red local".
 *  - Toda falla es silenciosa. Si el servidor no tiene salida a internet o el
 *    proveedor está caído, la pantalla igual carga y muestra la IP cruda.
 *    La geolocalización es información de apoyo, jamás motivo de un 500.
 */

import { getPrismaClient } from "../data/prisma-client";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const LOOKUP_TIMEOUT_MS = 4000;
const MAX_CONCURRENT_LOOKUPS = 5;

/** Proveedor por defecto: gratis, HTTPS, sin API key. Cambiable por env. */
function geoEndpoint(ip: string): string {
  const tpl = String(process.env.IP_GEO_ENDPOINT || "https://ipwho.is/{ip}").trim();
  return tpl.includes("{ip}") ? tpl.replace("{ip}", encodeURIComponent(ip)) : `${tpl}${encodeURIComponent(ip)}`;
}

export interface IpGeoInfo {
  ip: string;
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrivate: boolean;
  /** Texto ya armado para mostrar: "Asunción, Paraguay" / "Red local" / "—". */
  label: string;
}

// ── IPs privadas ─────────────────────────────────────────────────────────────

/**
 * Rangos que no tienen ubicación pública: loopback, LAN, link-local y las
 * direcciones IPv6 equivalentes (incluido el formato mapeado ::ffff:10.0.0.1
 * que devuelve el socket de Node cuando el server escucha en dual-stack).
 */
export function isPrivateIp(raw: string): boolean {
  const ip = raw.trim().toLowerCase().replace(/^::ffff:/, "");
  if (!ip) return true;
  if (ip === "::1" || ip === "::" || ip === "localhost") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // IPv6 unique-local
  if (ip.startsWith("fe80:")) return true;                     // IPv6 link-local

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

function normalizeIp(raw: string | null | undefined): string | null {
  const ip = String(raw ?? "").trim().replace(/^::ffff:/i, "");
  return ip.length > 0 && ip.length <= 45 ? ip : null;
}

// ── Formato para mostrar ─────────────────────────────────────────────────────

function buildLabel(row: {
  isPrivate: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
}): string {
  if (row.isPrivate) return "Red local";
  const parts = [row.city || row.region, row.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function toInfo(ip: string, row: {
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrivate: boolean;
}): IpGeoInfo {
  return {
    ip,
    countryCode: row.countryCode,
    country: row.country,
    region: row.region,
    city: row.city,
    isp: row.isp,
    latitude: row.latitude,
    longitude: row.longitude,
    isPrivate: row.isPrivate,
    label: buildLabel(row),
  };
}

const PRIVATE_INFO = (ip: string): IpGeoInfo => toInfo(ip, {
  countryCode: null, country: null, region: null, city: null, isp: null,
  latitude: null, longitude: null, isPrivate: true,
});

const UNKNOWN_INFO = (ip: string): IpGeoInfo => toInfo(ip, {
  countryCode: null, country: null, region: null, city: null, isp: null,
  latitude: null, longitude: null, isPrivate: false,
});

// ── Consulta al proveedor externo ────────────────────────────────────────────

interface ProviderResult {
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  latitude: number | null;
  longitude: number | null;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Acepta la forma de ipwho.is y también la de ip-api.com, para que cambiar de
 * proveedor por `IP_GEO_ENDPOINT` no requiera tocar código.
 */
function parseProviderPayload(data: Record<string, unknown>): ProviderResult | null {
  // ipwho.is marca el fallo con success:false; ip-api.com con status:"fail".
  if (data.success === false) return null;
  if (typeof data.status === "string" && data.status !== "success") return null;

  const connection = (data.connection ?? {}) as Record<string, unknown>;

  const result: ProviderResult = {
    countryCode: str(data.country_code) ?? str(data.countryCode),
    country:     str(data.country),
    region:      str(data.region) ?? str(data.regionName),
    city:        str(data.city),
    isp:         str(connection.isp) ?? str(connection.org) ?? str(data.isp) ?? str(data.org),
    latitude:    num(data.latitude) ?? num(data.lat),
    longitude:   num(data.longitude) ?? num(data.lon),
  };

  const hasAnything = result.country || result.city || result.latitude !== null;
  return hasAnything ? result : null;
}

async function lookupExternal(ip: string): Promise<ProviderResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(geoEndpoint(ip), { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return parseProviderPayload(data);
  } catch {
    return null; // sin internet, timeout, JSON inválido — todo se trata igual
  } finally {
    clearTimeout(timer);
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

/** Resuelve una IP. Nunca lanza: ante cualquier problema devuelve datos vacíos. */
export async function resolveIpGeo(rawIp: string | null | undefined): Promise<IpGeoInfo | null> {
  const ip = normalizeIp(rawIp);
  if (!ip) return null;
  const map = await resolveIpGeoMany([ip]);
  return map.get(ip) ?? UNKNOWN_INFO(ip);
}

/**
 * Resuelve muchas IPs de una. Deduplica, lee todo lo cacheado en una sola
 * consulta y solo sale a internet por las que faltan (de a 5 en paralelo).
 */
export async function resolveIpGeoMany(rawIps: Array<string | null | undefined>): Promise<Map<string, IpGeoInfo>> {
  const out = new Map<string, IpGeoInfo>();

  const unique = new Set<string>();
  for (const raw of rawIps) {
    const ip = normalizeIp(raw);
    if (ip) unique.add(ip);
  }
  if (unique.size === 0) return out;

  // Las privadas se resuelven sin tocar la base ni la red.
  const toResolve: string[] = [];
  for (const ip of unique) {
    if (isPrivateIp(ip)) out.set(ip, PRIVATE_INFO(ip));
    else toResolve.push(ip);
  }
  if (toResolve.length === 0) return out;

  const prisma = getPrismaClient();
  if (!prisma) {
    for (const ip of toResolve) out.set(ip, UNKNOWN_INFO(ip));
    return out;
  }

  const freshAfter = new Date(Date.now() - CACHE_TTL_MS);
  const pending: string[] = [];

  try {
    const cached = await prisma.ipGeo.findMany({ where: { ip: { in: toResolve } } });
    const byIp = new Map(cached.map((row) => [row.ip, row]));

    for (const ip of toResolve) {
      const row = byIp.get(ip);
      if (row && row.resolvedAt >= freshAfter) {
        out.set(ip, toInfo(ip, row));
      } else {
        pending.push(ip);
      }
    }
  } catch {
    // La caché no se pudo leer — se intenta resolver todo contra el proveedor.
    pending.push(...toResolve);
  }

  // Salida a internet, con concurrencia acotada.
  for (let i = 0; i < pending.length; i += MAX_CONCURRENT_LOOKUPS) {
    const batch = pending.slice(i, i + MAX_CONCURRENT_LOOKUPS);
    await Promise.all(batch.map(async (ip) => {
      const found = await lookupExternal(ip);
      const row = {
        countryCode: found?.countryCode ?? null,
        country:     found?.country ?? null,
        region:      found?.region ?? null,
        city:        found?.city ?? null,
        isp:         found?.isp ?? null,
        latitude:    found?.latitude ?? null,
        longitude:   found?.longitude ?? null,
        isPrivate:   false,
      };
      out.set(ip, toInfo(ip, row));

      // Se cachea también el fallo, para no martillar al proveedor con una IP
      // que no sabe resolver. `failed` deja rastro de por qué está vacía.
      try {
        await prisma.ipGeo.upsert({
          where:  { ip },
          create: { ip, ...row, failed: !found },
          update: { ...row, failed: !found, resolvedAt: new Date() },
        });
      } catch {
        /* la caché es un lujo, no un requisito */
      }
    }));
  }

  return out;
}
