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
    // Strip markdown bold/italic before anything else
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    // Mathematical comparison operators — \uXXXX escapes only, no literal Unicode chars
    .replace(/[≥≧⩾]/g, ">=")   // ≥ ≧ ⩾
    .replace(/[≤≦⩽]/g, "<=")   // ≤ ≦ ⩽
    .replace(/≠/g, "!=")                  // ≠
    .replace(/≈/g, "~=")                  // ≈
    .replace(/∞/g, "inf")                 // ∞
    .replace(/√/g, "sqrt")                // √
    .replace(/∑/g, "sum")                 // ∑
    .replace(/[Δ∆]/g, "Delta")       // Δ ∆
    // Arrows
    .replace(/[→⟹⇒]/g, "->")   // → ⟹ ⇒
    .replace(/[←⟸⇐]/g, "<-")   // ← ⟸ ⇐
    .replace(/↑/g, "^")                   // ↑
    .replace(/↓/g, "v")                   // ↓
    .replace(/↔/g, "<->")                 // ↔
    // Greek letters
    .replace(/Ω/g, "Ohm")                 // Ω
    .replace(/μ/g, "u")                   // μ
    .replace(/Σ/g, "Sigma")               // Σ
    .replace(/π/g, "pi")                  // π
    .replace(/α/g, "alpha")               // α
    .replace(/β/g, "beta")                // β
    .replace(/γ/g, "gamma")               // γ
    .replace(/λ/g, "lambda")              // λ
    .replace(/ρ/g, "rho")                 // ρ
    .replace(/θ/g, "theta")               // θ
    .replace(/φ/g, "phi")                 // φ
    // Checkbox-like symbols → plain marker
    .replace(/[ð☐☑☒□■✓✔✘]/g, "[ ]")
    // Fallback: replace any remaining non-WinAnsi char
    .replace(/[\s\S]/g, ch => {
      const cp = ch.codePointAt(0) ?? 0;
      if (isWinAnsiSafe(cp)) return ch;
      if (cp >= 0x2212 && cp <= 0x2215) return "-";
      return "?";
    });
}

export const LOGO_PATH = join(PUBLIC_DIR, "logo.png");

/**
 * Resolves the tenant logo buffer from local files only.
 * Looks for public/{slug}.{ext} (case-insensitive). Returns null if not found.
 *
 * Previously had a fallback that fetched logoUrl/logoUrlLight via HTTP — removed
 * (R-15 / H-01 SSRF). User-controlled tenant settings could trigger requests
 * to arbitrary URLs, including internal services. Local files are the only
 * trusted source; if a tenant needs a custom logo, it must be uploaded as a
 * file under public/.
 */
export async function resolveTenantLogo(
  slug: string,
  _logoUrl: string | null | undefined,
  _logoUrlLight: string | null | undefined,
): Promise<Buffer | null> {
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

  return null;
}
