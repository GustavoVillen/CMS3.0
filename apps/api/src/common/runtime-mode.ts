/**
 * Runtime mode detection — fail-closed.
 *
 * `isDevelopmentMode()` returns true ONLY when NODE_ENV is explicitly set to
 * "development". If NODE_ENV is unset, "production", "staging", a typo, or
 * anything else, it returns false. This avoids the dangerous pattern of
 * `NODE_ENV || "development"` which would silently activate dev fallbacks
 * (demo credentials, mock data, debug responses) in any environment that
 * forgets to set NODE_ENV.
 */
export function isDevelopmentMode(): boolean {
  const v = process.env.NODE_ENV;
  if (typeof v !== "string") return false;
  return v.trim().toLowerCase() === "development";
}

export function isProductionMode(): boolean {
  const v = process.env.NODE_ENV;
  if (typeof v !== "string") return false;
  return v.trim().toLowerCase() === "production";
}
