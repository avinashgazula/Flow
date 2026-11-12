# FFmpeg decoders

FFmpeg 7.1.1 (https://ffmpeg.org), built by `scripts/build-ffmpeg-decoders.sh` with only libavcodec,
libavutil and libswresample (which the Opus decoder uses) and these audio decoders: DTS (dca), Dolby TrueHD
and MLP, Opus, Vorbis, MPEG audio layers 1, 2 and 3, ALAC, WavPack, TTA, Windows Media Audio (versions 1, 2,
Pro and Lossless), Microsoft and IMA ADPCM, A-law, mu-law, AC-3 and E-AC-3. Licensed under the LGPL 2.1 (see
COPYING.LGPLv2.1); no GPL or non-free components are enabled. The source is the unmodified release
tarball (SHA-256 733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1). Run the script on a Mac to rebuild it or to link a modified FFmpeg.
