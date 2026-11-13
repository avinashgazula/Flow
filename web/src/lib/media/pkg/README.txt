flow-media.wasm and flow-media-video.wasm
==========================================

What it is
----------
Marquee's universal media engine for the web player: a WebAssembly module that reads almost any container a
source can hand a browser (AVI, MPEG-TS, MP4, WMV/ASF, FLV, Matroska, Ogg, RealMedia, MPEG program streams and
more) and writes fragmented MP4 that Media Source Extensions play, copying the picture and either copying the sound
or converting it (decode, mix to stereo or 5.1, 48 kHz, FLAC or AAC) when the browser can't play it. The web player
loads it only when a file needs it (src/lib/media), and the page appends what it produces.

There are two modules. flow-media.wasm copies the picture. flow-media-video.wasm is the same plus the picture decoders, and is loaded
only for a file whose picture the browser can't decode: the page then encodes the decoded frames again with WebCodecs and gives the packets
back to the module's muxer (see "Converting the picture" in native/flow-media/flow_media.c).

Both contain FFmpeg's libavformat, libavcodec, libswresample and libavutil, configured with only these parts
(the lists are in scripts/build-media-engine.sh):

  demuxers   avi, mpegts, mpegps, asf, flv, mov (mp4), matroska (webm), ogg, rm, wav, mp3, aac, ac3, eac3, dts,
             dtshd, truehd, mlp, flac, aiff, caf, amr, au, w64, gsm, and raw mpegvideo, m4v, h264, hevc, vc1
  muxer      mp4 (used in fragmented mode)
  decoders   audio only: ac3, eac3, dca (DTS), truehd, mlp, vorbis, opus, mp1/mp2/mp3, aac, alac, flac, wma
             (1, 2, Pro, Lossless), cook, ra_144, ra_288, amr, gsm, every PCM and common ADPCM
  encoders   flac, aac
  parsers    aac, aac_latm, ac3, dca, flac, mlp, mpegaudio, opus, vorbis, cook, gsm, h264, hevc, mpegvideo,
             mpeg4video, vc1, vp8, vp9, av1, dvdsub
  filters    the aac_adtstoasc and extract_extradata bitstream filters

  video      (flow-media-video.wasm only) mpeg1video, mpeg2video, mpeg4, msmpeg4v1/v2/v3, h263, h263p, flv, wmv1/2/3, vc1,
             vp6, vp6f, vp8, h264, hevc, theora, rv10/20/30/40, mjpeg, dvvideo, cinepak, msvideo1

plus a small C shim, web/native/flow-media/flow_media.c (this project's own code), that drives them one bounded
step at a time (and, in the video module, turns decoded pictures into plain 8-bit 4:2:0 frames: dithering 10-bit down, averaging chroma,
blending interlaced frames). There is no video encoder (H.264 is encoded by the browser), no protocol and no network code: the page
supplies the bytes through two imported functions. The video module is built with -O2 and WebAssembly SIMD; the other with -Oz.

Licence
-------
FFmpeg 7.1.1, https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz (SHA-256
733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1), is licensed under the GNU Lesser General
Public License, version 2.1 or later. The build enables no GPL or non-free part (no --enable-gpl, no
--enable-nonfree, no x264, x265 or fdk-aac). The licence text is in COPYING.LGPLv2.1 in this folder. The source
is the release tarball, with one change made by the build script: libavutil/tx_template.c has the transform lengths
above 32768 points removed (they are never used here, and their lookup tables would otherwise make the module commit
17 MB of memory when it starts). The shim (flow_media.c) is part of Marquee and covered by the repository's licence.

This module is loaded as a separate file at run time, never merged into the page's own JavaScript, so anyone can
replace it with a build made from a modified FFmpeg: put your flow-media.wasm in this folder (it must export the same
functions: see EXPORTS in the build script, and import only fm_js_read and fm_js_seek from "env") and rebuild the
site, or serve your file instead of this one.

How to rebuild
--------------
From the web/ folder:

  npm run media-wasm

It downloads FFmpeg and the WASI sysroot (wasi-sdk 25), checks their SHA-256 hashes, builds and links this file. It
needs a clang with the wasm32 target and wasm-ld (Ubuntu: apt install clang lld llvm; macOS: brew install llvm lld).
There is no Emscripten. Downloads and the build tree go to web/build/media-engine (git-ignored); set WORK=dir to put
them elsewhere, or OPT=-O2 for a faster, larger module. The output replaces this folder's flow-media.wasm and
COPYING.LGPLv2.1. Size: flow-media.wasm about 2.3 MB (1.0 MB gzipped), flow-media-video.wasm about 5.5 MB (1.9 MB gzipped).

Interface (C; integers and doubles only)
----------------------------------------
Imports (module "env"): fm_js_read(buf, size) and fm_js_seek(offset, whence). Exports: fm_open, fm_strerror, fm_close,
fm_streams, fm_stream_info, fm_stream_str, fm_stream_extradata, fm_can_decode, fm_container_bitrate, fm_duration_ms,
fm_offset_ms, fm_chapters, fm_chapter, fm_chapter_title, fm_start, fm_step, fm_out_next, fm_out_ptr, fm_out_kind,
fm_info, and for converting a picture fm_out_info, fm_scratch, fm_video_open, fm_video_packet, fm_video_end, fm_video_tune (stubs in
flow-media.wasm, which refuses fm_start's convert-picture flag). Their calling convention is documented at the top of flow_media.c, and src/lib/media/engine.ts is the only
caller.
