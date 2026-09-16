import { describe, expect, it } from 'vitest';
import { buildPalette, flattenPalette, shorten, type PaletteGroup } from '../src/lib/palette.ts';
import { DAY, taskA, taskB, taskC } from './fixtures.ts';

const tasks = [taskA(), taskB(), taskC()];
const base = { tasks, surface: 'now' as const, day: DAY, now: Date.parse('2026-09-15T12:00:00Z') };

function group(groups: PaletteGroup[], kind: string): PaletteGroup | undefined {
  return groups.find((g) => g.kind === kind);
}

function labels(groups: PaletteGroup[], kind: string): string[] {
  return group(groups, kind)?.items.map((i) => i.label) ?? [];
}

describe('buildPalette, unasked', () => {
  it('offers the most recent tasks and a couple of actions, and nothing else', () => {
    const groups = buildPalette({ ...base, query: '' });
    expect(groups.map((g) => g.kind)).toEqual(['task', 'action']);
    expect(group(groups, 'task')?.label).toBe('Recent tasks');
    /* Task A is the newest `updated` of the three fixtures, C next, B oldest. */
    expect(labels(groups, 'task')[0]).toBe('Release watch banner for stale tabs');
    expect(group(groups, 'action')?.items).toHaveLength(2);
  });

  it('never offers to create a task with no title, since there is nothing to call it', () => {
    const groups = buildPalette({ ...base, query: '   ' });
    expect(labels(groups, 'action').some((l) => l.startsWith('Create task'))).toBe(false);
  });

  it('says where the recent tasks live and when they were last written', () => {
    const groups = buildPalette({ ...base, query: '' });
    expect(group(groups, 'task')?.items[0]?.sub).toBe('app · 18 h ago');
  });
});

describe('buildPalette, asked', () => {
  it('finds a task by title, requirement, checklist and plan', () => {
    expect(labels(buildPalette({ ...base, query: 'optimistic crud' }), 'task')).toEqual([
      'Optimistic CRUD for the admin grid',
    ]);
    expect(labels(buildPalette({ ...base, query: 'lazy routes' }), 'task')).toEqual([
      'Release watch banner for stale tabs',
    ]);
    /* `interval` appears only in task C's plan, so this proves the plan half on its own. */
    const plan = buildPalette({ ...base, query: 'interval' });
    expect(group(plan, 'task')?.items[0]?.sub).toBe('admin-web · plan');
  });

  it('finds a task by its repository, which the surfaces do not search', () => {
    const groups = buildPalette({ ...base, query: 'admin-web' });
    expect(labels(groups, 'task')).toEqual(['Roll the version file out to every app']);
    expect(group(groups, 'task')?.items[0]?.sub).toBe('admin-web · repository');
  });

  it('lists a task once however many ways it matched', () => {
    const files = group(buildPalette({ ...base, query: 'version' }), 'task')?.items.map(
      (i) => i.command,
    );
    expect(new Set(files?.map((c) => JSON.stringify(c))).size).toBe(files?.length);
  });

  it('finds a session by its id and by the task it worked on', () => {
    expect(labels(buildPalette({ ...base, query: 'b13e8b5e' }), 'session')).toEqual(['b13e8b5e']);
    expect(labels(buildPalette({ ...base, query: 'version file' }), 'session')).toEqual([
      '4c1d9a2b',
    ]);
  });

  it('opens the session id row on the task that recorded it', () => {
    const item = group(buildPalette({ ...base, query: 'b13e8b5e' }), 'session')?.items[0];
    expect(item?.command).toEqual({ type: 'open-task', file: taskA().file });
    expect(item?.mono).toBe(true);
  });

  it('finds a note and captions it with its day and its task', () => {
    const notes = group(buildPalette({ ...base, query: 'service worker' }), 'note');
    expect(notes?.items).toHaveLength(1);
    expect(notes?.items[0]?.label).toContain('Polling a static file beats a service worker');
    expect(notes?.items[0]?.sub).toBe('Sat, 12 Sept · Roll the version file out to every app');
  });

  it('carries the typed text into a create action, first among the actions', () => {
    const actions = group(buildPalette({ ...base, query: 'write the release notes' }), 'action');
    expect(actions?.items[0]?.label).toBe('Create task "write the release notes"');
    expect(actions?.items[0]?.command).toEqual({
      type: 'add-task',
      title: 'write the release notes',
    });
  });

  it('finds the actions the panel already has, by words not written on them', () => {
    const rescan = group(buildPalette({ ...base, query: 'git' }), 'action');
    expect(rescan?.items.map((i) => i.command)).toContainEqual({ type: 'rescan' });
    const memory = group(buildPalette({ ...base, query: 'memory' }), 'action');
    expect(memory?.items.map((i) => i.command)).toContainEqual({
      type: 'surface',
      surface: 'memory',
    });
  });

  it('does not offer to take you to the surface you are already on', () => {
    const here = buildPalette({ ...base, query: 'go to', surface: 'now' });
    expect(labels(here, 'action')).not.toContain('Go to Now');
    expect(labels(here, 'action')).toContain('Go to Sessions');
  });

  it('answers a query nothing matches with the create action alone', () => {
    const groups = buildPalette({ ...base, query: 'kubernetes' });
    expect(groups.map((g) => g.kind)).toEqual(['action']);
    expect(labels(groups, 'action')).toEqual(['Create task "kubernetes"']);
  });

  it('puts tasks before sessions before notes before actions', () => {
    const groups = buildPalette({ ...base, query: 'version file' });
    expect(groups.map((g) => g.kind)).toEqual(['task', 'session', 'note', 'action']);
  });
});

describe('shorten', () => {
  it('leaves a line that fits exactly as it was written', () => {
    expect(shorten('Polling a static file beats a service worker here', 96)).toBe(
      'Polling a static file beats a service worker here',
    );
  });

  it('cuts a long line at a word boundary and says that it did', () => {
    const cut = shorten('Polling a static file beats a service worker here', 30);
    expect(cut).toBe('Polling a static file beats a…');
    expect(cut.length).toBeLessThanOrEqual(31);
  });

  it('cuts mid word rather than throwing most of the line away', () => {
    expect(shorten('Averyverylongsingleword plus more', 12)).toBe('Averyverylon…');
  });

  it('is what a note row shows, so one note cannot own the list', () => {
    const notes = buildPalette({ ...base, query: 'service worker' });
    const label = notes.find((g) => g.kind === 'note')?.items[0]?.label ?? '';
    expect(label.length).toBeLessThanOrEqual(90);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('flattenPalette', () => {
  it('is the groups end to end, holding the same objects the groups hold', () => {
    const groups = buildPalette({ ...base, query: 'version file' });
    const flat = flattenPalette(groups);
    expect(flat).toHaveLength(groups.reduce((n, g) => n + g.items.length, 0));
    expect(flat[0]).toBe(groups[0]?.items[0]);
  });
});
