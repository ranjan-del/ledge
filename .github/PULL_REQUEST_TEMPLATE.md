## What

<!-- One paragraph. What does this PR change and why. Link the issue: Closes #NN -->

## Phase and folder

<!-- e.g. Phase 0, packages/core; Phase 1, apps/desktop -->

## How it was tested

<!-- Commands run and their result. `npm test`, `npm run typecheck`, `sh plugin/test/hooks.test.sh`.
     For desktop changes, which rows of docs/manual-qa.md you ran and on which OS. -->

## Checklist

- [ ] Tests added or updated
- [ ] README, ROADMAP, CHANGELOG and the relevant `docs/*.md` updated if behaviour changed
- [ ] If the task file format changed: `docs/task-file-format.md` and `plugin/commands/ledge.md`
      updated
- [ ] Nothing writes outside `LEDGE_HOME`
- [ ] Hooks still exit 0 on every error path
- [ ] No new runtime dependency, or the PR says why
- [ ] No em dashes; lines at or under 100 characters in Markdown
