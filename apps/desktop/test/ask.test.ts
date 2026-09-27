import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AskLedge from '../src/components/AskLedge.svelte';
import {
  buildLedgePrompt,
  cleanAnswer,
  failureText,
  ledgeCommandOf,
  parseStreamLine,
  renderLedgeContext,
  type AskEvent,
} from '../src/lib/ask.ts';
import { ASK_PROGRAM, ASK_SCRIPT, askArgs, type AskOutcome, type AskRunner } from '../src/lib/ask-runner.ts';
import { chat, clearChat } from '../src/lib/ask-state.svelte.ts';
import { buildPalette } from '../src/lib/palette.ts';
import capsText from '../src-tauri/capabilities/default.json?raw';
import { DAY, repoStatus, taskA, taskB, taskC } from './fixtures.ts';

vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));

const line = (o: unknown) => JSON.stringify(o);

describe('parseStreamLine', () => {
  it('reads text deltas, message starts, Bash calls, their results and the final result', () => {
    expect(
      parseStreamLine(
        line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } }),
      ),
    ).toEqual([{ type: 'text', delta: 'Hi' }]);
    expect(parseStreamLine(line({ type: 'stream_event', event: { type: 'message_start' } }))).toEqual([
      { type: 'turn' },
    ]);
    expect(
      parseStreamLine(
        line({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ledge tick a 2' } }] },
        }),
      ),
    ).toEqual([{ type: 'command', id: 't1', command: 'ledge tick a 2' }]);
    expect(
      parseStreamLine(
        line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } }),
      ),
    ).toEqual([{ type: 'command-result', id: 't1', ok: false }]);
    expect(parseStreamLine(line({ type: 'result', subtype: 'success', is_error: false, result: 'Done.' }))).toEqual([
      { type: 'result', text: 'Done.', isError: false },
    ]);
  });

  it('ignores what it does not need, and anything that is not JSON', () => {
    expect(parseStreamLine('not json')).toEqual([]);
    expect(parseStreamLine(line({ type: 'system', subtype: 'init' }))).toEqual([]);
    expect(parseStreamLine('')).toEqual([]);
  });
});

describe('helpers', () => {
  it('keeps only the ledge part of a command', () => {
    expect(ledgeCommandOf('ledge note a "x"')).toBe('ledge note a "x"');
    expect(ledgeCommandOf('cd /tmp && ledge list --json')).toBe('ledge list --json');
    expect(ledgeCommandOf('git status')).toBeUndefined();
  });

  it('takes Markdown decoration off an answer and keeps the words', () => {
    expect(cleanAnswer('## Next\n**Poll** on `focus`\n\n\n\nThen ship.')).toBe('Next\nPoll on focus\n\nThen ship.');
  });

  it('explains a missing Claude Code and a signed out one in words', () => {
    expect(failureText(127, '')).toMatch(/not installed/);
    expect(failureText(1, 'Not logged in · Please run /login')).toMatch(/not signed in/);
    expect(failureText(1, '')).toMatch(/exit 1/);
  });
});

describe('the prompt and its context', () => {
  const context = renderLedgeContext({
    day: DAY,
    tasks: [taskA(), taskB(), { ...taskC(), status: 'done' }],
    repos: [repoStatus()],
    insights: {
      'release-watch-banner': {
        version: 1,
        taskId: 'release-watch-banner',
        headline: 'Build step next',
        phase: 'Build step',
        notes: {},
        plan: {},
        updatedAt: '',
      },
    },
    sessions: [
      {
        version: 1,
        id: 's1',
        taskId: 'release-watch-banner',
        title: 'Poller work',
        summary: 'Wrote the poll.',
        started: '2026-09-15T10:00:00+05:30',
        lastActivity: '2026-09-15T10:30:00+05:30',
        ended: '2026-09-15T10:30:00+05:30',
        filesChanged: ['a.ts'],
        commits: [{ sha: 'abc', subject: 'feat: poll' }],
        todosTicked: [],
        todosAdded: [],
      },
    ],
    now: new Date('2026-09-15T12:00:00+05:30'),
  });

  it('carries tasks, git, insights and sessions, and leaves done tasks out', () => {
    expect(context).toContain('id: release-watch-banner');
    expect(context).toContain('id: optimistic-crud');
    expect(context).not.toContain('id: version-file-rollout');
    expect(context).toContain('branch feature/banner');
    expect(context).toContain('release-watch-banner: headline: Build step next; current phase: Build step');
    expect(context).toContain('ended task=release-watch-banner: Poller work');
    expect(context).toContain('commits: feat: poll');
  });

  it('puts the question last and quotes the conversation before it', () => {
    const prompt = buildLedgePrompt('What next?', context, [{ question: 'Hi', answer: 'Hello.' }]);
    expect(prompt.indexOf('Person: Hi')).toBeGreaterThan(prompt.indexOf('=== END ==='));
    expect(prompt.trimEnd().endsWith('What next?')).toBe(true);
    expect(prompt).toContain('Never delete a task');
    expect(prompt).not.toMatch(/[–—]/);
  });
});

describe('the launch', () => {
  it('matches the claude-ask entry in the capabilities file exactly', () => {
    const caps = JSON.parse(capsText) as { permissions: unknown[] };
    const spawn = caps.permissions.find(
      (p): p is { identifier: string; allow: { name: string; cmd: string; args: unknown[] }[] } =>
        typeof p === 'object' && p !== null && (p as { identifier?: string }).identifier === 'shell:allow-spawn',
    );
    const entry = spawn?.allow.find((a) => a.name === ASK_PROGRAM);
    expect(entry?.cmd).toBe('/bin/sh');
    const args = askArgs('prompt');
    expect(entry?.args.slice(0, 3)).toEqual(args.slice(0, 3));
    expect(entry?.args[1]).toBe(ASK_SCRIPT);
    expect(caps.permissions).toContain('shell:allow-kill');
  });

  it('runs Sonnet with no settings, Bash for ledge only, and refuses delete and git', () => {
    for (const flag of [
      '--model sonnet',
      "--setting-sources ''",
      '--tools Bash',
      '--permission-mode dontAsk',
      "--allowedTools 'Bash(ledge:*)'",
      "'Bash(ledge delete:*)'",
      "'Bash(git:*)'",
      '--output-format stream-json',
    ]) {
      expect(ASK_SCRIPT).toContain(flag);
    }
    expect(ASK_SCRIPT).toContain('LEDGE_CAPTURE=1');
  });
});

/* ---------------------------------------------------------------- the chat surface */

function stubRunner(script: AskEvent[], outcome: Partial<AskOutcome> = {}) {
  const prompts: string[] = [];
  const runner: AskRunner = (prompt, onEvent) => {
    prompts.push(prompt);
    const done = (async () => {
      for (const e of script) {
        await Promise.resolve();
        onEvent(e);
      }
      return { code: 0, stderr: '', cancelled: false, ...outcome };
    })();
    return { done, cancel: () => {} };
  };
  return { runner, prompts };
}

describe('AskLedge', () => {
  afterEach(() => clearChat());

  it('asks the palette question at once, streams the answer and lists the ledge commands', async () => {
    const { runner, prompts } = stubRunner([
      { type: 'turn' },
      { type: 'text', delta: 'Ticking it.' },
      { type: 'command', id: 't1', command: 'ledge tick release-watch-banner 3' },
      { type: 'command-result', id: 't1', ok: true },
      { type: 'turn' },
      { type: 'text', delta: 'Done, **item 3** is ticked.' },
      { type: 'result', text: 'Done, **item 3** is ticked.', isError: false },
    ]);
    render(AskLedge, {
      props: { runner, context: () => 'CTX', initial: 'Tick the build step', onclose: () => {} },
    });
    await waitFor(() => expect(chat.turns[0]?.status).toBe('done'));
    expect(prompts[0]).toContain('CTX');
    expect(prompts[0]?.trimEnd().endsWith('Tick the build step')).toBe(true);
    expect(await screen.findByText('Done, item 3 is ticked.')).toBeTruthy();
    const ran = screen.getByRole('list', { name: 'Commands Ledge ran' });
    expect(ran.textContent).toContain('ledge tick release-watch-banner 3');
  });

  it('shows a thinking state until words arrive', async () => {
    let release: (() => void) | undefined;
    const runner: AskRunner = () => ({
      done: new Promise((resolve) => {
        release = () => resolve({ code: 0, stderr: '', cancelled: false });
      }),
      cancel: () => {},
    });
    render(AskLedge, { props: { runner, context: () => '', initial: 'Anything?', onclose: () => {} } });
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    release?.();
    await waitFor(() => expect(chat.busy).toBe(false));
  });

  it('says honestly when Claude Code is missing', async () => {
    const { runner } = stubRunner([], { code: 127 });
    render(AskLedge, { props: { runner, context: () => '', initial: 'Hello?', onclose: () => {} } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/not installed/);
  });

  it('quotes the earlier turn when a follow up is asked from the field', async () => {
    const first = stubRunner([{ type: 'result', text: 'Two tasks.', isError: false }]);
    const { unmount } = render(AskLedge, {
      props: { runner: first.runner, context: () => '', initial: 'How many?', onclose: () => {} },
    });
    await waitFor(() => expect(chat.turns[0]?.status).toBe('done'));
    unmount();
    /* The conversation outlives the sheet. */
    const second = stubRunner([{ type: 'result', text: 'The banner.', isError: false }]);
    render(AskLedge, { props: { runner: second.runner, context: () => '', onclose: () => {} } });
    expect(screen.getByText('Two tasks.')).toBeTruthy();
    const field = screen.getByLabelText('Your question') as HTMLTextAreaElement;
    await fireEvent.input(field, { target: { value: 'Which first?' } });
    await fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(chat.turns[1]?.status).toBe('done'));
    expect(second.prompts[0]).toContain('Person: How many?');
    expect(second.prompts[0]).toContain('Ledge: Two tasks.');
  });
});

describe('the palette offers Ask Ledge', () => {
  const base = { tasks: [taskA(), taskC()], surface: 'now' as const, day: DAY };

  it('only when asked to', () => {
    expect(buildPalette({ ...base, query: 'why poll?' }).some((g) => g.kind === 'ask')).toBe(false);
  });

  it('first for a question, after what the desk found otherwise', () => {
    const q = buildPalette({ ...base, query: 'what is left on the banner?', ask: true });
    expect(q[0]?.kind).toBe('ask');
    expect(q[0]?.items[0]?.command).toEqual({ type: 'ask', question: 'what is left on the banner?' });
    const plain = buildPalette({ ...base, query: 'banner', ask: true });
    expect(plain[0]?.kind).toBe('task');
    expect(plain.map((g) => g.kind)).toContain('ask');
  });
});
