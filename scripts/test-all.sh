#!/bin/bash
# Runs every test layer this machine can run, in the order that fails fastest. docs/TESTING.md says what each one proves.
# Usage: scripts/test-all.sh [--quick]     --quick stops after the unit tests (about two minutes).
# On Linux it runs the FlowKit and website layers; on a Mac with Xcode it adds the player check and the UI tests.
set -uo pipefail
cd "$(dirname "$0")/.."
quick=${1:-}
failed=()

step() { # $1 = name, rest = command
  local name=$1; shift
  printf '\n== %s\n' "$name"
  if "$@"; then echo "ok: $name"; else echo "FAILED: $name"; failed+=("$name"); fi
}

step "FlowKit unit tests, fuzzing and coverage floors" scripts/flowkit-coverage.sh
step "Website types" bash -c 'cd web && npx tsc -b --noEmit'
step "Website unit tests and contract vectors" bash -c 'cd web && npm test -- --run'

if [ "$quick" != "--quick" ]; then
  step "Website build and first-load budget" bash -c 'cd web && npm run build && npm run budget'
  step "Website browser tests (Chromium)" bash -c 'cd web && npm run e2e'
  if command -v xcodebuild > /dev/null 2>&1; then
    for platform in ios tvos macos; do step "Player check ($platform)" scripts/player-check.sh "$platform"; done
    step "UI tests (iPhone)" scripts/ui-test.sh
  else
    echo
    echo "No Xcode here: the player check and the UI tests run in CI (.github/workflows)."
  fi
fi

echo
if [ ${#failed[@]} -eq 0 ]; then echo "Everything passed."; exit 0; fi
printf 'Failed: %s\n' "${failed[@]}"
exit 1
