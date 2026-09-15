#!/bin/sh
# Fake `ledge` for the hook tests. Records its argv, one invocation per line, in the file
# named by LEDGE_FAKE_LOG and prints canned output chosen by LEDGE_FAKE_MODE:
#   task   a task matches (current --context prints a block, --json prints a task, link ok)
#   none   no task matches (current exits 2 with no output)
#   error  the store is broken (every command exits 3 with a message on stderr)
printf '%s\n' "$*" >>"${LEDGE_FAKE_LOG:-/dev/null}"

case "${LEDGE_FAKE_MODE:-task}" in
  error)
    echo "ledge: parse error in /home/user/.ledge/tasks/broken.md:3" >&2
    exit 3
    ;;
  none)
    case "$1" in
      current) exit 2 ;;
      *) exit 0 ;;
    esac
    ;;
  task)
    case "$1 $*" in
      "current "*"--context"*)
        printf '%s\n' \
          "Ledge task: Release watch banner for stale tabs (release-watch-banner)" \
          "" \
          "Requirement: Users keep old code in open tabs after a deploy." \
          "" \
          "Unchecked:" \
          "- [ ] Build step that writes version.json" \
          "- [ ] Banner component in the shell"
        exit 0
        ;;
      "current "*"--json"*)
        printf '%s\n' \
          '{"id":"release-watch-banner","title":"Release watch banner for stale tabs",' \
          '"status":"current","order":1,"repo":"/home/user/code/demo-app",' \
          '"sessions":["b13e8b5e"],"checklist":[]}'
        exit 0
        ;;
      "link "*) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
esac
exit 0
