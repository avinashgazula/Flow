#!/bin/bash
# Builds, launches and drives Flow in the iOS, iPadOS and tvOS simulators (and on the Mac), for
# developing and testing by hand or with Claude Code. See CLAUDE.md and docs/TEST_PLAN.md.
#
#   scripts/sim.sh devices                    simulators this script would pick, per platform
#   scripts/sim.sh run  [ios|ipad|tvos] [--real] [-- extra launch args]
#                                             build, install, launch (sample data unless --real)
#   scripts/sim.sh launch [platform] [--real] relaunch without building
#   scripts/sim.sh shot [platform] <name>     screenshot to shots/local/<platform>/<name>.png
#   scripts/sim.sh open <url> [platform]      open a flow:// link (flow://title/movie/693134, flow://search?q=dune)
#   scripts/sim.sh logs [platform]            stream the app's log
#   scripts/sim.sh reset [platform]           uninstall, for a fresh first launch
#   scripts/sim.sh tour [ios|ipad|tvos|macos] the full screenshot tour, as CI runs it, into shots/tour/<platform>
#   scripts/sim.sh mac  [--real]              build and run the Mac app
#
# Platform defaults to ios. Set SIM_UDID to use a particular simulator.
set -euo pipefail
cd "$(dirname "$0")/.."

DERIVED=build/dd
command=${1:-help}; shift || true

platform=ios
case "${1:-}" in ios|ipad|tvos|macos) platform=$1; shift ;; esac

real=false
extra=()
# The platform can also come later (`shot home ipad`, `open <url> ipad`), but not after `--`.
while [ $# -gt 0 ]; do
  case "$1" in
    ios|ipad|tvos|macos) platform=$1 ;;
    --real) real=true ;;
    --) shift; extra=("$@"); break ;;
    *) extra+=("$1") ;;
  esac
  shift
done

scheme() { [ "$platform" = tvos ] && echo Flow-tvOS || echo Flow-iOS; }
products() { [ "$platform" = tvos ] && echo Debug-appletvsimulator || echo Debug-iphonesimulator; }
app_path() { echo "$DERIVED/Build/Products/$(products)/Flow.app"; }

# The newest runtime's best match, preferring one that's already booted.
pick_device() {
  [ -n "${SIM_UDID:-}" ] && { echo "$SIM_UDID"; return; }
  xcrun simctl list devices available -j | python3 -c '
import json, re, sys
platform = sys.argv[1]
family = "tvOS" if platform == "tvos" else "iOS"
names = {"ios": ["iPhone 17 Pro", "iPhone 16 Pro", "iPhone"],
         "ipad": ["iPad Pro 13", "iPad Pro", "iPad"],
         "tvos": ["Apple TV 4K", "Apple TV"]}[platform]
def version(rt):
    m = re.search(r"\.(?:iOS|tvOS)-(\d+)-(\d+)", rt)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
runtimes = sorted((rt for rt in json.load(sys.stdin)["devices"].items() if f".{family}-" in rt[0]), key=lambda r: version(r[0]), reverse=True)
for _, devices in runtimes:
    for name in names:
        matches = [d for d in devices if d["name"].startswith(name) and (platform != "ios" or not d["name"].startswith("iPad"))]
        booted = [d for d in matches if d["state"] == "Booted"]
        if booted or matches:
            print((booted or matches)[0]["udid"]); sys.exit(0)
' "$platform"
}

boot() {
  udid=$(pick_device)
  [ -z "$udid" ] && { echo "No $platform simulator found. Add one in Xcode → Window → Devices and Simulators." >&2; exit 1; }
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  open -a Simulator --args -CurrentDeviceUDID "$udid" 2>/dev/null || true
  xcrun simctl ui "$udid" appearance dark 2>/dev/null || true
  if [ "$platform" != tvos ]; then
    xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 2>/dev/null || true
  fi
}

regenerate_if_needed() {
  if [ project.yml -nt Flow.xcodeproj/project.pbxproj ] || [ -n "$(git ls-files --others --exclude-standard -- 'Flow/*.swift' 'Widgets/*.swift' 'TopShelf/*.swift' 2>/dev/null)" ]; then
    if command -v xcodegen >/dev/null; then
      echo "Regenerating Flow.xcodeproj (project.yml changed or new source files)…"
      xcodegen generate --quiet
    else
      echo "warning: project.yml changed or there are new files; run 'brew install xcodegen && xcodegen generate'" >&2
    fi
  fi
}

build() {
  regenerate_if_needed
  local log=build/sim-build-$platform.log
  mkdir -p build
  echo "Building $(scheme) for $udid…"
  if ! xcodebuild build -project Flow.xcodeproj -scheme "$(scheme)" -destination "id=$udid" -derivedDataPath "$DERIVED" \
       CODE_SIGNING_ALLOWED=NO > "$log" 2>&1; then
    grep -E "error:" "$log" | sed -E 's#^.*/Flow/##' | sort -u | head -60
    echo "Build failed; full log in $log" >&2
    exit 1
  fi
  grep -E "warning:" "$log" | grep -v "appintentsmetadataprocessor" | sed -E 's#^.*/Flow/##' | sort -u | head -20 || true
}

bundle_id() {
  /usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$(app_path)/Info.plist" 2>/dev/null \
    || grep -E '^FLOW_BUNDLE_ID' Config/Flow.xcconfig | awk '{print $3}'
}

launch() {
  local demo=YES
  $real && demo=NO
  xcrun simctl launch --terminate-running-process "$udid" "$(bundle_id)" -FlowDemo "$demo" ${extra[@]+"${extra[@]}"} >/dev/null
  echo "Launched on $platform ($udid)$($real || echo ' with sample data')."
}

case "$command" in
  devices)
    for p in ios ipad tvos; do platform=$p; printf "%-5s %s\n" "$p" "$(pick_device)"; done ;;
  run)
    [ "$platform" = macos ] && exec "$0" mac ${extra[@]+"${extra[@]}"}
    boot; build
    xcrun simctl install "$udid" "$(app_path)"
    launch ;;
  launch)
    boot; launch ;;
  shot)
    name=${extra[0]:-$(date +%H%M%S)}
    out=shots/local/$platform
    mkdir -p "$out"
    if [ "$platform" = macos ]; then
      screencapture -x "$out/$name.png"
    else
      udid=$(pick_device)
      xcrun simctl io "$udid" screenshot --type=png "$out/$name.png" >/dev/null 2>&1
    fi
    echo "$out/$name.png" ;;
  open)
    url=${extra[0]:?usage: scripts/sim.sh open <url> [platform]}
    udid=$(pick_device)
    xcrun simctl openurl "$udid" "$url" ;;
  logs)
    udid=$(pick_device)
    xcrun simctl spawn "$udid" log stream --level debug --style compact --predicate 'process == "Flow"' ;;
  reset)
    udid=$(pick_device)
    xcrun simctl terminate "$udid" "$(bundle_id)" 2>/dev/null || true
    xcrun simctl uninstall "$udid" "$(bundle_id)" && echo "Uninstalled from $platform ($udid)." ;;
  tour)
    regenerate_if_needed
    exec scripts/screenshot-tour.sh "$platform" "shots/tour/$platform" ;;
  mac)
    regenerate_if_needed
    mkdir -p build
    xcodebuild build -project Flow.xcodeproj -scheme Flow-macOS -destination 'platform=macOS' -derivedDataPath "$DERIVED" \
      CODE_SIGNING_ALLOWED=NO > build/sim-build-macos.log 2>&1 \
      || { grep -E "error:" build/sim-build-macos.log | sed -E 's#^.*/Flow/##' | sort -u | head -60; exit 1; }
    pkill -x Flow 2>/dev/null || true
    demo=YES; $real && demo=NO
    open "$DERIVED/Build/Products/Debug/Flow.app" --args -FlowDemo "$demo" ${extra[@]+"${extra[@]}"}
    echo "Launched the Mac app$($real || echo ' with sample data')." ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
