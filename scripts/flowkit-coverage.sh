#!/usr/bin/env bash
# Runs the FlowKit tests with coverage and prints line coverage per folder of Sources/FlowKit.
# Exits non-zero when the tests fail or a folder is under its floor in
# Packages/FlowKit/coverage-floors.txt. On CI the table also goes to $GITHUB_STEP_SUMMARY.
#   scripts/flowkit-coverage.sh [--scratch-path DIR]   (extra args go to `swift test`)
set -euo pipefail
cd "$(dirname "$0")/../Packages/FlowKit"

swift test --enable-code-coverage "$@"

codecov_json=$(swift test --show-codecov-path "$@" | tail -1)
profdata="$(dirname "$codecov_json")/default.profdata"
bin=$(find "$(dirname "$(dirname "$codecov_json")")" -maxdepth 3 -name 'FlowKitPackageTests.xctest' | head -1)
# On macOS the .xctest is a bundle; the binary is inside it.
if [ -d "$bin" ]; then bin="$bin/Contents/MacOS/FlowKitPackageTests"; fi
if command -v llvm-cov >/dev/null 2>&1; then cov=(llvm-cov); else cov=(xcrun llvm-cov); fi

report=$("${cov[@]}" report "$bin" -instr-profile="$profdata" -ignore-filename-regex='Tests|\.build' --use-color=false)

# Report columns: $1 file, $8 lines, $9 missed lines. Sum per top-level folder, then sort by name.
per_folder=$(echo "$report" | awk '
  $1 ~ /\.swift$/ { n = split($1, p, "/"); d = (n > 1) ? p[1] : "(root)"; l[d] += $8; m[d] += $9 }
  END { for (d in l) print d, l[d], m[d] }' | sort)

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
