Test streams for decoder.test.ts
================================

Raw elementary streams (no container) made by FFmpeg's own encoders, so the decoder tests need no
network and no ffmpeg. Each is a short test signal: a 440 Hz sine on front left and a 660 Hz sine on
front right (peak 0.375 each), a 1000 Hz sine on the centre (peak 0.1), and silence on the LFE and the
surrounds. Different tones on left and right show a swapped channel; the centre tone shows the downmix.

  ac3-51.ac3        Dolby Digital 5.1, 48 kHz, 192 kb/s, 1 s (32 frames of 1536 samples)
  ac3-51-44k.ac3    Dolby Digital 5.1, 44.1 kHz, 192 kb/s, 1 s (29 frames): the resampling test
  eac3-51.eac3      Dolby Digital Plus 5.1, 48 kHz, 192 kb/s, 1 s
  dts-51.dts        DTS 5.1, 48 kHz, 768 kb/s, 0.4 s. FFmpeg's DTS encoder writes the core only, with no
                    DTS-HD Master Audio extension, and its lowest 5.1 bitrate is 768 kb/s, so it is short.
  truehd-51.thd     Dolby TrueHD 5.1, 48 kHz, 0.25 s. Lossless audio is large even for sines. FFmpeg's
                    TrueHD encoder stops at 5.1 (there is no 7.1) and writes a plain left/right pair as its
                    stereo presentation, so the decoded stereo has no centre tone.

To regenerate them (needs ffmpeg 6 or newer with the ac3, eac3, dca and truehd encoders):

  bash make-fixtures.sh

The commands in that script are, for the first file (the others differ only in the last line and in the
sample rate and length of the sine inputs). `sine` peaks at 0.125, so volume=3 gives 0.375 and volume=0.8
gives 0.1; the explicit join map is needed because every input is mono and join would otherwise put the
first one on the centre.

  ffmpeg -y \
    -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1 \
    -f lavfi -i sine=frequency=660:sample_rate=48000:duration=1 \
    -f lavfi -i sine=frequency=1000:sample_rate=48000:duration=1 \
    -f lavfi -i sine=frequency=100:sample_rate=48000:duration=1 \
    -f lavfi -i sine=frequency=200:sample_rate=48000:duration=1 \
    -f lavfi -i sine=frequency=300:sample_rate=48000:duration=1 \
    -filter_complex "[0:a]volume=3[c0];[1:a]volume=3[c1];[2:a]volume=0.8[c2];[3:a]volume=0[c3];[4:a]volume=0[c4];[5:a]volume=0[c5];[c0][c1][c2][c3][c4][c5]join=inputs=6:channel_layout=5.1(side):map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-SL|5.0-SR[a]" \
    -map "[a]" -c:a ac3 -b:a 192k -f ac3 ac3-51.ac3

  encoder arguments for the rest:
    ac3-51-44k.ac3   sample_rate=44100 in every input, then  -c:a ac3 -b:a 192k -f ac3
    eac3-51.eac3     -c:a eac3 -b:a 192k -f eac3
    dts-51.dts       duration=0.4 in every input, then  -c:a dca -b:a 768k -strict -2 -f dts
    truehd-51.thd    duration=0.25 in every input, then  -c:a truehd -strict -2 -f truehd

The same encoders and versions give the same bytes, but a different FFmpeg version may differ a little;
the tests check the sound and the length, not the bytes, so that is fine.
