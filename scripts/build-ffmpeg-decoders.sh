#!/bin/bash
# Builds a minimal FFmpeg (libavcodec + libavutil with only the DTS and Dolby TrueHD/MLP decoders)
# as a static xcframework for iOS, tvOS, macOS and their simulators, into Vendor/FFmpegDecoders.
#
# LGPL 2.1: no GPL or non-free parts are enabled. Flow links it statically, which the LGPL allows
# because Flow's own source is public, so anyone can relink against a modified FFmpeg.
#
# Usage (on a Mac with Xcode): scripts/build-ffmpeg-decoders.sh
set -euo pipefail

VERSION=7.1.1
SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$ROOT/build/ffmpeg
OUT=$ROOT/Vendor/FFmpegDecoders
JOBS=$(sysctl -n hw.ncpu)

mkdir -p "$WORK"
cd "$WORK"
if [ ! -d "ffmpeg-$VERSION" ]; then
  curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
  echo "$SHA256  ffmpeg.tar.xz" | shasum -a 256 -c -
  tar xJf ffmpeg.tar.xz
fi
SRC=$WORK/ffmpeg-$VERSION

FLAGS=(
  --disable-everything --disable-programs --disable-doc --disable-debug --disable-autodetect
  --disable-network --disable-avdevice --disable-avformat --disable-swscale --disable-swresample
  --disable-avfilter --enable-avcodec --enable-avutil
  --enable-decoder=dca --enable-decoder=truehd --enable-decoder=mlp
  --enable-parser=dca --enable-parser=mlp
  --enable-static --disable-shared --enable-pic --enable-cross-compile --target-os=darwin
)

# build <name> <sdk> <arch> <clang target>
build() {
  local name=$1 sdk=$2 arch=$3 target=$4
  local dir=$WORK/out/$name-$arch
  if [ -f "$dir/libFFmpegDecoders.a" ]; then return; fi
  local sysroot cc extra=()
  sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
  cc=$(xcrun --sdk "$sdk" -f clang)
  [ "$arch" = "x86_64" ] && extra+=(--disable-x86asm)
  rm -rf "$WORK/build-$name-$arch" && mkdir -p "$WORK/build-$name-$arch" && cd "$WORK/build-$name-$arch"
  "$SRC/configure" --prefix="$dir" --arch="$arch" --cc="$cc" --sysroot="$sysroot" \
    --extra-cflags="-target $target" --extra-ldflags="-target $target" \
    "${FLAGS[@]}" "${extra[@]}" > "$WORK/configure-$name-$arch.log"
  make -j"$JOBS" > "$WORK/make-$name-$arch.log" 2>&1 || { tail -40 "$WORK/make-$name-$arch.log"; exit 1; }
  make install > /dev/null
  libtool -static -o "$dir/libFFmpegDecoders.a" "$dir/lib/libavcodec.a" "$dir/lib/libavutil.a" 2>/dev/null
  cd "$WORK"
}

build ios iphoneos arm64 arm64-apple-ios17.0
build ios-sim iphonesimulator arm64 arm64-apple-ios17.0-simulator
build ios-sim iphonesimulator x86_64 x86_64-apple-ios17.0-simulator
build tvos appletvos arm64 arm64-apple-tvos17.0
build tvos-sim appletvsimulator arm64 arm64-apple-tvos17.0-simulator
build tvos-sim appletvsimulator x86_64 x86_64-apple-tvos17.0-simulator
build macos macosx arm64 arm64-apple-macos14.0
build macos macosx x86_64 x86_64-apple-macos14.0

# One library per platform (fat for simulators and macOS), with headers and a module map for Swift.
slice() {
  local name=$1; shift
  local dir=$WORK/slices/$name
  rm -rf "$dir" && mkdir -p "$dir/Headers"
  local libs=()
  for arch in "$@"; do libs+=("$WORK/out/$name-$arch/libFFmpegDecoders.a"); done
  lipo -create "${libs[@]}" -output "$dir/libFFmpegDecoders.a"
  cp -R "$WORK/out/$name-$1/include/libavcodec" "$WORK/out/$name-$1/include/libavutil" "$dir/Headers/"
  cat > "$dir/Headers/FFmpegDecoders.h" <<'H'
#include "libavcodec/avcodec.h"
#include "libavutil/channel_layout.h"
#include "libavutil/frame.h"
#include "libavutil/samplefmt.h"
H
  cat > "$dir/Headers/module.modulemap" <<'M'
module CFFmpegDecoders {
    header "FFmpegDecoders.h"
    export *
}
M
}
slice ios arm64
slice ios-sim arm64 x86_64
slice tvos arm64
slice tvos-sim arm64 x86_64
slice macos arm64 x86_64

rm -rf "$OUT/FFmpegDecoders.xcframework"
mkdir -p "$OUT"
args=()
for name in ios ios-sim tvos tvos-sim macos; do
  args+=(-library "$WORK/slices/$name/libFFmpegDecoders.a" -headers "$WORK/slices/$name/Headers")
done
xcodebuild -create-xcframework "${args[@]}" -output "$OUT/FFmpegDecoders.xcframework"
cp "$SRC/COPYING.LGPLv2.1" "$OUT/COPYING.LGPLv2.1"
cat > "$OUT/README.md" <<EOF
# FFmpeg decoders

FFmpeg $VERSION (https://ffmpeg.org), built by \`scripts/build-ffmpeg-decoders.sh\` with only libavcodec
and libavutil and the DTS (dca) and Dolby TrueHD/MLP decoders. Licensed under the LGPL 2.1 (see
COPYING.LGPLv2.1); no GPL or non-free components are enabled. The source is the unmodified release
tarball (SHA-256 $SHA256). Run the script on a Mac to rebuild it or to link a modified FFmpeg.
EOF
du -sh "$OUT/FFmpegDecoders.xcframework"
