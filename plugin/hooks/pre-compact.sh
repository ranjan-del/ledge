#!/bin/sh
# Ledge PreCompact hook.
# Reads the hook payload from stdin, resolves the Ledge task for the session's working
# directory and prints a one-line reminder to bring its checklist up to date and to append
# a closing note before the context is compacted. The note is the part that survives
# compaction: the checklist says what is done, the note says why and what is left.
# Prints nothing when the ledge CLI is missing or no task matches. Always exits 0.
# It also starts `ledge capture --final` detached, so the transcript is read into the task
# before compaction throws the detail away, whether or not a task matches yet.

# A capture runs `claude -p` in the background. That child must never start a capture of its
# own, so every hook stands down when the capture has marked its environment.
[ "${LEDGE_CAPTURE:-}" = "1" ] && exit 0

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

# launch_capture SESSION TRANSCRIPT CWD [--final] starts `ledge capture` fully detached: the
# subshell exits at once so the capture is not this hook's child, nohup keeps it alive when
# Claude Code closes the terminal, and every stream is redirected so nothing holds the hook's
# output open. LEDGE_CAPTURE=1 is what makes the hooks of the model call it starts stand down.
# The hook returns in milliseconds; the capture's own debounce decides whether a model is asked.
launch_capture() {
  (
    LEDGE_CAPTURE=1 nohup ledge capture --session "$1" --transcript "$2" --cwd "$3" $4 \
      >/dev/null 2>&1 </dev/null &
  )
}

command -v ledge >/dev/null 2>&1 || exit 0

cwd=$(printf '%s' "$payload" | json_str cwd)
[ -n "$cwd" ] || cwd=$PWD
session_id=$(printf '%s' "$payload" | json_str session_id)
transcript=$(printf '%s' "$payload" | json_str transcript_path)

if [ -n "$session_id" ] && [ -n "$transcript" ]; then
  launch_capture "$session_id" "$transcript" "$cwd" --final
fi

task_json=$(ledge current --repo "$cwd" --json 2>/dev/null) || exit 0
task_id=$(printf '%s' "$task_json" | json_str id)
[ -n "$task_id" ] || exit 0

echo "Before compaction, update the Ledge task ($task_id): tick finished checklist items" \
  "and add new ones with the Edit tool on the file from \`ledge open $task_id\`, then run" \
  "\`ledge note $task_id \"...\"\` with what was done, what is left and what the next" \
  "session needs to know. Do both now; after compaction the reasoning is gone."
exit 0
