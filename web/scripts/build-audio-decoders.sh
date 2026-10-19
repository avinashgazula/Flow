#!/bin/bash
# Builds FFmpeg's AC-3, E-AC-3, DTS and Dolby TrueHD decoders (libavcodec + libavutil, nothing else)
# plus native/flow-audio/flow_audio.c into one small WebAssembly module,
# src/lib/audio/pkg/flow-audio.wasm. Browsers can't decode these formats, so the player converts
# them to stereo PCM with this module (src/lib/audio/decoder.ts).
#
# LGPL 2.1: no GPL or non-free parts are enabled, the module is loaded as a separate file so it can
# be swapped for one built from modified FFmpeg, and the source is the unmodified release tarball.
# This is the web counterpart of scripts/build-ffmpeg-decoders.sh, which builds the iOS libraries.
#
# Needs a clang with the wasm32 target and wasm-ld. Ubuntu: apt install clang lld llvm.
# macOS: brew install llvm lld (Apple's own clang has no wasm32 target; this finds Homebrew's).
# No Emscripten: the module is plain C against the WASI sysroot, with the few imports it needs stubbed in JS.
#
# Usage: npm run audio-wasm      (from web/; WORK=dir keeps the downloads and build tree elsewhere;
#                                 OPT=-O2 trades size for speed)
set -euo pipefail

FFMPEG_VERSION=7.1.1
FFMPEG_SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
WASI_VERSION=25.0
WASI_URL=https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25
WASI_SYSROOT_SHA256=d09c62c18efcddffe4b2fdd8c5830109cc8e36130cdbc9acdc0bd1b204c942bb
WASI_BUILTINS_SHA256=13aca55665321200b9659b292615adf5110ace9e891ab94511badd970553ca18

WEB=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$WEB/build/audio-decoders}
OUT=$WEB/src/lib/audio/pkg
OPT=${OPT:--Oz}
# Memory is in 64 KiB pages: start at 4 MiB (the decoders' state and one frame of output fit), grow to 256 MiB.
INITIAL_MEMORY=$((4 * 1024 * 1024))
MAX_MEMORY=$((256 * 1024 * 1024))
STACK_SIZE=$((256 * 1024))
EXPORTS=(fa_open fa_input fa_decode fa_output fa_flush fa_finish fa_info fa_close)

if command -v nproc >/dev/null 2>&1; then JOBS=$(nproc); else JOBS=$(sysctl -n hw.ncpu); fi

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# fetch <url> <sha256> <file>: downloads once, and always checks the hash.
fetch() {
  [ -f "$3" ] || curl -fsSL -o "$3" "$1"
  if [ "$(sha256 "$3")" != "$2" ]; then echo "$3 does not match its pinned SHA-256; delete it and run again." >&2; exit 1; fi
}

# A clang that can target wasm32: $CLANG, then Homebrew's llvm, then whatever is on the PATH.
find_clang() {
  local c
  for c in "${CLANG:-}" "$(brew --prefix llvm 2>/dev/null)/bin/clang" clang clang-18 clang-19 clang-20; do
    [ -n "$c" ] && command -v "$c" >/dev/null 2>&1 || continue
    if "$c" --print-targets 2>/dev/null | grep -q wasm32; then command -v "$c"; return; fi
  done
  echo "No clang with the wasm32 target found. Install LLVM (apt install clang lld, or brew install llvm lld) or set CLANG." >&2
  exit 1
}
CC=$(find_clang)
LLVM_BIN=$(dirname "$CC")
# Homebrew keeps lld in its own prefix, so look there too.
for d in "$(brew --prefix lld 2>/dev/null)/bin"; do [ -d "$d" ] && PATH=$d:$PATH; done
PATH=$LLVM_BIN:$PATH

tool() { # tool <name>: the LLVM tool next to clang, or on the PATH, unversioned or with clang's version suffix
  local suffix; suffix=$(basename "$CC" | sed -n 's/^clang\(-[0-9][0-9]*\)$/\1/p')
  command -v "$1" 2>/dev/null || command -v "$1$suffix" 2>/dev/null || { echo "$1 not found; install LLVM." >&2; exit 1; }
}
AR=$(tool llvm-ar); RANLIB=$(tool llvm-ranlib); NM=$(tool llvm-nm); STRIP=$(tool llvm-strip)
WASM_LD=$(tool wasm-ld)

mkdir -p "$WORK/dl"
cd "$WORK"
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "$FFMPEG_SHA256" dl/ffmpeg.tar.xz
fetch "$WASI_URL/wasi-sysroot-$WASI_VERSION.tar.gz" "$WASI_SYSROOT_SHA256" dl/wasi-sysroot.tar.gz
fetch "$WASI_URL/libclang_rt.builtins-wasm32-wasi-$WASI_VERSION.tar.gz" "$WASI_BUILTINS_SHA256" dl/builtins.tar.gz
[ -d "ffmpeg-$FFMPEG_VERSION" ] || tar xJf dl/ffmpeg.tar.xz
[ -d "wasi-sysroot-$WASI_VERSION" ] || tar xzf dl/wasi-sysroot.tar.gz
[ -d "libclang_rt.builtins-wasm32-wasi-$WASI_VERSION" ] || tar xzf dl/builtins.tar.gz
SRC=$WORK/ffmpeg-$FFMPEG_VERSION

# One build-time change to FFmpeg: libavutil's transform code keeps a cosine table for every power-of-two
# length up to 2 million points, in each of three number formats. They are zero-filled memory that
# WebAssembly must commit when the module starts (17 MB), and nothing here transforms more than a few
# thousand points. Dropping the lengths above 32768 leaves the module needing about 1 MB. The source is
# otherwise exactly the release tarball (see src/lib/audio/pkg/README.txt).
if [ ! -f "$SRC/.flow-patched" ]; then
  big='(65536|131072|262144|524288|1048576|2097152)'
  sed -E -e "/^ +SR_TABLE\\($big\\) /d" -e "/^DECL_SR_CODELET\\($big,/d" \
         -e "/^ +&TX_NAME\\(ff_tx_fft${big}_ns_def\\),/d" \
      "$SRC/libavutil/tx_template.c" > "$SRC/libavutil/tx_template.c.new"
  # Fail loudly if a future FFmpeg lays this file out differently, rather than build a module with 17 MB of tables.
  if grep -qE "SR_TABLE\\($big\\)|SR_CODELET\\($big,|ff_tx_fft${big}_ns_def" "$SRC/libavutil/tx_template.c.new" ||
     ! grep -q "SR_TABLE(32768)" "$SRC/libavutil/tx_template.c.new"; then
    echo "tx_template.c did not patch as expected." >&2; exit 1
  fi
  mv "$SRC/libavutil/tx_template.c.new" "$SRC/libavutil/tx_template.c"
  touch "$SRC/.flow-patched"
fi
SYSROOT=$WORK/wasi-sysroot-$WASI_VERSION
BUILTINS=$WORK/libclang_rt.builtins-wasm32-wasi-$WASI_VERSION

# The same instruction set the Rust remuxer's module already needs (bulk memory, saturating float
# conversion, sign extension), so no browser that plays the video is left without the audio.
TARGET_FLAGS="--target=wasm32-wasi --sysroot=$SYSROOT -mbulk-memory -mnontrapping-fptoint -msign-ext"
# The compiler-rt builtins (64-bit division, soft-float helpers) come from the wasi-sdk archive, because a
# distro clang doesn't ship them for wasm32; -nodefaultlibs lets us name libc and the builtins ourselves.
LINK_FLAGS="--target=wasm32-wasi --sysroot=$SYSROOT -fuse-ld=$WASM_LD -nodefaultlibs -L$BUILTINS"
LIBS="-lm -lc -lclang_rt.builtins-wasm32"

PREFIX=$WORK/prefix
if [ ! -f "$PREFIX/lib/libavcodec.a" ] || [ "$(cat "$WORK/.opt" 2>/dev/null)" != "$OPT" ]; then
  rm -rf "$WORK/ffmpeg-build" "$PREFIX" && mkdir -p "$WORK/ffmpeg-build" && cd "$WORK/ffmpeg-build"
  # The same decoders as the iOS build, plus AC-3 and E-AC-3. swresample stays off: the wrapper's own
  # resampler and downmix are a few hundred lines and avoid pulling in a general-purpose converter.
  "$SRC/configure" --prefix="$PREFIX" \
    --enable-cross-compile --target-os=none --arch=wasm32 --cc="$CC" --ar="$AR" --ranlib="$RANLIB" --nm="$NM" --strip="$STRIP" \
    --extra-cflags="$TARGET_FLAGS -ffunction-sections -fdata-sections" --extra-ldflags="$LINK_FLAGS" \
    --extra-libs="$LIBS" --optflags="$OPT" \
    --disable-everything --disable-asm --disable-pthreads --disable-programs --disable-doc --disable-debug \
    --disable-network --disable-avformat --disable-avdevice --disable-swscale --disable-swresample \
    --disable-avfilter --disable-autodetect --disable-runtime-cpudetect --disable-stripping \
    --enable-avcodec --enable-avutil \
    --enable-decoder=ac3 --enable-decoder=eac3 --enable-decoder=dca --enable-decoder=truehd --enable-decoder=mlp \
    --enable-parser=ac3 --enable-parser=dca --enable-parser=mlp \
    --enable-static --disable-shared > "$WORK/configure.log" 2>&1 || { tail -40 "$WORK/configure.log"; exit 1; }
  make -j"$JOBS" > "$WORK/make.log" 2>&1 || { tail -40 "$WORK/make.log"; exit 1; }
  make install-libs install-headers > /dev/null
  echo "$OPT" > "$WORK/.opt"
  cd "$WORK"
fi

# The wrapper is the hot loop for resampling and downmixing, so it gets speed over size.
"$CC" $TARGET_FLAGS -O2 -Wall -Wextra -I"$PREFIX/include" -c "$WEB/native/flow-audio/flow_audio.c" -o "$WORK/flow_audio.o"

EXPORT_FLAGS=()
for e in "${EXPORTS[@]}"; do EXPORT_FLAGS+=("-Wl,--export=$e"); done

mkdir -p "$OUT"
# --no-entry makes it a library, not a program; -nostartfiles drops the WASI start-up code (which would
# import environment and argument calls nobody uses). Memory starts small and grows on demand.
"$CC" $LINK_FLAGS $OPT -nostartfiles \
  -Wl,--no-entry "${EXPORT_FLAGS[@]}" -Wl,--gc-sections -Wl,--strip-all \
  -Wl,--initial-memory=$INITIAL_MEMORY -Wl,--max-memory=$MAX_MEMORY -Wl,-z,stack-size=$STACK_SIZE \
  "$WORK/flow_audio.o" -L"$PREFIX/lib" -lavcodec -lavutil $LIBS \
  -o "$OUT/flow-audio.wasm"

cp "$SRC/COPYING.LGPLv2.1" "$OUT/COPYING.LGPLv2.1"
echo "$OUT/flow-audio.wasm: $(wc -c < "$OUT/flow-audio.wasm") bytes, $(gzip -9 -c "$OUT/flow-audio.wasm" | wc -c) gzipped"
