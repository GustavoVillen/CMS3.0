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

  // No diferenciamos prod vs dev al responder al cliente. Cualquier error.message
  // que no sea un RouteError deliberado puede leakear paths internos, queries
  // SQL, nombres de tablas, etc. El detalle solo va a stderr (logs internos).
  if (error instanceof Error) {
    process.stderr.write(`[unhandled-error] ${error.stack ?? error.message}\n`);
    return {
      statusCode: 500,
      payload: {
        error: {
          code: "INTERNAL_ERROR",
          message: "An internal error occurred.",
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
        message: "An internal error occurred.",
      },
    },
  };
}
