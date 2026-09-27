/**
 * The Ask Ledge conversation: a few turns held in memory for as long as the panel runs, so
 * closing the sheet and opening it again finds the conversation where it was. Nothing is
 * written anywhere. The runner and the context are handed in, which is what lets the chat
 * surface be tested with a stub in place of Claude Code.
 */
import {
  buildLedgePrompt,
  cleanAnswer,
  failureText,
  ledgeCommandOf,
  type AskTurn,
} from './ask.ts';
import type { AskRun, AskRunner } from './ask-runner.ts';

/** Turns kept on screen. Older ones fall off the top; the prompt quotes fewer still. */
export const KEEP_TURNS = 12;

export type TurnStatus = 'thinking' | 'streaming' | 'done' | 'error' | 'cancelled';

export interface RanCommand {
  id: string;
  command: string;
  /** Undefined until Claude Code reports how it went. */
  ok?: boolean;
}

export interface ChatTurn {
  id: number;
  question: string;
  /** Streamed text while running, the final answer after. */
  answer: string;
  status: TurnStatus;
  commands: RanCommand[];
  error?: string;
}

export interface Chat {
  turns: ChatTurn[];
  busy: boolean;
}

export function createChat(): Chat {
  return { turns: [], busy: false };
}

/** The one conversation the panel keeps. */
export const chat: Chat = $state(createChat());

let nextId = 1;
let current: AskRun | null = null;

/** Completed turns, as the prompt quotes them. */
function history(target: Chat): AskTurn[] {
  return target.turns
    .filter((t) => t.status === 'done')
    .map((t) => ({ question: t.question, answer: t.answer }));
}

export interface AskOptions {
  runner: AskRunner;
  /** Builds the context block at the moment of asking, so it is never stale. */
  context: () => string;
  cwd?: string;
  target?: Chat;
}

/**
 * Asks one question. Resolves when the run is over, whatever happened; a failure becomes an
 * honest message on the turn rather than a rejection.
 */
export async function ask(question: string, opts: AskOptions): Promise<void> {
  const target = opts.target ?? chat;
  const q = question.trim();
  if (q === '' || target.busy) return;
  let prompt: string;
  try {
    prompt = buildLedgePrompt(q, opts.context(), history(target));
  } catch (e) {
    prompt = buildLedgePrompt(q, `(the desk could not be read: ${String(e)})`, history(target));
  }
  target.turns.push({ id: nextId++, question: q, answer: '', status: 'thinking', commands: [] });
  if (target.turns.length > KEEP_TURNS) target.turns.splice(0, target.turns.length - KEEP_TURNS);
  /* Always edit the proxied element in the array, never a local copy, or the view misses it. */
  const turn = target.turns[target.turns.length - 1] as ChatTurn;
  target.busy = true;
  let final: { text: string; isError: boolean } | null = null;
  let freshMessage = false;

  const run = opts.runner(
    prompt,
    (event) => {
      if (event.type === 'turn') {
        freshMessage = turn.answer.trim() !== '';
      } else if (event.type === 'text') {
        if (freshMessage) {
          turn.answer = `${turn.answer.trimEnd()}\n\n`;
          freshMessage = false;
        }
        turn.answer += event.delta;
        turn.status = 'streaming';
      } else if (event.type === 'command') {
        const command = ledgeCommandOf(event.command) ?? event.command;
        turn.commands.push({ id: event.id, command });
      } else if (event.type === 'command-result') {
        const ran = turn.commands.find((c) => c.id === event.id);
        if (ran) ran.ok = event.ok;
      } else if (event.type === 'result') {
        final = { text: event.text, isError: event.isError };
      }
    },
    opts.cwd,
  );
  current = run;
  const outcome = await run.done;
  current = null;
  target.busy = false;

  const settled = final as { text: string; isError: boolean } | null;
  if (outcome.cancelled) {
    turn.status = 'cancelled';
    turn.answer = cleanAnswer(turn.answer);
    return;
  }
  if (settled && !settled.isError) {
    turn.answer = cleanAnswer(settled.text || turn.answer);
    turn.status = 'done';
    return;
  }
  turn.status = 'error';
  turn.answer = cleanAnswer(turn.answer);
  turn.error = settled?.isError
    ? failureText(outcome.code, `${outcome.stderr}\n${settled.text}`)
    : failureText(outcome.code, outcome.stderr);
}

/** Stops the question in flight, if there is one. */
export function cancelAsk(): void {
  current?.cancel();
}

/** Forgets the conversation. Refused while a question is running. */
export function clearChat(target: Chat = chat): void {
  if (target.busy) return;
  target.turns = [];
}
