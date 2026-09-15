# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private reporting:
**Security tab, then "Report a vulnerability"**, or open a draft security advisory on this
repository.

You will get an acknowledgement within 7 days and a plan or fix within 30 days for confirmed
issues.

## Supported versions

Pre-1.0: only the latest tagged release and `main` receive fixes.

## Security design notes

- Ledge is local only. It has no server, no sign in, no sync and makes no network calls. Nothing
  leaves the machine.
- The only files Ledge writes are under `LEDGE_HOME` (default `~/.ledge`). Tests point it at a
  temporary directory, and code that writes elsewhere is not merged.
- The hooks read two fields from the Claude Code hook payload, `cwd` and `session_id`, and pass
  them to the `ledge` CLI. They do not read conversation content, and they exit 0 with no output
  on any error so a bug in Ledge can never break a Claude Code session.
- The git scan runs exactly one read only command per repository,
  `git -C <repo> status --porcelain=v2 --branch`. It never fetches, pulls, commits or pushes.
- Ledge does not read Claude Code transcripts, the claude-mem database or anything under
  `~/.claude`. See [docs/adr/0003-no-claude-mem-read.md](docs/adr/0003-no-claude-mem-read.md).
- The desktop app (phase 1) will run terminal commands only when you click "Open in Claude" or
  "Resume in Claude" (phase 2), and the exact command is shown to you if the launch fails.
- Task files are plain Markdown you own. Anything you put in a Requirement or checklist is injected
  into a Claude Code session by the SessionStart hook, so treat the task folder like any other
  prompt source.
