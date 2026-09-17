// Tests for the inference layer's pure half. Nothing here starts a process or reaches a model:
// a prompt is a string, and what a prompt does or does not contain is the entire quality of the
// feature, so these assert on inclusion and on exclusion in equal measure.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTES_PER_TASK,
  buildAskPrompt,
  buildHandoffPrompt,
  buildStandupPrompt,
  observedFacts,
  renderAskContext,
  sanitizeForNote,
} from '../src/index.ts';
import type { AskContext, RepoStatus, Task } from '../src/index.ts';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'release-watch-banner',
    title: 'Release watch banner',
    status: 'current',
    order: 1,
    repo: '/srv/admin-web',
    sessions: ['abc'],
    created: '2026-09-14T21:04:00+05:30',
    updated: '2026-09-14T23:04:00+05:30',
    planned: '2026-09-16',
    requirement: 'Old tabs break after deploy.\nShow a banner.',
    plan: ['Write version.json at build time', 'Poll it from the shell'],
    checklist: [
      { text: 'Investigated caching', done: true },
      { text: 'Build step writes version.json', done: false },
      { text: 'Banner component', done: false },
    ],
    notes: [
      { date: '2026-09-10', body: 'Ruled out a service worker.' },
      { date: '2026-09-14', body: 'Chose polling.\nDecision taken, do not revisit.' },
    ],
    extra: '',
    file: '/tmp/ledge/tasks/2026-09-14-release-watch-banner.md',
    ...over,
  };
}

function repo(over: Partial<RepoStatus> = {}): RepoStatus {
  return {
    repo: '/srv/admin-web',
    branch: 'feature/banner',
    upstream: 'origin/feature/banner',
    ahead: 2,
    behind: 0,
    dirty: [{ path: 'src/app.ts', code: '1 .M' }],
    lastActivity: '2026-09-16T09:00:00+05:30',
    ...over,
  };
}

function context(over: Partial<AskContext> = {}): AskContext {
  return { day: '2026-09-16', tasks: [task()], repos: [repo()], ...over };
}

/** Every prompt must carry the rules that make an answer safe to print next to real records. */
function assertHonestyRules(prompt: string): void {
  assert.match(prompt, /Use only the context/);
  assert.match(prompt, /=== BEGIN CONTEXT ===[\s\S]*=== END CONTEXT ===/);
  assert.match(prompt, /the records do not say/);
  assert.match(prompt, /Inferred:/);
  assert.match(prompt, /Do not promote a record into a status/);
  assert.match(prompt, /never guess what is inside a file/);
  assert.match(prompt, /Never use an em dash or an en dash/);
  // Nothing in a prompt may invite the model to fill a gap, which is the one failure mode
  // that would make Ledge's inference worse than no inference at all.
  assert.doesNotMatch(prompt, /speculat|best guess|assume|estimate|imagine|probably/i);
  assert.ok(!prompt.includes(String.fromCodePoint(0x2014)), 'no em dashes');
}

describe('renderAskContext', () => {
  test('quotes the requirement, the plan, both halves of the checklist and the notes', () => {
    const text = renderAskContext(context());
    assert.match(text, /id: release-watch-banner/);
    assert.match(text, /title: Release watch banner/);
    assert.match(text, /planned: 2026-09-16 \(today\)/);
    assert.match(text, /checklist: 1 ticked of 3/);
    assert.match(text, /Old tabs break after deploy\.\nShow a banner\./);
    assert.match(text, /1\. Write version\.json at build time/);
    assert.match(text, /checklist, still unticked[\s\S]*?- Build step writes version\.json/);
    assert.match(text, /checklist, already ticked[\s\S]*?- Investigated caching/);
    assert.match(text, /note dated 2026-09-14:\nChose polling\.\nDecision taken, do not revisit\./);
  });

  test('a planned day before today reads as overdue, and a later one as upcoming', () => {
    const late = renderAskContext(context({ day: '2026-09-20' }));
    assert.match(late, /planned: 2026-09-16 \(overdue\)/);
    const early = renderAskContext(context({ day: '2026-09-01' }));
    assert.match(early, /planned: 2026-09-16 \(upcoming\)/);
  });

  test('git state is quoted and marked as read from the repositories, not from the files', () => {
    const text = renderAskContext(context());
    assert.match(text, /GIT, read from the repositories just now and not from any task file/);
    assert.match(text, /branch feature\/banner, upstream origin\/feature\/banner, 2 ahead/);
    assert.match(text, /2 ahead, 0 behind/);
    assert.match(text, /1 changed or untracked paths: src\/app\.ts/);
  });

  test('a missing scan says nothing is known rather than implying a clean tree', () => {
    const text = renderAskContext(context({ repos: undefined }));
    assert.match(text, /no scan was run, so nothing is known about the working trees/);
    assert.doesNotMatch(text, /working tree clean/);
    const empty = renderAskContext(context({ repos: [] }));
    assert.match(empty, /the scan ran and found no repository to report/);
  });

  test('an empty task says so in each section instead of leaving the section out', () => {
    const bare = task({ requirement: '', plan: [], checklist: [], notes: [], sessions: [] });
    const text = renderAskContext(context({ tasks: [bare] }));
    assert.match(text, /requirement, as the person wrote it:\n\(nothing recorded\)/);
    assert.match(text, /\(no plan recorded\)/);
    assert.match(text, /\(nothing unticked\)/);
    assert.match(text, /\(nothing ticked\)/);
    assert.match(text, /\(no notes recorded\)/);
    assert.match(text, /planned: 2026-09-16 \(today\)/);
  });

  test('only the newest notes are quoted, and the count says how many were left out', () => {
    const many = task({
      notes: [
        { date: '2026-09-01', body: 'one' },
        { date: '2026-09-02', body: 'two' },
        { date: '2026-09-03', body: 'three' },
        { date: '2026-09-04', body: 'four' },
      ],
    });
    const text = renderAskContext(context({ tasks: [many] }));
    assert.equal(DEFAULT_NOTES_PER_TASK, 3);
    assert.match(text, /3 quoted of 4/);
    assert.doesNotMatch(text, /note dated 2026-09-01/);
    assert.match(text, /note dated 2026-09-04/);
    const one = renderAskContext(context({ tasks: [many], notesPerTask: 1 }));
    assert.match(one, /1 quoted of 4/);
    assert.doesNotMatch(one, /note dated 2026-09-03/);
  });

  test('a parked task carries its reason, so a prompt cannot read it as work in flight', () => {
    const parked = task({ status: 'backlog', parked: 'waiting on design' });
    const text = renderAskContext(context({ tasks: [parked] }));
    assert.match(text, /status: backlog/);
    assert.match(text, /parked because: waiting on design/);
  });
});

describe('buildAskPrompt', () => {
  test('carries the honesty rules, the context and the question verbatim', () => {
    const prompt = buildAskPrompt('Why did I drop the service worker?', context());
    assertHonestyRules(prompt);
    assert.match(prompt, /Why did I drop the service worker\?/);
    assert.match(prompt, /Ruled out a service worker\./);
    assert.match(prompt, /at most 200 words/);
    assert.match(prompt, /If the records do not cover what was asked/);
  });

  test('the question comes after the context so it is the last thing read', () => {
    const prompt = buildAskPrompt('Where did I get to?', context());
    assert.ok(prompt.indexOf('=== END CONTEXT ===') < prompt.lastIndexOf('Where did I get to?'));
  });

  test('a blank question is reported as blank rather than replaced with one', () => {
    const prompt = buildAskPrompt('   ', context());
    assert.match(prompt, /\(no question was given\)/);
  });
});

describe('buildStandupPrompt', () => {
  test('asks for where each current task stands and one cited next action', () => {
    const prompt = buildStandupPrompt(context());
    assertHonestyRules(prompt);
    assert.match(prompt, /Cover every task whose status is current/);
    assert.match(prompt, /Next: one action, quoted from an unticked checklist item/);
    assert.match(prompt, /Say which of those three you took it from/);
    assert.match(prompt, /If\n {2}it is not the first unticked item, say why in the same line/);
    assert.match(prompt, /Start here: <task id>/);
  });

  test('it tells the model not to hand a parked task a next action', () => {
    const prompt = buildStandupPrompt(context({ tasks: [task({ status: 'backlog' })] }));
    assert.match(prompt, /A task whose\nstatus is backlog is parked/);
  });
});

describe('buildHandoffPrompt', () => {
  test('names the one task, asks for the four blocks and forbids Markdown headings', () => {
    const prompt = buildHandoffPrompt(task(), context());
    assertHonestyRules(prompt);
    assert.match(prompt, /handoff note for the task "Release watch banner"/);
    assert.match(prompt, /\(id: release-watch-banner\)/);
    assert.match(prompt, /What happened/);
    assert.match(prompt, /What is done/);
    assert.match(prompt, /What remains/);
    assert.match(prompt, /What the next session needs/);
    assert.match(prompt, /no line\nmay begin with #/);
    assert.match(prompt, /already\n {2}decided and must not be revisited/);
  });

  test('a task missing from the context is added, so the handoff is never about the unseen', () => {
    const other = task({ id: 'other', title: 'Other work' });
    const prompt = buildHandoffPrompt(task(), context({ tasks: [other] }));
    assert.match(prompt, /id: release-watch-banner/);
    assert.match(prompt, /id: other/);
    assert.match(prompt, /TASK 1 of 2/);
  });

  test('a task already in the context is not quoted twice', () => {
    const prompt = buildHandoffPrompt(task(), context());
    assert.equal(prompt.split('id: release-watch-banner').length - 1, 2);
    assert.match(prompt, /TASK 1 of 1/);
  });
});

describe('observedFacts', () => {
  test('counts progress and quotes the next step the task already names', () => {
    const facts = observedFacts(context());
    assert.equal(facts.day, '2026-09-16');
    assert.deepEqual(facts.tasks, [
      {
        id: 'release-watch-banner',
        title: 'Release watch banner',
        status: 'current',
        done: 1,
        total: 3,
        noteCount: 2,
        repo: '/srv/admin-web',
        planned: '2026-09-16',
        nextAction: { text: 'Build step writes version.json', source: 'checklist' },
        latestNote: '2026-09-14',
      },
    ]);
    assert.deepEqual(facts.repos, [
      {
        repo: '/srv/admin-web',
        branch: 'feature/banner',
        ahead: 2,
        behind: 0,
        dirty: 1,
        upstream: 'origin/feature/banner',
      },
    ]);
  });

  test('a task with nothing to go on reports no next action rather than inventing one', () => {
    const bare = task({ checklist: [], plan: [], notes: [], repo: undefined, planned: undefined });
    const facts = observedFacts(context({ tasks: [bare], repos: undefined }));
    assert.equal(facts.tasks[0]!.nextAction, undefined);
    assert.equal(facts.tasks[0]!.latestNote, undefined);
    assert.equal(facts.tasks[0]!.total, 0);
    assert.deepEqual(facts.repos, []);
  });
});

describe('sanitizeForNote', () => {
  test('strips heading hashes, which would otherwise cut the task file in two', () => {
    const text = sanitizeForNote('## What happened\n- a thing\n### 2026-01-01\n- another');
    assert.equal(text, 'What happened\n- a thing\n2026-01-01\n- another');
  });

  test('leaves a hash that is not a heading alone, and trims the edges', () => {
    assert.equal(sanitizeForNote('\n\nissue #4 is open\n\n'), 'issue #4 is open');
    assert.equal(sanitizeForNote('C# notes'), 'C# notes');
  });
});
