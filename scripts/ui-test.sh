#!/bin/bash
# Runs the UI tests (XCUITest, real taps) on a simulator with sample data: iPhone and iPad run UITests/, Apple TV
# runs UITestsTV/ with the remote's own presses. CI runs the three platforms as separate jobs (.github/workflows/ui-tests.yml).
#
# Usage: scripts/ui-test.sh [ios|ipad|tvos] [--smoke] [--no-build] [xcodebuild arguments, such as -only-testing:FlowUITests/LiveTVUITests]
#
#   --smoke     only the short list of critical paths below (launch, tabs, title page, player, a deep link, Live TV,
#               Settings, Search, and each device's own layout): a few minutes, for every change. Without it, every test.
#   --no-build  test what the last run built. The build is `build-for-testing` into build/ui-tests, and iPhone and iPad
#               share it (one scheme), so `ui-test.sh ios` then `ui-test.sh ipad --no-build` builds once.
#
# Tests run on several clones of the simulator at once (Xcode's parallel testing, one test class per clone at a time).
# UI_TEST_WORKERS sets how many: by default 2 on CI (CI=true; a hosted macOS runner has 3 cores and 7 GB), and here half
# the Mac's cores, at most 6; at most 2 for --smoke. UI_TEST_WORKERS=1 runs one test after another on the simulator itself, with every step's
# timing in the log ("t = …"), which is the way to see where a slow test spends its seconds.
#
# Without FLOW_SIM_OS the newest simulator that scripts/sim.sh would pick is used (SIM_UDID names one directly). With it,
# the simulator runtime's major version, the pick works as the screenshot tour's does, which is what the runners use.
# Results: build/ui-tests-<platform>.xcresult and .log, plus a table in the step summary when GitHub provides one.
set -uo pipefail
cd "$(dirname "$0")/.."

platform=ios
case "${1:-}" in ios|ipad|tvos) platform=$1; shift ;; esac
smoke=NO
build=YES
passthrough=()
for arg in "$@"; do
  case "$arg" in
    --smoke) smoke=YES ;;
    --no-build) build=NO ;;
    *) passthrough+=("$arg") ;;
  esac
done

# The smoke tier, in one place: "<platforms> <class>/<test>". Each line is a path a person takes every day, so a broken
# screen on any of them stops the change. The full suite runs everything else as well.
smoke_tests=(
  "ios,ipad HomeAndTabsUITests/testLaunchLandsOnHomeWithTheTopPickAsItsLead"
  "ios,ipad HomeAndTabsUITests/testEachTabOpensItsScreen"
  "ios,ipad HomeAndTabsUITests/testDetailsOpensTheLeadsPageAndBackReturnsHome"
  "ios,ipad TitlePageUITests/testPlayOpensTheSourceListAndCloseLeavesIt"
  "ios,ipad PlayerUITests/testPauseAndPlayChangeThePlayersState"
  "ios,ipad DeepLinkUITests/testATitleLinkOpensThatTitlesPage"
  "ios,ipad LiveTVUITests/testChannelButtonsTune"
  "ios,ipad SettingsUITests/testSettingsOpensAsASheetAndDoneClosesIt"
  "ios,ipad BrowseUITests/testTypingASearchShowsItsResultsAndOpensOne"
  "ios,ipad AccessibilityAuditUITests/testHome"
  "ios      PhonePlayerUITests/testThePlayerTurnsThePhoneToLandscapeAndClosingTurnsItBack"
  "ipad     iPadLayoutUITests/testHomesLeadRunsEdgeToEdgeFromTheTopWithItsWordsOverTheLowerLeft"
  "tvos     TVHomeFocusUITests/testLaunchFocusesOneThingAndDownReachesResumeThenAcrossHome"
  "tvos     TVHomeFocusUITests/testDetailsOpensAPageAndMenuReturnsToHome"
)

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
bundle=FlowUITests
[ "$platform" = tvos ] && scheme=Flow-tvOS && bundle=FlowTVUITests

if [ -z "${UI_TEST_WORKERS:-}" ]; then
  if [ "${CI:-}" = true ]; then
    UI_TEST_WORKERS=2
  else
    UI_TEST_WORKERS=$(( $(sysctl -n hw.ncpu) / 2 ))
    [ "$UI_TEST_WORKERS" -gt 6 ] && UI_TEST_WORKERS=6
  fi
  # Each clone takes a while to make and start, which a dozen tests don't win back past two (159 s on one, 149 s on
  # two and about 200 s on four, for the iPhone's smoke tests on an 8-core Mac).
  [ "$smoke" = YES ] && [ "$UI_TEST_WORKERS" -gt 2 ] && UI_TEST_WORKERS=2
fi
[ "$UI_TEST_WORKERS" -lt 1 ] && UI_TEST_WORKERS=1

# Classes that only make sense on one kind of iOS device are left out on the other, rather than skipped at run time.
selection=()
case "$platform" in
  ipad) selection=(-skip-testing:FlowUITests/PhonePlayerUITests -skip-testing:FlowUITests/LiveTVUITests/testPlayerTurnsToLandscape) ;;
  ios)  selection=(-skip-testing:FlowUITests/iPadLayoutUITests) ;;
esac
if [ "$smoke" = YES ]; then
  selection=()
  for entry in "${smoke_tests[@]}"; do
    read -r platforms test <<< "$entry"
    case ",$platforms," in *",$platform,"*) selection+=("-only-testing:$bundle/$test") ;; esac
  done
fi

# Parallel testing runs on clones of this simulator, which xcodebuild makes and boots itself; booting the original as
# well would only take memory the clones need.
if [ "$UI_TEST_WORKERS" -gt 1 ]; then
  parallel=(-parallel-testing-enabled YES -parallel-testing-worker-count "$UI_TEST_WORKERS")
else
  parallel=(-parallel-testing-enabled NO)
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b > /dev/null
fi
echo "$( [ "$smoke" = YES ] && echo "Smoke tests" || echo "All tests" ) on $UI_TEST_WORKERS worker(s)"

mkdir -p build
log="build/ui-tests-$platform.log"
result="build/ui-tests-$platform.xcresult"
rm -rf "$result"
common=(-project Flow.xcodeproj -scheme "$scheme" -destination "id=$udid" -derivedDataPath build/ui-tests CODE_SIGNING_ALLOWED=NO)

start=$(date +%s)
status=0
: > "$log"
if [ "$build" = YES ]; then
  command -v xcodegen > /dev/null && xcodegen generate --quiet
  xcodebuild build-for-testing "${common[@]}" >> "$log" 2>&1 || status=$?
  echo "Built in $(( $(date +%s) - start )) s"
fi

# A test that hangs is stopped after fifteen minutes rather than holding the runner until the job's own limit.
if [ "$status" -eq 0 ]; then
  tests_start=$(date +%s)
  xcodebuild test-without-building "${common[@]}" -resultBundlePath "$result" ${parallel[@]+"${parallel[@]}"} \
    -default-test-execution-time-allowance 600 -maximum-test-execution-time-allowance 900 \
    ${selection[@]+"${selection[@]}"} ${passthrough[@]+"${passthrough[@]}"} >> "$log" 2>&1
  status=$?
  echo "Tested in $(( $(date +%s) - tests_start )) s"
fi

grep -E "Test [Cc]ase|error:|TEST (EXECUTE )?(SUCCEEDED|FAILED)|\*\* (BUILD|TEST)" "$log" | grep -v "^$"

# The table: one row per test. The result bundle is read first (`xcresulttool get test-results`, Xcode 16 and later):
# parallel clones write their lines into the log at the same time, and xcodebuild's own messages can land in the middle of
# one, so the log can lose a test, which is how the table once showed a failure fewer than the run had. The log is the
# fallback, for a run that left no readable bundle.
python3 - "$log" "$platform" "$status" "$UI_TEST_WORKERS" "$smoke" "$(( $(date +%s) - start ))" "$result" > build/ui-tests-$platform.md <<'PY'
import json, re, subprocess, sys
log, platform, status, workers, smoke, wall, bundle = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7]
results, errors = {}, []

def from_bundle():
    try:
        out = subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "tests", "--path", bundle],
                             capture_output=True, text=True, timeout=300).stdout
        nodes = json.loads(out).get("testNodes", [])
    except Exception:
        return
    def walk(node):
        if node.get("nodeType") == "Test Case":
            name = node.get("nodeIdentifier", node.get("name", "")).replace("()", "")
            outcome = {"Passed": "passed", "Failed": "failed", "Skipped": "skipped"}.get(node.get("result"), "failed")
            seconds = node.get("durationInSeconds")
            results[name] = (outcome, f"{seconds:.1f}" if isinstance(seconds, (int, float)) else "")
            for child in node.get("children", []):
                if child.get("nodeType") == "Failure Message":
                    errors.append(f"{name}: {child.get('name')}")
        for child in node.get("children", []):
            walk(child)
    for node in nodes:
        walk(node)

def from_log():
    def short(raw):
        # "-[FlowUITests.HomeUITests testFoo]" and "HomeUITests.testFoo()" both become "HomeUITests/testFoo".
        m = re.match(r"-\[(?:\w+\.)?(\w+) (\w+)\]", raw)
        return f"{m.group(1)}/{m.group(2)}" if m else raw.replace("()", "").replace(".", "/")
    started = []
    for line in open(log, errors="replace"):
        # One test runner prints "Test Case '-[Class test]' passed (1.2 seconds)"; parallel clones print
        # "Test case 'Class.test()' passed on 'Clone 1 of iPhone …' (1.2 seconds)".
        m = re.search(r"Test [Cc]ase '(.+?)' (passed|failed)(?: on '.*?')? \(([\d.]+) seconds\)", line)
        s = re.search(r"Test [Cc]ase '(.+?)' started", line)
        if m:
            name = short(m.group(1))
            if results.get(name, ("", ""))[0] != "failed":
                results[name] = (m.group(2), m.group(3))
        elif s:
            started.append(short(s.group(1)))
        elif ": error:" in line and line.strip() not in errors:
            errors.append(line.strip())
    # A test that crashed the runner, or was stopped at its time limit, can start without ever printing a result.
    for name in started:
        if name not in results:
            results[name] = ("failed", "did not finish")

from_bundle()
if not results:
    from_log()
failed = sum(1 for r in results.values() if r[0] == "failed")
skipped = sum(1 for r in results.values() if r[0] == "skipped")
tier = "smoke tests" if smoke == "YES" else "all tests"
print(f"### UI tests ({platform}): {len(results) - failed - skipped} passed, {failed} failed" + (f", {skipped} skipped" if skipped else "") + "\n")
print(f"{tier.capitalize()} on {workers} worker{'s' if workers != '1' else ''}, {int(wall) // 60} min {int(wall) % 60} s in all.\n")
if not results:
    print("No test finished: the build or the launch failed. See the job log.\n")
print("| Test | Result | Seconds |\n|---|---|---|")
for name in sorted(results):
    result, seconds = results[name]
    print(f"| {name} | {'**FAILED**' if result == 'failed' else result} | {seconds} |")
if errors:
    print("\n<details><summary>Failures</summary>\n\n```")
    for line in errors[:60]:
        print(line[:400])
    print("```\n</details>")
PY
cat "build/ui-tests-$platform.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "build/ui-tests-$platform.md" >> "$GITHUB_STEP_SUMMARY"

exit $status
