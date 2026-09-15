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
assert_eq "task: calls ledge current --context with cwd" \
  "current --repo /home/user/code/demo-app --context" "$logged"

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
  'current --repo C:\Users\me\code\demo-app --context' "$logged"

run_hook session-start.sh malformed.json task "$bin"
assert_eq "malformed payload: exit 0" 0 "$rc"
assert_eq "malformed payload: falls back to PWD" "current --repo $tmp/pwd --context" "$logged"
assert_contains "malformed payload: still prints context" "Release watch banner" "$out"

run_hook session-start.sh - task "$bin"
assert_eq "empty stdin: exit 0" 0 "$rc"
assert_eq "empty stdin: falls back to PWD" "current --repo $tmp/pwd --context" "$logged"

echo "# stop.sh"
run_hook stop.sh stop.json task "$bin"
assert_eq "task: exit 0" 0 "$rc"
assert_empty "task: prints nothing" "$out"
assert_eq "task: resolves the task then links the session" \
  "current --repo /home/user/code/demo-app --json
link release-watch-banner 071729a1-9f0c-4d7e-8b2a-3c4d5e6f7a81" "$logged"

run_hook stop.sh stop.json none "$bin"
assert_eq "none: exit 0" 0 "$rc"
assert_empty "none: prints nothing" "$out"
assert_eq "none: no link call" "current --repo /home/user/code/demo-app --json" "$logged"

run_hook stop.sh stop.json error "$bin"
assert_eq "error: exit 0" 0 "$rc"
assert_empty "error: prints nothing" "$out"
assert_eq "error: no link call" "current --repo /home/user/code/demo-app --json" "$logged"

run_hook stop.sh stop.json task "$nobin"
assert_eq "missing ledge: exit 0" 0 "$rc"
assert_empty "missing ledge: prints nothing" "$out"

run_hook stop.sh - task "$bin"
assert_eq "empty stdin: exit 0" 0 "$rc"
assert_empty "empty stdin: prints nothing" "$out"
assert_empty "empty stdin: ledge never called without a session id" "$logged"

run_hook stop.sh malformed.json task "$bin"
assert_eq "malformed payload: exit 0" 0 "$rc"
assert_empty "malformed payload: prints nothing" "$out"
assert_empty "malformed payload: ledge never called" "$logged"

echo "# pre-compact.sh"
run_hook pre-compact.sh pre-compact.json task "$bin"
assert_eq "task: exit 0" 0 "$rc"
assert_contains "task: prints the reminder" "Before compaction, update the Ledge checklist" "$out"
assert_contains "task: names the task id" "release-watch-banner" "$out"
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

echo
printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
