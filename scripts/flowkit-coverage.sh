#!/usr/bin/env bash
# Runs the FlowKit tests with coverage and prints line coverage per folder of Sources/FlowKit.
# Exits non-zero when the tests fail or a folder is under its floor in
# Packages/FlowKit/coverage-floors.txt. On CI the table also goes to $GITHUB_STEP_SUMMARY.
#   scripts/flowkit-coverage.sh [--scratch-path DIR]   (extra args go to `swift test`)
set -euo pipefail
cd "$(dirname "$0")/../Packages/FlowKit"

swift test --enable-code-coverage "$@"

codecov_json=$(swift test --show-codecov-path "$@" | tail -1)
# SwiftPM exports the source paths and line totals directly on both Xcode and Linux.
per_folder=$(python3 - "$codecov_json" <<'PYTHON'
import json
import sys
from collections import defaultdict
from pathlib import Path

root = Path("Sources/FlowKit").resolve()
totals = defaultdict(lambda: [0, 0])
with open(sys.argv[1]) as report:
    for group in json.load(report)["data"]:
        for file in group["files"]:
            path = Path(file["filename"])
            if path.suffix != ".swift" or not path.is_relative_to(root):
                continue
            parts = path.relative_to(root).parts
            folder = parts[0] if len(parts) > 1 else "(root)"
            lines = file["summary"]["lines"]
            totals[folder][0] += lines["count"]
            totals[folder][1] += lines["count"] - lines["covered"]
if not totals:
    sys.exit("SwiftPM coverage contains no FlowKit source files")
for folder, (lines, missed) in sorted(totals.items()):
    print(folder, lines, missed)
PYTHON
)

table=$(echo "$per_folder" | awk -v floors=coverage-floors.txt '
  BEGIN { while ((getline x < floors) > 0) { if (x ~ /^[[:space:]]*(#|$)/) continue; split(x, q, /[[:space:]]+/); floor[q[1]] = q[2] } }
  BEGIN { print "| Folder | Lines | Covered | Floor | |"; print "|---|---:|---:|---:|---|" }
  { pct = $2 ? 100 * ($2 - $3) / $2 : 100; f = ($1 in floor) ? floor[$1] : 0
    ok = (pct + 0.0001 >= f) ? "ok" : "BELOW FLOOR"; if (ok != "ok") bad = 1
    tl += $2; tm += $3
    printf "| %s | %d | %.1f%% | %s%% | %s |\n", $1, $2, pct, f, ok }
  END { printf "| **Total** | %d | %.1f%% | | |\n", tl, tl ? 100 * (tl - tm) / tl : 100
        if (bad) print "FAILED" }')

echo "$table"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### FlowKit line coverage"; echo; echo "$table" | grep -v '^FAILED$'; } >> "$GITHUB_STEP_SUMMARY"
fi
if echo "$table" | grep -q '^FAILED$'; then
  echo "A folder is under its coverage floor (Packages/FlowKit/coverage-floors.txt)." >&2
  exit 1
fi
