#!/bin/bash
# Builds FFmpeg's demuxers, the mov muxer, the audio decoders and the FLAC and AAC encoders (libavformat +
# libavcodec + libswresample + libavutil) plus native/flow-media/flow_media.c into one WebAssembly module,
# src/lib/media/pkg/flow-media.wasm. It is Marquee's universal media engine: it reads any container a
# source hands the page (AVI, MPEG-TS, MP4, WMV, FLV, Ogg, ...) and writes fragmented MP4 that Media Source
# Extensions can play, converting the sound the browser can't decode (src/lib/media/).
#
# LGPL 2.1: no GPL or non-free parts are enabled, the module is loaded as a separate file so it can
# be swapped for one built from modified FFmpeg, and the source is the unmodified release tarball
# (plus the one size patch described below). Same toolchain as build-audio-decoders.sh: plain clang against
# the WASI sysroot, no Emscripten.
#
# Needs a clang with the wasm32 target and wasm-ld. Ubuntu: apt install clang lld llvm.
# macOS: brew install llvm lld (Apple's own clang has no wasm32 target; this finds Homebrew's).
#
# Usage: npm run media-wasm      (from web/; WORK=dir keeps the downloads and build tree elsewhere;
#                                 OPT=-O2 trades size for speed)
set -euo pipefail

FFMPEG_VERSION=7.1.1
FFMPEG_SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
WASI_VERSION=25.0
WASI_URL=https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25
WASI_SYSROOT_SHA256=d09c62c18efcddffe4b2fdd8c5830109cc8e36130cdbc9acdc0bd1b204c942bb
WASI_BUILTINS_SHA256=13aca55665321200b9659b292615adf5110ace9e891ab94511badd970553ca18

WEB=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$WEB/build/media-engine}
OUT=$WEB/src/lib/media/pkg
OPT=${OPT:--Oz}
# Memory is in 64 KiB pages: start at 4 MiB (the decoders' state and one frame of output fit), grow to 256 MiB.
INITIAL_MEMORY=$((8 * 1024 * 1024))
MAX_MEMORY=$((512 * 1024 * 1024))
STACK_SIZE=$((256 * 1024))
EXPORTS=(fm_open fm_strerror fm_close fm_streams fm_stream_info fm_stream_str fm_stream_extradata fm_can_decode fm_container_bitrate
         fm_duration_ms fm_offset_ms fm_chapters fm_chapter fm_chapter_title fm_start fm_step fm_out_next fm_out_ptr fm_out_kind fm_info)

if command -v nproc >/dev/null 2>&1; then JOBS=$(nproc); else JOBS=$(sysctl -n hw.ncpu); fi

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# fetch <url> <sha256> <file>: downloads once, and always checks the hash.
fetch() {
  [ -f "$3" ] || curl -fsSL -o "$3" "$1"
  if [ "$(sha256 "$3")" != "$2" ]; then echo "$3 does not match its pinned SHA-256; delete it and run again." >&2; exit 1; fi
}

# A clang that can target wasm32: $CLANG, then Homebrew's llvm, then whatever is on the PATH.
find_clang() {
  local c brewed=""
  if command -v brew >/dev/null 2>&1; then brewed=$(brew --prefix llvm 2>/dev/null || true); fi
  for c in "${CLANG:-}" "${brewed:+$brewed/bin/clang}" clang clang-18 clang-19 clang-20; do
    [ -n "$c" ] && command -v "$c" >/dev/null 2>&1 || continue
    case $("$c" --print-targets 2>/dev/null || true) in *wasm32*) command -v "$c"; return ;; esac
  done
  echo "No clang with the wasm32 target found. Install LLVM (apt install clang lld, or brew install llvm lld) or set CLANG." >&2
  exit 1
}
CC=$(find_clang)
LLVM_BIN=$(dirname "$CC")
# Homebrew keeps lld in its own prefix, so look there too.
if command -v brew >/dev/null 2>&1 && [ -d "$(brew --prefix lld 2>/dev/null)/bin" ]; then PATH=$(brew --prefix lld)/bin:$PATH; fi
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
# otherwise exactly the release tarball (see src/lib/media/pkg/README.txt).
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
  # Everything that carries a picture or sound a browser may be handed, minus video codecs (the engine
  # copies video; decoding it is a later step) and minus every protocol (the page supplies the bytes).
  DEMUXERS=(avi mpegts mpegps asf flv mov matroska ogg rm wav mp3 aac ac3 eac3 dts dtshd truehd mlp flac aiff caf amr au w64 gsm)
  PARSERS=(aac aac_latm ac3 dca flac mlp mpegaudio opus vorbis cook gsm h264 hevc mpegvideo mpeg4video vc1 vp8 vp9 av1 dvdsub)
  BSFS=(aac_adtstoasc extract_extradata)
  # Audio decoders: the four Dolby/DTS formats, the usual lossy codecs, every PCM and the common ADPCM flavours.
  DECODERS=(ac3 eac3 dca truehd mlp vorbis opus mp1 mp1float mp2 mp2float mp3 mp3float mp3adu mp3adufloat aac aac_latm alac flac
            wmav1 wmav2 wmapro wmalossless cook ra_144 ra_288 amrnb amrwb gsm gsm_ms
            pcm_s8 pcm_u8 pcm_s16le pcm_s16be pcm_u16le pcm_u16be pcm_s24le pcm_s24be pcm_u24le pcm_u24be pcm_s32le pcm_s32be
            pcm_u32le pcm_u32be pcm_f32le pcm_f32be pcm_f64le pcm_f64be pcm_alaw pcm_mulaw pcm_s24daud pcm_bluray pcm_dvd
            pcm_lxf pcm_s8_planar pcm_s16le_planar pcm_s16be_planar pcm_s24le_planar pcm_s32le_planar pcm_f16le pcm_f24le
            adpcm_ms adpcm_ima_wav adpcm_ima_qt adpcm_ima_dk3 adpcm_ima_dk4 adpcm_swf adpcm_yamaha adpcm_g722 adpcm_g726
            adpcm_ima_ws adpcm_ima_smjpeg adpcm_ima_apm adpcm_ima_oki adpcm_ct)
  ENABLES=(--enable-muxer=mp4 --enable-encoder=flac --enable-encoder=aac)
  for x in "${DEMUXERS[@]}"; do ENABLES+=(--enable-demuxer=$x); done
  for x in "${PARSERS[@]}"; do ENABLES+=(--enable-parser=$x); done
  for x in "${BSFS[@]}"; do ENABLES+=(--enable-bsf=$x); done
  for x in "${DECODERS[@]}"; do ENABLES+=(--enable-decoder=$x); done
  "$SRC/configure" --prefix="$PREFIX" \
    --enable-cross-compile --target-os=none --arch=wasm32 --cc="$CC" --ar="$AR" --ranlib="$RANLIB" --nm="$NM" --strip="$STRIP" \
    --extra-cflags="$TARGET_FLAGS -ffunction-sections -fdata-sections" --extra-ldflags="$LINK_FLAGS" \
    --extra-libs="$LIBS" --optflags="$OPT" \
    --disable-everything --disable-asm --disable-pthreads --disable-programs --disable-doc --disable-debug \
    --disable-network --disable-avdevice --disable-swscale --disable-avfilter --disable-autodetect --disable-runtime-cpudetect \
    --disable-stripping --disable-iconv --disable-zlib --disable-bzlib --disable-lzma \
    --enable-avcodec --enable-avformat --enable-avutil --enable-swresample --enable-small \
    "${ENABLES[@]}" \
    --enable-static --disable-shared > "$WORK/configure.log" 2>&1 || { tail -40 "$WORK/configure.log"; exit 1; }
  make -j"$JOBS" > "$WORK/make.log" 2>&1 || { tail -40 "$WORK/make.log"; exit 1; }
  make install-libs install-headers > /dev/null
  echo "$OPT" > "$WORK/.opt"
  cd "$WORK"
fi

# The shim only steers FFmpeg (the hot loops are inside it), so it is built for size like the rest.
"$CC" $TARGET_FLAGS $OPT -Wall -Wextra -I"$PREFIX/include" -c "$WEB/native/flow-media/flow_media.c" -o "$WORK/flow_media.o"

EXPORT_FLAGS=()
for e in "${EXPORTS[@]}"; do EXPORT_FLAGS+=("-Wl,--export=$e"); done

mkdir -p "$OUT"
# --no-entry makes it a library, not a program; -nostartfiles drops the WASI start-up code (which would
# import environment and argument calls nobody uses). Memory starts small and grows on demand.
"$CC" $LINK_FLAGS $OPT -nostartfiles \
  -Wl,--no-entry "${EXPORT_FLAGS[@]}" -Wl,--gc-sections -Wl,--strip-all \
  -Wl,--initial-memory=$INITIAL_MEMORY -Wl,--max-memory=$MAX_MEMORY -Wl,-z,stack-size=$STACK_SIZE \
  "$WORK/flow_media.o" -L"$PREFIX/lib" -lavformat -lavcodec -lswresample -lavutil $LIBS \
  -o "$OUT/flow-media.wasm"

cp "$SRC/COPYING.LGPLv2.1" "$OUT/COPYING.LGPLv2.1"
echo "$OUT/flow-media.wasm: $(wc -c < "$OUT/flow-media.wasm") bytes, $(gzip -9 -c "$OUT/flow-media.wasm" | wc -c) gzipped"
