# Contributing to Ledge

Thank you for considering a contribution. Ledge is built in the open, phase by phase, and the
phases are listed in [ROADMAP.md](ROADMAP.md). The fastest way to help is to pick something from
the current phase or open an issue describing what you need.

## How contributions flow

1. Fork the repository. Nobody pushes to `main` directly, including the maintainer.
2. Create a branch in your fork: `feat/<area>-<short-name>`, `fix/...`, `docs/...`.
3. Open a pull request against `main` using the PR template. Say which phase and which folder it
   touches.
4. CI must pass: `npm test` and `npm run typecheck` on Node 22 and 24. The `cargo check` job is
   advisory until the desktop app compiles.
5. A maintainer reviews. Small, focused PRs are reviewed fastest.

There is no contributor license agreement. By opening a pull request you agree that your
contribution is licensed under the [MIT License](LICENSE).

## What we will and will not merge

| Welcome | Please open an issue first |
|---|---|
| Bug fixes with a failing test that now passes | A change to the task file format or to `config.json` keys |
| Support for another terminal in `open_terminal` | A change to the `@ledge/core` public API |
| Documentation, corrections, manual QA results for an OS | Anything that adds a database, a server, a daemon or a network call |
| Test fixtures: recorded `git status --porcelain=v2` output, hook payloads | A new hook or a new slash command |
| Small, dependency free improvements to the CLI output | Any new runtime dependency |

## Ground rules that keep the project honest

- **Files are the API.** Every feature must work when the task files are edited by hand, by a
  script, or by Claude Code. Nothing may depend on state that is not in `~/.ledge`.
- **No feature is claimed before it ships.** README, docs and the roadmap say what exists today
  and mark everything else with a phase number.
- **Hooks never fail a session.** Every hook script exits 0 on any error and prints nothing unless
  it has something useful to say. The SessionStart hook is the only one allowed to print a hint.
- **Zero token cost by default.** A change that makes Claude read more at session start needs a
  reason and a number in the PR.
- **Never write outside `LEDGE_HOME`.** Tests set it to a temporary directory; code that writes
  anywhere else will not be merged.
- **Low RAM, low battery, simplicity.** No polling where the OS offers events, no animation loops
  while the panel is hidden, no framework that ships a runtime the app does not need.

## Conventions

- Node 22.6 or newer. TypeScript source is run directly by Node with type stripping. There is no
  build step for `packages/core` or `packages/cli`.
- `erasableSyntaxOnly` is on: no enums, no parameter properties, no namespaces. Use `import type`
  for types.
- Imports inside a package use relative paths with `.ts` extensions. Cross package imports are
  `@ledge/core` only. Never deep import.
- Tests use Node's built in runner: `node --test test/*.test.ts`. The desktop app uses Vitest for
  component tests only.
- Line width 100. No em dashes anywhere, in code, comments or docs.
- Every exported function has a one paragraph doc comment saying what it does and why it exists.

## Development setup

```bash
git clone https://github.com/ranjan-del/ledge.git
cd ledge
npm install                       # workspaces: packages/core, packages/cli, apps/desktop
npm test                          # every package's tests
npm run typecheck                 # tsc in every package
sh plugin/test/hooks.test.sh      # hook scripts against a fake `ledge`
```

To try the CLI against a throwaway store:

```bash
export LEDGE_HOME="$(mktemp -d)"
node packages/cli/bin/ledge.ts init
node packages/cli/bin/ledge.ts add "Try Ledge" --repo "$PWD"
node packages/cli/bin/ledge.ts
```

The desktop app needs Rust via rustup and the Tauri 2 prerequisites for your platform. See
[docs/getting-started.md](docs/getting-started.md).

## Keep every surface in sync

A change to behaviour, naming or plan updates README, ROADMAP, CHANGELOG and the relevant
`docs/*.md` in the same pull request. If the task file format changes,
[docs/task-file-format.md](docs/task-file-format.md) and the `/ledge` command text in
`plugin/commands/ledge.md` change with it. Reviewers check this before anything else.

## Commit messages

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`. One logical change
per commit.

## Decisions

Decisions that shape the project are recorded in [docs/adr](docs/adr). If your change reverses one,
add a new ADR that supersedes it rather than editing the old one.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
