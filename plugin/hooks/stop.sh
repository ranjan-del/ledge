#!/bin/sh
# Ledge Stop hook.
# Reads the hook payload from stdin, resolves the Ledge task for the session's working
# directory and appends this session id to that task with `ledge link`. Silent: prints
# nothing in every case and always exits 0 so it can never block Claude from stopping.

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

session_id=$(printf '%s' "$payload" | json_str session_id)
[ -n "$session_id" ] || exit 0

cwd=$(printf '%s' "$payload" | json_str cwd)
[ -n "$cwd" ] || cwd=$PWD

task_json=$(ledge current --repo "$cwd" --json 2>/dev/null) || exit 0
task_id=$(printf '%s' "$task_json" | json_str id)
[ -n "$task_id" ] || exit 0

ledge link "$task_id" "$session_id" >/dev/null 2>&1
exit 0
