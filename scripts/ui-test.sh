#!/bin/bash
# Runs the UI tests (XCUITest, real taps) on a simulator with sample data: iPhone and iPad run UITests/, Apple TV
# runs UITestsTV/ with the remote's own presses. CI runs the three platforms as separate jobs (.github/workflows/ui-tests.yml).
#
# Usage: scripts/ui-test.sh [ios|ipad|tvos] [xcodebuild arguments, such as -only-testing:FlowUITests/LiveTVUITests]
#
# Without FLOW_SIM_OS the newest simulator that scripts/sim.sh would pick is used (SIM_UDID names one directly). With it,
# the simulator runtime's major version, the pick works as the screenshot tour's does, which is what the runners use.
# Results: build/ui-tests-<platform>.xcresult and .log, plus a table in the step summary when GitHub provides one.
set -uo pipefail
cd "$(dirname "$0")/.."

platform=ios
case "${1:-}" in ios|ipad|tvos) platform=$1; shift ;; esac

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

udid=${SIM_UDID:-}
if [ -z "$udid" ] && [ -n "${FLOW_SIM_OS:-}" ]; then
  os=$FLOW_SIM_OS
  case "$platform" in
    ios)
      # "iPhone 1" keeps the fallback on a numbered model, as the tour does.
      for name in "iPhone 17 Pro" "iPhone 18 Pro" "iPhone 1" "iPhone"; do
        udid=$(pick_device "$name" "iOS-$os"); [ -n "$udid" ] && break
      done ;;
    ipad)
      udid=$(pick_device "iPad Pro 13" "iOS-$os"); [ -z "$udid" ] && udid=$(pick_device "iPad" "iOS-$os") ;;
    tvos)
      udid=$(pick_device "Apple TV 4K" "tvOS-$os"); [ -z "$udid" ] && udid=$(pick_device "Apple TV" "tvOS") ;;
  esac
fi
[ -z "$udid" ] && udid=$(scripts/sim.sh devices | awk -v p="$platform" '$1==p {print $2}')
[ -z "$udid" ] && { echo "No $platform simulator found." >&2; exit 1; }
echo "Using simulator $udid for $platform"

scheme=Flow-iOS
[ "$platform" = tvos ] && scheme=Flow-tvOS

# Classes that only make sense on one kind of iOS device are left out on the other, rather than skipped at run time.
skips=()
case "$platform" in
  ipad) skips=(-skip-testing:FlowUITests/PhonePlayerUITests -skip-testing:FlowUITests/LiveTVUITests/testPlayerTurnsToLandscape) ;;
  ios)  skips=(-skip-testing:FlowUITests/iPadLayoutUITests) ;;
esac

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b > /dev/null
command -v xcodegen > /dev/null && xcodegen generate --quiet

mkdir -p build
log="build/ui-tests-$platform.log"
result="build/ui-tests-$platform.xcresult"
rm -rf "$result"

# A test that hangs is stopped after fifteen minutes rather than holding the runner until the job's own limit.
xcodebuild test -project Flow.xcodeproj -scheme "$scheme" -destination "id=$udid" -derivedDataPath build/ui-tests \
  -resultBundlePath "$result" -parallel-testing-enabled NO \
  -default-test-execution-time-allowance 600 -maximum-test-execution-time-allowance 900 \
  CODE_SIGNING_ALLOWED=NO ${skips[@]+"${skips[@]}"} "$@" > "$log" 2>&1
status=$?

grep -E "Test [Cc]ase|error:|TEST (SUCCEEDED|FAILED)|\*\* BUILD" "$log" | grep -v "^$"

# The table: one row per test, from the log (the shape of an .xcresult changes between Xcode releases; these lines do not).
python3 - "$log" "$platform" "$status" > build/ui-tests-$platform.md <<'PY'
import re, sys
log, platform, status = sys.argv[1], sys.argv[2], int(sys.argv[3])
results, errors = {}, []

def short(raw):
    # "-[FlowUITests.HomeUITests testFoo]" and "HomeUITests.testFoo()" both become "HomeUITests/testFoo".
    m = re.match(r"-\[(?:\w+\.)?(\w+) (\w+)\]", raw)
    return f"{m.group(1)}/{m.group(2)}" if m else raw.replace("()", "").replace(".", "/")

for line in open(log, errors="replace"):
    m = re.search(r"Test [Cc]ase '(.+?)' (passed|failed)(?: on '.*?')? \(([\d.]+) seconds\)", line)
    if m:
        name = short(m.group(1))
        results[name] = (m.group(2), m.group(3))
    elif ": error:" in line and line not in errors:
        errors.append(line.strip())
failed = sum(1 for r in results.values() if r[0] == "failed")
print(f"### UI tests ({platform}): {len(results) - failed} passed, {failed} failed\n")
if not results:
    print("No test finished: the build or the launch failed. See the job log.\n")
print("| Test | Result | Seconds |\n|---|---|---|")
for name in sorted(results):
    result, seconds = results[name]
    print(f"| {name} | {'passed' if result == 'passed' else '**FAILED**'} | {seconds} |")
if errors:
    print("\n<details><summary>Failures</summary>\n\n```")
    for line in errors[:60]:
        print(line[:400])
    print("```\n</details>")
PY
cat "build/ui-tests-$platform.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "build/ui-tests-$platform.md" >> "$GITHUB_STEP_SUMMARY"

exit $status
