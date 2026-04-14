import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function findDotEnvPath(): string | null {
  let currentDir = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = resolve(currentDir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return null;
}

export function loadDotEnvFile(): void {
  const envPath = findDotEnvPath();
  if (!envPath) return;

  const content = readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = stripWrappingQuotes(rawValue);
  }
}
