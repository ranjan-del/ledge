/** Shared fixtures: task Markdown that follows spec section 2 and a porcelain v2 sample. */
import { parseTask, type RepoStatus, type Task } from '@ledge/core/pure';

export const HOME = '/home/t';
export const LEDGE_HOME = `${HOME}/.ledge`;
export const TASKS_DIR = `${LEDGE_HOME}/tasks`;
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
