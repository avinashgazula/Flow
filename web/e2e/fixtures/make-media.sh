#!/bin/bash
# Regenerates the stand-in stream the browser tests play (e2e/fixtures/hls): 24 seconds of a 320x180 test pattern with a
# running clock, two sound tracks (English 440 Hz, Spanish 660 Hz) and two WebVTT subtitle tracks, as an HLS master
# playlist with fragmented-MP4 segments: the shape of the Apple sample the demo data plays. The files are committed (about
# 100 KB), so the tests don't need ffmpeg; this only exists so they can be made again. Everything is generated: nothing
# here is copyrighted.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf hls && mkdir -p hls/video hls/audio-en hls/audio-es hls/subs
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
V=(-f lavfi -i "testsrc2=size=320x180:rate=15:duration=24")
H264=(-c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p -g 60 -keyint_min 60 -sc_threshold 0 -b:v 60k -maxrate 80k -bufsize 160k)
HLS=(-f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments)

ff "${V[@]}" "${H264[@]}" -an "${HLS[@]}" -hls_fmp4_init_filename init.mp4 -hls_segment_filename "hls/video/seg%d.m4s" hls/video/prog.m3u8
for l in en:440 es:660; do
  ff -f lavfi -i "sine=frequency=${l#*:}:sample_rate=44100:duration=24,aformat=channel_layouts=mono" -c:a aac -b:a 24k "${HLS[@]}" \
    -hls_fmp4_init_filename init.mp4 -hls_segment_filename "hls/audio-${l%%:*}/seg%d.m4s" "hls/audio-${l%%:*}/prog.m3u8"
done

# Subtitles: one cue per four seconds, so the one showing says which track it is.
for l in en:English es:Spanish; do
  code=${l%%:*}; name=${l#*:}
  {
    echo "WEBVTT"; echo
    for i in 0 1 2 3 4 5; do
      s=$((i * 4))
      printf '00:00:%02d.000 --> 00:00:%02d.000\n%s subtitle %d\n\n' "$s" $((s + 4)) "$name" $((i + 1))
    done
  } > "hls/subs/$code.vtt"
  printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:24\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:24.0,\n%s.vtt\n#EXT-X-ENDLIST\n' "$code" > "hls/subs/$code.m3u8"
done

cat > hls/master.m3u8 <<'M3U'
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio-en/prog.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Spanish",LANGUAGE="es",DEFAULT=NO,AUTOSELECT=YES,URI="audio-es/prog.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subs/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Spanish",LANGUAGE="es",DEFAULT=NO,AUTOSELECT=YES,URI="subs/es.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=140000,AVERAGE-BANDWIDTH=100000,CODECS="avc1.4d400d,mp4a.40.2",RESOLUTION=320x180,FRAME-RATE=15,AUDIO="aud",SUBTITLES="subs"
video/prog.m3u8
M3U
du -sh hls
