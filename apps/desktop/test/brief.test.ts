import { beforeEach, describe, expect, it, vi } from 'vitest';

const shell = vi.hoisted(() => ({
  calls: [] as { name: string; args: string[] }[],
  briefOut: { code: 0 as number | null, stdout: '', stderr: '' },
  fail: false,
}));

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn(async () => '/home/t') }));
vi.mock('@tauri-apps/plugin-fs', () => ({}));
vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn((name: string, args: string[]) => ({
      execute: async () => {
        shell.calls.push({ name, args });
        if (name === 'ledge-brief') {
          if (shell.fail) throw new Error('not allowed');
          return { ...shell.briefOut, signal: null };
        }
        return { code: 0, stdout: '', stderr: '', signal: null };
      },
    })),
  },
}));

import capsText from '../src-tauri/capabilities/default.json?raw';
import {
  BRIEF_MAX_LINES,
  BRIEF_SCRIPT,
  RESUME_WINDOW_MS,
  acceptBrief,
  buildBrief,
  chooseLaunch,
} from '../src/lib/brief.ts';
import type { SessionRecord } from '../src/lib/insights.ts';
import { launchCommand, openInClaude } from '../src/lib/platform.ts';
import { desk } from '../src/lib/store.svelte.ts';
import { taskA, taskC } from './fixtures.ts';

const claude = { command: 'claude', resumeFlag: '--resume' };
const NOW = new Date('2026-09-27T12:00:00+05:30');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function rec(id: string, lastActivity: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    version: 1,
    id,
    taskId: 'release-watch-banner',
    started: lastActivity,
    lastActivity,
    filesChanged: [],
    commits: [],
    todosTicked: [],
    todosAdded: [],
    ...extra,
  };
}

describe('chooseLaunch', () => {
  const task = taskA();

  it('resumes a session active in the last 12 hours', () => {
    const plan = chooseLaunch({ task, records: [rec('071729a1', hoursAgo(2))], now: NOW, resume: true });
    expect(plan).toEqual({ kind: 'resume', sessionId: '071729a1' });
  });

  it('briefs a new session when the newest is older than 12 hours', () => {
    const plan = chooseLaunch({ task, records: [rec('071729a1', hoursAgo(13))], now: NOW, resume: true });
    expect(plan).toEqual({ kind: 'brief' });
    expect(RESUME_WINDOW_MS).toBe(12 * 3_600_000);
  });

  it('judges the session asked about, not the newest one', () => {
    const records = [rec('new', hoursAgo(1)), rec('old', hoursAgo(30))];
    expect(chooseLaunch({ task, records, now: NOW, resume: true, sessionId: 'old' })).toEqual({ kind: 'brief' });
    expect(chooseLaunch({ task, records, now: NOW, resume: true, sessionId: 'new' })).toEqual({
      kind: 'resume',
      sessionId: 'new',
    });
  });

  it('falls back to the task updated time for an id with no record', () => {
    const fresh = { ...task, updated: hoursAgo(1) };
    expect(chooseLaunch({ task: fresh, records: [], now: NOW, resume: true })).toEqual({
      kind: 'resume',
      sessionId: '071729a1',
    });
    expect(chooseLaunch({ task, records: [], now: NOW, resume: true })).toEqual({ kind: 'brief' });
  });

  it('always briefs for Open in Claude, and when there is no session at all', () => {
    expect(chooseLaunch({ task, records: [rec('x', hoursAgo(1))], now: NOW, resume: false })).toEqual({
      kind: 'brief',
    });
    expect(chooseLaunch({ task: { ...task, sessions: [] }, records: [], now: NOW, resume: true })).toEqual({
      kind: 'brief',
    });
  });
});

describe('buildBrief', () => {
  it('carries title, requirement, phase, open todos, last session and last note', () => {
    const task = taskC();
    const brief = buildBrief(
      task,
      {
        version: 1,
        taskId: task.id,
        headline: 'Build done, poll next',
        phase: 'Poll on focus',
        notes: {},
        plan: {},
        updatedAt: '',
      },
      rec('s', hoursAgo(20), { title: 'Wrote the build step', summary: 'version.json lands in dist.' }),
    );
    expect(brief).toContain('Resume the Ledge task "Roll the version file out to every app"');
    expect(brief).toContain('Where it stands: Build done, poll next');
    expect(brief).toContain('Every app writes version.json at build');
    expect(brief).toContain('Current phase: Poll on focus');
    expect(brief).toContain('- Poll on focus');
    expect(brief).not.toContain('- Build step writes version.json');
    expect(brief).toContain('Last session: Wrote the build step. version.json lands in dist.');
    expect(brief).toContain('Last note (2026-09-14): Chunk load errors are the safety net');
  });

  it('never runs past 40 lines, and says how many todos it left out', () => {
    const task = { ...taskA(), checklist: Array.from({ length: 80 }, (_, i) => ({ text: `item ${i}`, done: false })) };
    const brief = buildBrief(task);
    expect(brief.split('\n').length).toBeLessThanOrEqual(BRIEF_MAX_LINES);
    expect(brief).toMatch(/\(and \d+ more in the task file\)/);
  });

  it('accepts ledge brief output only when it succeeded with words', () => {
    expect(acceptBrief(0, ' Brief \n')).toBe('Brief');
    expect(acceptBrief(1, 'Brief')).toBeUndefined();
    expect(acceptBrief(0, '  ')).toBeUndefined();
  });
});

describe('launchCommand and openInClaude', () => {
  beforeEach(() => {
    shell.calls = [];
    shell.fail = false;
    shell.briefOut = { code: 0, stdout: 'BRIEF FROM CLI\nline two', stderr: '' };
    desk.sessionRecords = [];
    desk.insights = {};
    desk.home = '/home/t';
  });

  it('keeps claude --resume for a recent session', async () => {
    desk.sessionRecords = [rec('071729a1', hoursAgo(1))];
    expect(await launchCommand(taskA(), true, claude, { now: NOW })).toBe(`claude --resume '071729a1'`);
    expect(shell.calls).toEqual([]);
  });

  it('passes ledge brief output as the prompt for an old session', async () => {
    desk.sessionRecords = [rec('071729a1', hoursAgo(30))];
    const cmd = await launchCommand(taskA(), true, claude, { now: NOW });
    expect(cmd).toBe(`claude 'BRIEF FROM CLI\nline two'`);
    expect(shell.calls[0]).toEqual({ name: 'ledge-brief', args: ['-c', BRIEF_SCRIPT, 'ledge-brief', 'release-watch-banner'] });
  });

  it('builds the brief locally when ledge brief is unavailable', async () => {
    shell.briefOut = { code: 127, stdout: '', stderr: '' };
    const cmd = await launchCommand(taskA(), false, claude, { now: NOW });
    expect(cmd).toContain('Resume the Ledge task "Release watch banner for stale tabs"');
    shell.fail = true;
    const again = await launchCommand(taskA(), false, claude, { now: NOW });
    expect(again).toContain('Open todos:');
  });

  it('opens the terminal with that command', async () => {
    const result = await openInClaude(taskA(), false);
    expect(result).toEqual({ ok: true });
    const osa = shell.calls.find((c) => c.name === 'osascript');
    expect(osa?.args[1]).toContain('BRIEF FROM CLI');
  });

  it('matches the ledge-brief entry in the capabilities file exactly', () => {
    const caps = JSON.parse(capsText) as { permissions: unknown[] };
    const exec = caps.permissions.find(
      (p): p is { identifier: string; allow: { name: string; cmd: string; args: unknown[] }[] } =>
        typeof p === 'object' && p !== null && (p as { identifier?: string }).identifier === 'shell:allow-execute',
    );
    const entry = exec?.allow.find((a) => a.name === 'ledge-brief');
    expect(entry?.cmd).toBe('/bin/sh');
    expect(entry?.args.slice(0, 3)).toEqual(['-c', BRIEF_SCRIPT, 'ledge-brief']);
  });
});
