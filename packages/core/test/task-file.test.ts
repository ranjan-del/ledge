import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  parseTask,
  serializeTask,
  slugify,
  taskFileName,
  TaskParseError,
} from '../src/index.ts';

const sample = `---
id: release-watch-banner
title: Release watch banner for stale tabs
status: current
order: 1
repo: ~/code/thinktac-india-production/apps/admin-web
sessions:
  - b13e8b5e
  - 071729a1
created: 2026-09-14T21:04:00+05:30
updated: 2026-09-14T23:04:00+05:30
parked: Waiting for design approval
owner: ranjan
priority: high
---

## Requirement

Users keep old code in open tabs after a deploy and lazy routes fail.
Write version.json at build, poll it and on window focus, show a banner,
reload only when idle, catch chunk-load errors as a safety net.

## Checklist

- [x] Investigated caching setup and why open tabs break
- [x] Design agreed: version.json polling, banner, idle reload
- [ ] Build step that writes version.json
- [ ] ReleaseWatchService with polling and focus listener
- [ ] Banner component in the shell

## Notes

Some extra text that must survive.

- a plain bullet, not a checklist item
`;

test('parseTask reads frontmatter, requirement, checklist and extra', () => {
  const task = parseTask(sample, '/tmp/x.md');
  assert.equal(task.id, 'release-watch-banner');
  assert.equal(task.title, 'Release watch banner for stale tabs');
  assert.equal(task.status, 'current');
  assert.equal(task.order, 1);
  assert.equal(task.repo, join(homedir(), 'code/thinktac-india-production/apps/admin-web'));
  assert.deepEqual(task.sessions, ['b13e8b5e', '071729a1']);
  assert.equal(task.created, '2026-09-14T21:04:00+05:30');
  assert.equal(task.updated, '2026-09-14T23:04:00+05:30');
  assert.equal(task.parked, 'Waiting for design approval');
  assert.equal(task.file, '/tmp/x.md');
  assert.match(task.requirement, /^Users keep old code/);
  assert.match(task.requirement, /safety net\.$/);
  assert.equal(task.checklist.length, 5);
  assert.deepEqual(task.checklist[0], {
    text: 'Investigated caching setup and why open tabs break',
    done: true,
  });
  assert.deepEqual(task.checklist[2], { text: 'Build step that writes version.json', done: false });
  assert.match(task.extra, /^## Notes/);
  assert.match(task.extra, /a plain bullet, not a checklist item$/);
  assert.deepEqual(task.meta, { owner: 'ranjan', priority: 'high' });
});

test('serializeTask round-trips parseTask byte for byte on canonical input', () => {
  const task = parseTask(sample);
  const out = serializeTask(task);
  assert.equal(out, sample);
  const again = parseTask(out);
  assert.deepEqual(again, task);
});

test('serializeTask keeps unknown frontmatter keys in their original order', () => {
  const md = `---
id: t
title: T
status: backlog
order: 2
sessions: []
created: 2026-01-01T00:00:00+00:00
updated: 2026-01-01T00:00:00+00:00
zeta: 1
alpha: 2
---

## Requirement

## Checklist
`;
  const out = serializeTask(parseTask(md));
  const zeta = out.indexOf('zeta: 1');
  const alpha = out.indexOf('alpha: 2');
  assert.ok(zeta > 0 && alpha > zeta, 'zeta must come before alpha');
  assert.ok(out.indexOf('updated:') < zeta, 'known keys come before unknown ones');
});

test('repo tilde is expanded on parse and re-tilded on serialize', () => {
  const task = parseTask(sample);
  assert.ok(task.repo!.startsWith(homedir()));
  assert.match(serializeTask(task), /^repo: ~\/code\/thinktac-india-production\/apps\/admin-web$/m);
  const abs = { ...task, repo: '/srv/elsewhere' };
  assert.match(serializeTask(abs), /^repo: \/srv\/elsewhere$/m);
});

test('serializeTask omits repo and parked when undefined and quotes numeric-looking ids', () => {
  const task = parseTask(sample);
  delete task.repo;
  delete task.parked;
  task.sessions = ['12345678'];
  const out = serializeTask(task);
  assert.doesNotMatch(out, /^repo:/m);
  assert.doesNotMatch(out, /^parked:/m);
  assert.deepEqual(parseTask(out).sessions, ['12345678']);
});

test('parseTask throws TaskParseError with file and line on bad YAML', () => {
  const bad = `---
id: x
title: [unclosed
status: current
---
`;
  assert.throws(
    () => parseTask(bad, '/tmp/bad.md'),
    (err: unknown) => {
      assert.ok(err instanceof TaskParseError);
      assert.equal(err.file, '/tmp/bad.md');
      assert.equal(typeof err.line, 'number');
      assert.ok(err.line! >= 2 && err.line! <= 5, `line was ${err.line}`);
      return true;
    },
  );
});

test('parseTask throws TaskParseError when frontmatter is missing or fields are invalid', () => {
  assert.throws(() => parseTask('# no frontmatter\n', '/tmp/a.md'), (err: unknown) => {
    assert.ok(err instanceof TaskParseError);
    assert.equal(err.file, '/tmp/a.md');
    assert.equal(err.line, 1);
    return true;
  });
  assert.throws(() => parseTask('---\nid: x\n', '/tmp/b.md'), TaskParseError);
  assert.throws(
    () => parseTask('---\nid: x\ntitle: T\nstatus: weird\norder: 1\n---\n', '/tmp/c.md'),
    /status/,
  );
  assert.throws(() => parseTask('---\ntitle: T\nstatus: current\norder: 1\n---\n'), /id/);
});

test('parseTask fills defaults for optional fields', () => {
  const task = parseTask('---\nid: x\ntitle: T\nstatus: current\norder: 1\n---\n');
  assert.deepEqual(task.sessions, []);
  assert.equal(task.requirement, '');
  assert.deepEqual(task.checklist, []);
  assert.deepEqual(task.plan, []);
  assert.deepEqual(task.notes, []);
  assert.equal(task.planned, undefined);
  assert.equal(task.extra, '');
  assert.equal(task.file, '');
  assert.equal(task.repo, undefined);
  assert.equal(task.meta, undefined);
  assert.match(task.created, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(task.updated, task.created);
});

test('slugify makes stable filename-safe ids', () => {
  assert.equal(
    slugify('Release watch banner for stale tabs'),
    'release-watch-banner-for-stale-tabs',
  );
  assert.equal(slugify('  Fix   the  CRUD!!  '), 'fix-the-crud');
  assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
  assert.equal(slugify('___'), 'task');
  assert.equal(slugify('a'.repeat(120)).length, 60);
});

test('taskFileName is the created date plus id', () => {
  assert.equal(
    taskFileName({ id: 'release-watch-banner', created: '2026-09-14T21:04:00+05:30' }),
    '2026-09-14-release-watch-banner.md',
  );
});

const v2 = `---
id: release-watch-banner
title: Release watch banner for stale tabs
status: current
order: 1
planned: 2026-09-18
sessions:
  - b13e8b5e
created: 2026-09-15T21:04:00+05:30
updated: 2026-09-15T23:04:00+05:30
---

## Requirement

Short statement of what has to be true when this is finished.

## Plan

1. Write version.json at build time
2. Poll it on an interval and on window focus
3. Show the banner, reload only when idle

## Checklist

- [x] Investigated why open tabs break after a deploy
- [ ] Build step that writes version.json

## Notes

### 2026-09-15
Decided to poll a version file rather than use a service worker, because the app already
fetches a static config file the same way. Chunk load errors are the safety net.

### 2026-09-16
Second day: the build step landed.
`;

test('parseTask reads planned, the plan and the dated notes', () => {
  const task = parseTask(v2, '/tmp/v2.md');
  assert.equal(task.planned, '2026-09-18');
  assert.deepEqual(task.plan, [
    'Write version.json at build time',
    'Poll it on an interval and on window focus',
    'Show the banner, reload only when idle',
  ]);
  assert.equal(task.notes.length, 2);
  assert.equal(task.notes[0]!.date, '2026-09-15');
  assert.match(task.notes[0]!.body, /^Decided to poll a version file/);
  assert.match(task.notes[0]!.body, /safety net\.$/);
  assert.deepEqual(task.notes[1], {
    date: '2026-09-16',
    body: 'Second day: the build step landed.',
  });
  assert.equal(task.extra, '', 'known sections are not duplicated into extra');
  assert.equal(task.checklist.length, 2);
});

test('serializeTask round-trips a v2 file with planned, plan and notes byte for byte', () => {
  const task = parseTask(v2);
  assert.equal(serializeTask(task), v2);
  assert.deepEqual(parseTask(serializeTask(task)), task);
});

test('a v1 file with no plan, notes or planned date parses empty and round-trips', () => {
  const v1 = `---
id: plain
title: Plain v1 task
status: current
order: 1
sessions: []
created: 2026-09-14T21:04:00+05:30
updated: 2026-09-14T21:04:00+05:30
---

## Requirement

Just the two v1 sections.

## Checklist

- [ ] One step
`;
  const task = parseTask(v1, '/tmp/v1.md');
  assert.deepEqual(task.plan, []);
  assert.deepEqual(task.notes, []);
  assert.equal(task.planned, undefined);
  assert.equal(serializeTask(task), v1, 'byte for byte');
});

test('body sections parse in any order and are rewritten in the fixed order', () => {
  const shuffled = `---
id: shuffled
title: Shuffled
status: current
order: 1
sessions: []
created: 2026-09-15T09:00:00+05:30
updated: 2026-09-15T09:00:00+05:30
---

## Notes

### 2026-09-15
A note that came first in the file.

## Checklist

- [ ] Only step

## Plan

1. Only planned step

## Requirement

The requirement came last.

## Appendix

Unknown content stays at the end.
`;
  const task = parseTask(shuffled);
  assert.equal(task.requirement, 'The requirement came last.');
  assert.deepEqual(task.plan, ['Only planned step']);
  assert.equal(task.checklist.length, 1);
  assert.equal(task.notes.length, 1);
  assert.match(task.extra, /^## Appendix/);
  const out = serializeTask(task);
  const order = ['## Requirement', '## Plan', '## Checklist', '## Notes', '## Appendix'];
  const at = order.map((heading) => out.indexOf(heading));
  assert.ok(at.every((i) => i > 0), `all headings present in ${out}`);
  const sorted = [...at].sort((a, b) => a - b);
  assert.deepEqual(at, sorted, 'fixed order: Requirement, Plan, Checklist, Notes, then the rest');
  assert.deepEqual(parseTask(out), { ...task, file: '' });
});

test('a malformed planned value is dropped, not thrown', () => {
  const head = (planned: string) =>
    `---\nid: x\ntitle: T\nstatus: current\norder: 1\nplanned: ${planned}\n---\n`;
  for (const bad of ['tomorrow', '2026-13-01', '2026-02-31', '15/09/2026', '""']) {
    const task = parseTask(head(bad), '/tmp/bad-planned.md');
    assert.equal(task.planned, undefined, `dropped ${bad}`);
    assert.doesNotMatch(serializeTask(task), /^planned:/m);
  }
  assert.equal(parseTask(head('2026-09-18')).planned, '2026-09-18');
});

test('planned is written after repo and before sessions', () => {
  const task = parseTask(v2);
  const out = serializeTask({ ...task, repo: '/srv/app' });
  const lines = out.split('\n');
  const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix));
  assert.ok(at('repo:') < at('planned:'), 'repo before planned');
  assert.ok(at('planned:') < at('sessions:'), 'planned before sessions');
});

test('a Plan or Notes section without list items or dates is kept as extra', () => {
  const prose = `---
id: prose
title: Prose
status: current
order: 1
sessions: []
created: 2026-09-15T09:00:00+05:30
updated: 2026-09-15T09:00:00+05:30
---

## Requirement

R.

## Checklist

## Plan

Some prose where a v1 file used the word Plan.

## Notes

Undated prose, kept verbatim.
`;
  const task = parseTask(prose);
  assert.deepEqual(task.plan, []);
  assert.deepEqual(task.notes, []);
  assert.match(task.extra, /## Plan/);
  assert.match(task.extra, /Undated prose, kept verbatim\./);
  assert.equal(serializeTask(task), prose, 'nothing is lost or moved');
});

test('an empty plan or note body is not written back', () => {
  const task = parseTask(v2);
  const out = serializeTask({ ...task, plan: [], notes: [{ date: '2026-09-15', body: '  ' }] });
  assert.doesNotMatch(out, /^## Plan$/m);
  assert.doesNotMatch(out, /^## Notes$/m);
});

test('a bulleted plan is read and renumbered on save', () => {
  const bulleted = `---
id: bulleted
title: Bulleted
status: current
order: 1
sessions: []
created: 2026-09-15T09:00:00+05:30
updated: 2026-09-15T09:00:00+05:30
---

## Requirement

R.

## Plan

- Write version.json
- Poll it on focus

## Checklist
`;
  const task = parseTask(bulleted);
  assert.deepEqual(task.plan, ['Write version.json', 'Poll it on focus']);
  assert.match(serializeTask(task), /^1\. Write version\.json$/m);
  assert.match(serializeTask(task), /^2\. Poll it on focus$/m);
  assert.equal(task.extra, '');
});
