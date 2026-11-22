/** Reads `a.b.c` from a nested object; `undefined` when any step is missing. */
export function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Writes `a.b.c` into a nested object, creating the maps on the way. Mutates and
 * returns `target`. `saveDoc` merges nested maps, so a write built this way only
 * touches the leaves it names.
 */
export function setPath<T extends Record<string, unknown>>(target: T, path: string, value: unknown): T {
  const keys = path.split(".");
  let current: Record<string, unknown> = target;
  keys.slice(0, -1).forEach((key) => {
    const next = current[key];
    if (next == null || typeof next !== "object" || Array.isArray(next)) current[key] = {};
    current = current[key] as Record<string, unknown>;
  });
  current[keys[keys.length - 1]] = value;
  return target;
}
