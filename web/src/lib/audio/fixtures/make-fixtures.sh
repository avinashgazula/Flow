#!/bin/bash
# Regenerates the test streams in this folder (see README.txt). Needs an ffmpeg with the ac3, eac3,
# dca and truehd encoders; dca and truehd are experimental, hence -strict -2.
#
# Usage: bash make-fixtures.sh [output folder]      (default: this folder)
set -euo pipefail
cd "${1:-$(dirname "$0")}"

# signal <sample rate> <seconds> <layout> <channels>: sets SIGNAL_INPUTS and SIGNAL_FILTER, the ffmpeg
# arguments for a test signal. Front left is a 440 Hz sine and front right a 660 Hz sine (both with a peak
# of 0.375), the centre is a 1000 Hz sine peaking at 0.1, and every other channel (LFE and the surrounds)
# is silent. Different tones on left and right show a swapped channel; the centre tone shows the downmix.
signal() {
  local rate=$1 seconds=$2 layout=$3 channels=$4 inputs="" chain="" map="" pairs=""
  local freq=(440 660 1000 100 200 300)
  # The sine source peaks at 0.125, so these gains give 0.375, 0.375 and 0.1.
  local volume=(3 3 0.8 0 0 0)
  local name=(FL FR FC LFE SL SR)
  for ((i = 0; i < channels; i++)); do
    inputs+=" -f lavfi -i sine=frequency=${freq[$i]}:sample_rate=$rate:duration=$seconds"
    chain+="[$i:a]volume=${volume[$i]}[c$i];"
    map+="[c$i]"
    pairs+="${pairs:+|}$i.0-${name[$i]}"
  done
  # Each input is mono, so without an explicit map join would put the first on the centre, not the left.
  SIGNAL_INPUTS=$inputs
  SIGNAL_FILTER="${chain}${map}join=inputs=$channels:channel_layout=$layout:map=$pairs[a]"
}

# encode <output> <sample rate> <seconds> <layout> <channels> <encoder arguments...>
encode() {
  local out=$1 rate=$2 seconds=$3 layout=$4 channels=$5
  shift 5
  signal "$rate" "$seconds" "$layout" "$channels"
  # shellcheck disable=SC2086
  ffmpeg -hide_banner -loglevel error -y $SIGNAL_INPUTS -filter_complex "$SIGNAL_FILTER" -map "[a]" "$@" "$out"
}

encode ac3-51.ac3        48000 1    "5.1(side)" 6 -c:a ac3   -b:a 192k -f ac3
encode ac3-51-44k.ac3    44100 1    "5.1(side)" 6 -c:a ac3   -b:a 192k -f ac3
encode eac3-51.eac3      48000 1    "5.1(side)" 6 -c:a eac3  -b:a 192k -f eac3
# FFmpeg's DTS encoder makes the core stream only (no DTS-HD Master Audio extension), and its lowest 5.1
# bitrate is 768 kb/s, so this one is shorter to stay small.
encode dts-51.dts        48000 0.4  "5.1(side)" 6 -c:a dca   -b:a 768k -strict -2 -f dts
# Lossless audio is big even for a sine, so this one is shorter too. FFmpeg's TrueHD encoder stops at 5.1
# (and writes no separate stereo presentation, which real discs carry), so there is no 7.1 fixture.
encode truehd-51.thd     48000 0.25 "5.1(side)" 6 -c:a truehd -strict -2 -f truehd
