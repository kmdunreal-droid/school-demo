/**
 * Shared data helpers used by App.tsx and all dashboards.
 *
 * Deep-compares two lists of entities by id + full content.
 * Returns true when `next` differs from `prev` in any way
 * (added, removed or modified items) — unlike length-only checks,
 * this catches same-length edits too.
 */
export function listChanged(prev: any[], next: any[]): boolean {
  if (!Array.isArray(prev) || prev.length !== next.length) return true;
  for (const item of next) {
    const matched = prev.find(p => String(p?.id) === String(item?.id));
    if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) return true;
  }
  return false;
}
