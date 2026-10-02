# Ledge documentation

| Document | What it covers | Status |
|---|---|---|
| [getting-started.md](getting-started.md) | Install the CLI and the plugin, create the first task, command reference | Phase 0: CLI and plugin flow. The desktop app section is marked phase 1 |
| [architecture.md](architecture.md) | Packages, data flow, what reads and writes what, the git scan, the hooks | Phase 0 shipped parts are current; desktop app parts are design |
| [task-file-format.md](task-file-format.md) | Frontmatter keys, body headings, filename rule, parse errors | Contract 1, fixed for phase 0 |
| [week-file-format.md](week-file-format.md) | The weekly to-do file: sections, items, task links, ISO weeks, numbering | Weekly to-do contract, 2026-09-27 |
| [configuration.md](configuration.md) | Every key in `config.json`, defaults, `LEDGE_HOME` | Contract 2 `Config`, fixed for phase 0 |
| [manual-qa.md](manual-qa.md) | Per OS checklist for window effects, drag and snap, terminal launch | Written ahead of phase 1; nothing ticked yet |
| [adr/](adr/) | Architecture decision records | Accepted |
| [superpowers/specs/](superpowers/specs/) | The full design spec | Approved direction, 2026-09-14 |
| [superpowers/plans/](superpowers/plans/) | Phase implementation plans | Phase 0 plan, 2026-09-15 |

Documents describing features that have not shipped carry a status line at the top. They are
written before the code on purpose: the explanation is the specification, and the implementation
must match it or the document is corrected in the same pull request.

## Flagship standard documents

Added for the flagship documentation standard (see the README section "Project documentation"). Each is a stub until filled in.

| Document | Status |
|---|---|
| [benchmarks.md](benchmarks.md) | to be written |
| [cost.md](cost.md) | to be written |
| [deployment.md](deployment.md) | partial |
| [evaluation.md](evaluation.md) | partial |
| [failure-cases.md](failure-cases.md) | partial |
| [trade-offs.md](trade-offs.md) | partial |
