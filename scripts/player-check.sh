#!/bin/bash
# Runs the player check (Flow/App/PlayerCheck.swift) on a simulator or the Mac: every sample stream
# through starting, seeking, tracks, the MKV remuxer, switching source, Skip Intro, fallback, errors,
# Up Next and resume. Prints PASS/FAIL lines and screenshots each marked screen.
# Usage: scripts/player-check.sh [ios|ipad|tvos|macos]   (SIM_UDID picks a simulator; FLOW_CHECK_ONLY=episodes,resume
# runs just those of streams, switch, intro, fallback, failure, episodes, resume, panels)
set -euo pipefail
cd "$(dirname "$0")/.."
platform=${1:-ios}
out=shots/player-check/$platform
rm -rf "$out"; mkdir -p "$out"
log="$PWD/$out/check.log"
step="$log.step"
rm -f "$log" "$step"

if [ "$platform" = macos ]; then
  scripts/sim.sh mac >/dev/null
  pkill -x Flow 2>/dev/null || true
  FLOW_CHECK_FILE="$log" FLOW_CHECK_ONLY="${FLOW_CHECK_ONLY:-}" build/dd/Build/Products/Debug/Flow.app/Contents/MacOS/Flow -FlowDemo YES -FlowPlayerCheck YES -ApplePersistenceIgnoreState YES >/dev/null 2>&1 &
  app=$!
  capture() { screencapture -x "$1" 2>/dev/null || true; }
else
  scripts/sim.sh run "$platform" >/dev/null
  udid=${SIM_UDID:-$(scripts/sim.sh devices | awk -v p="$platform" '$1==p {print $2}')}
  bundle=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "build/dd/Build/Products/$([ "$platform" = tvos ] && echo Debug-appletvsimulator || echo Debug-iphonesimulator)/Flow.app/Info.plist")
  SIMCTL_CHILD_FLOW_CHECK_FILE="$log" SIMCTL_CHILD_FLOW_CHECK_ONLY="${FLOW_CHECK_ONLY:-}" xcrun simctl launch --terminate-running-process "$udid" "$bundle" -FlowDemo YES -FlowPlayerCheck YES >/dev/null
  capture() { xcrun simctl io "$udid" screenshot "$1" >/dev/null 2>&1 || true; }
fi

last=""; deadline=$((SECONDS + 900)); printed=0
while [ $SECONDS -lt $deadline ]; do
  s=$(cat "$step" 2>/dev/null || true)
  if [ -n "$s" ] && [ "$s" != "$last" ]; then
    last=$s
    [ "$s" = done ] && break
    sleep 1; capture "$out/$(printf "%02d" "${s%%:*}")-${s#*:}.png"
  fi
  if [ -f "$log" ]; then
    total=$(wc -l < "$log"); if [ "$total" -gt "$printed" ]; then sed -n "$((printed + 1)),${total}p" "$log"; printed=$total; fi
  fi
  sleep 0.5
done
[ -f "$log" ] && total=$(wc -l < "$log") && [ "$total" -gt "$printed" ] && sed -n "$((printed + 1)),${total}p" "$log"
[ "$platform" = macos ] && kill "${app:-0}" 2>/dev/null || true
grep -q "RESULT .* 0 failed" "$log"
