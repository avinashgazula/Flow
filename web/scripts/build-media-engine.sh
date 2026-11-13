#!/bin/bash
# Builds FFmpeg's demuxers, the mov muxer, the audio decoders and the FLAC and AAC encoders (libavformat +
# libavcodec + libswresample + libavutil) plus native/flow-media/flow_media.c into WebAssembly modules in
# src/lib/media/pkg/. It is Marquee's universal media engine: it reads any container a source hands the page
# (AVI, MPEG-TS, MP4, WMV, FLV, Ogg, ...) and writes fragmented MP4 that Media Source Extensions can play,
# converting the sound the browser can't decode (src/lib/media/).
#
# Two modules come out of one run:
#   flow-media.wasm        containers and sound only (the picture is copied): loaded for every file the engine plays
#   flow-media-video.wasm  the same plus the video decoders (MPEG-2, MPEG-4 ASP, VC-1/WMV, VP8, H.264, HEVC, Theora,
#                          RealVideo, ...): loaded only when the browser has no decoder for a file's picture, which
#                          the page then converts by decoding it here and encoding it again with WebCodecs
#
# LGPL 2.1: no GPL or non-free parts are enabled, the modules are loaded as separate files so they can
# be swapped for ones built from modified FFmpeg, and the source is the unmodified release tarball
# (plus the one size patch described below). Same toolchain as build-audio-decoders.sh: plain clang against
# the WASI sysroot, no Emscripten.
#
# Needs a clang with the wasm32 target and wasm-ld. Ubuntu: apt install clang lld llvm.
# macOS: brew install llvm lld (Apple's own clang has no wasm32 target; this finds Homebrew's).
#
# Usage: npm run media-wasm      (from web/; WORK=dir keeps the downloads and build tree elsewhere;
#                                 OPT=-O2 trades size for speed in the sound-only module; VIDEO_OPT sets the video
#                                 module's optimisation; VARIANTS="audio" or "video" builds just one)
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
# Decoding pictures is the hot loop of the whole engine, so that module is built for speed, with WebAssembly SIMD
# (every browser that has WebCodecs' VideoEncoder, which the conversion needs, has had it for years).
VIDEO_OPT=${VIDEO_OPT:--O2}
VARIANTS=${VARIANTS:-audio video}
# Memory is in 64 KiB pages: start at 8 MiB (the decoders' state and one frame of output fit), grow to 512 MiB.
INITIAL_MEMORY=$((8 * 1024 * 1024))
MAX_MEMORY=$((512 * 1024 * 1024))
STACK_SIZE=$((256 * 1024))
EXPORTS=(fm_open fm_strerror fm_close fm_streams fm_stream_info fm_stream_str fm_stream_extradata fm_can_decode fm_container_bitrate
         fm_duration_ms fm_offset_ms fm_chapters fm_chapter fm_chapter_title fm_start fm_step fm_out_next fm_out_ptr fm_out_kind fm_out_info fm_info
         fm_scratch fm_video_open fm_video_packet fm_video_end fm_video_tune)

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
BASE_FLAGS="--target=wasm32-wasi --sysroot=$SYSROOT -mbulk-memory -mnontrapping-fptoint -msign-ext"
# The compiler-rt builtins (64-bit division, soft-float helpers) come from the wasi-sdk archive, because a
# distro clang doesn't ship them for wasm32; -nodefaultlibs lets us name libc and the builtins ourselves.
LINK_FLAGS="--target=wasm32-wasi --sysroot=$SYSROOT -fuse-ld=$WASM_LD -nodefaultlibs -L$BUILTINS"
LIBS="-lm -lc -lclang_rt.builtins-wasm32"

# Everything that carries a picture or sound a browser may be handed, minus every protocol (the page supplies the bytes).
DEMUXERS=(avi mpegts mpegps asf flv mov matroska ogg rm wav mp3 aac ac3 eac3 dts dtshd truehd mlp flac aiff caf amr au w64 gsm mpegvideo m4v h264 hevc vc1)
PARSERS=(aac aac_latm ac3 dca flac mlp mpegaudio opus vorbis cook gsm h264 hevc mpegvideo mpeg4video vc1 vp8 vp9 av1 dvdsub h263)
BSFS=(aac_adtstoasc extract_extradata)
# Audio decoders: the four Dolby/DTS formats, the usual lossy codecs, every PCM and the common ADPCM flavours.
DECODERS=(ac3 eac3 dca truehd mlp vorbis opus mp1 mp1float mp2 mp2float mp3 mp3float mp3adu mp3adufloat aac aac_latm alac flac
          wmav1 wmav2 wmapro wmalossless cook ra_144 ra_288 amrnb amrwb gsm gsm_ms
          pcm_s8 pcm_u8 pcm_s16le pcm_s16be pcm_u16le pcm_u16be pcm_s24le pcm_s24be pcm_u24le pcm_u24be pcm_s32le pcm_s32be
          pcm_u32le pcm_u32be pcm_f32le pcm_f32be pcm_f64le pcm_f64be pcm_alaw pcm_mulaw pcm_s24daud pcm_bluray pcm_dvd
          pcm_lxf pcm_s8_planar pcm_s16le_planar pcm_s16be_planar pcm_s24le_planar pcm_s32le_planar pcm_f16le pcm_f24le
          adpcm_ms adpcm_ima_wav adpcm_ima_qt adpcm_ima_dk3 adpcm_ima_dk4 adpcm_swf adpcm_yamaha adpcm_g722 adpcm_g726
          adpcm_ima_ws adpcm_ima_smjpeg adpcm_ima_apm adpcm_ima_oki adpcm_ct)
# Picture decoders, for the video module only: what no browser plays in MP4 (MPEG-1/2, MPEG-4 part 2 from DivX and Xvid,
# Microsoft's MPEG-4 and Windows Media Video, VC-1, H.263 and Flash's Sorenson, VP6 and VP8, RealVideo, Theora, Motion JPEG,
# DV, and two old AVI favourites) and the two a browser may not have (H.264 beyond 8-bit 4:2:0, and HEVC). Keep in step with
# VIDEO_DECODERS in src/lib/media/codecs.ts, which names the same codecs the way FFmpeg reports them.
VIDEO_DECODERS=(mpeg1video mpeg2video mpeg4 msmpeg4v1 msmpeg4v2 msmpeg4v3 h263 h263p flv wmv1 wmv2 wmv3 vc1 vp6 vp6f vp8 h264 hevc
                theora rv10 rv20 rv30 rv40 mjpeg dvvideo cinepak msvideo1)

# build_variant <name> <optimisation flags> <extra compiler flags> <output file> <shim define>
build_variant() {
  local name=$1 opt=$2 extra=$3 out=$4 define=$5
  local prefix=$WORK/prefix-$name target_flags="$BASE_FLAGS $extra"
  # What the libraries were built from: a change to any list or flag builds them again, one to the shim doesn't.
  local key="$name $opt $extra ${DEMUXERS[*]} ${PARSERS[*]} ${BSFS[*]} ${DECODERS[*]} ${VIDEO_DECODERS[*]}"
  if [ ! -f "$prefix/lib/libavcodec.a" ] || [ "$(cat "$WORK/.opt-$name" 2>/dev/null)" != "$key" ]; then
    rm -rf "$WORK/ffmpeg-build-$name" "$prefix" && mkdir -p "$WORK/ffmpeg-build-$name" && cd "$WORK/ffmpeg-build-$name"
    local enables=(--enable-muxer=mp4 --enable-encoder=flac --enable-encoder=aac) x
    for x in "${DEMUXERS[@]}"; do enables+=(--enable-demuxer=$x); done
    for x in "${PARSERS[@]}"; do enables+=(--enable-parser=$x); done
    for x in "${BSFS[@]}"; do enables+=(--enable-bsf=$x); done
    for x in "${DECODERS[@]}"; do enables+=(--enable-decoder=$x); done
    if [ "$name" = video ]; then for x in "${VIDEO_DECODERS[@]}"; do enables+=(--enable-decoder=$x); done; fi
    "$SRC/configure" --prefix="$prefix" \
      --enable-cross-compile --target-os=none --arch=wasm32 --cc="$CC" --ar="$AR" --ranlib="$RANLIB" --nm="$NM" --strip="$STRIP" \
      --extra-cflags="$target_flags -ffunction-sections -fdata-sections" --extra-ldflags="$LINK_FLAGS" \
      --extra-libs="$LIBS" --optflags="$opt" \
      --disable-everything --disable-asm --disable-pthreads --disable-programs --disable-doc --disable-debug \
      --disable-network --disable-avdevice --disable-swscale --disable-avfilter --disable-autodetect --disable-runtime-cpudetect \
      --disable-stripping --disable-iconv --disable-zlib --disable-bzlib --disable-lzma \
      --enable-avcodec --enable-avformat --enable-avutil --enable-swresample --enable-small \
      "${enables[@]}" \
      --enable-static --disable-shared > "$WORK/configure-$name.log" 2>&1 || { tail -40 "$WORK/configure-$name.log"; exit 1; }
    make -j"$JOBS" > "$WORK/make-$name.log" 2>&1 || { tail -40 "$WORK/make-$name.log"; exit 1; }
    make install-libs install-headers > /dev/null
    echo "$key" > "$WORK/.opt-$name"
    cd "$WORK"
  fi

  # The shim only steers FFmpeg (the hot loops are inside it), apart from the picture converter, which is why it takes the optimisation flags too.
  "$CC" $target_flags $define $opt -Wall -Wextra -I"$prefix/include" -c "$WEB/native/flow-media/flow_media.c" -o "$WORK/flow_media-$name.o"

  local export_flags=() e
  for e in "${EXPORTS[@]}"; do export_flags+=("-Wl,--export=$e"); done

  mkdir -p "$OUT"
  # --no-entry makes it a library, not a program; -nostartfiles drops the WASI start-up code (which would
  # import environment and argument calls nobody uses). Memory starts small and grows on demand.
  "$CC" $LINK_FLAGS $target_flags $opt -nostartfiles \
    -Wl,--no-entry "${export_flags[@]}" -Wl,--gc-sections -Wl,--strip-all \
    -Wl,--initial-memory=$INITIAL_MEMORY -Wl,--max-memory=$MAX_MEMORY -Wl,-z,stack-size=$STACK_SIZE \
    "$WORK/flow_media-$name.o" -L"$prefix/lib" -lavformat -lavcodec -lswresample -lavutil $LIBS \
    -o "$OUT/$out"
  echo "$OUT/$out: $(wc -c < "$OUT/$out") bytes, $(gzip -9 -c "$OUT/$out" | wc -c) gzipped"
}

for variant in $VARIANTS; do
  case $variant in
    audio) build_variant audio "$OPT" "" flow-media.wasm "-DFM_VIDEO=0" ;;
    video) build_variant video "$VIDEO_OPT" "-msimd128" flow-media-video.wasm "-DFM_VIDEO=1" ;;
    *) echo "Unknown variant $variant (audio or video)." >&2; exit 1 ;;
  esac
done

cp "$SRC/COPYING.LGPLv2.1" "$OUT/COPYING.LGPLv2.1"
