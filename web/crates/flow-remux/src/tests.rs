//! End-to-end tests against real files: the web sample and FlowKit's fixtures (made with ffmpeg;
//! counts match `ffprobe -show_packets`).

use crate::mp4::tests::find;
use crate::remuxer::{Core, Fragment, KIND_AUDIO, KIND_VIDEO};

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/../../../Packages/FlowKit/Tests/FlowKitTests/Resources/{name}.mkv", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(path).unwrap()
}

fn sample() -> Vec<u8> {
    std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../public/samples/flow-sample.mkv")).unwrap()
}

/// Reads the header the way the worker does: a first chunk, then whatever the reader asks for.
fn open(bytes: &[u8]) -> Core {
    let mut core = Core::new(Some(bytes.len() as u64));
    while let Some((offset, len)) = core.header_need() {
        let end = (offset + len).min(bytes.len() as u64);
        core.reader.feed(offset, &bytes[offset as usize..end as usize]);
    }
    assert!(core.reader.is_ready(), "{:?}", core.reader.error);
    while let Some((offset, len)) = core.cues_need() {
        let end = (offset + len).min(bytes.len() as u64);
        core.cues_feed(offset, &bytes[offset as usize..end as usize]);
    }
    core
}

/// Pushes the file from `from` in network-sized pieces, collecting every fragment.
fn stream(core: &mut Core, bytes: &[u8], from: u64, chunk: usize) -> Vec<Fragment> {
    let mut out = Vec::new();
    for piece in bytes[from as usize..].chunks(chunk) {
        core.push(piece);
        while let Some(f) = core.next_fragment() {
            out.push(f);
        }
    }
    core.finish();
    while let Some(f) = core.next_fragment() {
        out.push(f);
    }
    out
}

struct Parsed {
    base: u64,
    durations: Vec<u32>,
    sizes: Vec<u32>,
    sync: Vec<bool>,
    offsets: Vec<i32>,
}

fn parse_fragment(f: &[u8], video: bool) -> Parsed {
    let u32_at = |i: usize| u32::from_be_bytes(f[i..i + 4].try_into().unwrap());
    let tfdt = find(f, b"tfdt").unwrap();
    let base = u64::from_be_bytes(f[tfdt + 12..tfdt + 20].try_into().unwrap());
    let trun = find(f, b"trun").unwrap();
    let count = u32_at(trun + 12) as usize;
    let data_offset = u32_at(trun + 16) as usize;
    let per = if video { 16 } else { 12 };
    let mut p = Parsed { base, durations: vec![], sizes: vec![], sync: vec![], offsets: vec![] };
    for k in 0..count {
        let at = trun + 20 + k * per;
        p.durations.push(u32_at(at));
        p.sizes.push(u32_at(at + 4));
        p.sync.push(u32_at(at + 8) == 0x0200_0000);
        p.offsets.push(if video { u32_at(at + 12) as i32 } else { 0 });
    }
    let total: u32 = p.sizes.iter().sum();
    let mdat = data_offset - 8;
    assert_eq!(&f[mdat + 4..mdat + 8], b"mdat");
    assert_eq!(u32_at(mdat) as usize, 8 + total as usize, "mdat holds exactly the samples");
    assert_eq!(f.len(), data_offset + total as usize);
    p
}

fn track_id(core: &Core, codec_id: &str) -> u32 {
    core.reader.header.tracks.iter().find(|t| t.codec_id == codec_id).unwrap().number
}

#[test]
fn sample_file_remuxes_completely() {
    let bytes = sample();
    let mut core = open(&bytes);
    let json = core.header_json();
    assert!(json.contains("\"codec\":\"avc1.64001F\""), "{json}");
    assert!(json.contains("\"width\":1280"), "{json}");
    assert!(json.contains("\"codecId\":\"A_DTS\",\"codec\":\"\",\"supported\":false,\"reason\":\"DTS audio\""), "{json}");
    assert!(json.contains("\"subtitleKind\":\"text\"") && json.contains("\"subtitleKind\":\"image\""), "{json}");
    assert!(core.reader.header.cues.len() >= 2, "the sample has a seek index");

    let (video, aac, ac3) = (track_id(&core, "V_MPEG4/ISO/AVC"), track_id(&core, "A_AAC"), track_id(&core, "A_AC3"));
    core.select(video, aac);
    let first = core.reader.header.first_cluster.unwrap();
    let fragments = stream(&mut core, &bytes, first, 64 * 1024);

    let (init, codec) = core.init_segment(video).unwrap();
    assert_eq!(codec, "avc1.64001F");
    assert!(find(&init, b"avcC").is_some());
    assert_eq!(core.init_segment(aac).unwrap().1, "mp4a.40.2");
    let (ac3_init, ac3_codec) = core.init_segment(ac3).unwrap();
    assert_eq!(ac3_codec, "ac-3");
    assert!(find(&ac3_init, b"dac3").is_some(), "configured from the first AC-3 frame");

    let videos: Vec<Parsed> = fragments.iter().filter(|f| f.kind == KIND_VIDEO).map(|f| parse_fragment(&f.data, true)).collect();
    let audios: Vec<Parsed> = fragments.iter().filter(|f| f.kind == KIND_AUDIO).map(|f| parse_fragment(&f.data, false)).collect();
    assert_eq!(videos.iter().map(|p| p.sizes.len()).sum::<usize>(), 288, "every video frame, once");
    assert_eq!(audios.iter().map(|p| p.sizes.len()).sum::<usize>(), 564, "every AAC frame, once");
    assert!(videos[0].sync[0], "playback starts on a keyframe");
    // A fragment says it starts on a keyframe exactly when its first sample is one.
    for f in fragments.iter().filter(|f| f.kind == KIND_VIDEO) {
        assert_eq!(f.key, parse_fragment(&f.data, true).sync[0]);
    }
    assert!(fragments.iter().filter(|f| f.kind == KIND_VIDEO && f.key).count() >= 2, "the sample has several GOPs");

    // Decode times run on without gaps or overlaps from fragment to fragment.
    for pair in videos.windows(2) {
        assert_eq!(pair[0].base + pair[0].durations.iter().map(|&d| d as u64).sum::<u64>(), pair[1].base);
    }
    for pair in audios.windows(2) {
        assert_eq!(pair[0].base + pair[0].durations.iter().map(|&d| d as u64).sum::<u64>(), pair[1].base);
    }
    // 24 fps at 90 kHz: 3750 ticks a frame, and 12 seconds in all.
    assert!(videos.iter().flat_map(|p| &p.durations).all(|&d| d == 3750));
    let last = fragments.iter().filter(|f| f.kind == KIND_VIDEO).last().unwrap();
    assert!((last.end - 12.0 - core.delay_seconds()).abs() < 0.1, "ends at {}", last.end);
    let first_fragment = fragments.iter().find(|f| f.kind == KIND_VIDEO).unwrap();
    assert!((first_fragment.start - core.delay_seconds()).abs() < 0.001);
    assert!(core.delay_seconds() > 0.0, "the sample has B-frames");

    let cues = core.take_cues().unwrap();
    assert!(cues.matches("\"track\":").count() >= 2, "{cues}");
}

#[test]
fn h264_aac_and_srt() {
    let bytes = fixture("avc-aac-srt");
    let mut core = open(&bytes);
    core.select(1, 2);
    let first = core.reader.header.first_cluster.unwrap();
    let fragments = stream(&mut core, &bytes, first, 4096);
    let frames: usize = fragments.iter().filter(|f| f.kind == KIND_VIDEO).map(|f| parse_fragment(&f.data, true).sizes.len()).sum();
    let audio: usize = fragments.iter().filter(|f| f.kind == KIND_AUDIO).map(|f| parse_fragment(&f.data, false).sizes.len()).sum();
    assert_eq!(frames, 144);
    assert_eq!(audio, 283);

    // Stored in decode order with B-frames (0, 125, 42, 83 ms): composition offsets put them back.
    let v = parse_fragment(&fragments.iter().find(|f| f.kind == KIND_VIDEO).unwrap().data, true);
    let delay = (core.delay_seconds() * 90_000.0).round() as i64;
    let mut dts = v.base as i64;
    let mut pts = Vec::new();
    for (d, o) in v.durations.iter().zip(&v.offsets) {
        assert!(*o >= 0);
        pts.push(dts + *o as i64 - delay);
        dts += *d as i64;
    }
    let ms: Vec<i64> = pts.iter().take(4).map(|p| (p * 1000 + 45_000) / 90_000).collect();
    assert_eq!(ms, vec![0, 125, 42, 83]);

    // Cues arrive in media time: the file's 0.5 s to 2 s, plus the delay.
    let cues = core.take_cues().unwrap();
    let number = |key: &str| -> f64 {
        let at = cues.find(key).unwrap() + key.len();
        cues[at..].split([',', '}']).next().unwrap().parse().unwrap()
    };
    assert!((number("\"start\":") - 0.5 - core.delay_seconds()).abs() < 1e-6, "{cues}");
    assert!((number("\"end\":") - 2.0 - core.delay_seconds()).abs() < 1e-6, "{cues}");
    assert!(cues.contains("\"text\":\"Hello from Flow.\""), "{cues}");
    assert!(cues.contains("\"text\":\"Second line\\nacross two rows.\""), "{cues}");
}

#[test]
fn hevc_with_dolby_audio() {
    let bytes = fixture("hevc-eac3-ac3");
    let mut core = open(&bytes);
    let json = core.header_json();
    assert!(json.contains("\"codec\":\"hvc1.2.4.L"), "{json}");
    assert!(json.contains("\"range\":\"HDR10\""), "{json}");
    let video = track_id(&core, "V_MPEGH/ISO/HEVC");
    let (eac3, ac3) = (track_id(&core, "A_EAC3"), track_id(&core, "A_AC3"));
    core.select(video, eac3);
    let first = core.reader.header.first_cluster.unwrap();
    let fragments = stream(&mut core, &bytes, first, 16 * 1024);
    let (init, codec) = core.init_segment(video).unwrap();
    assert!(codec.starts_with("hvc1.2.4.L"));
    assert!(find(&init, b"hvcC").is_some() && find(&init, b"colr").is_some());
    let (e_init, e_codec) = core.init_segment(eac3).unwrap();
    assert_eq!(e_codec, "ec-3");
    assert!(find(&e_init, b"dec3").is_some());
    assert!(find(&core.init_segment(ac3).unwrap().0, b"dac3").is_some());
    assert!(fragments.iter().any(|f| f.kind == KIND_AUDIO));
    assert!(fragments.iter().any(|f| f.kind == KIND_VIDEO));
}

#[test]
fn opus_plays_in_browsers() {
    let bytes = fixture("opus");
    let mut core = open(&bytes);
    let opus = track_id(&core, "A_OPUS");
    let video = core.reader.header.tracks.iter().find(|t| t.kind == crate::matroska::VIDEO).map_or(0, |t| t.number);
    core.select(video, opus);
    let first = core.reader.header.first_cluster.unwrap();
    let fragments = stream(&mut core, &bytes, first, 32 * 1024);
    let (init, codec) = core.init_segment(opus).unwrap();
    assert_eq!(codec, "opus");
    assert!(find(&init, b"dOps").is_some());
    let audio: Vec<Parsed> = fragments.iter().filter(|f| f.kind == KIND_AUDIO).map(|f| parse_fragment(&f.data, false)).collect();
    assert!(!audio.is_empty());
    assert!(audio.iter().flat_map(|p| &p.durations).all(|&d| d == 960), "20 ms Opus packets");
}

#[test]
fn seeking_starts_at_the_keyframe_before() {
    let bytes = fixture("avc-aac-srt");
    let mut core = open(&bytes);
    core.select(1, 2);
    // Before any frame is read the timeline's delay isn't known yet: the target is file time.
    let (offset, time, aligned) = core.seek_target(3.4);
    assert!(aligned);
    assert!((time - 3.0).abs() < 0.001, "the cue at 3 s ({time})");
    core.reset(offset, true);
    let fragments = stream(&mut core, &bytes, offset, 8192);
    let first = fragments.iter().find(|f| f.kind == KIND_VIDEO).unwrap();
    assert!(parse_fragment(&first.data, true).sync[0]);
    let expected = 3.0 + core.delay_seconds();
    assert!((first.start - expected).abs() < 0.001, "starts at {} not {expected}", first.start);
    // Once it is, seek targets are in media time.
    assert!((core.seek_target(3.4).1 - expected).abs() < 0.001);
    let frames: usize = fragments.iter().filter(|f| f.kind == KIND_VIDEO).map(|f| parse_fragment(&f.data, true).sizes.len()).sum();
    assert_eq!(frames, 72, "three of the six seconds");
}

#[test]
fn reading_from_a_guessed_offset_finds_the_next_cluster() {
    let bytes = fixture("avc-aac-srt");
    let mut core = open(&bytes);
    core.select(1, 2);
    let clusters: Vec<usize> = bytes.windows(4).enumerate().filter(|(_, w)| *w == [0x1F, 0x43, 0xB6, 0x75]).map(|(i, _)| i).collect();
    assert!(clusters.len() >= 2);
    let sloppy = (clusters[1] - 37) as u64;
    core.reset(sloppy, false);
    let fragments = stream(&mut core, &bytes, sloppy, 1000);
    let first = fragments.iter().find(|f| f.kind == KIND_VIDEO).expect("video after resynchronising");
    assert!(parse_fragment(&first.data, true).sync[0]);
}

#[test]
fn audio_switch_keeps_the_picture() {
    let bytes = sample();
    let mut core = open(&bytes);
    let (video, aac, ac3) = (track_id(&core, "V_MPEG4/ISO/AVC"), track_id(&core, "A_AAC"), track_id(&core, "A_AC3"));
    core.select(video, aac);
    let first = core.reader.header.first_cluster.unwrap();
    stream(&mut core, &bytes, first, 1 << 20);
    // Switch to AC-3 at 6 s with the picture buffered to 10 s: only audio is rebuilt below 10 s.
    core.select(video, ac3);
    let (offset, _, _) = core.seek_target(6.0);
    core.reset(offset, true);
    core.set_video_floor(10.0);
    let fragments = stream(&mut core, &bytes, offset, 1 << 20);
    assert!(fragments.iter().filter(|f| f.kind == KIND_VIDEO).all(|f| f.end > 10.0));
    let audio: Vec<&Fragment> = fragments.iter().filter(|f| f.kind == KIND_AUDIO).collect();
    assert!(!audio.is_empty() && audio[0].start <= 6.0 + core.delay_seconds());
    // AC-3 frames are 1536 samples each.
    assert!(audio.iter().flat_map(|f| parse_fragment(&f.data, false).durations).all(|d| d == 1536));
}

#[test]
fn corrupt_files_never_panic() {
    // A small deterministic generator: the same corruptions every run.
    let mut seed = 0x2545_F491_4F6C_DD1Du64;
    let mut next = move |n: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % n.max(1) as u64) as usize
    };
    for name in ["avc-aac-srt", "hevc-eac3-ac3", "dts-commentary", "opus"] {
        let original = fixture(name);
        for round in 0..40 {
            let mut bytes = original.clone();
            match round % 3 {
                0 => {
                    for _ in 0..1 + next(40) {
                        let i = next(bytes.len());
                        bytes[i] = next(256) as u8;
                    }
                }
                1 => bytes.truncate(next(bytes.len())),
                _ => {
                    let start = next(bytes.len());
                    let fill = if next(2) == 0 { 0xFF } else { 0 };
                    let end = (start + 1 + next(64)).min(bytes.len());
                    bytes[start..end].fill(fill);
                }
            }
            let mut core = Core::new(Some(bytes.len() as u64));
            let mut rounds = 0;
            while let Some((offset, len)) = core.header_need() {
                let (o, e) = (offset.min(bytes.len() as u64) as usize, (offset + len).min(bytes.len() as u64) as usize);
                core.reader.feed(offset, &bytes[o..e]);
                rounds += 1;
                assert!(rounds < 50, "the header reader always ends");
            }
            if !core.reader.is_ready() {
                continue;
            }
            let _ = core.header_json();
            let tracks: Vec<(u32, u8)> = core.reader.header.tracks.iter().map(|t| (t.number, t.kind)).collect();
            let video = tracks.iter().find(|t| t.1 == 1).map_or(0, |t| t.0);
            let audio = tracks.iter().find(|t| t.1 == 2).map_or(0, |t| t.0);
            core.select(video, audio);
            let start = core.reader.header.first_cluster.unwrap_or(0).min(bytes.len() as u64);
            stream(&mut core, &bytes, start, 777);
            for t in &tracks {
                let _ = core.init_segment(t.0);
            }
            let _ = core.take_cues();
            let _ = core.seek_target(2.0);
        }
    }
}
