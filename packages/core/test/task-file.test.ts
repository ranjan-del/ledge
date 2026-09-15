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
