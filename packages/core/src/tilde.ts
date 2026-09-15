/**
 * Pure path-string helpers shared by both entries of @ledge/core. Nothing here asks the
 * operating system anything: the home folder and any base folder arrive as arguments, so the
 * same code runs in Node and in the desktop WebView. Separator handling is done by hand rather
 * than with `node:path`; a path written with backslashes keeps them, everything else uses `/`,
 * which is the form Ledge stores in task files.
 */

const WINDOWS_ROOT = /^([A-Za-z]:)[\\/]/;
const TRAILING_SEPARATORS = /[\\/]+$/;
const LEADING_SEPARATORS = /^[\\/]+/;
const ANY_SEPARATOR = /[\\/]+/;

function separatorOf(p: string): string {
  return p.includes('\\') && !p.includes('/') ? '\\' : '/';
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\') || WINDOWS_ROOT.test(p);
}

/**
 * Cleans a path string: collapses repeated separators, drops `.` segments, applies `..` where
 * it can and removes a trailing separator. A relative path stays relative, because only the
 * caller knows what it should be resolved against.
 */
export function normalizePath(p: string): string {
  if (p === '') return '';
  const separator = separatorOf(p);
  const segments = p.split(ANY_SEPARATOR);
  const drive = WINDOWS_ROOT.exec(p);
  let root = '';
  if (drive) {
    root = drive[1]! + separator;
    segments.shift();
  } else if (LEADING_SEPARATORS.test(p)) {
    root = separator;
  }
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (root === '') out.push('..');
      continue;
    }
    out.push(segment);
  }
  const body = out.join(separator);
  if (root !== '') return root + body;
  return body === '' ? '.' : body;
}

/**
 * Resolves `p` against `base` and normalizes the result. An absolute `p` ignores `base`, and an
 * empty `base` leaves a relative path relative, which is the honest answer in a browser where
 * there is no working directory to resolve against.
 */
export function resolvePath(p: string, base: string = ''): string {
  if (isAbsolute(p) || base === '') return normalizePath(p);
  const root = base.replace(TRAILING_SEPARATORS, '');
  return normalizePath(root + separatorOf(root) + p);
}

/**
 * Expands a leading `~` or `~/` to the given home folder. Task files and config store paths
 * with a tilde so the same file reads naturally on any machine; code always works with absolute
 * paths, so expansion happens once at load time. An empty `home` means the caller does not know
 * where home is, and the path is returned untouched rather than guessed at.
 */
export function expandTilde(p: string, home: string): string {
  if (home === '') return p;
  const root = home.replace(TRAILING_SEPARATORS, '');
  if (p === '~') return root;
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    const rest = p.slice(2).replace(LEADING_SEPARATORS, '');
    return rest === '' ? root : normalizePath(root + separatorOf(root) + rest);
  }
  return p;
}

/**
 * Inverse of expandTilde: turns a path inside the home folder back into the `~/...` form used
 * inside files, always with forward slashes. Paths outside the home folder, and every path when
 * `home` is empty, are returned unchanged.
 */
export function collapseTilde(p: string, home: string): string {
  if (home === '') return p;
  const root = home.replace(TRAILING_SEPARATORS, '');
  if (p === root) return '~';
  const next = p[root.length];
  if (p.startsWith(root) && (next === '/' || next === '\\')) {
    return '~/' + p.slice(root.length + 1).split(ANY_SEPARATOR).join('/');
  }
  return p;
}
