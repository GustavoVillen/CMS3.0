export class RouteError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function toErrorPayload(error: unknown): { statusCode: number; payload: { error: { code: string; message: string } } } {
  if (error instanceof RouteError) {
    return {
      statusCode: error.statusCode,
      payload: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  const isProduction = process.env.NODE_ENV === "production";

  if (error instanceof Error) {
    process.stderr.write(`[unhandled-error] ${error.stack ?? error.message}\n`);
    return {
      statusCode: 500,
      payload: {
        error: {
          code: "INTERNAL_ERROR",
          message: isProduction ? "An internal error occurred." : error.message,
        },
      },
    };
  }

  process.stderr.write(`[unknown-error] ${String(error)}\n`);
  return {
    statusCode: 500,
    payload: {
      error: {
        code: "UNKNOWN_ERROR",
        message: "Unknown error.",
      },
    },
  };
}
