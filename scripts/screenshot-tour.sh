#!/bin/bash
# Builds Flow for a simulator (or macOS), runs the demo screenshot tour and captures each step.
# Usage: scripts/screenshot-tour.sh ios|ipad|tvos|macos <output-dir>
set -euo pipefail
platform=$1
out=$2
mkdir -p "$out"
bundle_id=$(grep -E '^FLOW_BUNDLE_ID' Config/Flow.xcconfig | awk '{print $3}')
tour_file="$PWD/tour-step-$platform"
rm -f "$tour_file"

pick_device() { # $1 = name prefix, $2 = runtime prefix (e.g. iOS-26)
  xcrun simctl list devices available -j | python3 -c '
import json, sys
prefix, runtime = sys.argv[1], sys.argv[2]
data = json.load(sys.stdin)["devices"]
best = None
for rt, devices in sorted(data.items(), reverse=True):
    if runtime not in rt: continue
    for d in devices:
        if d["name"].startswith(prefix):
            best = best or d["udid"]
print(best or "")' "$1" "$2"
}

capture_loop() { # $1 = capture command template (uses $file)
  local last="" deadline=$((SECONDS + 240))
  while [ $SECONDS -lt $deadline ]; do
    local step
    step=$(cat "$tour_file" 2>/dev/null || true)
    if [ "$step" = "done" ]; then break; fi
    if [ -n "$step" ] && [ "$step" != "$last" ]; then
      last=$step
      sleep 3.5
      local idx=${step%%:*} name=${step#*:}
      local file
      file=$(printf "%s/%02d-%s.png" "$out" "$idx" "$name")
      eval "$1" || true
      echo "captured $file"
    fi
    sleep 0.5
  done
}

if [ "$platform" = "macos" ]; then
  xcodebuild build -project Flow.xcodeproj -scheme Flow-macOS -destination 'platform=macOS' -derivedDataPath dd \
    CODE_SIGNING_ALLOWED=NO > build-shots.log 2>&1 || { grep -E "error:" build-shots.log | head -40; exit 1; }
  FLOW_TOUR_FILE="$tour_file" FLOW_TOUR_DWELL=7 dd/Build/Products/Debug/Flow.app/Contents/MacOS/Flow -FlowDemo YES -FlowTour YES -ApplePersistenceIgnoreState YES &
  app_pid=$!
  sleep 6
  osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is '"$app_pid"') to true' || true
  capture_loop 'screencapture -x "$file"'
  cp "$tour_file.log" "$out/tour.log" 2>/dev/null || true
  kill $app_pid || true
  exit 0
fi

if [ "$platform" = "ios" ]; then
  udid=$(pick_device "iPhone 17 Pro" "iOS-26"); [ -z "$udid" ] && udid=$(pick_device "iPhone" "iOS-26")
  scheme=Flow-iOS; products=Debug-iphonesimulator
elif [ "$platform" = "ipad" ]; then
  udid=$(pick_device "iPad Pro 13" "iOS-26"); [ -z "$udid" ] && udid=$(pick_device "iPad" "iOS-26")
  scheme=Flow-iOS; products=Debug-iphonesimulator
else
  udid=$(pick_device "Apple TV 4K" "tvOS-26"); [ -z "$udid" ] && udid=$(pick_device "Apple TV" "tvOS")
  scheme=Flow-tvOS; products=Debug-appletvsimulator
fi
echo "Using simulator $udid"
xcrun simctl boot "$udid" || true
xcrun simctl bootstatus "$udid" -b
xcodebuild build -project Flow.xcodeproj -scheme "$scheme" -destination "id=$udid" -derivedDataPath dd \
  CODE_SIGNING_ALLOWED=NO > build-shots.log 2>&1 || { grep -E "error:" build-shots.log | head -40; exit 1; }
xcrun simctl ui "$udid" appearance dark || true
if [ "$platform" != "tvos" ]; then
  xcrun simctl status_bar "$udid" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 || true
fi
xcrun simctl install "$udid" "dd/Build/Products/$products/Flow.app"
SIMCTL_CHILD_FLOW_TOUR_FILE="$tour_file" SIMCTL_CHILD_FLOW_TOUR_DWELL=7 \
  xcrun simctl launch "$udid" "$bundle_id" -FlowDemo YES -FlowTour YES
capture_loop 'xcrun simctl io "$udid" screenshot "$file"'
cp "$tour_file.log" "$out/tour.log" 2>/dev/null || true
xcrun simctl terminate "$udid" "$bundle_id" || true
