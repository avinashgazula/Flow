#!/bin/bash
# Runs the UI tests (UITests/) on an iPhone simulator with sample data: real taps on screens that
# simulator tools can't drive reliably, such as the Live TV player in landscape.
# Usage: scripts/ui-test.sh [-only-testing:FlowUITests/LiveTVUITests/testCloseLeavesThePlayer]
set -euo pipefail
cd "$(dirname "$0")/.."
udid=${SIM_UDID:-$(scripts/sim.sh devices | awk '$1=="ios" {print $2}')}
xcodegen generate --quiet
xcodebuild test -project Flow.xcodeproj -scheme Flow-iOS -destination "id=$udid" -derivedDataPath build/ui-tests \
  CODE_SIGNING_ALLOWED=NO "$@" 2>&1 | grep -E "Test Case|error:|failed|passed|TEST (SUCCEEDED|FAILED)" | grep -v "^$"
