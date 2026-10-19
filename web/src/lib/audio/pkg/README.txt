flow-audio.wasm
===============

What it is
----------
A WebAssembly module that decodes Dolby Digital (AC-3), Dolby Digital Plus (E-AC-3), DTS and Dolby
TrueHD to stereo PCM, because browsers can't. Flow's web player loads it only when a track in one of
those formats plays (src/lib/audio/decoder.ts), and plays the result through Web Audio.

It contains FFmpeg's libavcodec and libavutil, configured with only these parts:

  decoders  ac3, eac3, dca (DTS), truehd, mlp
  parsers   ac3 (also E-AC-3), dca, mlp (also TrueHD)

plus a small C wrapper, web/native/flow-audio/flow_audio.c (this project's own code), that adds a stream
parser loop, a downmix to stereo and a sample-rate converter. No other FFmpeg library (libavformat,
libswresample and so on) is included, and no encoder.

Licence
-------
FFmpeg 7.1.1, https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz (SHA-256
733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1), is licensed under the GNU Lesser General
Public License, version 2.1 or later. The build enables no GPL or non-free part. The licence text is in
COPYING.LGPLv2.1 in this folder. The source is the release tarball, with one change made by the build
script: libavutil/tx_template.c has the transform lengths above 32768 points removed (they are never
used here, and their lookup tables would otherwise make the module commit 17 MB of memory when it starts).
The wrapper (flow_audio.c) is part of Flow and covered by the repository's licence.

This module is loaded as a separate file at run time, never merged into the page's own JavaScript, so
anyone can replace it with a build made from a modified FFmpeg: put your flow-audio.wasm in this folder
(it must export the same functions: see EXPORTS in the build script) and rebuild the site, or serve your
file instead of this one.

How to rebuild
--------------
From the web/ folder:

  npm run audio-wasm

It downloads FFmpeg and the WASI sysroot (wasi-sdk 25), checks their SHA-256 hashes, builds and links
this file. It needs a clang with the wasm32 target and wasm-ld (Ubuntu: apt install clang lld llvm;
macOS: brew install llvm lld). There is no Emscripten. Downloads and the build tree go to
web/build/audio-decoders (git-ignored); set WORK=dir to put them elsewhere, or OPT=-O2 for a faster, larger
module. The output replaces this folder's flow-audio.wasm and COPYING.LGPLv2.1.

Interface (C, all integers)
---------------------------
  fa_open(codec, out_rate)   1 AC-3, 2 E-AC-3, 3 DTS, 4 TrueHD; returns a handle, 0 on failure
  fa_input(h, size)          pointer to a buffer to write `size` compressed bytes into
  fa_decode(h, size)         decodes them; returns stereo frames now at fa_output(h), or < 0 on error
  fa_output(h)               pointer to interleaved float32 stereo at out_rate
  fa_flush(h)                after a seek
  fa_finish(h)               at the end: what is still buffered (then as after fa_flush)
  fa_info(h, key)            1 source channels, 2 source sample rate, 3 source frames decoded, 4 errors
  fa_close(h)

The module imports nothing from its host.
