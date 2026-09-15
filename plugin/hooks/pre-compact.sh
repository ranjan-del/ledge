#!/bin/sh
# Ledge PreCompact hook.
# Reads the hook payload from stdin, resolves the Ledge task for the session's working
# directory and prints a one-line reminder to bring its checklist up to date before the
# context is compacted. Prints nothing when the ledge CLI is missing or no task matches.
# Always exits 0.

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

task_json=$(ledge current --repo "$cwd" --json 2>/dev/null) || exit 0
task_id=$(printf '%s' "$task_json" | json_str id)
[ -n "$task_id" ] || exit 0

echo "Before compaction, update the Ledge checklist for the current task ($task_id):" \
  "tick finished items and add new ones with the Edit tool on the file" \
  "from \`ledge open $task_id\`."
exit 0
