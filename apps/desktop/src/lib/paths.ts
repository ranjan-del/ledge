/**
 * Path helpers that work on plain strings in the webview, where Node's `path` module
 * is unavailable. Ledge stores absolute paths, so these are simple and predictable.
 */

/** Joins path segments with a single forward slash, trimming duplicate separators. */
export function join(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join('/');
}

/** Returns the last path segment, so `~/code/app` shows as `app` in a row. */
export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** The Ledge home folder for a given user home: `<home>/.ledge`. */
export function ledgeHomeFor(home: string): string {
  return join(home, '.ledge');
}

/** Expands a leading `~` to the given home folder; leaves other paths untouched. */
export function expandTilde(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}

/** True when `path` is a Markdown task file (ends in `.md`, not hidden). */
export function isTaskFile(p: string): boolean {
  const name = basename(p);
  return name.endsWith('.md') && !name.startsWith('.');
}
