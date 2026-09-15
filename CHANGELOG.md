# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

Release plan (see [ROADMAP.md](ROADMAP.md) for the work inside each phase):

| Version | Phase | Contents |
|---|---|---|
| v0.1.0 | 0 | `@ledge/core`, the `ledge` CLI, the Claude Code plugin, tests, docs |
| v0.2.0 | 1 | Desktop app on macOS: button, panel, three tabs, detail, file watch, git scan |
| v0.3.0 | 2 | Open and Resume in Claude, Windows and Linux builds, installers on GitHub Releases |
| v0.4.0 | 3 | Optional PR status and calendar connectors |

## [Unreleased]

### Added

- Monorepo with npm workspaces: `packages/core` (`@ledge/core`), `packages/cli` (`@ledge/cli`,
  the `ledge` binary), `apps/desktop` (Tauri 2 and Svelte 5), `plugin/` (Claude Code plugin) and a
  root `.claude-plugin/marketplace.json`. Node 22.6 or newer with native TypeScript, no build
  step for core and cli.
- Design spec at `docs/superpowers/specs/2026-09-14-ledge-design.md` and the phase 0
  implementation plan at `docs/superpowers/plans/2026-09-15-phase-0-plan.md`.
- Documentation: `docs/README.md`, getting started, architecture, task file format,
  configuration, manual QA checklist, and ADRs 0001 to 0003.
- Repository governance: CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY,
  ROADMAP, NOTICE, CODEOWNERS, issue and PR templates, Dependabot.
- CI: `npm test` and `npm run typecheck` on Node 22 and 24; advisory `cargo check` of the Tauri
  shell on Ubuntu, macOS and Windows. Release workflow with `tauri-action` on `v*` tags.

### Notes

- Phase 0 is in progress. The entries above describe what the repository is being built to
  contain; each package is marked shipped in ROADMAP.md when its tests pass on `main`.
- MIT licensed from the first commit.
