const isProduction = process.env.NODE_ENV === "production";

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message;
      if (typeof a === "object" && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
}

export const log = {
  debug: (...args: unknown[]): void => {
    if (isProduction) return;
    process.stdout.write(`[debug] ${fmt(args)}\n`);
  },
  info: (...args: unknown[]): void => {
    if (isProduction) return;
    process.stdout.write(`[info] ${fmt(args)}\n`);
  },
  warn: (...args: unknown[]): void => {
    process.stderr.write(`[warn] ${fmt(args)}\n`);
  },
  error: (...args: unknown[]): void => {
    process.stderr.write(`[error] ${fmt(args)}\n`);
  },
};
