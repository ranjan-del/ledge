import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WINDOW_MS,
  contentKey,
  isSessionRunning,
  parseInsights,
  parseSessionRecord,
  sessionDurationMs,
  type SessionRecord,
} from '@ledge/core/pure';
import {
  clip,
  noteDigest,
  noteFallback,
  noteKey,
  stepDigest,
  stepFallback,
} from '../src/lib/digest.ts';

function rec(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    version: 1,
    id: 's1',
    started: '2026-09-27T10:00:00+05:30',
    lastActivity: '2026-09-27T10:40:00+05:30',
    filesChanged: [],
    commits: [],
    todosTicked: [],
    todosAdded: [],
    ...overrides,
  };
}

describe('contentKey', () => {
  it('is FNV-1a 32 bit as 8 lowercase hex', () => {
    /* Reference values for FNV-1a 32: the empty string is the offset basis. */
    expect(contentKey('')).toBe('811c9dc5');
    expect(contentKey('a')).toBe('e40c292c');
    expect(contentKey('foobar')).toBe('bf9cf968');
  });

  it('ignores how the text was wrapped or padded', () => {
    expect(contentKey('  one\n two\t\tthree ')).toBe(contentKey('one two three'));
    expect(contentKey('one two')).not.toBe(contentKey('one  twox'));
  });
});

describe('parseSessionRecord', () => {
  it('reads a full record', () => {
    const r = parseSessionRecord(JSON.stringify(rec({ title: 'T', commits: [{ sha: 'abc', subject: 's' }] })));
    expect(r?.title).toBe('T');
    expect(r?.commits).toEqual([{ sha: 'abc', subject: 's' }]);
  });

  it('treats junk, the wrong version and a missing id as absent', () => {
    expect(parseSessionRecord('nope')).toBeUndefined();
    expect(parseSessionRecord(JSON.stringify({ ...rec(), version: 2 }))).toBeUndefined();
    expect(parseSessionRecord(JSON.stringify({ ...rec(), id: '' }))).toBeUndefined();
  });

  it('fills missing lists with empty ones rather than failing', () => {
    const r = parseSessionRecord(JSON.stringify({ version: 1, id: 'x', started: '2026-09-27T10:00:00Z' }));
    expect(r).toMatchObject({ filesChanged: [], commits: [], todosTicked: [], todosAdded: [] });
    expect(r?.lastActivity).toBe('2026-09-27T10:00:00Z');
  });
});

describe('parseInsights', () => {
  it('keeps well formed entries and drops the rest', () => {
    const i = parseInsights(
      JSON.stringify({
        version: 1,
        taskId: 't',
        notes: { a: { title: 'A', summary: 'sa' }, b: { nope: 1 } },
        plan: { c: { title: 'C' } },
        updatedAt: 'x',
      }),
    );
    expect(Object.keys(i?.notes ?? {})).toEqual(['a']);
    expect(i?.plan.c).toEqual({ title: 'C' });
  });

  it('is absent for anything that is not version 1 with a task id', () => {
    expect(parseInsights('{}')).toBeUndefined();
    expect(parseInsights(JSON.stringify({ version: 1 }))).toBeUndefined();
  });
});

describe('running and duration', () => {
  const at = (iso: string) => new Date(iso);

  it('is running while not ended and active within the window', () => {
    const r = rec();
    const last = Date.parse(r.lastActivity);
    expect(isSessionRunning(r, new Date(last + ACTIVE_WINDOW_MS - 1000))).toBe(true);
    expect(isSessionRunning(r, new Date(last + ACTIVE_WINDOW_MS + 1000))).toBe(false);
    expect(isSessionRunning(rec({ ended: r.lastActivity }), at(r.lastActivity))).toBe(false);
  });

  it('measures to the last activity, even once the session has ended', () => {
    expect(sessionDurationMs(rec())).toBe(40 * 60_000);
    expect(sessionDurationMs(rec({ ended: '2026-09-27T11:00:00+05:30' }))).toBe(40 * 60_000);
    expect(sessionDurationMs(rec({ started: 'bad' }))).toBe(0);
  });
});

describe('digest fallback', () => {
  it('titles a note with its first sentence and summarises with the next two', () => {
    const d = noteFallback('Chose polling. It is simple. It reuses config. It is cheap.');
    expect(d).toEqual({ title: 'Chose polling.', summary: 'It is simple. It reuses config.' });
  });

  it('cuts a long first sentence at 60 characters with an ellipsis', () => {
    const long = 'Polling a static file beats a service worker here because the app already fetches config';
    const d = noteFallback(long);
    expect(d.title.length).toBeLessThanOrEqual(60);
    expect(d.title.endsWith('…')).toBe(true);
    expect(clip('short')).toBe('short');
  });

  it('reads through Markdown list markers and emphasis', () => {
    expect(noteFallback('- **Decided** to use `fetch`.\n- Then shipped.').title).toBe(
      'Decided to use fetch.',
    );
  });

  it('titles a plan step with the text up to a colon or a bracket', () => {
    expect(stepFallback('Build the poller: every 60 s and on focus. Then log it.')).toEqual({
      title: 'Build the poller',
      summary: 'every 60 s and on focus. Then log it.',
    });
    expect(stepFallback('Ship the banner (behind a flag)')).toEqual({
      title: 'Ship the banner',
      summary: 'behind a flag',
    });
    expect(stepFallback('Short step')).toEqual({ title: 'Short step', summary: '' });
  });
});

describe('digest lookup', () => {
  const note = { date: '2026-09-14', body: 'Chunk load errors are the safety net. Not the mechanism.' };

  it('uses a current insight for a note, found by its content key', () => {
    const insights = {
      version: 1 as const,
      taskId: 't',
      notes: { [noteKey(note)]: { title: 'Safety net only', summary: 'The poll does the work.' } },
      plan: {},
      updatedAt: '',
    };
    expect(noteDigest(note, insights)).toMatchObject({
      title: 'Safety net only',
      summary: 'The poll does the work.',
      fromInsight: true,
    });
  });

  it('falls back when the insight is stale because the note changed', () => {
    const insights = {
      version: 1 as const,
      taskId: 't',
      notes: { [noteKey({ ...note, body: 'older words' })]: { title: 'Stale', summary: '' } },
      plan: {},
      updatedAt: '',
    };
    const d = noteDigest(note, insights);
    expect(d.fromInsight).toBe(false);
    expect(d.title).toBe('Chunk load errors are the safety net.');
    expect(d.hasMore).toBe(false);
  });

  it('uses a plan insight keyed by the step text', () => {
    const step = 'Write version.json in the build step';
    const insights = {
      version: 1 as const,
      taskId: 't',
      notes: {},
      plan: { [contentKey(step)]: { title: 'Build writes version', detail: 'In vite.' } },
      updatedAt: '',
    };
    expect(stepDigest(step, insights)).toMatchObject({ title: 'Build writes version', summary: 'In vite.' });
    expect(stepDigest(step).title).toBe(step);
    expect(stepDigest(step).hasMore).toBe(false);
  });
});
