import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = join(process.cwd(), "..", "web-modern", "public");

// WinAnsi (Windows-1252) safe range for PDFKit built-in fonts (Helvetica, etc.).
// Characters outside this range are replaced with ASCII equivalents before rendering.
const WINANSI_SAFE = new Set<number>([
  // Windows-1252 extensions (0x80-0x9F mapped codepoints)
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C,
  0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
  0x0153, 0x017E, 0x0178,
]);

function isWinAnsiSafe(cp: number): boolean {
  return cp <= 0xFF || WINANSI_SAFE.has(cp);
}

/**
 * Sanitize text for PDFKit built-in fonts (Helvetica / WinAnsi encoding).
 * Replaces known technical Unicode symbols with ASCII equivalents and
 * strips any remaining characters outside WinAnsi to prevent garbled output.
 */
export function sanitizePdfText(s: string): string {
  return s
    // Mathematical comparison / operators
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/≠/g, "!=")
    .replace(/≈/g, "~=")
    .replace(/∞/g, "inf")
    .replace(/√/g, "sqrt")
    .replace(/∑/g, "sum")
    .replace(/∆/g, "Delta")
    // Arrows
    .replace(/[→⟹⇒]/g, "->")
    .replace(/[←⟸⇐]/g, "<-")
    .replace(/↑/g, "^")
    .replace(/↓/g, "v")
    .replace(/↔/g, "<->")
    // Greek letters (commonly used in technical/maritime docs)
    .replace(/Ω/g, "Ohm")
    .replace(/μ/g, "u")          // Greek mu (≠ micro sign U+00B5 which IS in WinAnsi)
    .replace(/Δ/g, "Delta")
    .replace(/Σ/g, "Sigma")
    .replace(/π/g, "pi")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/γ/g, "gamma")
    .replace(/λ/g, "lambda")
    .replace(/ρ/g, "rho")
    .replace(/θ/g, "theta")
    .replace(/φ/g, "phi")
    // Checkbox-like symbols → plain marker. Bullets (• etc.) NO se reemplazan
    // acá porque las plantillas los interceptan y dibujan un cuadro real.
    .replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]")
    // Remove bold markdown markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    // Fallback: strip any remaining characters outside WinAnsi
    .replace(/[\s\S]/g, ch => isWinAnsiSafe(ch.codePointAt(0) ?? 0) ? ch : "?");
}

export const LOGO_PATH = join(PUBLIC_DIR, "logo.png");

export async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { timeout: 5000 } as RequestInit);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Resolves the tenant logo buffer.
 * Priority: local file in public/{slug}.png (case-insensitive) → logoUrl download → logoUrlLight download.
 */
export async function resolveTenantLogo(
  slug: string,
  logoUrl: string | null | undefined,
  logoUrlLight: string | null | undefined,
): Promise<Buffer | null> {
  // 1. Local file match (case-insensitive)
  if (existsSync(PUBLIC_DIR)) {
    try {
      const files = readdirSync(PUBLIC_DIR);
      const slugLower = slug.toLowerCase();
      const match = files.find(f => f.toLowerCase().replace(/\.[^.]+$/, "") === slugLower);
      if (match) {
        return readFileSync(join(PUBLIC_DIR, match));
      }
    } catch { /* non-blocking */ }
  }

  // 2. Download from URL
  const url = logoUrlLight || logoUrl;
  if (url) {
    return downloadImage(url);
  }

  return null;
}
