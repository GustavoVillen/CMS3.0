type Primitive = string | number | boolean | null | undefined;

export interface FieldChange { from: Primitive; to: Primitive }
export type ChangeDiff = Record<string, FieldChange>;

function fmt(v: unknown): Primitive {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/**
 * Returns only the fields that changed between `before` and `after`.
 * `fields` restricts which keys are compared (omit internal/system fields).
 */
export function buildChangeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): ChangeDiff {
  const diff: ChangeDiff = {};
  for (const key of fields) {
    const a = fmt(before[key]);
    const b = fmt(after[key]);
    if (a !== b) diff[key] = { from: a, to: b };
  }
  return diff;
}
