/**
 * Per-turn model routing, a local heuristic with no model call (assistant tab contract,
 * Routing):
 *
 * - haiku: a short general-knowledge or chit-chat question that names nothing on the desk.
 * - opus: asks to analyse, plan, design, review, compare or audit, or is long (over 400 chars).
 * - sonnet: everything else, including every action and every question about the desk.
 *
 * Sonnet is the safe default, so every doubt resolves to it.
 */
import type { ModelChoice, ResolvedModel } from './types.ts';

/** Longer than this is large analysis, whatever it says. */
export const LONG_TEXT = 400;
/** Longer than this is not a quick question. */
export const SHORT_TEXT = 160;

export interface RouteTurn {
  role: 'user' | 'assistant';
  text: string;
  model?: ResolvedModel;
}

export interface RouteOptions {
  /** Names on the desk (task titles and ids, repositories, branches, people). */
  deskTerms?: readonly string[];
}

/** Verbs that change something: an action is always Sonnet or better. */
const WORK_VERBS =
  'add|create|make|new|park|unpark|grant|revoke|give|share|deploy|fix|start|begin|finish|done|complete|tick|untick|check off|' +
  'remove|delete|clear|drop|move|reschedule|schedule|remind|rename|note|log|push|pull|merge|commit|rebase|revert|send|email|' +
  'mail|message|dm|post|reply|invite|assign|update|edit|change|set|mark|close|reopen|open|run|build|test|install|write|' +
  'draft|summari[sz]e|recap|prioriti[sz]e|book|cancel|archive|restore|resume|continue|ship|release|upload|download|sync';

/** Nouns and words that point at the person's own work. */
const DESK_WORDS =
  'my|mine|me|i|we|our|us|task|tasks|todo|todos|to-do|to-dos|pending|backlog|week|weekly|today|tonight|tomorrow|yesterday|' +
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|repo|repos|repository|' +
  'repositories|branch|branches|commit|commits|pr|prs|pull request|project|projects|sprint|jira|ticket|tickets|issue|' +
  'issues|session|sessions|meeting|meetings|deadline|deadlines|standup|ledge|desk|agenda|calendar|inbox|slack|email|' +
  'emails|progress|status|blocked|blocker|blockers|next step|next steps|phase|milestone|firebase|gcloud|bitbucket|github|' +
  'deploy|deployment|release|access|permission|permissions|vendor|client|customer|team|colleague';

const ANALYSIS_VERBS = 'analy[sz]e|analysis|plan|design|review|compare|comparison|audit|assess|evaluate|architect|architecture|roadmap|strategy|trade-?offs?';

const wordsRe = (alts: string) => new RegExp(`(^|[^a-z0-9-])(${alts})(?=$|[^a-z0-9-])`, 'i');

const WORK_RE = wordsRe(WORK_VERBS);
const DESK_RE = wordsRe(DESK_WORDS);
const ANALYSIS_RE = wordsRe(ANALYSIS_VERBS);
/** Starts with an action verb, perhaps after a polite lead-in. */
const ACTION_START_RE = new RegExp(
  `^\\s*(?:(?:please|pls|hey|ok|okay|can you|could you|would you|will you|go ahead and|now)[\\s,]+)*(?:${WORK_VERBS})\\b`,
  'i',
);
/** Words that lean on something said before ("and that one?"). */
const FOLLOW_UP_RE = wordsRe('it|its|that|this|those|these|them|they|same|again|also|too|more|else|other|another|then');

/**
 * Something that reads like a name rather than an English word: a mixed-case token such as
 * `unLab` or `GitChips`, a slug or path (`ledge-wt-ui`, `apps/desktop`), an @handle or #ref,
 * code in backticks, or a number that looks like a ticket.
 */
function namesSomething(text: string): boolean {
  if (/`[^`]+`/.test(text)) return true;
  if (/[@#][A-Za-z0-9_-]+/.test(text)) return true;
  if (/\b[A-Z]{2,}-\d+\b/.test(text)) return true;
  if (/\b[\w.-]+\/[\w./-]+/.test(text)) return true;
  if (/\b[a-z0-9]+(?:[-_][a-z0-9]+){1,}\b/i.test(text)) return true;
  // Mixed case inside a word: lower then upper (unLab, iPhone is fine to catch too).
  if (/\b[a-z]+[A-Z][A-Za-z]*\b/.test(text)) return true;
  // CamelCase with two capitals (GitChips), not an acronym (LLM) or a sentence start.
  if (/\b[A-Z][a-z]+[A-Z][a-z]+\w*\b/.test(text)) return true;
  return false;
}

function mentionsDeskTerm(text: string, terms: readonly string[] | undefined): boolean {
  if (!terms || terms.length === 0) return false;
  const lower = text.toLowerCase();
  return terms.some((t) => {
    const term = t.trim().toLowerCase();
    if (term.length < 3) return false;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(lower);
  });
}

/** Text with quoted phrases taken out, so `add "review PR" to thursday` is not a review. */
function withoutQuotes(text: string): string {
  return text.replace(/"[^"]*"|“[^”]*”|'[^']{2,}'/g, ' ');
}

/** The model for this turn, from the words alone. */
export function route(text: string, history: readonly RouteTurn[] = [], options: RouteOptions = {}): ResolvedModel {
  const trimmed = text.trim();
  if (trimmed.length > LONG_TEXT) return 'opus';
  const bare = withoutQuotes(trimmed);
  const action = ACTION_START_RE.test(bare);
  if (!action && ANALYSIS_RE.test(bare)) return 'opus';
  if (action) return 'sonnet';
  if (WORK_RE.test(bare) || DESK_RE.test(bare)) return 'sonnet';
  if (namesSomething(trimmed) || mentionsDeskTerm(trimmed, options.deskTerms)) return 'sonnet';
  if (trimmed.length > SHORT_TEXT) return 'sonnet';
  // A short follow-up to a desk answer stays with the model that knows the thread.
  const last = [...history].reverse().find((t) => t.role === 'assistant');
  if (last?.model && last.model !== 'haiku' && FOLLOW_UP_RE.test(bare)) return 'sonnet';
  return 'haiku';
}

/** An explicit choice wins; Auto routes. */
export function resolveModel(
  choice: ModelChoice | undefined,
  text: string,
  history: readonly RouteTurn[] = [],
  options: RouteOptions = {},
): ResolvedModel {
  return choice && choice !== 'auto' ? choice : route(text, history, options);
}

/** The display name the UI shows under an answer. */
export function modelLabel(model: ResolvedModel): string {
  return model === 'haiku' ? 'Haiku' : model === 'opus' ? 'Opus' : 'Sonnet';
}
