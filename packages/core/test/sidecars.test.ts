// Tests for the sidecar records of the AI assistant contract: the content key both the CLI and
// the panel file insights under, the tolerant parsers, the running and duration helpers, and the
// two stores that write the files. Every store test runs in its own temporary LEDGE_HOME.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTIVE_WINDOW_MS,
  InsightStore,
  SessionStore,
  contentKey,
  emptyInsights,
  isSessionRunning,
  noteKey,
  parseInsights,
  parseSessionRecord,
  serializeSessionRecord,
  sessionDurationMs,
} from '../src/index.ts';
import * as pure from '../src/pure.ts';
import type { SessionRecord } from '../src/index.ts';

const homes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ledge-sidecars-'));
  homes.push(home);
  process.env.LEDGE_HOME = home;
  return home;
}

test.after(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    version: 1,
    id: 'b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90',
    started: '2026-09-27T10:00:00+05:30',
    lastActivity: '2026-09-27T10:45:00+05:30',
    filesChanged: [],
    commits: [],
    todosTicked: [],
    todosAdded: [],
    ...overrides,
  };
}

describe('contentKey', () => {
  test('is FNV-1a 32 bit over UTF-8, as eight lowercase hex digits', () => {
    assert.equal(contentKey(''), '811c9dc5');
    assert.equal(contentKey('a'), 'e40c292c');
    assert.equal(contentKey('foobar'), 'bf9cf968');
    assert.equal(contentKey('Write version.json at build time'), '12f90e82');
    assert.equal(contentKey('héllo wörld'), 'd41e41a2');
  });

  test('ignores how the text is wrapped and indented, but not what it says', () => {
    const key = contentKey('Write version.json at build time');
    assert.equal(contentKey('  Write version.json\n   at build\ttime \n'), key);
    assert.notEqual(contentKey('Write version.json at deploy time'), key);
    assert.notEqual(contentKey('write version.json at build time'), key, 'case is content');
  });

  test('a note is keyed by its date and body together', () => {
    const note = { date: '2026-09-15', body: 'Decided to poll' };
    assert.equal(noteKey(note), contentKey('2026-09-15\nDecided to poll'));
    assert.notEqual(noteKey(note), noteKey({ ...note, date: '2026-09-16' }));
  });

  test('the pure entry exports the same function', () => {
    assert.equal(pure.contentKey('foobar'), 'bf9cf968');
    assert.equal(typeof pure.parseSessionRecord, 'function');
    assert.equal(typeof pure.parseInsights, 'function');
    assert.equal(typeof pure.isSessionRunning, 'function');
    assert.equal(typeof pure.sessionDurationMs, 'function');
  });
});

describe('parseSessionRecord', () => {
  test('round trips a full record', () => {
    const full = record({
      taskId: 'release-watch-banner',
      repo: '/home/user/code/demo-app',
      transcriptPath: '/home/user/.claude/projects/x/b13e8b5e.jsonl',
      ended: '2026-09-27T11:00:00+05:30',
      title: 'Wire the release banner',
      summary: 'Added the banner. Polling works.',
      filesChanged: ['src/banner.ts'],
      commits: [{ sha: 'abc123', subject: 'feat: banner' }],
      todosTicked: ['Banner component in the shell'],
      todosAdded: ['Test the idle reload'],
      autoCreatedTask: true,
      capturedAt: '2026-09-27T10:46:00+05:30',
      capturedLines: 412,
      model: 'haiku',
    });
    assert.deepEqual(parseSessionRecord(serializeSessionRecord(full)), full);
  });

  test('answers undefined for anything that is not a version 1 record', () => {
    assert.equal(parseSessionRecord(''), undefined);
    assert.equal(parseSessionRecord('{"version":1,'), undefined);
    assert.equal(parseSessionRecord('[]'), undefined);
    assert.equal(parseSessionRecord('null'), undefined);
    assert.equal(parseSessionRecord(JSON.stringify({ ...record(), version: 2 })), undefined);
    assert.equal(parseSessionRecord(JSON.stringify({ ...record(), id: '' })), undefined);
    assert.equal(parseSessionRecord(JSON.stringify({ ...record(), started: 5 })), undefined);
  });

  test('drops fields of the wrong type and keeps the rest', () => {
    const parsed = parseSessionRecord(
      JSON.stringify({
        version: 1,
        id: 's1',
        started: '2026-09-27T10:00:00+05:30',
        title: 42,
        filesChanged: 'src/a.ts',
        commits: [{ sha: 'abc', subject: 'ok' }, { subject: 'no sha' }, 'junk'],
        todosTicked: ['one', 2],
        capturedLines: 'many',
        autoCreatedTask: 'yes',
      }),
    );
    assert.ok(parsed);
    assert.equal(parsed.title, undefined);
    assert.equal(parsed.lastActivity, '2026-09-27T10:00:00+05:30', 'falls back to started');
    assert.deepEqual(parsed.filesChanged, []);
    assert.deepEqual(parsed.commits, [{ sha: 'abc', subject: 'ok' }]);
    assert.deepEqual(parsed.todosTicked, ['one']);
    assert.deepEqual(parsed.todosAdded, []);
    assert.equal(parsed.capturedLines, undefined);
    assert.equal(parsed.autoCreatedTask, undefined);
  });
});

describe('parseInsights', () => {
  test('round trips, and drops entries without a title', () => {
    const text = JSON.stringify({
      version: 1,
      taskId: 'release-watch-banner',
      headline: 'Banner done, polling next',
      phase: 'Poll it on an interval',
      notes: { aaaa0000: { title: 'Chose polling', summary: 'Over a service worker.' }, bad: {} },
      plan: { bbbb1111: { title: 'Write version.json', detail: 'at build' }, cccc2222: 'no' },
      updatedAt: '2026-09-27T10:46:00+05:30',
      model: 'haiku',
    });
    assert.deepEqual(parseInsights(text), {
      version: 1,
      taskId: 'release-watch-banner',
      headline: 'Banner done, polling next',
      phase: 'Poll it on an interval',
      notes: { aaaa0000: { title: 'Chose polling', summary: 'Over a service worker.' } },
      plan: { bbbb1111: { title: 'Write version.json', detail: 'at build' } },
      updatedAt: '2026-09-27T10:46:00+05:30',
      model: 'haiku',
    });
  });

  test('answers undefined without a task id or with the wrong version', () => {
    assert.equal(parseInsights('{}'), undefined);
    assert.equal(parseInsights('{"version":1}'), undefined);
    assert.equal(parseInsights('{"version":3,"taskId":"x"}'), undefined);
    assert.equal(parseInsights('not json'), undefined);
    assert.deepEqual(parseInsights('{"version":1,"taskId":"x"}')?.notes, {});
  });
});

describe('isSessionRunning and sessionDurationMs', () => {
  const last = Date.parse('2026-09-27T10:45:00+05:30');

  test('running means not ended and active inside the window', () => {
    assert.equal(isSessionRunning(record(), new Date(last + 60_000)), true);
    assert.equal(isSessionRunning(record(), new Date(last + ACTIVE_WINDOW_MS)), false);
    assert.equal(
      isSessionRunning(record({ ended: '2026-09-27T10:46:00+05:30' }), new Date(last + 60_000)),
      false,
    );
    assert.equal(isSessionRunning(record({ lastActivity: 'soon' }), new Date(last)), false);
  });

  test('duration runs from started to the last activity, never below zero', () => {
    assert.equal(sessionDurationMs(record()), 45 * 60_000);
    assert.equal(
      sessionDurationMs(record({ ended: '2026-09-28T09:00:00+05:30' })),
      45 * 60_000,
      'a terminal left open overnight is not a night of work',
    );
    assert.equal(sessionDurationMs(record({ lastActivity: '2026-09-27T09:00:00+05:30' })), 0);
    assert.equal(sessionDurationMs(record({ started: 'never' })), 0);
  });
});

describe('SessionStore', () => {
  test('puts atomically, gets, and lists newest first', () => {
    const home = freshHome();
    const store = new SessionStore();
    assert.equal(store.home, home);
    assert.deepEqual(store.list(), [], 'no folder yet is an empty list');
    store.put(record({ id: 'old', lastActivity: '2026-09-26T10:00:00+05:30', taskId: 't1' }));
    store.put(record({ id: 'new', lastActivity: '2026-09-27T12:00:00+05:30', taskId: 't2' }));
    assert.deepEqual(readdirSync(join(home, 'sessions')).sort(), ['new.json', 'old.json']);
    assert.equal(store.get('new')?.taskId, 't2');
    assert.deepEqual(store.list().map((r) => r.id), ['new', 'old']);
    assert.deepEqual(store.list('t1').map((r) => r.id), ['old']);
    assert.match(readFileSync(join(home, 'sessions', 'old.json'), 'utf8'), /\n$/);
  });

  test('a file that does not parse is absent, never an error', () => {
    const home = freshHome();
    mkdirSync(join(home, 'sessions'), { recursive: true });
    writeFileSync(join(home, 'sessions', 'broken.json'), '{"version":1,"id":');
    writeFileSync(join(home, 'sessions', 'notes.txt'), 'ignored');
    const store = new SessionStore(home);
    store.put(record({ id: 'fine' }));
    assert.equal(store.get('broken'), undefined);
    assert.equal(store.get('missing'), undefined);
    assert.deepEqual(store.list().map((r) => r.id), ['fine']);
  });

  test('refuses an id that would leave the folder', () => {
    const store = new SessionStore(freshHome());
    assert.throws(() => store.put(record({ id: '../escape' })), /Not a usable record id/);
    assert.throws(() => store.put(record({ id: 'a/b' })), /Not a usable record id/);
    assert.equal(store.get('../escape'), undefined);
  });
});

describe('InsightStore', () => {
  test('puts, gets and lists, and leaves no temporary file behind', () => {
    const home = freshHome();
    const store = new InsightStore();
    const insights = emptyInsights('release-watch-banner', '2026-09-27T10:46:00+05:30');
    insights.notes[contentKey('x')] = { title: 'X', summary: 'Y' };
    store.put(insights);
    assert.deepEqual(store.get('release-watch-banner'), insights);
    assert.deepEqual(readdirSync(join(home, 'insights')), ['release-watch-banner.json']);
    assert.deepEqual(store.list().map((i) => i.taskId), ['release-watch-banner']);
    assert.equal(store.get('nope'), undefined);
  });
});
