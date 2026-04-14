/**
 * SPA router for web-legacy.
 *
 * Mount point: /ui
 * The backend serves index.html for GET /ui and GET /ui/*.
 * All history pushes prefix logical paths with /ui.
 *
 * Logical routes:
 *   /app/login        → tenant login page
 *   /app/dashboard    → tenant dashboard
 *   /app/*            → other tenant pages
 *   /platform/login   → platform login page
 *   /platform/tenants → platform tenants list
 *   /platform/*       → other platform pages
 */

const SPA_MOUNT = "/ui";

export type RouteHandler = () => void | Promise<void>;

interface Route {
  pattern: string;
  handler: RouteHandler;
}

const _routes: Route[] = [];

/** Strip /ui prefix; returns logical path (always starts with /). */
export function getLogicalPath(): string {
  const full = window.location.pathname;
  if (full === SPA_MOUNT || full === SPA_MOUNT + "/") return "/";
  if (full.startsWith(SPA_MOUNT + "/")) return full.slice(SPA_MOUNT.length);
  return full; // fallback: treat as-is
}

/** Push browser history and dispatch the handler for logicalPath. */
export function navigate(logicalPath: string): void {
  const url = SPA_MOUNT + (logicalPath === "/" ? "" : logicalPath);
  window.history.pushState({}, "", url);
  dispatch();
}

/** Register a route pattern → handler. Supports prefix patterns ending with /*. */
export function registerRoute(pattern: string, handler: RouteHandler): void {
  _routes.push({ pattern, handler });
}

/** Dispatch to the first matching route. */
export function dispatch(): void {
  const path = getLogicalPath();
  for (const { pattern, handler } of _routes) {
    if (matchesPattern(pattern, path)) {
      void handler();
      return;
    }
  }
  navigate("/app/login");
}

function matchesPattern(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(prefix + "/");
  }
  return false;
}

/** Boot the router: handle browser back/forward + initial dispatch. */
export function initRouter(): void {
  window.addEventListener("popstate", () => dispatch());
  dispatch();
}

/** Produce an absolute /ui-prefixed href for use in anchor tags. */
export function href(logicalPath: string): string {
  return SPA_MOUNT + logicalPath;
}
