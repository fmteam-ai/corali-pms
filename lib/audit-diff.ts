/** Top-level fields whose values differ between two audit payloads (JSON-compared). */
export function changedFields(before: unknown, after: unknown): { field: string; before: unknown; after: unknown }[] {
  const a = before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const b = after && typeof after === "object" && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(b), ...(before ? Object.keys(a) : [])])];
  return keys
    .filter((key) => JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null))
    .map((key) => ({ field: key, before: a[key] ?? null, after: b[key] ?? null }));
}
