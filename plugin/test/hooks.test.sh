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
for u in sh cat tr awk sed; do
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
  # run_hook SCRIPT FIXTURE MODE PATHDIR   sets out, rc, logged
  # FIXTURE "-" means empty stdin. The hook runs with $tmp/pwd as its working directory.
  : >"$log"
  if [ "$2" = "-" ]; then input=/dev/null; else input="$fixtures/$2"; fi
  out=$(cd "$tmp/pwd" && env PATH="$4" LEDGE_FAKE_MODE="$3" LEDGE_FAKE_LOG="$log" \
    "$SH" "$hooks/$1" <"$input" 2>"$tmp/stderr")
  rc=$?
  logged=$(cat "$log")
}

line_count() { printf '%s' "$1" | awk 'END { print NR + (length($0) > 0 && NR == 0) }'; }

bin="$tmp/bin"
nobin="$tmp/nobin"

echo "# syntax"
for s in session-start.sh stop.sh pre-compact.sh; do
  if "$SH" -n "$hooks/$s" 2>/dev/null; then ok "sh -n $s"; else ko "sh -n $s" "syntax error"; fi
done

echo "# hooks.json"
hj=$(cat "$hooks/hooks.json")
for ev in SessionStart Stop PreCompact; do
  assert_contains "hooks.json wires $ev" "\"$ev\"" "$hj"
done
for s in session-start.sh stop.sh pre-compact.sh; do
  assert_contains "hooks.json references $s" "\${CLAUDE_PLUGIN_ROOT}/hooks/$s" "$hj"
  if [ -f "$hooks/$s" ]; then ok "$s exists"; else ko "$s exists" "missing"; fi
done
assert_eq "hooks.json has three 5 second timeouts" 3 "$(grep -c '"timeout": 5' "$hooks/hooks.json")"

echo "# session-start.sh"
run_hook session-start.sh session-start.json task "$bin"
assert_eq "task: exit 0" 0 "$rc"
assert_contains "task: prints title" "Release watch banner for stale tabs" "$out"
assert_contains "task: prints unchecked items" "- [ ] Banner component in the shell" "$out"
assert_eq "task: arms the intent record, then calls ledge current --context with cwd" \
  "began --repo /home/user/code/demo-app --session b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90
current --repo /home/user/code/demo-app --context" "$logged"

assert_contains "task: prints the planned day" "Planned: 2026-09-18" "$out"
assert_contains "task: prints the plan" "1. Write version.json at build time" "$out"
assert_contains "task: prints the latest note" "Notes (2026-09-15):" "$out"

run_hook session-start.sh session-start.json none "$bin"
assert_eq "none: exit 0" 0 "$rc"
assert_eq "none: prints the no-task line" \
  "No Ledge task for this repo. Use /ledge start to create one." "$out"

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
assert_eq "windows path: backslashes unescaped" \
  'began --repo C:\Users\me\code\demo-app --session c9d8e7f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f
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
assert_eq "intent: exactly one line" 1 "$(line_count "$out")"

run_hook session-start.sh session-start.json both "$bin"
assert_eq "both: exit 0" 0 "$rc"
assert_contains "both: prints the current task context first" \
  "Ledge task: Release watch banner" "$out"
assert_contains "both: prints the nudge as well" "ledge start release-watch-banner" "$out"
last=$(printf '%s\n' "$out" | awk 'END { print }')
assert_contains "both: the nudge is the last line" "ledge start" "$last"

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

run_hook pre-compact.sh pre-compact.json none "$bin"
assert_eq "none: exit 0" 0 "$rc"
assert_empty "none: prints nothing" "$out"

run_hook pre-compact.sh pre-compact.json error "$bin"
assert_eq "error: exit 0" 0 "$rc"
assert_empty "error: prints nothing" "$out"

run_hook pre-compact.sh pre-compact.json task "$nobin"
assert_eq "missing ledge: exit 0" 0 "$rc"
assert_empty "missing ledge: prints nothing" "$out"

echo "# commands/ledge.md"
cmd="$here/../commands/ledge.md"
if [ -f "$cmd" ]; then ok "ledge.md exists"; else ko "ledge.md exists" "missing"; fi
md=$(cat "$cmd")
for sub in plan note when; do
  assert_contains "ledge.md documents the $sub subcommand" "### $sub" "$md"
  assert_contains "ledge.md runs ledge $sub" "ledge $sub <id>" "$md"
done
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
