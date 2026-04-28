import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = join(process.cwd(), "..", "web-modern", "public");

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
