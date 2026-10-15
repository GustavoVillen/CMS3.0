// Código sugerido de un equipo nuevo: {BUQUE}-{GRUPO SFI}-{INICIALES}-{NNN}.
// Lo usan la ficha de Equipos y el asistente "Nueva OT → Para un Equipo Nuevo".

export function toAssetCodeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildNamePrefix(name: string): string {
  const tokens = toAssetCodeToken(name).split("-").filter(Boolean);
  if (tokens.length === 0) return "AS";
  const ignored = new Set(["SYSTEM", "SYSTEMS", "EQUIPMENT", "UNIT", "GENERAL"]);
  const meaningful = tokens.filter(token => !ignored.has(token));
  if (meaningful.length >= 2) return `${meaningful[0][0]}${meaningful[1][0]}`.slice(0, 4);
  if (meaningful.length === 1) return meaningful[0].slice(0, 4);
  return tokens[0].slice(0, 4) || "AS";
}

export function nextSequentialAssetCode(prefix: string, existingCodes: Set<string>): string {
  const normalizedPrefix = toAssetCodeToken(prefix).slice(0, 8) || "AS";
  const matcher = new RegExp(`^${escapeRegExp(normalizedPrefix)}-(\\d{3,4})$`);
  let maxSeq = 0;

  for (const code of existingCodes) {
    const match = code.match(matcher);
    if (!match) continue;
    const seq = Number(match[1]);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }

  const next = maxSeq + 1;
  const width = next >= 1000 ? 4 : 3;
  return `${normalizedPrefix}-${String(next).padStart(width, "0")}`;
}

/** `existingCodes` = códigos del buque ya pasados por toAssetCodeToken. */
export function buildFormattedAssetCode(
  vesselCode: string,
  groupNumber: string,
  name: string,
  existingCodes: Set<string>,
): string {
  const vc = toAssetCodeToken(vesselCode);
  const gn = groupNumber.trim();
  const namePrefix = buildNamePrefix(name);
  const prefix = vc && gn ? `${vc}-${gn}-${namePrefix}` : namePrefix;
  return nextSequentialAssetCode(prefix, existingCodes);
}
