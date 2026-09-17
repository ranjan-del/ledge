#!/bin/sh
# Fake `ledge` for the hook tests. Records its argv, one invocation per line, in the file
# named by LEDGE_FAKE_LOG and prints canned output chosen by LEDGE_FAKE_MODE:
#   task     a task matches (current --context prints a block, --json prints a task, link ok)
#   none     no task matches (current exits 2 with no output)
#   error    the store is broken (every command exits 3 with a message on stderr)
#   intent   no current task, but a live intent record: began prints the backlog line and
#            settle reports a promotion
#   kept     the same live intent record, but settle found no evidence and promoted nothing
#   both     a current task and a live intent record for another task in the same folder
printf '%s\n' "$*" >>"${LEDGE_FAKE_LOG:-/dev/null}"

nudge="Ledge: this task is in the backlog (id: release-watch-banner). Run \`ledge start \
release-watch-banner\` as soon as you make a real change to it, so the desk shows what is \
being worked on."

case "${LEDGE_FAKE_MODE:-task}" in
  error)
    echo "ledge: parse error in /home/user/.ledge/tasks/broken.md:3" >&2
    exit 3
    ;;
  none)
    case "$1" in
      current) exit 2 ;;
      began) exit 2 ;;
      settle) printf '%s\n' '{"decision":"none","message":"Nothing to settle."}' ;;
      *) exit 0 ;;
    esac
    ;;
  both)
    case "$1 $*" in
      "current "*"--context"*)
        printf '%s\n' \
          "Ledge task: Release watch banner for stale tabs (release-watch-banner)" \
          "" \
          "Still to do:" \
          "- [ ] Build step that writes version.json"
        ;;
      "began "*) printf '%s\n' "$nudge" ;;
      "settle "*) printf '%s\n' '{"decision":"none","message":"Nothing to settle."}' ;;
      *) exit 0 ;;
    esac
    ;;
  intent | kept)
    case "$1" in
      current) exit 2 ;;
      began) printf '%s\n' "$nudge" ;;
      settle)
        if [ "${LEDGE_FAKE_MODE}" = "intent" ]; then
          printf '%s\n' \
            '{"decision":"promoted","taskId":"release-watch-banner","worked":true,' \
            '"reasons":["a checklist item was ticked"],' \
            '"message":"Ledge moved release-watch-banner from the backlog to your current' \
            ' tasks, because a checklist item was ticked."}'
        else
          printf '%s\n' \
            '{"decision":"kept","taskId":"release-watch-banner","worked":false,' \
            '"reasons":["no checklist item was ticked or added"],' \
            '"message":"Left release-watch-banner in the backlog."}'
        fi
        ;;
      *) exit 0 ;;
    esac
    ;;
  task)
    case "$1 $*" in
      "current "*"--context"*)
        printf '%s\n' \
          "Ledge task: Release watch banner for stale tabs (release-watch-banner)" \
          "Planned: 2026-09-18 (on 2026-09-18)" \
          "" \
          "Requirement:" \
          "Users keep old code in open tabs after a deploy." \
          "" \
          "Plan:" \
          "1. Write version.json at build time" \
          "2. Poll it on an interval and on window focus" \
          "" \
          "Still to do:" \
          "- [ ] Build step that writes version.json" \
          "- [ ] Banner component in the shell" \
          "" \
          "Notes (2026-09-15):" \
          "Decided to poll a version file rather than use a service worker."
        exit 0
        ;;
      "current "*"--json"*)
        printf '%s\n' \
          '{"id":"release-watch-banner","title":"Release watch banner for stale tabs",' \
          '"status":"current","order":1,"repo":"/home/user/code/demo-app",' \
          '"sessions":["b13e8b5e"],"checklist":[]}'
        exit 0
        ;;
      "began "*) exit 2 ;;
      "settle "*)
        printf '%s\n' '{"decision":"none","message":"Nothing to settle."}'
        exit 0
        ;;
      "link "*) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
esac
exit 0
