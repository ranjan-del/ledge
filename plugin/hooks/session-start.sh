#!/bin/sh
# Ledge SessionStart hook.
# Reads the hook payload from stdin, resolves the Ledge task for the session's working
# directory and prints its context block (title, requirement, unchecked items) so Claude
# starts the session briefed. Never fails the session: every path exits 0.
# Output rules: task context when a task matches, one hint line when none matches or when
# the ledge CLI is missing, nothing at all on any other error.

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

if ! command -v ledge >/dev/null 2>&1; then
  echo "Ledge: the ledge CLI is not on PATH, so no task context was loaded." \
    "Install it (npm install -g @ledge/cli) or see the plugin README."
  exit 0
fi

cwd=$(printf '%s' "$payload" | json_str cwd)
[ -n "$cwd" ] || cwd=$PWD

out=$(ledge current --repo "$cwd" --context 2>/dev/null)
rc=$?

if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
  printf '%s\n' "$out"
elif [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ]; then
  echo "No Ledge task for this repo. Use /ledge start to create one."
fi

exit 0
