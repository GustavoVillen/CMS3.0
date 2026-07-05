import type { IncomingMessage } from "node:http";
import { RouteError } from "./route-error";

// 50 MB default — cubre PDFs escaneados, fotos de progreso y adjuntos legítimos
// con margen. Corta temprano (aborta al superar el tope) para no acumular
// gigabytes en memoria: sin este límite, un body enorme puede agotar la RAM del
// proceso (DoS por OOM). Los callers con un límite de negocio más estricto
// (p.ej. assertFileSize = 10 MB para parseo IA) lo aplican además, después.
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Lee el body binario crudo (uploads) acumulando chunks con corte temprano.
 * Análogo a readJsonBody pero devuelve un Buffer sin parsear.
 */
export async function readBinaryBody(
  request: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      // Aborta antes de seguir acumulando — evita OOM por bodies gigantes.
      throw new RouteError(
        413,
        "PAYLOAD_TOO_LARGE",
        `El archivo excede el tamaño máximo (${Math.floor(maxBytes / (1024 * 1024))} MB).`,
      );
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}
