#!/bin/bash
# Runs the player check (Flow/App/PlayerCheck.swift) on a simulator or the Mac: every sample stream
# through starting, seeking, tracks, the MKV remuxer, the built-in decoder, switching source and engine,
# resume points, Skip Intro, fallback, errors and Up Next. Prints PASS/FAIL lines and screenshots each
# marked screen. CI runs it on iPhone, Apple TV and Mac (.github/workflows/ci.yml, job "Player check").
# Usage: scripts/player-check.sh [ios|ipad|tvos|macos]   (SIM_UDID picks a simulator; FLOW_CHECK_ONLY=episodes,resume
# runs just those scenarios: streams, universal, avi, audio, apple, engines, staleresume, resumeinside, close,
# missing, switch, intro, fallback, failure, episodes, resume, panels)
#
# Exit status: 0 every check passed; 1 a check failed; 2 the app died; 3 the run hung, timed out or never started.
# Everything it saw is in shots/player-check/<platform>/: check.log, summary.md (the PASS/FAIL table) and screenshots.
set -euo pipefail
cd "$(dirname "$0")/.."
platform=${1:-ios}
out=shots/player-check/$platform
rm -rf "$out"; mkdir -p "$out"
log="$PWD/$out/check.log"
step="$log.step"
rm -f "$log" "$step"
limit=${FLOW_CHECK_LIMIT:-1800}   # seconds for the whole run
quiet=${FLOW_CHECK_QUIET:-360}    # seconds without a new line from the app before it counts as hung (the longest scenario gives up after 240)

# Runs a command and gives up on it after $1 seconds: a screenshot that hangs (seen with screencapture on a runner)
# mustn't stall the whole run.
limited() {
  local seconds=$1; shift
  "$@" > /dev/null 2>&1 &
  local pid=$!
  ( sleep "$seconds"; kill "$pid" ) > /dev/null 2>&1 &
  local watchdog=$!
  wait "$pid" > /dev/null 2>&1 || true
  kill "$watchdog" > /dev/null 2>&1 || true
}

if [ "$platform" = macos ]; then
  SIM_NO_LAUNCH=1 scripts/sim.sh mac > "$out/build.log" 2>&1 || { cat "$out/build.log"; echo "The Mac app didn't build." >&2; exit 3; }
  pkill -x Flow 2>/dev/null || true
  FLOW_CHECK_FILE="$log" FLOW_CHECK_ONLY="${FLOW_CHECK_ONLY:-}" build/dd/Build/Products/Debug/Flow.app/Contents/MacOS/Flow -FlowDemo YES -FlowPlayerCheck YES -ApplePersistenceIgnoreState YES > "$out/app-stdout.log" 2>&1 &
  app=$!
  sleep 6
  osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is '"$app"') to true' > /dev/null 2>&1 || true
  capture() { limited 30 screencapture -x "$1"; }
else
  SIM_NO_LAUNCH=1 scripts/sim.sh run "$platform" > "$out/build.log" 2>&1 || { cat "$out/build.log"; echo "The app didn't build for the $platform simulator." >&2; exit 3; }
  udid=${SIM_UDID:-$(scripts/sim.sh devices | awk -v p="$platform" '$1==p {print $2}')}
  bundle=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "build/dd/Build/Products/$([ "$platform" = tvos ] && echo Debug-appletvsimulator || echo Debug-iphonesimulator)/Flow.app/Info.plist")
  echo "Simulator $udid, $bundle"
  launched=$(SIMCTL_CHILD_FLOW_CHECK_FILE="$log" SIMCTL_CHILD_FLOW_CHECK_ONLY="${FLOW_CHECK_ONLY:-}" xcrun simctl launch "$udid" "$bundle" -FlowDemo YES -FlowPlayerCheck YES)
  # "com.example.flow: 4321": the app's process id, which says whether it is still alive.
  app=$(echo "$launched" | awk -F': ' '{print $NF}' | tr -d ' ')
  case "$app" in ''|*[!0-9]*) echo "Couldn't read the app's process id from: $launched"; app="" ;; esac
  capture() { limited 30 xcrun simctl io "$udid" screenshot "$1"; }
fi

status=""; last=""; printed=0; started=$SECONDS; lastgrow=$SECONDS
while :; do
  s=$(cat "$step" 2>/dev/null || true)
  if [ -n "$s" ] && [ "$s" != "$last" ]; then
    last=$s
    [ "$s" = done ] && break
    sleep 1; capture "$out/$(printf "%02d" "${s%%:*}")-${s#*:}.png"
  fi
  if [ -f "$log" ]; then
    total=$(wc -l < "$log" | tr -d ' ')
    if [ "$total" -gt "$printed" ]; then sed -n "$((printed + 1)),${total}p" "$log"; printed=$total; lastgrow=$SECONDS; fi
  fi
  if [ -n "${app:-}" ] && ! kill -0 "$app" 2>/dev/null; then
    # It may have just written "done" and quit.
    [ "$(cat "$step" 2>/dev/null || true)" = done ] || status=died
    break
  fi
  if [ $((SECONDS - lastgrow)) -gt "$quiet" ]; then status=hung; break; fi
  if [ $((SECONDS - started)) -gt "$limit" ]; then status=timeout; break; fi
  sleep 0.5
done
if [ -f "$log" ]; then
  total=$(wc -l < "$log" | tr -d ' ')
  [ "$total" -gt "$printed" ] && sed -n "$((printed + 1)),${total}p" "$log"
fi

# What says where, when the app died or stopped answering.
if [ -n "$status" ]; then
  echo "The app $status."
  if [ "$status" != died ] && [ -n "${app:-}" ]; then limited 60 sample "$app" 5 -file "$out/hang-sample.txt"; fi
  if [ "$platform" = macos ]; then
    limited 120 sh -c "log show --last 40m --style compact --predicate 'process == \"Flow\"' | tail -400 > '$out/app-log.txt'"
  else
    limited 120 sh -c "xcrun simctl spawn '$udid' log show --last 40m --style compact --predicate 'process == \"Flow\"' | tail -400 > '$out/app-log.txt'"
  fi
  cp "$HOME"/Library/Logs/DiagnosticReports/Flow* "$out/" 2>/dev/null || true
fi
if [ "$platform" = macos ]; then
  [ -n "${app:-}" ] && kill "$app" 2>/dev/null || true
else
  xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
fi

# The table for the job summary: one row per scenario, then every retry (a flake is reported, not hidden).
fails=$(grep -c '^  FAIL  ' "$log" 2>/dev/null || true)
{
  echo "### Player check: $platform"
  echo
  [ -n "$status" ] && echo "**The app $status before the check finished.**" && echo
  echo "| Scenario | PASS | FAIL | What failed |"
  echo "|---|---:|---:|---|"
  awk '
    /^== / { section = substr($0, 4); if (!(section in seen)) { seen[section] = 1; order[++n] = section }; next }
    /^  PASS  / { pass[section]++; next }
    /^  FAIL  / { fail[section]++; detail = substr($0, 9); gsub(/\|/, "/", detail); why[section] = why[section] (why[section] == "" ? "" : "<br>") detail; next }
    END { for (i = 1; i <= n; i++) { s = order[i]; t = s; gsub(/\|/, "/", t); printf "| %s | %d | %d | %s |\n", t, pass[s], fail[s], why[s] } }
  ' "$log"
  echo
  grep '^  RETRY  ' "$log" | sed 's/^  RETRY  /- Retried once: /' || true
  grep '^RESULT ' "$log" | sed 's/^/**/; s/$/**/' || true
} > "$out/summary.md"
cat "$out/summary.md"

[ "$status" = died ] && exit 2
[ -n "$status" ] && exit 3
grep -q '^RESULT ' "$log" || { echo "The check never reported a result."; exit 3; }
[ "${fails:-0}" -eq 0 ] && grep -q "RESULT .* 0 failed" "$log"
