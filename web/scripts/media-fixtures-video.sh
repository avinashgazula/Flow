#!/bin/bash
# Regenerates the tiny picture fixtures for converting video (src/lib/media/__fixtures__): the formats no browser plays
# in MP4, as clips of a few KB each, plus a few packets of H.264 to stand in for WebCodecs' encoder in tests (node has no
# VideoEncoder). Needs an ffmpeg with libxvid, libx264, libx265, libvpx, libtheora, libmp3lame and libvorbis. The files are
# committed, so tests don't need ffmpeg; this script only exists so they can be made again. Nothing here is copyrighted:
# it is all generated. VC-1 has no encoder in FFmpeg, so no fixture is made for it: the decoder is built and its name is
# listed (src/lib/media/codecs.ts), and that is all that can be checked without a licensed clip.
set -euo pipefail
cd "$(dirname "$0")/../src/lib/media/__fixtures__"

# Two seconds of a moving test pattern with a tone, so frame counts, sizes and times are easy to check.
V=(-f lavfi -i "testsrc2=size=160x90:rate=15:duration=2")
A=(-f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2,aformat=channel_layouts=stereo")
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
KEY=(-g 15 -bf 2)

# MPEG-4 part 2 as Xvid makes it (with B-frames), in AVI with MP3: the classic download.
ff "${V[@]}" "${A[@]}" -c:v libxvid -b:v 80k "${KEY[@]}" -vtag XVID -c:a libmp3lame -b:a 64k -shortest v-xvid-mp3.avi
# Windows Media Video 8 and Microsoft's MPEG-4 (the older, DivX 3 era) with WMA, in ASF.
ff "${V[@]}" "${A[@]}" -c:v wmv2 -b:v 80k -g 15 -c:a wmav2 -b:a 64k -shortest v-wmv2-wma.wmv
# MPEG-2 in a DVD-style program stream with AC-3 is av-mpeg2-ac3.vob (media-fixtures.sh). Here it is interlaced, a second of
# NTSC video with two fields a frame, top field first.
ff -f lavfi -i "testsrc2=size=160x90:rate=30000/1001:duration=1" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=1,aformat=channel_layouts=stereo" -vf "interlace=scan=tff" -flags +ildct+ilme -top 1 -c:v mpeg2video -b:v 120k "${KEY[@]}" -c:a ac3 -b:a 96k -shortest -f vob v-mpeg2-interlaced.vob
# Anamorphic: 180x120 coded, shown 16:9 (a DVD's 720x480 widescreen picture in miniature), so the pixels are 32:27.
ff -f lavfi -i "testsrc2=size=180x120:rate=15:duration=1" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=1,aformat=channel_layouts=stereo" -aspect 16:9 -c:v mpeg2video -b:v 120k "${KEY[@]}" -c:a ac3 -b:a 96k -shortest -f vob v-mpeg2-anamorphic.vob
# VP8 in Matroska, Theora in Ogg, Sorenson in FLV, Motion JPEG in AVI.
ff "${V[@]}" "${A[@]}" -c:v libvpx -b:v 80k -g 15 -c:a libvorbis -b:a 64k -shortest v-vp8-vorbis.mkv
ff "${V[@]}" -c:v libtheora -b:v 80k -g 15 v-theora.ogv
ff "${V[@]}" "${A[@]}" -c:v flv -b:v 80k -g 15 -c:a libmp3lame -b:a 64k -ar 44100 -shortest v-flv1-mp3.flv
ff "${V[@]}" -c:v mjpeg -q:v 12 -pix_fmt yuvj420p v-mjpeg.avi
# H.264 the browsers refuse: 10-bit High 10 (anime), and 4:2:2.
ff "${V[@]}" "${A[@]}" -c:v libx264 -preset veryfast -profile:v high10 -pix_fmt yuv420p10le -b:v 80k "${KEY[@]}" -c:a libopus -b:a 32k -shortest v-h264-hi10p.mkv
ff "${V[@]}" "${A[@]}" -c:v libx264 -preset veryfast -profile:v high422 -pix_fmt yuv422p -b:v 80k "${KEY[@]}" -c:a libopus -b:a 32k -shortest v-h264-422.mkv
# HEVC, for a browser that has no decoder for it.
ff "${V[@]}" "${A[@]}" -c:v libx265 -preset ultrafast -x265-params "keyint=15:min-keyint=15:log-level=error" -b:v 80k -tag:v hvc1 -c:a libopus -b:a 32k -shortest v-hevc.mkv
# A gradient in 10 bits, to see the step down to 8 dithered (a ramp of 1024 levels across 160 columns).
ff -f lavfi -i "nullsrc=size=160x90:rate=15:duration=1,format=yuv420p10le,geq=lum='clip(X*1024/160,0,1023)':cb=512:cr=512" -c:v libx264 -preset veryfast -profile:v high10 -crf 10 -g 15 v-gradient-10bit.mkv

# What the encoder would have made: 160x90 High profile H.264, one key frame a second, no B-frames, as 30 length-prefixed packets
# in an MP4 (the test reads its sample tables). One per frame of the clips above.
ff "${V[@]}" -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -b:v 120k -g 15 -bf 0 -x264-params keyint=15:min-keyint=15:scenecut=0 -movflags +faststart enc-h264-160x90.mp4
ls -l v-* enc-*
