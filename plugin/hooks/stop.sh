#!/bin/sh
# Ledge Stop hook.
# Reads the hook payload from stdin, resolves the Ledge task for the session's working
# directory and appends this session id to that task with `ledge link`. It then runs
# `ledge settle`, which compares the task and its repo with the snapshot taken at session
# start and moves the task out of the backlog only when something actually changed.
# Silent unless a task was promoted, because a hook that narrates every session end is
# noise. Always exits 0 so it can never block Claude from stopping.

payload=$(cat 2>/dev/null)

# json_str KEY prints the string value of the first top-level occurrence of "KEY" in the
# text passed on stdin. Plain awk so there is no jq dependency. Unescapes \\ and \/ only.
json_str() {
  tr -d '\n\r' | awk -v key="\"$1\"" '
    {
      i = index($0, key)
      if (i == 0) exit
      s = substr($0, i + length(key))
      if (sub(/^[ \t]*:[ \t]*"/, "", s) == 0) exit
      sub(/".*/, "", s)
      gsub(/\\\//, "/", s)
      gsub(/\\\\/, "\\", s)
      print s
    }'
}

command -v ledge >/dev/null 2>&1 || exit 0

cwd=$(printf '%s' "$payload" | json_str cwd)
[ -n "$cwd" ] || cwd=$PWD
session_id=$(printf '%s' "$payload" | json_str session_id)

if [ -n "$session_id" ] && task_json=$(ledge current --repo "$cwd" --json 2>/dev/null); then
  task_id=$(printf '%s' "$task_json" | json_str id)
  [ -n "$task_id" ] && ledge link "$task_id" "$session_id" >/dev/null 2>&1
fi

settled=$(ledge settle --repo "$cwd" --json 2>/dev/null) || exit 0
decision=$(printf '%s' "$settled" | json_str decision)
[ "$decision" = "promoted" ] || exit 0

message=$(printf '%s' "$settled" | json_str message)
[ -n "$message" ] && printf '%s\n' "$message"
exit 0
