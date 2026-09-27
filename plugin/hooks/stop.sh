#!/bin/sh
# Ledge Stop hook.
# Reads the hook payload from stdin, resolves the Ledge task for the session's working
# directory and appends this session id to that task with `ledge link`. It then runs
# `ledge settle`, which compares the task and its repo with the snapshot taken at session
# start and moves the task out of the backlog only when something actually changed.
# Silent unless a task was promoted, because a hook that narrates every session end is
# noise. Last, it starts `ledge capture` detached, which reads the transcript and keeps the
# task current; its debounce makes that a no-op on most turns. Always exits 0 so it can never
# block Claude from stopping, and returns without waiting for the capture.

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

if [ -n "$session_id" ] && task_json=$(ledge current --repo "$cwd" --json 2>/dev/null); then
  task_id=$(printf '%s' "$task_json" | json_str id)
  [ -n "$task_id" ] && ledge link "$task_id" "$session_id" >/dev/null 2>&1
fi

settled=$(ledge settle --repo "$cwd" --json 2>/dev/null)
if [ -n "$settled" ]; then
  decision=$(printf '%s' "$settled" | json_str decision)
  if [ "$decision" = "promoted" ]; then
    message=$(printf '%s' "$settled" | json_str message)
    [ -n "$message" ] && printf '%s\n' "$message"
  fi
fi

if [ -n "$session_id" ] && [ -n "$transcript" ]; then
  launch_capture "$session_id" "$transcript" "$cwd"
fi
exit 0
