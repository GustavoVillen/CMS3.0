import type { IncomingMessage } from "node:http";
import { RouteError } from "./route-error";

// 16 MB default — covers normal JSON payloads and base64-encoded file attachments
// up to ~10 MB raw (the file-parser-service MAX_FILE_BYTES). Callers that legitimately
// need more can pass a higher maxBytes; callers that handle uploads bypass this
// helper entirely and stream chunks directly.
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export async function readJsonBody<T>(
  request: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      // Abort early — don't accumulate gigabytes in memory.
      throw new RouteError(
        413,
        "PAYLOAD_TOO_LARGE",
        `Request body exceeds ${maxBytes} bytes.`,
      );
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new Error("Request body is empty.");
  }

  return JSON.parse(raw) as T;
}
