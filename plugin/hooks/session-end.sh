#!/bin/sh
# Ledge SessionEnd hook.
# Reads the hook payload from stdin, marks the session's record ended with `ledge track
# --ended`, which is what stops the panel showing it as running, and then starts a final
# `ledge capture --final` detached so the last turns are read into the task. Prints nothing
# and always exits 0: Claude Code is closing, and nothing here may hold it up.

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
[ -n "$session_id" ] || exit 0

if [ -n "$transcript" ]; then
  ledge track --session "$session_id" --cwd "$cwd" --transcript "$transcript" --ended \
    >/dev/null 2>&1
  launch_capture "$session_id" "$transcript" "$cwd" --final
else
  ledge track --session "$session_id" --cwd "$cwd" --ended >/dev/null 2>&1
fi
exit 0
