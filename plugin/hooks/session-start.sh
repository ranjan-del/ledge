#!/bin/sh
# Ledge SessionStart hook.
# Reads the hook payload from stdin, resolves the Ledge task for the session's working
# directory and prints its context block (title, requirement, unchecked items) so Claude
# starts the session briefed. Never fails the session: every path exits 0.
# It also arms any live intent record for this folder, which takes the snapshot the session
# will be judged against at the end and yields one extra line saying the task is still in
# the backlog. That line is a nudge, not the mechanism: the Stop hook promotes on evidence.
# Output rules: task context when a task matches, the backlog line when an intent record is
# live, one hint line when neither matches or when the ledge CLI is missing, nothing at all
# on any other error. Whenever ledge answers at all, a short block of standing rules follows,
# telling the session to keep its task current as it works. The hook also writes the session
# record skeleton (start time, folder, transcript) with `ledge track`, which is what lets the
# panel show a session as running before any capture has read it.

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

if ! command -v ledge >/dev/null 2>&1; then
  echo "Ledge: the ledge CLI is not on PATH, so no task context was loaded." \
    "Install it (npm install -g @ledge/cli) or see the plugin README."
  exit 0
fi

cwd=$(printf '%s' "$payload" | json_str cwd)
[ -n "$cwd" ] || cwd=$PWD
session_id=$(printf '%s' "$payload" | json_str session_id)
transcript=$(printf '%s' "$payload" | json_str transcript_path)

# Arm first, so the before snapshot is taken before anything in this session can change it.
if [ -n "$session_id" ]; then
  nudge=$(ledge began --repo "$cwd" --session "$session_id" 2>/dev/null)
else
  nudge=$(ledge began --repo "$cwd" 2>/dev/null)
fi

if [ -n "$session_id" ]; then
  if [ -n "$transcript" ]; then
    ledge track --session "$session_id" --cwd "$cwd" --transcript "$transcript" >/dev/null 2>&1
  else
    ledge track --session "$session_id" --cwd "$cwd" >/dev/null 2>&1
  fi
fi

out=$(ledge current --repo "$cwd" --context 2>/dev/null)
rc=$?

# standing_rules prints the block that asks the session to keep its task current, and the one
# line that says how to add to the weekly to-do list when asked. Twelve lines
# at most, because it is read at the start of every session and paid for on every turn.
standing_rules() {
  echo ""
  echo "Ledge standing rules: keep this repo's Ledge task current as you work, unasked."
  echo "- The task id is in the block above, or run \`ledge current --repo \"\$PWD\" --json\`."
  echo "- When you make or change a plan, run \`ledge plan <id> \"step\" \"step\" ...\` with every step."
  echo "- When a checklist item is done, run \`ledge tick <id> <n>\`; new work: \`ledge todo <id> \"item\"\`."
  echo "- For a decision or a dead end, run \`ledge note <id> \"...\"\` when it happens, with why."
  echo "- A step, batch, sub-goal or follow-up of the task above is NOT a new task: add it with"
  echo "  \`ledge todo <id> \"[sub-goal] item\"\`. Never \`ledge add\` while a task is shown above."
  echo "- Only for a new goal with no task at all, run \`ledge add \"title\" --repo \"\$PWD\"\`, then"
  echo "  \`ledge start <id>\`. Duplicates already made: \`ledge merge <keep> <dup>... --yes\`."
  echo "- Asked to remember something this week: \`ledge week add \"text\" [--day mon]\`. Never add week items unasked."
  echo "- Ledge also reads this session in the background, so a missed step is caught later."
}

if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
  printf '%s\n' "$out"
  [ -n "$nudge" ] && printf '%s\n' "$nudge"
  standing_rules
elif [ -n "$nudge" ]; then
  printf '%s\n' "$nudge"
  standing_rules
elif [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ]; then
  echo "No Ledge task for this repo. Use /ledge start to create one."
  standing_rules
fi

exit 0
