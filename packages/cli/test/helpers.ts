// Test helpers: pick the core (real or fake), then dynamically import main() so the resolve hook
// is in place before src/ is linked. Every test gets a fresh LEDGE_HOME from mkdtemp; ~/.ledge is
// never read or written.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeCore } from './fake-core/register.ts';

/** Which @ledge/core these tests run against. */
export const coreKind = useFakeCore();

const { main } = await import('../src/main.ts');

/** Captured result of one CLI invocation. */
export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Creates a fresh temp store directory, points LEDGE_HOME at it and returns the path. */
export function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ledge-cli-test-'));
  process.env.LEDGE_HOME = home;
  return home;
}

/** Removes a temp home created by freshHome(). */
export function removeHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

/**
 * Runs main() with the given argv, capturing stdout, stderr and the exit code. The working
 * directory defaults to the current LEDGE_HOME so `current` without --repo has a stable cwd.
 */
export async function run(argv: string[], cwd = process.env.LEDGE_HOME ?? '/'): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, {
    out: (text) => {
      stdout += text + '\n';
    },
    err: (text) => {
      stderr += text + '\n';
    },
    cwd,
  });
  return { code, stdout, stderr };
}

/**
 * Runs `ledge init` in a fresh home and returns the home path. The generated config gets
 * `roots: []` so the real core's git scan never walks this machine's repositories.
 */
export async function initHome(): Promise<string> {
  const home = freshHome();
  const result = await run(['init']);
  if (result.code !== 0) throw new Error(`init failed: ${result.stderr}`);
  const configPath = join(home, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as { roots: string[] };
  config.roots = [];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return home;
}

/** Adds a task with `ledge add --json` and returns its id. */
export async function addTask(title: string, ...extra: string[]): Promise<string> {
  const result = await run(['add', title, '--json', ...extra]);
  if (result.code !== 0) throw new Error(`add failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as { id: string }).id;
}
