#!/bin/bash
# Makes the clips the playback matrix plays in real browsers (e2e/media): eight seconds of a 320x180 test pattern, one
# clip for each container, picture codec and sound codec the site says it plays. Every clip is a plain tone, so a test can
# listen to it: 440 Hz on the first sound track, 660 Hz on the second, 880 Hz on the third. The clips are generated
# (not committed: about 16 MB) by `npm run e2e-media-fixtures`; CI runs it before the matrix. Needs ffmpeg with libx264,
# libx265, libvpx, libvpx-vp9, libsvtav1, libtheora, libxvid, libopus, libvorbis and libmp3lame, as Ubuntu's has.
# Nothing here is copyrighted: it is all generated.
set -euo pipefail
cd "$(dirname "$0")/.."
out=e2e/media/generated
rm -rf "$out" && mkdir -p "$out"
cd "$out"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

D=8
V=(-f lavfi -i "testsrc2=size=320x180:rate=15:duration=$D")
A1=(-f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$D,aformat=channel_layouts=stereo")
A2=(-f lavfi -i "sine=frequency=660:sample_rate=48000:duration=$D,aformat=channel_layouts=stereo")
A3=(-f lavfi -i "sine=frequency=880:sample_rate=48000:duration=$D,aformat=channel_layouts=stereo")
H264=(-c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p -g 15 -bf 2 -b:v 120k -x264-params keyint=15:min-keyint=15:scenecut=0)
KEY=(-g 15 -bf 2)
STRICT=(-strict -2)

# The browser's own player.
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest -movflags +faststart n-mp4-h264-aac.mp4
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest -f mov n-mov-h264-aac.mov
ff "${V[@]}" "${A1[@]}" -c:v libvpx-vp9 -b:v 120k -g 15 -deadline realtime -cpu-used 8 -c:a libopus -b:a 48k -shortest n-webm-vp9-opus.webm
ff "${V[@]}" "${A1[@]}" -c:v libvpx -b:v 120k -g 15 -deadline realtime -cpu-used 8 -c:a libvorbis -b:a 64k -shortest n-webm-vp8-vorbis.webm
ff "${V[@]}" "${A1[@]}" -c:v libsvtav1 -preset 12 -g 15 -b:v 120k -c:a aac -b:a 64k -shortest -movflags +faststart n-mp4-av1-aac.mp4
# Sound a browser may not decode: Dolby Digital and Plus in MP4.
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a ac3 -b:a 96k -shortest -movflags +faststart n-mp4-h264-ac3.mp4
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a eac3 -b:a 96k -shortest -movflags +faststart n-mp4-h264-eac3.mp4
# HEVC, which Safari plays and Chromium and Firefox on Linux do not.
ff "${V[@]}" "${A1[@]}" -c:v libx265 -preset ultrafast -x265-params "keyint=15:min-keyint=15:log-level=error" -b:v 120k -tag:v hvc1 -c:a aac -b:a 64k -shortest -movflags +faststart n-mp4-hevc-aac.mp4

# Matroska through the remuxer: sound that plays as it is, then sound that has to be converted, then two and three tracks.
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest r-mkv-h264-aac.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a libopus -b:a 48k -shortest r-mkv-h264-opus.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a flac -shortest r-mkv-h264-flac.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a libmp3lame -b:a 64k -shortest r-mkv-h264-mp3.mkv
ff "${V[@]}" "${A1[@]}" -c:v libvpx-vp9 -b:v 120k -g 15 -deadline realtime -cpu-used 8 -c:a libopus -b:a 48k -shortest r-mkv-vp9-opus.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a ac3 -b:a 96k -shortest r-mkv-h264-ac3.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a eac3 -b:a 96k -shortest r-mkv-h264-eac3.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a dca "${STRICT[@]}" -b:a 384k -shortest r-mkv-h264-dts.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a truehd "${STRICT[@]}" -shortest r-mkv-h264-truehd.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a libvorbis -b:a 64k -shortest r-mkv-h264-vorbis.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a pcm_s16le -shortest r-mkv-h264-pcm.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a mp2 -b:a 96k -shortest r-mkv-h264-mp2.mkv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a wmav2 -b:a 64k -shortest r-mkv-h264-wma.mkv
ff "${V[@]}" "${A1[@]}" "${A2[@]}" "${H264[@]}" -map 0:v -map 1:a -map 2:a -c:a:0 aac -b:a:0 64k -c:a:1 libopus -b:a:1 48k \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra -shortest r-mkv-h264-aac-opus.mkv
ff "${V[@]}" "${A1[@]}" "${A2[@]}" "${A3[@]}" "${H264[@]}" -map 0:v -map 1:a -map 2:a -map 3:a -c:a:0 aac -b:a:0 64k -c:a:1 ac3 -b:a:1 96k -c:a:2 dca "${STRICT[@]}" -b:a:2 384k \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra -metadata:s:a:2 language=deu -shortest r-mkv-h264-aac-ac3-dts.mkv
# Matroska whose sound the remuxer can't play: three tracks, so the engine's own track list is exercised.
ff "${V[@]}" "${A1[@]}" "${A2[@]}" "${A3[@]}" "${H264[@]}" -map 0:v -map 1:a -map 2:a -map 3:a -c:a:0 libvorbis -b:a:0 64k -c:a:1 pcm_s16le -c:a:2 mp2 -b:a:2 96k \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra -metadata:s:a:2 language=deu -shortest r-mkv-h264-vorbis-pcm-mp2.mkv

# Containers only the FFmpeg engine opens, with a picture the browser plays.
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a libmp3lame -b:a 64k -shortest u-avi-h264-mp3.avi
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a ac3 -b:a 96k -shortest -f mpegts u-ts-h264-ac3.ts
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest -f mpegts u-ts-h264-aac.ts
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest -f mpegts u-m2ts-h264-aac.m2ts
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest u-flv-h264-aac.flv
ff "${V[@]}" "${A1[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest -f 3gp u-3gp-h264-aac.3gp
ff "${V[@]}" "${A1[@]}" "${A2[@]}" "${H264[@]}" -map 0:v -map 1:a -map 2:a -c:a:0 libmp3lame -b:a:0 64k -c:a:1 ac3 -b:a:1 96k -shortest u-avi-h264-mp3-ac3.avi

# A picture no browser plays: the engine converts it as it plays.
ff "${V[@]}" "${A1[@]}" -c:v libxvid -b:v 150k "${KEY[@]}" -vtag XVID -c:a libmp3lame -b:a 64k -shortest c-avi-xvid-mp3.avi
ff "${V[@]}" "${A1[@]}" -c:v wmv2 -b:v 150k -g 15 -c:a wmav2 -b:a 64k -shortest c-wmv-wmv2-wma.wmv
ff "${V[@]}" "${A1[@]}" -c:v msmpeg4 -b:v 150k -g 15 -c:a wmav2 -b:a 64k -shortest c-wmv-msmpeg4-wma.wmv
ff "${V[@]}" "${A1[@]}" -r 25 -c:v mpeg2video -b:v 300k "${KEY[@]}" -c:a ac3 -b:a 96k -shortest -f vob c-vob-mpeg2-ac3.vob
ff "${V[@]}" "${A1[@]}" -r 25 -c:v mpeg1video -b:v 300k -g 15 -c:a mp2 -b:a 96k -shortest -f mpeg c-mpg-mpeg1-mp2.mpg
ff "${V[@]}" "${A1[@]}" -c:v flv -b:v 150k -g 15 -c:a libmp3lame -b:a 64k -ar 44100 -shortest c-flv-flv1-mp3.flv
ff "${V[@]}" "${A1[@]}" -c:v mjpeg -q:v 12 -pix_fmt yuvj420p -c:a pcm_s16le -shortest c-avi-mjpeg-pcm.avi
ff "${V[@]}" "${A1[@]}" -c:v libtheora -b:v 150k -g 15 -c:a libvorbis -b:a 64k -shortest c-ogv-theora-vorbis.ogv
ff "${V[@]}" "${A1[@]}" -c:v libvpx -b:v 150k -g 15 -deadline realtime -cpu-used 8 -c:a libvorbis -b:a 64k -shortest c-mkv-vp8-vorbis.mkv
ff "${V[@]}" "${A1[@]}" -c:v libx264 -preset veryfast -profile:v high10 -pix_fmt yuv420p10le -b:v 150k "${KEY[@]}" -c:a aac -b:a 64k -shortest c-mkv-h264-hi10p-aac.mkv
ff "${V[@]}" "${A1[@]}" -c:v libx264 -preset veryfast -profile:v high422 -pix_fmt yuv422p -b:v 150k "${KEY[@]}" -c:a aac -b:a 64k -shortest c-mkv-h264-422-aac.mkv
ff "${V[@]}" "${A1[@]}" -c:v libx265 -preset ultrafast -x265-params "keyint=15:min-keyint=15:log-level=error" -b:v 120k -c:a aac -b:a 64k -shortest c-mkv-hevc-aac.mkv

# What a browser can't convert: a picture above 1080p. (The HDR clip is committed, e2e/media/committed: ffmpeg 8 no longer writes the HDR tags into the Matroska file.)
ff -f lavfi -i "testsrc2=size=3840x2160:rate=5:duration=1" -c:v libx265 -preset ultrafast -x265-params "keyint=5:min-keyint=5:log-level=error" -b:v 400k -an x-mkv-hevc-4k.mkv
du -sh . && ls
