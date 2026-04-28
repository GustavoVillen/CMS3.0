import ExcelJS from "exceljs";
import type { ExcelModule } from "./excel-permissions";
import { getModuleColumns } from "./excel-template";

export interface ParsedRow {
  rowNumber: number;
  data: Record<string, string | number | null>;
}

export interface ParseResult {
  ok: boolean;
  rows: ParsedRow[];
  errors: string[];
  fixes: string[];
}

const MATCHING_KEY: Record<ExcelModule, string> = {
  vessels:           "code",
  assets:            "assetCode",
  maintenance_plans: "taskCode",
  spares:            "sku",
  providers:         "providerCode",
  certificates:      "certificateCode",
};

const HEADER_ALIASES: Record<string, string> = {
  VesselName: "name",
  Codigo_Embarcacion: "code",
  Armador: "owner",
  Tipo: "vesselType",
  IMO: "imo",
  Matricula: "registration",
  Potencia_HP: "powerHp",
  DWT_tons: "dwtTons",
  Eslora_m: "lengthM",
  Manga_m: "beamM",
  Puntal_m: "depthM",
  TRN_tn: "trnTn",
  TRB_tn: "trbTn",
  Ano_Construcc: "buildYear",
  Pais_Construccion: "buildCountry",
  Fecha_Incorporacion: "incorporationDate",
  Tipo_Incorporacion: "incorporationType",
};

export async function parseExcelBuffer(buffer: Buffer, module: ExcelModule): Promise<ParseResult> {
  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  const workbook = new ExcelJS.Workbook();
  // @ts-ignore — ExcelJS 4.x types predate Buffer<T> generic in @types/node
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { ok: false, rows: [], errors: ["El archivo no contiene hojas."], fixes: [] };
  }

  // Read header row
  const headerRow = sheet.getRow(1);
  const headerMap: Record<number, string> = {};
  headerRow.eachCell((cell, colNumber) => {
    const raw = String(cell.value ?? "").trim();
    // strip trailing " *" from required column headers
    const key = raw.replace(/ \*$/, "");
    headerMap[colNumber] = HEADER_ALIASES[key] ?? key;
  });

  // Validate required columns exist
  const cols = getModuleColumns(module);
  const requiredCols = cols.filter((c) => c.required).map((c) => c.key);
  const presentKeys = Object.values(headerMap);
  for (const req of requiredCols) {
    if (!presentKeys.includes(req)) {
      errors.push(`Columna requerida ausente: "${req}"`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, rows: [], errors, fixes: [] };
  }

  // Parse data rows
  const matchingKey = MATCHING_KEY[module];
  // Map: keyStr → index in rows[] for deduplication
  const seenKeys = new Map<string, number>();
  const fixes: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const data: Record<string, string | number | null> = {};
    let hasAnyValue = false;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headerMap[colNumber];
      if (!key) return;
      const val = cell.value;
      if (val === null || val === undefined || val === "") {
        data[key] = null;
      } else if (val instanceof Date) {
        data[key] = val.toISOString().split("T")[0]; // YYYY-MM-DD
        hasAnyValue = true;
      } else if (typeof val === "object") {
        if ("richText" in val) {
          // Rich text cell — join all text fragments
          const text = (val as { richText: Array<{ text: string }> }).richText
            .map((r) => r.text)
            .join("")
            .trim();
          data[key] = text || null;
          if (text) hasAnyValue = true;
        } else if ("text" in val) {
          // Hyperlink cell
          const text = String((val as { text: string }).text).trim();
          data[key] = text || null;
          if (text) hasAnyValue = true;
        } else if ("result" in val) {
          // Formula cell — use the computed result, not the formula string
          const result = (val as { result: unknown }).result;
          if (result === null || result === undefined || result === "") {
            data[key] = null;
          } else if (result instanceof Date) {
            data[key] = result.toISOString().split("T")[0];
            hasAnyValue = true;
          } else {
            data[key] = result as string | number;
            hasAnyValue = true;
          }
        } else {
          // Unknown object shape — treat as empty to avoid "[object Object]"
          data[key] = null;
        }
      } else {
        data[key] = val as string | number;
        hasAnyValue = true;
      }
    });

    if (!hasAnyValue) return; // skip empty rows

    // Always coerce sfiCode to string (Excel reads numeric codes like 700 as numbers)
    if (data.sfiCode !== null && data.sfiCode !== undefined) {
      data.sfiCode = String(data.sfiCode);
    }

    const keyValue = data[matchingKey];
    if (!keyValue) {
      errors.push(`Fila ${rowNumber}: falta el campo de clave "${matchingKey}".`);
      return;
    }

    const keyStr = String(keyValue);
    if (seenKeys.has(keyStr)) {
      // Auto-fix: replace the earlier row with this one (keep last occurrence)
      const existingIdx = seenKeys.get(keyStr)!;
      const prevRow = rows[existingIdx];
      fixes.push(`Fila ${rowNumber}: clave duplicada "${keyStr}" — reemplaza fila ${prevRow.rowNumber} (se conserva la última).`);
      rows[existingIdx] = { rowNumber, data };
      seenKeys.set(keyStr, existingIdx);
      return;
    }

    seenKeys.set(keyStr, rows.length);
    rows.push({ rowNumber, data });
  });

  return { ok: errors.length === 0, rows, errors, fixes };
}

export function getMatchingKey(module: ExcelModule): string {
  return MATCHING_KEY[module];
}
