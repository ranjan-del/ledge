// Tests for the capture: the debounce, the answer check, the fuzzy match, and whole runs against
// a fake provider in a temporary LEDGE_HOME. No test reaches a model or the real store, and git
// is a stand-in so no test depends on a repository.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InsightStore,
  SessionStore,
  TaskStore,
  buildCapturePrompt,
  captureDue,
  isoDay,
  matchItem,
  noteKey,
  parseCaptureResult,
  runCapture,
  trackSession,
} from '../src/index.ts';
import type { Provider, Task } from '../src/index.ts';

const fixture = new URL('./fixtures/transcript.jsonl', import.meta.url);
const SESSION = 'b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90';
const homes: string[] = [];

test.after(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ledge-capture-'));
  homes.push(home);
  process.env.LEDGE_HOME = home;
  new TaskStore(home).init();
  return home;
}

interface FakeProvider extends Provider {
  prompts: string[];
}

function answering(answer: unknown): FakeProvider {
  const provider: FakeProvider = {
    name: 'test-fake',
    model: 'haiku',
    prompts: [],
    available: async () => true,
    ask: async (prompt: string) => {
      provider.prompts.push(prompt);
      return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), provider: 'test-fake' };
    },
  };
  return provider;
}

function failing(): FakeProvider {
  return {
    name: 'test-broken',
    prompts: [],
    available: async () => true,
    ask: async () => {
      throw new Error('the model is down');
    },
  };
}

function bannerTask(home: string, repo: string): Task {
  const store = new TaskStore(home);
  const task = store.add({ title: 'Release watch banner', repo, requirement: 'Show a banner.' });
  store.addTodo(task.id, 'Write version.json at build time');
  store.addTodo(task.id, 'Banner component in the shell');
  return store.get(task.id);
}

/** Copies the fixture into a temp repo folder and returns both paths. */
function sessionFolder(home: string): { cwd: string; transcript: string } {
  const cwd = join(home, 'demo-app');
  const text = readFileSync(fixture, 'utf8').replaceAll('/home/user/code/demo-app', cwd);
  const transcript = join(home, 'transcript.jsonl');
  writeFileSync(transcript, text);
  return { cwd, transcript };
}

const noGit = async () => [{ sha: 'abc1234def', subject: 'feat: banner' }];

describe('captureDue', () => {
  const now = new Date('2026-09-27T12:00:00+05:30');
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  test('a session never captured is always due', () => {
    assert.equal(captureDue(undefined, 3, now).due, true);
  });

  test('skips under 40 new lines and under 10 minutes, runs past either', () => {
    assert.equal(captureDue({ capturedAt: at(2), capturedLines: 100 }, 139, now).due, false);
    assert.equal(captureDue({ capturedAt: at(2), capturedLines: 100 }, 140, now).due, true);
    assert.equal(captureDue({ capturedAt: at(10), capturedLines: 100 }, 101, now).due, true);
    assert.match(captureDue({ capturedAt: at(2), capturedLines: 100 }, 110, now).reason, /debounced/);
  });

  test('final skips the debounce but not an empty read; force skips both', () => {
    const history = { capturedAt: at(1), capturedLines: 100 };
    assert.equal(captureDue(history, 101, now, { final: true }).due, true);
    assert.equal(captureDue(history, 100, now, { final: true }).due, false);
    assert.equal(captureDue(history, 100, now, { force: true }).due, true);
  });
});

describe('parseCaptureResult', () => {
  const ok = {
    taskId: 'release-watch-banner',
    checklistAdd: ['Test the idle reload'],
    checklistTick: ['Write version.json at build time'],
    session: { title: 'Wire the release banner.', summary: 'Built the banner.' },
    headline: 'Banner built, reload next',
  };

  test('accepts the shape, fenced or bare, and trims a trailing period off the title', () => {
    const fenced = '```json\n' + JSON.stringify(ok) + '\n```';
    const parsed = parseCaptureResult(fenced, ['release-watch-banner']);
    assert.ok(parsed.result, parsed.error);
    assert.equal(parsed.result.session.title, 'Wire the release banner');
    assert.equal(parsed.result.headline, 'Banner built, reload next');
    assert.equal(parsed.result.newTask, undefined);
  });

  test('refuses a task id the model was not shown', () => {
    const parsed = parseCaptureResult(JSON.stringify(ok), ['something-else']);
    assert.match(parsed.error ?? '', /not one of the candidates/);
  });

  test('refuses wrong types, a missing session, and prose', () => {
    const ids = ['release-watch-banner'];
    assert.match(parseCaptureResult('no json here', ids).error ?? '', /no JSON/);
    assert.match(parseCaptureResult(JSON.stringify({ ...ok, session: undefined }), ids).error ?? '', /session/);
    assert.match(
      parseCaptureResult(JSON.stringify({ ...ok, checklistTick: 'one' }), ids).error ?? '',
      /checklistTick/,
    );
    assert.match(parseCaptureResult(JSON.stringify({ ...ok, taskId: 7 }), ids).error ?? '', /taskId/);
    assert.match(
      parseCaptureResult(JSON.stringify({ ...ok, note: { body: 5 } }), ids).error ?? '',
      /note.body/,
    );
  });

  test('cuts long text instead of refusing it', () => {
    const long = { ...ok, taskId: null, session: { title: 'x'.repeat(200), summary: '' }, plan: ['y'.repeat(200)] };
    const parsed = parseCaptureResult(JSON.stringify(long), []);
    assert.ok(parsed.result);
    assert.equal(parsed.result.session.title.length, 60);
    assert.equal(parsed.result.plan?.[0]?.length, 90);
    assert.equal(parsed.result.taskId, null);
  });
});

describe('matchItem', () => {
  const items = ['Build step that writes version.json', 'Banner component in the shell', 'Tests'];

  test('matches on words, not characters', () => {
    assert.equal(matchItem(items, 'build step that writes `version.json`'), 0);
    assert.equal(matchItem(items, 'Banner component in the app shell'), 1);
    assert.equal(matchItem(items, 'tests'), 2);
  });

  test('answers -1 when nothing is close', () => {
    assert.equal(matchItem(items, 'Deploy to production'), -1);
    assert.equal(matchItem(items, ''), -1);
    assert.equal(matchItem([], 'Tests'), -1);
  });
});

describe('buildCapturePrompt', () => {
  test('carries the rules, the candidates and the digest, and no em dash', () => {
    const task = {
      id: 'release-watch-banner',
      title: 'Release watch banner',
      status: 'current',
      requirement: 'Show a banner.\nMore.',
      plan: ['Write version.json'],
      checklist: [{ text: 'Banner component', done: false }],
      notes: [],
    } as unknown as Task;
    const prompt = buildCapturePrompt({
      digest: 'DIGEST BODY',
      candidates: [task],
      linkedTaskId: task.id,
      cwd: '/repo',
      day: '2026-09-27',
    });
    assert.match(prompt, /Never invent work/);
    assert.match(prompt, /TASK id: release-watch-banner \(this session is already linked to it\)/);
    assert.match(prompt, /requirement, first line: Show a banner\./);
    assert.match(prompt, /- \[ \] Banner component/);
    assert.match(prompt, /DIGEST BODY/);
    assert.doesNotMatch(prompt, /[—–]/);
  });
});

describe('runCapture', () => {
  test('attributes to an existing task, ticks, adds, notes, links and writes both sidecars', async () => {
    const home = freshHome();
    const { cwd, transcript } = sessionFolder(home);
    const task = bannerTask(home, cwd);
    const provider = answering({
      taskId: task.id,
      plan: ['Write version.json at build time', 'Show the banner'],
      checklistAdd: ['Test the idle reload', 'banner component in the shell'],
      checklistTick: ['write version.json at build time'],
      note: {
        title: 'Chose polling over a service worker',
        summary: 'Polling reuses the config fetch.',
        body: '## Decision\nPolled version.json instead of a service worker.',
      },
      session: { title: 'Wire the release banner', summary: 'Built the banner and the build step.' },
      headline: 'Banner built, idle reload next',
      phase: 'Show the banner',
    });
    const outcome = await runCapture({
      sessionId: SESSION,
      transcriptPath: transcript,
      cwd,
      provider,
      home,
      gitLog: noGit,
    });
    assert.equal(outcome.status, 'captured', outcome.reason);
    assert.equal(outcome.taskId, task.id);
    assert.equal(provider.prompts.length, 1);
    assert.match(provider.prompts[0]!, /TASK id: release-watch-banner/);

    const after = new TaskStore(home).get(task.id);
    assert.deepEqual(after.plan, ['Write version.json at build time', 'Show the banner']);
    assert.deepEqual(after.checklist, [
      { text: 'Write version.json at build time', done: true },
      { text: 'Banner component in the shell', done: false },
      { text: 'Test the idle reload', done: false },
    ]);
    assert.equal(after.notes.length, 1);
    assert.equal(after.notes[0]!.body, 'Decision\nPolled version.json instead of a service worker.');
    assert.deepEqual(after.sessions, [SESSION]);
    assert.equal(after.meta, undefined, 'an existing task is not marked auto');

    const record = new SessionStore(home).get(SESSION);
    assert.ok(record);
    assert.equal(record.taskId, task.id);
    assert.equal(record.title, 'Wire the release banner');
    assert.equal(record.repo, cwd);
    assert.equal(record.capturedLines, 25);
    assert.equal(record.model, 'haiku');
    assert.equal(Date.parse(record.started), Date.parse('2026-09-27T04:00:00.000Z'));
    assert.equal(Date.parse(record.lastActivity), Date.parse('2026-09-27T04:01:10.000Z'));
    assert.deepEqual(record.filesChanged, [
      'src/banner.ts',
      'scripts/write-version.mjs',
      '/elsewhere/analysis.ipynb',
    ]);
    assert.deepEqual(record.commits, [{ sha: 'abc1234def', subject: 'feat: banner' }]);
    assert.deepEqual(record.todosTicked, ['Write version.json at build time']);
    assert.deepEqual(record.todosAdded, ['Test the idle reload']);
    assert.equal(record.autoCreatedTask, undefined);

    const insights = new InsightStore(home).get(task.id);
    assert.ok(insights);
    assert.equal(insights.headline, 'Banner built, idle reload next');
    assert.equal(insights.phase, 'Show the banner');
    assert.deepEqual(insights.notes[noteKey(after.notes[0]!)], {
      title: 'Chose polling over a service worker',
      summary: 'Polling reuses the config fetch.',
    });
    const log = readFileSync(join(home, 'capture.log'), 'utf8').trim().split('\n');
    assert.equal(log.length, 1);
    assert.match(log[0]!, / captured session=b13e8b5e-\S+ task=release-watch-banner lines=25 first capture$/);
  });

  test('creates a task marked origin: auto when none fits', async () => {
    const home = freshHome();
    const { cwd, transcript } = sessionFolder(home);
    const provider = answering({
      taskId: null,
      newTask: { title: 'Release banner', requirement: 'Tell people a new version is out.' },
      checklistAdd: ['Banner component'],
      checklistTick: [],
      session: { title: 'Start the release banner', summary: 'Designed it.' },
    });
    const outcome = await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider, home, gitLog: noGit });
    assert.equal(outcome.status, 'captured', outcome.reason);
    assert.equal(outcome.created, true);
    const created = new TaskStore(home).get(outcome.taskId!);
    assert.equal(created.title, 'Release banner');
    assert.deepEqual(created.meta, { origin: 'auto' });
    assert.equal(created.repo, cwd);
    assert.deepEqual(created.sessions, [SESSION]);
    assert.match(readFileSync(created.file, 'utf8'), /\norigin: auto\n/);
    const record = new SessionStore(home).get(SESSION);
    assert.equal(record?.autoCreatedTask, true);
    assert.equal(record?.taskId, created.id);
    assert.match(readFileSync(join(home, 'capture.log'), 'utf8'), / created /);
  });

  test('writes nothing when the model call fails, and logs why', async () => {
    const home = freshHome();
    const { cwd, transcript } = sessionFolder(home);
    const task = bannerTask(home, cwd);
    const before = readFileSync(task.file, 'utf8');
    const outcome = await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider: failing(), home, gitLog: noGit });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.reason, /the model is down/);
    assert.equal(readFileSync(task.file, 'utf8'), before);
    assert.equal(new SessionStore(home).get(SESSION), undefined);
    assert.equal(existsSync(join(home, 'insights')), false);
    assert.deepEqual(readdirSync(join(home, 'sessions')), [], 'the lock is gone too');
    assert.match(readFileSync(join(home, 'capture.log'), 'utf8'), / failed session=\S+ task=- lines=25 model call failed/);
  });

  test('writes nothing for an answer that does not check out', async () => {
    const home = freshHome();
    const { cwd, transcript } = sessionFolder(home);
    const task = bannerTask(home, cwd);
    const before = readFileSync(task.file, 'utf8');
    const provider = answering({ taskId: 'made-up', session: { title: 'x', summary: '' } });
    const outcome = await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider, home, gitLog: noGit });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.reason, /answer refused/);
    assert.equal(readFileSync(task.file, 'utf8'), before);
    assert.equal(new SessionStore(home).get(SESSION), undefined);
  });

  test('an unavailable provider is a logged failure, not a crash', async () => {
    const home = freshHome();
    const { cwd, transcript } = sessionFolder(home);
    const provider: Provider = {
      name: 'none',
      available: async () => false,
      unavailableReason: () => 'claude is not installed',
      ask: async () => {
        throw new Error('never');
      },
    };
    const outcome = await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider, home });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.reason, 'claude is not installed');
  });

  test('the second capture is debounced, and a final one with nothing new skips too', async () => {
    const home = freshHome();
    const { cwd, transcript } = sessionFolder(home);
    const task = bannerTask(home, cwd);
    const provider = answering({ taskId: task.id, session: { title: 'Banner', summary: '' } });
    const first = await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider, home, gitLog: noGit });
    assert.equal(first.status, 'captured');
    const again = await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider, home, gitLog: noGit });
    assert.equal(again.status, 'skipped');
    const final = await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider, home, final: true, gitLog: noGit });
    assert.equal(final.status, 'skipped');
    assert.match(final.reason, /no new transcript lines/);
    const forced = await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider, home, force: true, gitLog: noGit });
    assert.equal(forced.status, 'captured');
    assert.equal(provider.prompts.length, 2);
    assert.equal(readFileSync(join(home, 'capture.log'), 'utf8').trim().split('\n').length, 4);
  });

  test('keeps an ended mark written while the model was thinking', async () => {
    const home = freshHome();
    const { cwd, transcript } = sessionFolder(home);
    const task = bannerTask(home, cwd);
    const provider: Provider = {
      name: 'slow',
      available: async () => true,
      ask: async () => {
        trackSession({ sessionId: SESSION, ended: true }, { home });
        return { text: JSON.stringify({ taskId: task.id, session: { title: 'Banner', summary: '' } }), provider: 'slow' };
      },
    };
    await runCapture({ sessionId: SESSION, transcriptPath: transcript, cwd, provider, home, gitLog: noGit });
    assert.ok(new SessionStore(home).get(SESSION)?.ended);
  });

  test('skips when another capture of the same session holds the lock', async () => {
    const home = freshHome();
    const { cwd, transcript } = sessionFolder(home);
    new SessionStore(home).put({
      version: 1, id: 'x', started: '2026-09-27T10:00:00+05:30', lastActivity: '2026-09-27T10:00:00+05:30',
      filesChanged: [], commits: [], todosTicked: [], todosAdded: [],
    });
    writeFileSync(join(home, 'sessions', `${SESSION}.lock`), '1');
    const outcome = await runCapture({
      sessionId: SESSION, transcriptPath: transcript, cwd, provider: answering({}), home, lockWaitMs: 300,
    });
    assert.equal(outcome.status, 'skipped');
    assert.match(outcome.reason, /still running/);
  });
});

describe('trackSession', () => {
  test('writes a skeleton, then marks it ended, then clears the mark on resume', () => {
    const home = freshHome();
    const now = new Date('2026-09-27T10:00:00+05:30');
    const first = trackSession({ sessionId: 's1', cwd: home, transcriptPath: '/t.jsonl' }, { home, now });
    assert.equal(first.repo, home);
    assert.equal(first.transcriptPath, '/t.jsonl');
    assert.equal(Date.parse(first.started), now.getTime());
    assert.deepEqual(first.filesChanged, []);
    const ended = trackSession({ sessionId: 's1', ended: true }, { home, now: new Date(now.getTime() + 60_000) });
    assert.equal(Date.parse(ended.ended!), now.getTime() + 60_000);
    assert.equal(ended.started, first.started, 'started is kept');
    const resumed = trackSession({ sessionId: 's1', cwd: home }, { home });
    assert.equal(resumed.ended, undefined);
    assert.equal(isoDay(new Date(resumed.started)), isoDay(now));
  });
});
