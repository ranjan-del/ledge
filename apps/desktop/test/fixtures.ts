/**
 * Shared fixtures: task Markdown that follows spec section 2 and contract section 2, plus a
 * porcelain v2 sample.
 */
import { parseTask, type RepoStatus, type Task } from '@ledge/core/pure';

export const HOME = '/home/t';
export const LEDGE_HOME = `${HOME}/.ledge`;
export const TASKS_DIR = `${LEDGE_HOME}/tasks`;
export const ARCHIVE_DIR = `${LEDGE_HOME}/archive`;
export const CONFIG_PATH = `${LEDGE_HOME}/config.json`;

export const TASK_A_FILE = `${TASKS_DIR}/2026-09-14-release-watch-banner.md`;
export const TASK_B_FILE = `${TASKS_DIR}/2026-09-14-optimistic-crud.md`;

export const TASK_A = `---
id: release-watch-banner
title: Release watch banner for stale tabs
status: current
order: 1
repo: ~/code/app
sessions:
  - b13e8b5e
  - 071729a1
created: 2026-09-14T21:04:00+05:30
updated: 2026-09-14T23:04:00+05:30
---

## Requirement

Users keep old code in open tabs after a deploy and lazy routes fail.
Write version.json at build, poll it and on window focus, show a banner.

## Checklist

- [x] Investigated caching setup and why open tabs break
- [x] Design agreed: version.json polling, banner, idle reload
- [ ] Build step that writes version.json
- [ ] ReleaseWatchService with polling and focus listener
- [ ] Banner component in the shell
`;

export const TASK_A_RENAMED = TASK_A.replace(
  'title: Release watch banner for stale tabs',
  'title: Release watch banner v2',
);

export const TASK_B = `---
id: optimistic-crud
title: Optimistic CRUD for the admin grid
status: backlog
order: 1
sessions: []
created: 2026-09-13T10:00:00+05:30
updated: 2026-09-13T12:00:00+05:30
parked: Waiting for design approval
---

## Requirement

Rows should update instantly and roll back on error.

## Checklist

- [ ] Optimistic insert
- [ ] Rollback on failure
`;

export const BROKEN_TASK = `---
id: broken
title: [unclosed
status: nope
---
`;

export const PORCELAIN = `# branch.oid 1a2b3c
# branch.head feature/banner
# branch.upstream origin/feature/banner
# branch.ab +2 -0
1 .M N... 100644 100644 100644 abc def src/app.ts
? notes.txt
`;

export function taskA(): Task {
  return parseTask(TASK_A, TASK_A_FILE, { home: HOME });
}

export function taskB(): Task {
  return parseTask(TASK_B, TASK_B_FILE, { home: HOME });
}

export function taskC(): Task {
  return parseTask(TASK_C, TASK_C_FILE, { home: HOME });
}

/** A copy of task A planned for a given day, for the Today block and overdue marking. */
export function plannedTask(day: string, overrides: Partial<Task> = {}): Task {
  return { ...taskA(), planned: day, ...overrides };
}

export function repoStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    repo: `${HOME}/code/app`,
    branch: 'feature/banner',
    upstream: 'origin/feature/banner',
    ahead: 2,
    behind: 0,
    dirty: [
      { path: 'src/app.ts', code: '.M' },
      { path: 'notes.txt', code: '??' },
    ],
    lastActivity: new Date().toISOString(),
    ...overrides,
  };
}

/** The day the dated fixtures are written against. Pass it as `day` and the clock cannot bite. */
export const DAY = '2026-09-15';
/** Four days before DAY, for overdue rows. */
export const DAY_PAST = '2026-09-11';

export const TASK_C_FILE = `${TASKS_DIR}/2026-09-11-version-file-rollout.md`;

/** A task with all three contract section 2 additions: planned, a plan, and dated notes. */
export const TASK_C = `---
id: version-file-rollout
title: Roll the version file out to every app
status: current
order: 2
repo: ~/code/admin-web
planned: ${DAY_PAST}
sessions:
  - 4c1d9a2b
created: 2026-09-11T09:30:00+05:30
updated: 2026-09-14T18:10:00+05:30
---

## Requirement

Every app writes version.json at build and the shell reloads when it changes.

## Plan

1. Write version.json in the build step
2. Poll it on an interval and on window focus
3. Show the banner and reload only when the tab is idle

## Checklist

- [x] Build step writes version.json
- [ ] Poll on focus
- [ ] Banner in the shell

## Notes

### 2026-09-12
Polling a static file beats a service worker here: the app already fetches its config the
same way, so there is nothing new to cache-bust.

### 2026-09-14
Chunk load errors are the safety net, not the mechanism. Caught one in the wild today and the
reload recovered it, so the banner can stay quiet until the poll notices.
`;

/* Two finished tasks, in `archive/`. The Done view reads these; nothing else does, and
   nothing reads them at boot. One was finished to the letter and one was not, which is the
   difference the final progress is there to show. */
export const ARCHIVED_OLD_FILE = `${ARCHIVE_DIR}/2026-09-02-shipped-first.md`;
export const ARCHIVED_NEW_FILE = `${ARCHIVE_DIR}/2026-09-08-shipped-last.md`;

export const ARCHIVED_OLD = `---
id: shipped-first
title: Version file in the build step
status: done
order: 1
repo: ~/code/app
sessions:
  - 3a91f0cc
created: 2026-09-01T09:00:00+05:30
updated: 2026-09-03T18:20:00+05:30
---

## Checklist

- [x] Write version.json
- [x] Check it into the deploy
`;

export const ARCHIVED_NEW = `---
id: shipped-last
title: Retry the nightly sync once before giving up
status: done
order: 2
sessions: []
created: 2026-09-05T09:00:00+05:30
updated: 2026-09-08T11:05:00+05:30
---

## Checklist

- [x] Bounded retry with backoff
- [ ] Alert once, not once per record
`;

/** Archived tasks as the Done view receives them: parsed, newest first. */
export function archived(): Task[] {
  return [
    parseTask(ARCHIVED_NEW, ARCHIVED_NEW_FILE, { home: HOME }),
    parseTask(ARCHIVED_OLD, ARCHIVED_OLD_FILE, { home: HOME }),
  ];
}
