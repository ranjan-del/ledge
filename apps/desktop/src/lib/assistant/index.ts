/**
 * What the UI imports: `getAssistantEngine()` for the app's one engine, `createAssistantEngine()`
 * to build one with overrides, and the fake for tests. The real engine reads the desk for its
 * per-turn context, exactly as Ask Ledge does, and keeps chats in `~/.ledge/chats/`.
 */
import { isoWeekOf } from '@ledge/core/pure';
import { renderLedgeContext } from '../ask.ts';
import { ensureDir, listDir, moveFile, readText, removeFile, writeText } from '../io.ts';
import { basename, join } from '../paths.ts';
import { desk, weekFor } from '../store.svelte.ts';
import { todayIso } from '../time.ts';
import { ClaudeAssistantEngine, type EngineOptions } from './engine.ts';
import { ChatHistory, type HistoryFs } from './history.ts';
import { shellAgentRunner } from './runner.ts';
import type { AssistantEngine } from './types.ts';

export type * from './types.ts';
export { ClaudeAssistantEngine } from './engine.ts';
export { FakeAssistantEngine, defaultScript, type FakeOptions, type FakeStep } from './fake.ts';
export { modelLabel, route, resolveModel } from './router.ts';
export { classify } from './policy.ts';

/** The real file operations, through the fs plugin, scoped to `~/.ledge`. */
export const pluginHistoryFs: HistoryFs = {
  readText,
  writeText,
  rename: moveFile,
  remove: removeFile,
  list: async (dir) => (await listDir(dir)).filter((e) => e.isFile).map((e) => e.name),
  ensureDir,
};

/** The Ledge context block for one turn, built from the desk as it is right now. */
export function deskContext(): string {
  return renderLedgeContext({
    day: todayIso(),
    tasks: desk.tasks,
    repos: desk.lastScan ? desk.pending : undefined,
    insights: desk.insights,
    sessions: desk.sessionRecords,
    now: new Date(),
    week: weekFor(isoWeekOf(todayIso())),
  });
}

/** Names on the desk the router treats as work: task titles and ids, and repository names. */
export function deskTerms(): string[] {
  const terms = new Set<string>();
  for (const t of desk.tasks) {
    if (t.status === 'done') continue;
    terms.add(t.id);
    terms.add(t.title);
    if (t.repo) terms.add(basename(t.repo));
  }
  for (const r of desk.pending) terms.add(basename(r.repo));
  return [...terms];
}

/** A new engine over the real Claude Code process and `~/.ledge/chats/`. */
export function createAssistantEngine(overrides: Partial<EngineOptions> = {}): ClaudeAssistantEngine {
  return new ClaudeAssistantEngine({
    runner: shellAgentRunner,
    history: new ChatHistory(() => join(desk.ledgeHome, 'chats'), pluginHistoryFs),
    context: deskContext,
    deskTerms,
    home: () => desk.home || undefined,
    ...overrides,
  });
}

let shared: ClaudeAssistantEngine | undefined;

/** The app's one engine, made on first use. The process ends with the page. */
export function getAssistantEngine(): AssistantEngine {
  if (!shared) {
    const engine = createAssistantEngine();
    shared = engine;
    try {
      globalThis.addEventListener?.('beforeunload', () => engine.dispose());
    } catch {
      /* Not in a browser: nothing to listen to. */
    }
  }
  return shared;
}
