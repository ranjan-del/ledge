import { describe, expect, it, vi } from 'vitest';
import capsText from '../src-tauri/capabilities/default.json?raw';
import { dateLine, replayTranscript, systemPrompt, toolSummary, turnText } from '../src/lib/assistant/prompt.ts';
import { AGENT_ARG_VALIDATORS, AGENT_PROGRAM, AGENT_SCRIPT, agentArgs } from '../src/lib/assistant/runner.ts';

vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));

type Entry = { name: string; cmd: string; args: (string | { validator: string })[] };

function agentEntry(): Entry | undefined {
  const caps = JSON.parse(capsText) as { permissions: unknown[] };
  const spawn = caps.permissions.find(
    (p): p is { identifier: string; allow: Entry[] } =>
      typeof p === 'object' && p !== null && (p as { identifier?: string }).identifier === 'shell:allow-spawn',
  );
  return spawn?.allow.find((a) => a.name === AGENT_PROGRAM);
}

/** What the shell plugin does with an entry: fixed args must be equal, validators match whole. */
function allowed(entry: Entry, args: string[]): boolean {
  if (entry.args.length !== args.length) return false;
  return entry.args.every((a, i) => (typeof a === 'string' ? a === args[i] : new RegExp(`^${a.validator}$`).test(args[i]!)));
}

describe('the claude-agent launch', () => {
  it('matches the capability entry exactly, and may write to stdin', () => {
    const entry = agentEntry();
    expect(entry?.cmd).toBe('/bin/sh');
    expect(entry?.args[1]).toBe(AGENT_SCRIPT);
    expect(entry?.args.slice(3)).toEqual(AGENT_ARG_VALIDATORS.map((validator) => ({ validator })));
    const caps = JSON.parse(capsText) as { permissions: unknown[] };
    expect(caps.permissions).toContain('shell:allow-stdin-write');
    expect(caps.permissions).toContain('shell:allow-kill');
  });

  it('builds arguments the capability allows, with and without a session to resume', () => {
    const entry = agentEntry()!;
    const fresh = agentArgs({ model: 'haiku', systemPrompt: 'Rules\nmore' });
    expect(fresh.slice(2)).toEqual(['ledge-assistant', 'haiku', 'Rules\nmore', '']);
    expect(allowed(entry, fresh)).toBe(true);
    const resumed = agentArgs({ model: 'opus', systemPrompt: 'x', resume: '11111111-2222-4333-8444-555555555555' });
    expect(allowed(entry, resumed)).toBe(true);
    expect(agentArgs({ model: 'sonnet', systemPrompt: 'x', resume: '$(rm -rf ~)' })[5]).toBe('');
    expect(allowed(entry, ['-c', AGENT_SCRIPT, 'ledge-assistant', 'xsonnetx', 'x', ''])).toBe(false);
  });

  it('runs the stdio protocol with the person’s own settings, quietly for Ledge hooks', () => {
    for (const flag of [
      '--input-format stream-json',
      '--output-format stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompt-tool stdio',
      '--permission-mode default',
      '--append-system-prompt',
      'LEDGE_CAPTURE=1',
      '$HOME/.local/bin',
      'cd "$HOME/.ledge"',
      '.claude/identity.md',
    ]) {
      expect(AGENT_SCRIPT).toContain(flag);
    }
    expect(AGENT_SCRIPT).not.toContain('--setting-sources');
    expect(AGENT_SCRIPT).not.toContain('--strict-mcp-config');
    expect(AGENT_SCRIPT).not.toContain('--no-session-persistence');
  });
});

describe('prompt', () => {
  it('carries the rules and the date, with no em or en dashes', () => {
    const p = systemPrompt('Saturday 27 September 2026, 10:00');
    expect(p).toContain('Today is Saturday 27 September 2026');
    expect(p).toMatch(/general questions directly and briefly/);
    expect(p).toMatch(/`ledge` command line tool/);
    expect(p).toMatch(/what you did in one line/);
    expect(p).not.toMatch(/[\u2013\u2014]/);
  });

  it('puts a fresh context block and the date in front of the words, and a replay when asked', () => {
    const now = new Date(2026, 8, 27, 10, 5);
    expect(dateLine(now)).toBe('Sunday 27 September 2026, 10:05');
    const t = turnText('  what is pending ', { now, context: 'CTX' });
    expect(t).toBe('<ledge-context now="Sunday 27 September 2026, 10:05">\nCTX\n</ledge-context>\n\nwhat is pending');
    expect(turnText('x', { now, replay: 'R' }).startsWith('R\n\n<ledge-context')).toBe(true);
    expect(turnText('x', { now })).toContain('(Ledge context unavailable this turn.)');
  });

  it('replays the last messages, cut short', () => {
    const msg = (role: 'user' | 'assistant', text: string) => ({ id: text, role, text, tools: [], approvals: [], at: '' });
    const r = replayTranscript([msg('user', 'hello'), msg('assistant', 'Hi.'), msg('assistant', '')])!;
    expect(r).toContain('Person: hello\nAssistant: Hi.');
    expect(replayTranscript([])).toBeUndefined();
    expect(replayTranscript([msg('user', 'x'.repeat(2000))])!.length).toBeLessThan(800);
  });

  it('summarises tool calls in one line', () => {
    expect(toolSummary('Bash', { command: 'cd ~/.ledge && ledge week add "Call vendor" --day thu' })).toBe(
      'ledge week add "Call vendor" --day thu',
    );
    expect(toolSummary('Bash', { command: 'git status\ngit log' })).toBe('git status');
    expect(toolSummary('Read', { file_path: '/Users/t/code/a.ts' }, '/Users/t')).toBe('Read ~/code/a.ts');
    expect(toolSummary('Grep', { pattern: 'TODO', path: '/Users/t/x' }, '/Users/t')).toBe('Search for "TODO" in ~/x');
    expect(toolSummary('WebSearch', { query: 'llm' })).toBe('Web search "llm"');
    expect(toolSummary('mcp__claude_ai_Slack__slack_send_message', { channel: 'C1', text: 'hi' })).toBe(
      'Slack: slack send message (C1)',
    );
    expect(toolSummary('Bash', { command: 'x'.repeat(300) }).length).toBeLessThanOrEqual(100);
  });
});
