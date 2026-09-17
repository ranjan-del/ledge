// Everything the three assistant commands share: building the context a prompt is allowed to
// see, and asking a provider for an answer without ever letting a missing provider become a
// failure. Rendering lives in ./format.ts with the rest of the output.
import { isPending, loadConfig, scanRepos } from '@ledge/core';
import type { AskContext, AskResult, Provider, RepoStatus, Task, TaskStore } from '@ledge/core';

/**
 * Which repositories a context carries. `named` is the working tree of every repository the
 * tasks themselves name. `pending` is those plus any other repository in the scan with
 * uncommitted or unpushed work, which is the part of the machine's state a person forgets over
 * a weekend and wants raised on a desk-wide view.
 */
export type RepoScope = 'named' | 'pending';

/**
 * Reads the git state that belongs with a set of tasks, at the given scope.
 *
 * Returns undefined when the scan could not be run at all. That is deliberately not the same
 * answer as an empty list: the context block spells one as "no scan was run, so nothing is
 * known" and the other as "the scan ran and found nothing", and a model told the wrong one of
 * those would report a clean tree that was never looked at.
 */
export async function gitFor(
  store: TaskStore,
  tasks: Task[],
  scope: RepoScope = 'pending',
): Promise<RepoStatus[] | undefined> {
  const named = new Set(tasks.map((task) => task.repo).filter((repo): repo is string => !!repo));
  try {
    const config = loadConfig(store.home);
    const statuses = await scanRepos(config, { referenced: [...named] });
    return statuses.filter(
      (status) => named.has(status.repo) || (scope === 'pending' && isPending(status)),
    );
  } catch {
    return undefined;
  }
}

/** How a caller shapes its context. Both have defaults; a command passes only what it changes. */
export interface ContextOptions {
  /** Dated notes quoted per task. Left to core's default when absent. */
  notesPerTask?: number;
  /** Which repositories to read. Defaults to `pending`. */
  repoScope?: RepoScope;
}

/**
 * Assembles the context for a prompt: the day, the tasks to quote and the git state that goes
 * with them. One function builds it for every command so that what the model is shown and what
 * the command prints as observed facts are provably the same reading of the store.
 */
export async function gatherContext(
  store: TaskStore,
  tasks: Task[],
  day: string,
  options: ContextOptions = {},
): Promise<AskContext> {
  const context: AskContext = { day, tasks };
  const repos = await gitFor(store, tasks, options.repoScope ?? 'pending');
  if (repos !== undefined) context.repos = repos;
  if (options.notesPerTask !== undefined) context.notesPerTask = options.notesPerTask;
  return context;
}

/** Either an answer from a provider, or the reason there is none. Never both, never neither. */
export interface Inference {
  answer?: AskResult;
  /** One or two sentences: why nothing was asked or nothing came back, and what to do next. */
  noInference?: string;
}

/**
 * Asks a provider a prompt and turns every way that can go wrong into a sentence rather than an
 * exception. A provider that is missing, signed out, broken, slow or silent all end the same
 * way here: no answer, and a reason the person can act on. This is what keeps inference an
 * addition to Ledge instead of a dependency, since every caller carries on and prints the facts
 * it read from the files either way.
 */
export async function ask(provider: Provider, prompt: string): Promise<Inference> {
  let usable = false;
  try {
    usable = await provider.available();
  } catch (error) {
    return { noInference: `The ${provider.name} provider could not be checked: ${message(error)}` };
  }
  if (!usable) {
    const reason = provider.unavailableReason?.();
    return {
      noInference:
        reason ??
        `The ${provider.name} provider is not available, and did not say why. Nothing was asked.`,
    };
  }
  try {
    return { answer: await provider.ask(prompt) };
  } catch (error) {
    const why = `The ${provider.name} provider was asked but could not answer: ${message(error)}`;
    return { noInference: why };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
