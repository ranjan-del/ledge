// Test helpers: pick the core (real or fake), then dynamically import main() so the resolve hook
// is in place before src/ is linked. Every test gets a fresh LEDGE_HOME from mkdtemp; ~/.ledge is
// never read or written.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeCore } from './fake-core/register.ts';
import type { Provider } from '@ledge/core';

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

/** A provider stand-in that also keeps every prompt it was handed, for tests to assert on. */
export interface RecordingProvider extends Provider {
  prompts: string[];
}

/**
 * A provider that is never available. It is the default for every test in this suite, which is
 * the point: no test can reach a model or the network by forgetting to inject one, and the
 * machine running the tests may not even have Claude Code installed.
 */
export function noProvider(reason?: string): RecordingProvider {
  return {
    name: 'test-none',
    prompts: [],
    available: async () => false,
    unavailableReason: () => reason ?? 'No provider is configured in this test.',
    ask: async () => {
      throw new Error('noProvider was asked, which a test should never do');
    },
  };
}

/** A provider that answers every prompt with `text` and records what it was asked. */
export function fakeProvider(text: string): RecordingProvider {
  const provider: RecordingProvider = {
    name: 'test-fake',
    prompts: [],
    available: async () => true,
    ask: async (prompt: string) => {
      provider.prompts.push(prompt);
      return { text, provider: 'test-fake' };
    },
  };
  return provider;
}

/** A provider that is available but fails when asked, for the "asked and could not answer" path. */
export function failingProvider(message: string): RecordingProvider {
  return {
    name: 'test-broken',
    prompts: [],
    available: async () => true,
    ask: async () => {
      throw new Error(message);
    },
  };
}

/**
 * Runs main() with the given argv, capturing stdout, stderr and the exit code. The working
 * directory defaults to the current LEDGE_HOME so `current` without --repo has a stable cwd, and
 * the provider defaults to one that is never available so no test reaches a model by accident.
 */
export async function run(
  argv: string[],
  cwd = process.env.LEDGE_HOME ?? '/',
  provider: Provider = noProvider(),
): Promise<RunResult> {
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
    provider,
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
