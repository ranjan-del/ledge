#!/bin/sh
# Ledge plugin hook tests. Plain POSIX sh, no frameworks.
# Puts a fake `ledge` on PATH that records its argv and prints canned output, feeds the
# payloads in fixtures/ to each hook script, and asserts stdout and exit codes.
# Run with: sh plugin/test/hooks.test.sh    Exits non-zero if any assertion fails.

here=$(cd "$(dirname "$0")" && pwd)
hooks="$here/../hooks"
fixtures="$here/fixtures"
SH=$(command -v sh)

tmp=$(mktemp -d 2>/dev/null || mktemp -d -t ledge-hooks)
trap 'rm -rf "$tmp"' EXIT INT TERM

# bin/ holds the fake ledge plus the utilities the hooks need. nobin/ holds only the
# utilities, so a hook run with PATH=nobin sees no ledge at all.
mkdir -p "$tmp/bin" "$tmp/nobin" "$tmp/pwd"
for u in sh cat tr awk sed nohup sleep; do
  ln -s "$(command -v "$u")" "$tmp/bin/$u"
  ln -s "$(command -v "$u")" "$tmp/nobin/$u"
done
cp "$here/fake-ledge.sh" "$tmp/bin/ledge"
chmod +x "$tmp/bin/ledge"

log="$tmp/ledge-argv.log"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
ko() { fail=$((fail + 1)); printf 'FAIL %s\n     %s\n' "$1" "$2"; }

assert_eq() {
  # assert_eq NAME EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then ok "$1"; else ko "$1" "expected [$2] got [$3]"; fi
}

assert_contains() {
  # assert_contains NAME NEEDLE HAYSTACK
  case "$3" in
    *"$2"*) ok "$1" ;;
    *) ko "$1" "expected to find [$2] in [$3]" ;;
  esac
}

assert_empty() {
  # assert_empty NAME ACTUAL
  if [ -z "$2" ]; then ok "$1"; else ko "$1" "expected empty output, got [$2]"; fi
}

run_hook() {
  # run_hook SCRIPT FIXTURE MODE PATHDIR   sets out, rc, logged, elapsed
  # FIXTURE "-" means empty stdin. The hook runs with $tmp/pwd as its working directory.
  # GUARD=1 runs it as if inside a capture; SLOW=n makes the fake capture take n seconds.
  wait_for_capture 0
  : >"$log"
  : >"$log.capture"
  if [ "$2" = "-" ]; then input=/dev/null; else input="$fixtures/$2"; fi
  t0=$(date +%s)
  out=$(cd "$tmp/pwd" && env PATH="$4" LEDGE_FAKE_MODE="$3" LEDGE_FAKE_LOG="$log" \
    LEDGE_CAPTURE="${GUARD:-}" LEDGE_FAKE_CAPTURE_SLEEP="${SLOW:-}" \
    "$SH" "$hooks/$1" <"$input" 2>"$tmp/stderr")
  rc=$?
  elapsed=$(( $(date +%s) - t0 ))
  logged=$(cat "$log")
  # Some shells keep an assignment written before a function call after it returns, so the
  # two switches are cleared here rather than trusted to go out of scope.
  GUARD=
  SLOW=
}

wait_for_capture() {
  # wait_for_capture SECONDS   waits until a detached capture has logged, sets captured
  n=0
  captured=$(cat "$log.capture" 2>/dev/null)
  while [ -z "$captured" ] && [ "$n" -lt "$(( $1 * 10 ))" ]; do
    sleep 0.1
    n=$((n + 1))
    captured=$(cat "$log.capture" 2>/dev/null)
  done
}

line_count() { printf '%s' "$1" | awk 'END { print NR + (length($0) > 0 && NR == 0) }'; }

bin="$tmp/bin"
nobin="$tmp/nobin"

echo "# syntax"
for s in session-start.sh stop.sh pre-compact.sh session-end.sh; do
  if "$SH" -n "$hooks/$s" 2>/dev/null; then ok "sh -n $s"; else ko "sh -n $s" "syntax error"; fi
done

echo "# hooks.json"
hj=$(cat "$hooks/hooks.json")
for ev in SessionStart Stop PreCompact SessionEnd; do
  assert_contains "hooks.json wires $ev" "\"$ev\"" "$hj"
done
for s in session-start.sh stop.sh pre-compact.sh session-end.sh; do
  assert_contains "hooks.json references $s" "\${CLAUDE_PLUGIN_ROOT}/hooks/$s" "$hj"
  if [ -f "$hooks/$s" ]; then ok "$s exists"; else ko "$s exists" "missing"; fi
done
assert_eq "hooks.json has four 5 second timeouts" 4 "$(grep -c '"timeout": 5' "$hooks/hooks.json")"

echo "# session-start.sh"
run_hook session-start.sh session-start.json task "$bin"
assert_eq "task: exit 0" 0 "$rc"
assert_contains "task: prints title" "Release watch banner for stale tabs" "$out"
assert_contains "task: prints unchecked items" "- [ ] Banner component in the shell" "$out"
assert_eq "task: arms the intent, writes the session record, then asks for the context" \
  "began --repo /home/user/code/demo-app --session b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90
track --session b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90 --cwd /home/user/code/demo-app \
--transcript /home/user/.claude/projects/-home-user-code-demo-app/b13e8b5e.jsonl
current --repo /home/user/code/demo-app --context" "$logged"
assert_contains "task: prints the standing rules" "Ledge standing rules" "$out"
assert_contains "task: the rules ask for ledge plan" "ledge plan <id>" "$out"
assert_contains "task: the rules ask for ledge tick" "ledge tick <id> <n>" "$out"
assert_contains "task: the rules ask for ledge note" "ledge note <id>" "$out"
assert_contains "task: the rules say how to start a new goal" "ledge add \"title\"" "$out"
assert_contains "task: the rules say how to add to the week" "ledge week add \"text\" [--day mon]" "$out"
assert_contains "task: the rules say week items are only added when asked" \
  "Never add week items unasked." "$out"
rules=$(printf '%s\n' "$out" | awk '/^Ledge standing rules/ { on = 1 } on { n++ } END { print n }')
if [ "$rules" -le 12 ]; then ok "task: the rules block is at most 12 lines"; else
  ko "task: the rules block is at most 12 lines" "it is $rules"; fi
last=$(printf '%s\n' "$out" | awk 'END { print }')
assert_contains "task: the rules come last" "reads this session in the background" "$last"

assert_contains "task: prints the planned day" "Planned: 2026-09-18" "$out"
assert_contains "task: prints the plan" "1. Write version.json at build time" "$out"
assert_contains "task: prints the latest note" "Notes (2026-09-15):" "$out"

run_hook session-start.sh session-start.json none "$bin"
assert_eq "none: exit 0" 0 "$rc"
first=$(printf '%s\n' "$out" | awk 'NR == 1')
assert_eq "none: prints the no-task line first" \
  "No Ledge task for this repo. Use /ledge start to create one." "$first"
assert_contains "none: then the standing rules" "Ledge standing rules" "$out"

run_hook session-start.sh session-start.json error "$bin"
assert_eq "error: exit 0" 0 "$rc"
assert_empty "error: prints nothing" "$out"

run_hook session-start.sh session-start.json task "$nobin"
assert_eq "missing ledge: exit 0" 0 "$rc"
assert_contains "missing ledge: prints a hint" "ledge CLI is not on PATH" "$out"
assert_eq "missing ledge: exactly one line" 1 "$(line_count "$out")"
assert_empty "missing ledge: ledge never called" "$logged"

run_hook session-start.sh windows-path.json task "$bin"
assert_eq "windows path: exit 0" 0 "$rc"
assert_eq "windows path: backslashes unescaped, and no transcript to pass" \
  'began --repo C:\Users\me\code\demo-app --session c9d8e7f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f
track --session c9d8e7f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f --cwd C:\Users\me\code\demo-app
current --repo C:\Users\me\code\demo-app --context' "$logged"

run_hook session-start.sh malformed.json task "$bin"
assert_eq "malformed payload: exit 0" 0 "$rc"
assert_eq "malformed payload: falls back to PWD, with no session id to pass" \
  "began --repo $tmp/pwd
current --repo $tmp/pwd --context" "$logged"
assert_contains "malformed payload: still prints context" "Release watch banner" "$out"

run_hook session-start.sh - task "$bin"
assert_eq "empty stdin: exit 0" 0 "$rc"
assert_eq "empty stdin: falls back to PWD" \
  "began --repo $tmp/pwd
current --repo $tmp/pwd --context" "$logged"

run_hook session-start.sh session-start.json intent "$bin"
assert_eq "intent: exit 0" 0 "$rc"
assert_contains "intent: prints the backlog nudge" \
  "Run \`ledge start release-watch-banner\`" "$out"
assert_contains "intent: says the task is in the backlog" "is in the backlog" "$out"
case "$out" in
  *"No Ledge task for this repo"*) ko "intent: no contradictory no-task line" "found it" ;;
  *) ok "intent: no contradictory no-task line" ;;
esac
first=$(printf '%s\n' "$out" | awk 'NR == 1')
assert_contains "intent: the nudge is the first line" "is in the backlog" "$first"
assert_contains "intent: then the standing rules" "Ledge standing rules" "$out"

run_hook session-start.sh session-start.json both "$bin"
assert_eq "both: exit 0" 0 "$rc"
assert_contains "both: prints the current task context first" \
  "Ledge task: Release watch banner" "$out"
assert_contains "both: prints the nudge as well" "ledge start release-watch-banner" "$out"
nudge_at=$(printf '%s\n' "$out" | awk '/is in the backlog/ { print NR; exit }')
rules_at=$(printf '%s\n' "$out" | awk '/^Ledge standing rules/ { print NR; exit }')
if [ -n "$nudge_at" ] && [ -n "$rules_at" ] && [ "$nudge_at" -lt "$rules_at" ]; then
  ok "both: the nudge comes after the context and before the rules"
else
  ko "both: the nudge comes after the context and before the rules" "nudge $nudge_at rules $rules_at"
fi

GUARD=1 run_hook session-start.sh session-start.json task "$bin"
assert_eq "inside a capture: exit 0" 0 "$rc"
assert_empty "inside a capture: prints nothing" "$out"
assert_empty "inside a capture: ledge never called" "$logged"

echo "# stop.sh"
run_hook stop.sh stop.json task "$bin"
assert_eq "task: exit 0" 0 "$rc"
assert_empty "task: prints nothing" "$out"
assert_eq "task: resolves the task, links the session, then settles" \
  "current --repo /home/user/code/demo-app --json
link release-watch-banner 071729a1-9f0c-4d7e-8b2a-3c4d5e6f7a81
settle --repo /home/user/code/demo-app --json" "$logged"

run_hook stop.sh stop.json none "$bin"
assert_eq "none: exit 0" 0 "$rc"
assert_empty "none: prints nothing" "$out"
assert_eq "none: no link call, but it still settles" \
  "current --repo /home/user/code/demo-app --json
settle --repo /home/user/code/demo-app --json" "$logged"

run_hook stop.sh stop.json error "$bin"
assert_eq "error: exit 0" 0 "$rc"
assert_empty "error: prints nothing" "$out"
assert_eq "error: no link call, and a failed settle says nothing" \
  "current --repo /home/user/code/demo-app --json
settle --repo /home/user/code/demo-app --json" "$logged"

run_hook stop.sh stop.json task "$nobin"
assert_eq "missing ledge: exit 0" 0 "$rc"
assert_empty "missing ledge: prints nothing" "$out"

run_hook stop.sh - task "$bin"
assert_eq "empty stdin: exit 0" 0 "$rc"
assert_empty "empty stdin: prints nothing" "$out"
assert_eq "empty stdin: no link without a session id, but it still settles" \
  "settle --repo $tmp/pwd --json" "$logged"

run_hook stop.sh malformed.json task "$bin"
assert_eq "malformed payload: exit 0" 0 "$rc"
assert_empty "malformed payload: prints nothing" "$out"
assert_eq "malformed payload: no link, and settle falls back to PWD" \
  "settle --repo $tmp/pwd --json" "$logged"

run_hook stop.sh stop.json intent "$bin"
assert_eq "promoted: exit 0" 0 "$rc"
assert_contains "promoted: says what moved and why" \
  "moved release-watch-banner from the backlog" "$out"
assert_contains "promoted: names the evidence" "a checklist item was ticked" "$out"
assert_eq "promoted: exactly one line" 1 "$(line_count "$out")"

run_hook stop.sh stop.json kept "$bin"
assert_eq "kept: exit 0" 0 "$rc"
assert_empty "kept: says nothing when nothing was promoted" "$out"
assert_contains "kept: settle still ran" "settle --repo" "$logged"

wait_for_capture 1
assert_empty "stop without a transcript: no capture started" "$captured"

SLOW=3 run_hook stop.sh stop-transcript.json task "$bin"
assert_eq "transcript: exit 0" 0 "$rc"
assert_empty "transcript: prints nothing" "$out"
if [ "$elapsed" -le 1 ]; then ok "transcript: returns without waiting for the capture"; else
  ko "transcript: returns without waiting for the capture" "took ${elapsed}s"; fi
assert_eq "transcript: links and settles as before" \
  "current --repo /home/user/code/demo-app --json
link release-watch-banner 071729a1-9f0c-4d7e-8b2a-3c4d5e6f7a81
settle --repo /home/user/code/demo-app --json" "$logged"
wait_for_capture 6
assert_eq "transcript: starts ledge capture detached, marked LEDGE_CAPTURE=1" \
  "capture --session 071729a1-9f0c-4d7e-8b2a-3c4d5e6f7a81 \
--transcript /home/user/.claude/projects/-home-user-code-demo-app/071729a1.jsonl \
--cwd /home/user/code/demo-app LEDGE_CAPTURE=1" "$captured"

run_hook stop.sh stop-transcript.json none "$bin"
wait_for_capture 5
assert_contains "no task yet: still captures, so a task can be created" "capture --session" \
  "$captured"

GUARD=1 run_hook stop.sh stop-transcript.json task "$bin"
assert_empty "inside a capture: prints nothing" "$out"
assert_empty "inside a capture: ledge never called" "$logged"
wait_for_capture 1
assert_empty "inside a capture: no capture started" "$captured"

echo "# pre-compact.sh"
run_hook pre-compact.sh pre-compact.json task "$bin"
assert_eq "task: exit 0" 0 "$rc"
assert_contains "task: prints the reminder" "Before compaction, update the Ledge task" "$out"
assert_contains "task: names the task id" "release-watch-banner" "$out"
assert_contains "task: asks for the checklist" "tick finished checklist items" "$out"
assert_contains "task: asks for a closing note" "ledge note release-watch-banner" "$out"
assert_contains "task: says what the note must cover" \
  "what was done, what is left and what the next session needs" "$out"
assert_eq "task: exactly one line" 1 "$(line_count "$out")"
assert_eq "task: resolves the task by cwd" \
  "current --repo /home/user/code/demo-app --json" "$logged"
wait_for_capture 5
assert_eq "task: starts a final capture detached" \
  "capture --session b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90 \
--transcript /home/user/.claude/projects/-home-user-code-demo-app/b13e8b5e.jsonl \
--cwd /home/user/code/demo-app --final LEDGE_CAPTURE=1" "$captured"

run_hook pre-compact.sh pre-compact.json none "$bin"
assert_eq "none: exit 0" 0 "$rc"
assert_empty "none: prints nothing" "$out"
wait_for_capture 5
assert_contains "none: still starts the final capture" "--final" "$captured"

run_hook pre-compact.sh pre-compact.json error "$bin"
assert_eq "error: exit 0" 0 "$rc"
assert_empty "error: prints nothing" "$out"

run_hook pre-compact.sh pre-compact.json task "$nobin"
assert_eq "missing ledge: exit 0" 0 "$rc"
assert_empty "missing ledge: prints nothing" "$out"

GUARD=1 run_hook pre-compact.sh pre-compact.json task "$bin"
assert_empty "inside a capture: prints nothing" "$out"
assert_empty "inside a capture: ledge never called" "$logged"

echo "# session-end.sh"
SLOW=3 run_hook session-end.sh session-end.json task "$bin"
assert_eq "end: exit 0" 0 "$rc"
assert_empty "end: prints nothing" "$out"
if [ "$elapsed" -le 1 ]; then ok "end: returns without waiting for the capture"; else
  ko "end: returns without waiting for the capture" "took ${elapsed}s"; fi
assert_eq "end: marks the session ended first" \
  "track --session b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90 --cwd /home/user/code/demo-app \
--transcript /home/user/.claude/projects/-home-user-code-demo-app/b13e8b5e.jsonl --ended" \
  "$logged"
wait_for_capture 6
assert_eq "end: then starts a final capture detached" \
  "capture --session b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90 \
--transcript /home/user/.claude/projects/-home-user-code-demo-app/b13e8b5e.jsonl \
--cwd /home/user/code/demo-app --final LEDGE_CAPTURE=1" "$captured"

run_hook session-end.sh - task "$bin"
assert_eq "end, empty stdin: exit 0" 0 "$rc"
assert_empty "end, empty stdin: nothing to mark without a session id" "$logged"

run_hook session-end.sh session-end.json error "$bin"
assert_eq "end, broken store: exit 0" 0 "$rc"
assert_empty "end, broken store: prints nothing" "$out"

run_hook session-end.sh session-end.json task "$nobin"
assert_eq "end, missing ledge: exit 0" 0 "$rc"
assert_empty "end, missing ledge: prints nothing" "$out"

GUARD=1 run_hook session-end.sh session-end.json task "$bin"
assert_empty "end, inside a capture: ledge never called" "$logged"
wait_for_capture 1
assert_empty "end, inside a capture: no capture started" "$captured"

echo "# commands/ledge.md"
cmd="$here/../commands/ledge.md"
if [ -f "$cmd" ]; then ok "ledge.md exists"; else ko "ledge.md exists" "missing"; fi
md=$(cat "$cmd")
for sub in plan note when; do
  assert_contains "ledge.md documents the $sub subcommand" "### $sub" "$md"
  assert_contains "ledge.md runs ledge $sub" "ledge $sub <id>" "$md"
done
assert_contains "ledge.md documents the week subcommand" "### week" "$md"
assert_contains "ledge.md runs ledge week add" "ledge week add \"<item>\"" "$md"
assert_contains "ledge.md keeps week items to explicit requests" \
  "Do not add week items on your" "$md"
assert_contains "ledge.md documents the planned key" "planned: 2026-09-18" "$md"
assert_contains "ledge.md documents the Plan section" "## Plan" "$md"
assert_contains "ledge.md documents dated notes" "### YYYY-MM-DD" "$md"
assert_contains "ledge.md orders a plan before editing code" \
  "Write a plan before you edit code." "$md"
assert_contains "ledge.md orders a note on a decision" \
  "Append a note when you decide something or something surprises you." "$md"
assert_contains "ledge.md orders a closing note before compaction and at session end" \
  "Append a closing note before compaction and at the end of a session." "$md"
assert_contains "ledge.md says what the closing note covers" \
  "what is left, and where it was left" "$md"
assert_contains "ledge.md tells the assistant to read the notes" \
  "Read the notes at the start." "$md"
if grep -q '—' "$cmd"; then ko "ledge.md has no em dashes" "found an em dash"; else
  ok "ledge.md has no em dashes"; fi
long=$(awk 'length > 100 { print FNR; exit }' "$cmd")
if [ -z "$long" ]; then ok "ledge.md lines stay under 100"; else
  ko "ledge.md lines stay under 100" "line $long is longer"; fi

echo
printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
