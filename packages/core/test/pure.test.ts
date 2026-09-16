// Guards the one constraint the desktop bundle cannot recover from: `@ledge/core/pure` and
// everything it reaches must run in a WebView with no Node. The check walks the import graph
// from src/pure.ts rather than checking that one file, because the constraint is transitive: a
// `node:` import three modules down breaks the bundle just as surely as one at the top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(new URL('../src', import.meta.url)));
const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)[^;'"]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Every module specifier `file` imports or re-exports, static and dynamic alike. */
function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const re of [IMPORT_FROM, BARE_IMPORT, DYNAMIC_IMPORT]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) found.push(match[1]!);
  }
  return found;
}

/** Walks the import graph from `entry`, returning every reachable file inside src/. */
function reachable(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (graph.has(file)) continue;
    const specs = specifiers(file);
    graph.set(file, specs);
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue;
      const next = resolve(dirname(file), spec);
      if (!graph.has(next)) queue.push(next);
    }
  }
  return graph;
}

test('the pure entry reaches no node: import and no process', () => {
  const graph = reachable(resolve(SRC, 'pure.ts'));
  assert.ok(graph.size >= 6, `expected a real graph, walked ${graph.size} files`);
  for (const [file, specs] of graph) {
    const where = relative(SRC, file);
    for (const spec of specs) {
      assert.ok(!spec.startsWith('node:'), `${where} imports ${spec}`);
      assert.ok(spec.startsWith('.') || spec === 'yaml', `${where} imports ${spec}`);
    }
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\bprocess\./, `${where} reads process`);
  }
});

test('the pure entry reaches the four surface views', () => {
  const graph = reachable(resolve(SRC, 'pure.ts'));
  assert.ok(graph.has(resolve(SRC, 'surfaces.ts')), 'surfaces.ts is in the pure graph');
});
