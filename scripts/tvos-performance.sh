#!/bin/bash
# Sustained playback check on a paired physical Apple TV using a signed Debug app.
# Usage: FLOW_PERF_APP_PATH=/path/to/Flow.app scripts/tvos-performance.sh <device-id> <url-file> [seconds]
# Or set FLOW_PERF_BUNDLE_ID to use an already installed Debug app.
# Set FLOW_PERF_REQUIRE_DOLBY_VISION=1 for a Dolby Vision MKV fixture.
# Set FLOW_PERF_SEEK_SECONDS to check playback after seeking within the fixture.
# Keep the stream URL in a private file so signed links and tokens stay out of the command line and report.
set -euo pipefail
cd "$(dirname "$0")/.."

device=${1:?Pass the physical Apple TV identifier from xcrun devicectl list devices}
url_file=${2:?Pass a file containing the playable stream URL}
seconds=${3:-300}
[[ "$seconds" =~ ^[0-9]+$ ]] && (( seconds >= 10 && seconds <= 600 )) || { echo 'Use 10–600 seconds.' >&2; exit 2; }
[[ -f "$url_file" ]] || { echo 'Stream URL file is missing.' >&2; exit 2; }
stream_url=$(head -n 1 "$url_file")
[[ "$stream_url" == http://* || "$stream_url" == https://* ]] || { echo 'The file must contain an HTTP(S) stream URL.' >&2; exit 2; }
if ! xcrun devicectl list devices | awk -v id="$device" 'index($0, id) && /Apple TV/ && $NF == "physical" { found = 1 } END { exit !found }'; then
  echo 'Pair the physical Apple TV with Xcode, then pass its device identifier.' >&2
  exit 2
fi
if [[ -n "${FLOW_PERF_APP_PATH:-}" ]]; then
  app=${FLOW_PERF_APP_PATH}
  [[ -d "$app" && -f "$app/Info.plist" ]] || { echo 'FLOW_PERF_APP_PATH must point to a built .app bundle.' >&2; exit 2; }
  codesign --verify "$app" || { echo 'Sign the Debug app for the paired Apple TV before testing.' >&2; exit 2; }
  bundle=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
  xcrun devicectl device install app --device "$device" "$app"
else
  bundle=${FLOW_PERF_BUNDLE_ID:?Set FLOW_PERF_APP_PATH or FLOW_PERF_BUNDLE_ID}
fi

out=${FLOW_PERF_REPORT:-"$PWD/flow-tvos-performance.log"}
raw=$(mktemp)
trap 'rm -f "$raw"' EXIT
echo "Measuring playback on physical Apple TV for $seconds seconds."
set +e
DEVICECTL_CHILD_FLOW_CHECK_ONLY=formats \
DEVICECTL_CHILD_FLOW_CHECK_FORMAT_URLS="$stream_url" \
DEVICECTL_CHILD_FLOW_CHECK_FORMAT_SECONDS="$seconds" \
DEVICECTL_CHILD_FLOW_CHECK_FORMAT_SEEK_SECONDS="${FLOW_PERF_SEEK_SECONDS:-}" \
DEVICECTL_CHILD_FLOW_CHECK_PERFORMANCE=1 \
DEVICECTL_CHILD_FLOW_CHECK_REQUIRE_PICTURE="${FLOW_PERF_REQUIRE_DOLBY_VISION:-0}" \
DEVICECTL_CHILD_FLOW_PERF_DIAG=1 \
DEVICECTL_CHILD_FLOW_CHECK_EXIT=1 \
xcrun devicectl device process launch --console --terminate-existing --timeout "$((seconds + 240))" \
  --device "$device" "$bundle" -- -FlowDemo YES -FlowPlayerCheck YES >"$raw" 2>&1
launch_status=$?
set -e
rg 'FLOWCHECK .*?(ROUTING|ROUTE|CADENCE|PASS|FAIL|RESULT)|FLOWPERF ' "$raw" \
  | sed -e 's/^.*FLOWCHECK /FLOWCHECK /' -e 's/^.*FLOWPERF /FLOWPERF /' >"$out" || true
if (( launch_status != 0 )) || ! rg -q 'RESULT [0-9]+ passed, 0 failed' "$out"; then
  rg '^ERROR: .*CoreDeviceError|^ERROR: Command timeout' "$raw" >&2 || true
  echo 'Playback check did not complete cleanly. Inspect the device console and report.' >&2
  exit 1
fi
if [[ "${FLOW_PERF_REQUIRE_DOLBY_VISION:-0}" == 1 ]]; then
  # Audio can advance with zero frame drops while AVKit still displays a spinner.
  if ! rg -q 'FLOWPERF engine=MKV remux .*video=[^=]*Dolby Vision .*advance5s=[1-9][0-9]*\.[0-9]+ .*picture=ready' "$out" ||
     awk '/FLOWCHECK +ROUTING format fixture 1:/ { fixture=1 }
          fixture && /FLOWPERF remux opened .*compatible=yes|FLOWPERF engine=built-in/ { downgraded=1 }
          END { exit !downgraded }' "$out"; then
    echo "The fixture did not sustain native Dolby Vision playback. See $out." >&2
    exit 1
  fi
fi
cat "$out"
echo "Report saved to $out"
