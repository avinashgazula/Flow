#!/bin/bash
# Regenerates the tiny media files the engine's tests read (src/lib/media/__fixtures__): two seconds of a
# 160x90 test pattern with a tone, in the containers and codecs the engine handles. Needs an ffmpeg with
# libx264, libmp3lame, libvorbis and libopus. The files are committed, so tests don't need ffmpeg;
# this script only exists so they can be made again. Nothing here is copyrighted: it is all generated.
set -euo pipefail
cd "$(dirname "$0")/../src/lib/media/__fixtures__"

# Picture: a moving pattern with a key frame every second and two B-frames, so timestamps aren't trivial.
V=(-f lavfi -i "testsrc2=size=160x90:rate=15:duration=2")
# Sound: a plain tone, so a converted file can be checked for its length and its pitch.
A=(-f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2,aformat=channel_layouts=stereo")
A51=(-f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2")
H264=(-c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p -g 15 -bf 2 -b:v 60k -x264-params keyint=15:min-keyint=15:scenecut=0)
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

ff "${V[@]}" "${A[@]}" "${H264[@]}" -c:a libmp3lame -b:a 64k -shortest av-h264-mp3.avi
ff "${V[@]}" "${A[@]}" "${H264[@]}" -c:a ac3 -b:a 96k -shortest av-h264-ac3.ts
ff "${V[@]}" "${A51[@]}" "${H264[@]}" -af "pan=5.1|FL=c0|FR=c0|FC=c0|LFE=c0|BL=c0|BR=c0" -c:a ac3 -b:a 96k -shortest av-h264-ac3-51.ts
ff "${V[@]}" "${A[@]}" "${H264[@]}" -c:a eac3 -b:a 96k -shortest av-h264-eac3.mp4
ff "${V[@]}" "${A[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest av-h264-aac.mp4
ff "${V[@]}" "${A[@]}" "${H264[@]}" -c:a libvorbis -b:a 64k -shortest av-h264-vorbis.mkv
ff "${V[@]}" "${A[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest av-h264-aac.flv
ff "${V[@]}" "${A[@]}" "${H264[@]}" -c:a aac -b:a 64k -shortest av-h264-aac-adts.ts
# Two sound tracks (English PCM, French Opus).
ff "${V[@]}" "${A[@]}" -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=2" "${H264[@]}" -map 0:v -map 1:a -map 2:a \
  -c:a:0 pcm_s16le -ar:a:0 8000 -ac:a:0 1 -c:a:1 libopus -b:a:1 48k -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra av-h264-two-audio.mkv
# Sound the engine decodes that no browser does: WMA (in a Windows Media file) and AC-3 in a DVD-style program stream (the
# pictures are MPEG-4 and MPEG-2, which only a later step plays).
ff "${V[@]}" "${A[@]}" -c:v msmpeg4 -b:v 60k -c:a wmav2 -b:a 64k -shortest av-wmv-wma.wmv
ff "${V[@]}" "${A[@]}" -c:v mpeg2video -b:v 100k -g 15 -c:a ac3 -b:a 96k -shortest -f vob av-mpeg2-ac3.vob
# Sound only.
ff "${A[@]}" -c:a libopus -b:a 32k a-opus.ogg
ff "${A[@]}" -c:a libmp3lame -b:a 64k a-mp3.mp3
ff "${A[@]}" -c:a mp2 -b:a 96k a-mp2.mp2
ls -l
