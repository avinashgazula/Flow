#!/bin/sh
# Builds the Matroska remuxer to WebAssembly and writes it, with its JS glue and types, to
# src/lib/remux/pkg/ (committed, so the site builds without Rust). Needs the wasm32-unknown-unknown
# target and the wasm-bindgen CLI at the crate's pinned version; wasm-opt is used when installed.
set -eu
cd "$(dirname "$0")"
out=../../src/lib/remux/pkg

cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir "$out" --out-name flow_remux target/wasm32-unknown-unknown/release/flow_remux.wasm
if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Os --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int --enable-mutable-globals \
    "$out/flow_remux_bg.wasm" -o "$out/flow_remux_bg.wasm"
fi
# The generated package.json and .gitignore would hide the output from git and confuse bundlers.
rm -f "$out/package.json" "$out/.gitignore"
wc -c "$out/flow_remux_bg.wasm"
