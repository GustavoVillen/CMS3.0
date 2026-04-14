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

  if (error instanceof Error) {
    return {
      statusCode: 400,
      payload: {
        error: {
          code: "REQUEST_FAILED",
          message: error.message,
        },
      },
    };
  }

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
