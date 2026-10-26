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
    let mut need = core.chapters_need();
    while let Some((offset, len)) = need {
        let end = (offset + len).min(bytes.len() as u64);
        need = core.chapters_feed(offset, &bytes[offset as usize..end as usize]);
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

// MARK: - Raw audio and the Opus muxer

use crate::mp4::tests::boxes;
use crate::opus_mux::OpusMuxer;
use crate::remuxer::KIND_RAW;

/// Matroska, written by hand: just enough of it for the header reader and the block parser.
mod mkv {
    pub fn el(id: u32, body: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = id.to_be_bytes().into_iter().skip_while(|&b| b == 0).collect();
        // An 8-byte size, so a body of any length fits.
        out.push(0x01);
        out.extend_from_slice(&(body.len() as u64).to_be_bytes()[1..]);
        out.extend_from_slice(body);
        out
    }

    pub fn uint(id: u32, v: u64) -> Vec<u8> {
        let bytes = v.to_be_bytes();
        let skip = bytes.iter().take(7).take_while(|&&b| b == 0).count();
        el(id, &bytes[skip..])
    }

    pub fn text(id: u32, s: &str) -> Vec<u8> {
        el(id, s.as_bytes())
    }

    pub struct Track {
        pub number: u32,
        pub codec: &'static str,
        pub default_duration_ms: Option<u64>,
        pub stripped: Vec<u8>,
    }

    pub fn audio(number: u32, codec: &'static str) -> Track {
        Track { number, codec, default_duration_ms: None, stripped: Vec::new() }
    }

    pub struct Block {
        pub track: u32,
        /// Milliseconds after the cluster's start.
        pub rel: i16,
        pub flags: u8,
        pub body: Vec<u8>,
        /// Written as a BlockGroup with this BlockDuration (ms).
        pub duration_ms: Option<u64>,
    }

    pub fn block(track: u32, rel: i16, flags: u8, body: &[u8]) -> Block {
        Block { track, rel, flags, body: body.to_vec(), duration_ms: None }
    }

    fn track_entry(t: &Track) -> Vec<u8> {
        let mut body = uint(0xD7, t.number as u64);
        body.extend(uint(0x83, 2));
        body.extend(text(0x86, t.codec));
        if let Some(ms) = t.default_duration_ms {
            body.extend(uint(0x23E383, ms * 1_000_000));
        }
        let mut audio = el(0xB5, &48000f64.to_be_bytes());
        audio.extend(uint(0x9F, 6));
        body.extend(el(0xE1, &audio));
        if !t.stripped.is_empty() {
            let mut compression = uint(0x4254, 3);
            compression.extend(el(0x4255, &t.stripped));
            body.extend(el(0x6D80, &el(0x6240, &el(0x5034, &compression))));
        }
        el(0xAE, &body)
    }

    fn cluster(time_ms: u64, blocks: &[Block]) -> Vec<u8> {
        let mut body = uint(0xE7, time_ms);
        for b in blocks {
            let mut payload = vec![0x80 | b.track as u8];
            payload.extend_from_slice(&b.rel.to_be_bytes());
            payload.push(b.flags);
            payload.extend_from_slice(&b.body);
            match b.duration_ms {
                None => body.extend(el(0xA3, &payload)),
                Some(ms) => {
                    let mut group = el(0xA1, &payload);
                    group.extend(uint(0x9B, ms));
                    body.extend(el(0xA0, &group));
                }
            }
        }
        el(0x1F43B675, &body)
    }

    /// A file with `tracks` (all audio) and one cluster per entry of `clusters` (start in ms, blocks).
    /// With `cues`, every cluster is indexed under the first track.
    pub fn file(tracks: &[Track], clusters: &[(u64, Vec<Block>)], cues: bool) -> Vec<u8> {
        let mut ebml = el(0x4282, b"matroska");
        ebml.extend(uint(0x4287, 4));
        let mut head = el(0x1A45DFA3, &ebml);
        let mut segment = el(0x1549A966, &uint(0x2AD7B1, 1_000_000));
        let entries: Vec<u8> = tracks.iter().flat_map(track_entry).collect();
        segment.extend(el(0x1654AE6B, &entries));
        let bodies: Vec<Vec<u8>> = clusters.iter().map(|(t, b)| cluster(*t, b)).collect();
        if cues {
            // Positions are fixed-width, so the index is the same size whatever they say.
            let index = |first: u64| -> Vec<u8> {
                let mut position = first;
                let mut points = Vec::new();
                for ((time, _), body) in clusters.iter().zip(&bodies) {
                    let mut at = el(0xF7, &[tracks[0].number as u8]);
                    at.extend(el(0xF1, &(position as u32).to_be_bytes()));
                    let mut point = uint(0xB3, *time);
                    point.extend(el(0xB7, &at));
                    points.extend(el(0xBB, &point));
                    position += body.len() as u64;
                }
                el(0x1C53BB6B, &points)
            };
            let first = segment.len() + index(0).len();
            segment.extend(index(first as u64));
        }
        bodies.iter().for_each(|b| segment.extend_from_slice(b));
        head.extend(el(0x18538067, &segment));
        head
    }

    /// Xiph lacing: the frames' sizes, all but the last, in 255-runs, then the frames.
    pub fn xiph(frames: &[&[u8]]) -> Vec<u8> {
        let mut out = vec![frames.len() as u8 - 1];
        for f in &frames[..frames.len() - 1] {
            out.extend(std::iter::repeat(255).take(f.len() / 255));
            out.push((f.len() % 255) as u8);
        }
        frames.iter().for_each(|f| out.extend_from_slice(f));
        out
    }
}

fn raw_payloads(fragments: &[Fragment]) -> Vec<(f64, Vec<u8>)> {
    let mut out = Vec::new();
    for f in fragments.iter().filter(|f| f.kind == KIND_RAW) {
        let mut at = 0;
        for (&size, &time) in f.sizes.iter().zip(&f.times) {
            out.push((time, f.data[at..at + size as usize].to_vec()));
            at += size as usize;
        }
        assert_eq!(at, f.data.len(), "the sizes cover the data exactly");
    }
    out
}

/// Opens `bytes`, selects `audio` (no video) as raw and streams everything.
fn raw_run(bytes: &[u8], audio: u32, chunk: usize) -> (Core, Vec<Fragment>) {
    let mut core = open(bytes);
    core.select_with(0, audio, true);
    let first = core.reader.header.first_cluster.unwrap();
    let fragments = stream(&mut core, bytes, first, chunk);
    (core, fragments)
}

/// A payload that differs by track and index, 5 to 8 bytes long.
fn numbered(track: u32, i: usize) -> Vec<u8> {
    (0..5 + i % 4).map(|k| (track as usize * 7 + i * 31 + k) as u8).collect()
}

fn track_json(json: &str, id: u32) -> &str {
    json.split("{\"id\":").skip(1).find(|t| t.starts_with(&format!("{id},"))).unwrap()
}

fn drain(core: &mut Core) -> Vec<Fragment> {
    let mut out = Vec::new();
    while let Some(f) = core.next_fragment() {
        out.push(f);
    }
    out
}

#[test]
fn headers_name_the_decoder_each_audio_track_needs() {
    let tracks: Vec<mkv::Track> = [(1, "A_TRUEHD"), (2, "A_MLP"), (3, "A_DTS"), (4, "A_DTS/LOSSLESS"), (5, "A_AC3"), (6, "A_EAC3"), (7, "A_AAC"), (8, "A_VORBIS")]
        .into_iter()
        .map(|(n, c)| mkv::audio(n, c))
        .collect();
    let bytes = mkv::file(&tracks, &[(0, vec![mkv::block(1, 0, 0x80, &[1])])], false);
    let core = open(&bytes);
    let json = core.header_json();
    let decode = |id| -> String {
        let t = track_json(&json, id);
        let at = t.find("\"decode\":\"").unwrap() + 10;
        t[at..].split('"').next().unwrap().to_string()
    };
    assert_eq!([1, 2, 3, 4, 5, 6, 7, 8].map(decode), ["truehd", "truehd", "dts", "dts", "ac3", "eac3", "", ""]);
    // DTS and TrueHD still can't be remuxed as they are; AC-3 can.
    assert!(track_json(&json, 1).contains("\"supported\":false,\"reason\":\"Dolby TrueHD audio\""), "{json}");
    assert!(track_json(&json, 3).contains("\"supported\":false,\"reason\":\"DTS audio\""), "{json}");
    assert!(track_json(&json, 5).contains("\"supported\":true"), "{json}");
    // Only audio tracks have the field.
    let sample = open(&sample()).header_json();
    assert!(sample.contains("\"codecId\":\"A_DTS\"") && sample.contains("\"decode\":\"dts\""), "{sample}");
    assert_eq!(sample.matches("\"decode\"").count(), sample.matches("\"type\":\"audio\"").count());
}

#[test]
fn raw_mode_is_the_only_way_to_pick_a_track_browsers_cannot_play() {
    let blocks = (0..5).map(|i| mkv::block(1, i * 100, 0x80, &numbered(1, i as usize))).collect();
    let bytes = mkv::file(&[mkv::audio(1, "A_TRUEHD")], &[(0, blocks)], false);
    let mut core = open(&bytes);
    core.select(0, 1);
    let first = core.reader.header.first_cluster.unwrap();
    assert!(stream(&mut core, &bytes, first, 64).is_empty(), "without raw there is nothing to send");

    let (core, fragments) = raw_run(&bytes, 1, 64);
    assert_eq!(raw_payloads(&fragments).len(), 5);
    assert!(core.init_segment(1).is_none(), "raw audio has no init segment");
}

#[test]
fn raw_payloads_leave_whole_and_in_order() {
    let clusters: Vec<_> = (0..3u64)
        .map(|c| (c * 1000, (0..10).map(|k| mkv::block(1, k * 100, 0x80, &numbered(1, (c * 10) as usize + k as usize))).collect()))
        .collect();
    let bytes = mkv::file(&[mkv::audio(1, "A_TRUEHD")], &clusters, false);
    // Odd chunk sizes split elements across pushes.
    for chunk in [7, 1000, bytes.len()] {
        let (_, fragments) = raw_run(&bytes, 1, chunk);
        assert!(fragments.iter().all(|f| f.kind == KIND_RAW && f.key), "only raw fragments, each on a 'keyframe'");
        // About once a second without a picture, and the rest at the end.
        assert_eq!(fragments.iter().map(|f| f.sizes.len()).collect::<Vec<_>>(), vec![11, 11, 8], "chunk {chunk}");
        for f in &fragments {
            assert_eq!(f.sizes.len(), f.times.len());
            assert_eq!(f.start, f.times[0]);
            assert_eq!(f.end, *f.times.last().unwrap());
            assert_eq!(f.data.len(), f.sizes.iter().sum::<u32>() as usize);
        }
        let all = raw_payloads(&fragments);
        assert_eq!(all.len(), 30);
        for (i, (time, data)) in all.iter().enumerate() {
            assert!((time - i as f64 * 0.1).abs() < 1e-9, "payload {i} at {time}");
            assert_eq!(data, &numbered(1, i), "payload {i}");
        }
    }
}

#[test]
fn laced_blocks_become_separate_payloads() {
    let (a0, a1, a2) = (numbered(2, 0), numbered(2, 1), numbered(2, 2));
    // A frame longer than 255 bytes takes two size bytes in Xiph lacing.
    let long = vec![9u8; 300];
    let mut fixed = vec![1];
    fixed.extend_from_slice(&[1, 2, 3, 4, 5, 6]);
    let mut dts = mkv::audio(2, "A_DTS");
    dts.default_duration_ms = Some(10);
    let blocks = vec![
        mkv::block(2, 0, 0x80 | 0x02, &mkv::xiph(&[&a0, &a1, &a2])),
        mkv::block(2, 100, 0x80 | 0x04, &fixed),
        mkv::block(2, 200, 0x80, &a1),
        mkv::block(2, 300, 0x80 | 0x02, &mkv::xiph(&[&long, &a0])),
    ];
    let bytes = mkv::file(&[dts], &[(0, blocks)], false);
    let (_, fragments) = raw_run(&bytes, 2, 11);
    let all = raw_payloads(&fragments);
    // The track's frame duration spaces the frames of a block.
    let expected: Vec<(f64, Vec<u8>)> = vec![
        (0.0, a0.clone()),
        (0.01, a1.clone()),
        (0.02, a2),
        (0.1, vec![1, 2, 3]),
        (0.11, vec![4, 5, 6]),
        (0.2, a1),
        (0.3, long),
        (0.31, a0),
    ];
    assert_eq!(all.len(), expected.len());
    for (got, want) in all.iter().zip(&expected) {
        assert!((got.0 - want.0).abs() < 1e-9, "{} vs {}", got.0, want.0);
        assert_eq!(got.1, want.1);
    }

    // Without a frame duration, a BlockGroup's duration is shared out; without either, frames share a time.
    let (f0, f1, f2) = (vec![1u8, 2], vec![3u8, 4, 5], vec![6u8, 7, 8, 9]);
    // EBML lacing: first size 2 (0x82), then +1 as a signed vint (0xC0); the last frame is the rest.
    let mut ebml_laced = vec![2, 0x82, 0xC0];
    for f in [&f0, &f1, &f2] {
        ebml_laced.extend_from_slice(f);
    }
    let mut grouped = mkv::block(3, 0, 0x80 | 0x06, &ebml_laced);
    grouped.duration_ms = Some(30);
    let plain = mkv::block(3, 500, 0x80 | 0x02, &mkv::xiph(&[&f0, &f1]));
    let bytes = mkv::file(&[mkv::audio(3, "A_TRUEHD")], &[(0, vec![grouped, plain])], false);
    let (_, fragments) = raw_run(&bytes, 3, 5);
    let all = raw_payloads(&fragments);
    let times: Vec<f64> = all.iter().map(|p| p.0).collect();
    let want = [0.0, 0.01, 0.02, 0.5, 0.5];
    assert_eq!(times.len(), want.len());
    assert!(times.iter().zip(want).all(|(a, b)| (a - b).abs() < 1e-9), "{times:?}");
    assert_eq!(all.into_iter().map(|p| p.1).collect::<Vec<_>>(), vec![f0.clone(), f1.clone(), f2, f0, f1]);
}

#[test]
fn header_stripped_prefixes_come_back() {
    let dts_prefix = vec![0x7F, 0xFE, 0x80, 0x01];
    let mut dts = mkv::audio(2, "A_DTS");
    dts.stripped = dts_prefix.clone();
    let mut ac3 = mkv::audio(3, "A_AC3");
    ac3.stripped = vec![0x0B, 0x77];
    let (x, y) = ([4u8, 5], [6u8]);
    let blocks = vec![
        mkv::block(2, 0, 0x80, &[1, 2, 3]),
        mkv::block(2, 100, 0x80 | 0x02, &mkv::xiph(&[&x, &y])),
        mkv::block(3, 0, 0x80, &[9, 9, 9]),
        mkv::block(3, 100, 0x80 | 0x04, &[1, 7, 7, 8, 8]),
    ];
    let bytes = mkv::file(&[dts, ac3], &[(0, blocks)], false);
    let with = |prefix: &[u8], body: &[u8]| [prefix, body].concat();

    let (_, fragments) = raw_run(&bytes, 2, 1000);
    let payloads: Vec<Vec<u8>> = raw_payloads(&fragments).into_iter().map(|p| p.1).collect();
    assert_eq!(payloads, vec![with(&dts_prefix, &[1, 2, 3]), with(&dts_prefix, &[4, 5]), with(&dts_prefix, &[6])]);

    // AC-3 goes out as stored, prefix restored, even where it isn't a valid frame: the decoder's parser
    // does the splitting.
    let (_, fragments) = raw_run(&bytes, 3, 1000);
    let payloads: Vec<Vec<u8>> = raw_payloads(&fragments).into_iter().map(|p| p.1).collect();
    assert_eq!(payloads, vec![vec![0x0B, 0x77, 9, 9, 9], vec![0x0B, 0x77, 7, 7], vec![0x0B, 0x77, 8, 8]]);
}

#[test]
fn raw_times_share_the_timeline_with_video_and_audio_fragments() {
    let bytes = sample();

    // The same AC-3 track, muxed and raw: the payloads are the frames, at the muxed fragments' times.
    let mut muxed = open(&bytes);
    let (video, ac3, dts) = (track_id(&muxed, "V_MPEG4/ISO/AVC"), track_id(&muxed, "A_AC3"), track_id(&muxed, "A_DTS"));
    muxed.select(video, ac3);
    let start = muxed.reader.header.first_cluster.unwrap();
    let normal = stream(&mut muxed, &bytes, start, 64 * 1024);
    let mut raw = open(&bytes);
    raw.select_with(video, ac3, true);
    let fragments = stream(&mut raw, &bytes, start, 64 * 1024);

    assert!(raw.delay_seconds() > 0.0, "the sample has B-frames");
    assert_eq!(raw.delay_seconds(), muxed.delay_seconds());
    assert!(fragments.iter().all(|f| f.kind != KIND_AUDIO), "raw audio isn't muxed");
    let kinds: Vec<u8> = fragments.iter().map(|f| f.kind).collect();
    assert_eq!(kinds[0], KIND_VIDEO, "nothing leaves before the timeline is settled");
    assert!(kinds.iter().filter(|&&k| k == KIND_RAW).count() >= 2, "raw fragments come with the video fragments: {kinds:?}");

    let muxed_audio: Vec<&Fragment> = normal.iter().filter(|f| f.kind == KIND_AUDIO).collect();
    let mut muxed_bytes = Vec::new();
    for f in &muxed_audio {
        let total = parse_fragment(&f.data, false).sizes.iter().sum::<u32>() as usize;
        muxed_bytes.extend_from_slice(&f.data[f.data.len() - total..]);
    }
    let all = raw_payloads(&fragments);
    assert_eq!(all.iter().flat_map(|p| p.1.clone()).collect::<Vec<_>>(), muxed_bytes, "the same bytes, in the same order");
    let raw_fragments: Vec<&Fragment> = fragments.iter().filter(|f| f.kind == KIND_RAW).collect();
    assert!((raw_fragments[0].start - muxed_audio[0].start).abs() < 1.0 / 48000.0, "{} vs {}", raw_fragments[0].start, muxed_audio[0].start);
    assert!(raw_fragments[0].start >= raw.delay_seconds() - 1e-9, "the delay is applied");
    // Every payload is 32 ms (1536 samples) after the one before.
    for pair in all.windows(2) {
        assert!((pair[1].0 - pair[0].0 - 0.032).abs() < 0.002, "{} then {}", pair[0].0, pair[1].0);
    }
    // And the video is what it always was.
    let videos = |f: &[Fragment]| -> Vec<Vec<u32>> { f.iter().filter(|f| f.kind == KIND_VIDEO).map(|f| parse_fragment(&f.data, true).sizes).collect() };
    assert_eq!(videos(&fragments), videos(&normal));

    // DTS is raw too, on that timeline.
    let mut raw = open(&bytes);
    raw.select_with(video, dts, true);
    let fragments = stream(&mut raw, &bytes, start, 64 * 1024);
    let all = raw_payloads(&fragments);
    assert!(all.len() > 100 && all[0].0 >= raw.delay_seconds() - 1e-9, "{} payloads from {}", all.len(), all[0].0);
    assert!(all.iter().all(|p| p.1.len() >= 4));
    let last = fragments.iter().filter(|f| f.kind == KIND_RAW).last().unwrap();
    assert_eq!(last.end, all.last().unwrap().0);
}

#[test]
fn dts_fixture_streams_raw() {
    let bytes = fixture("dts-commentary");
    let core = open(&bytes);
    let dts = core.reader.header.tracks.iter().find(|t| t.codec_id.starts_with("A_DTS")).unwrap().number;
    let (_, fragments) = raw_run(&bytes, dts, 4096);
    let all = raw_payloads(&fragments);
    assert!(!all.is_empty());
    // A DTS core frame starts with the sync word.
    assert!(all.iter().all(|p| p.1.starts_with(&[0x7F, 0xFE, 0x80, 0x01])), "{:02X?}", &all[0].1[..8]);
    assert!(all.windows(2).all(|w| w[1].0 >= w[0].0));
}

#[test]
fn reset_and_track_switches_drop_queued_payloads() {
    let blocks = (0..5)
        .flat_map(|i| [mkv::block(1, i * 100, 0x80, &numbered(1, i as usize)), mkv::block(2, i * 100 + 10, 0x80, &numbered(2, i as usize))])
        .collect();
    let bytes = mkv::file(&[mkv::audio(1, "A_TRUEHD"), mkv::audio(2, "A_DTS")], &[(0, blocks)], false);
    let mut core = open(&bytes);
    let first = core.reader.header.first_cluster.unwrap();
    let body = &bytes[first as usize..];

    // Under a second of audio is held back until the end, so there is something to throw away.
    core.select_with(0, 1, true);
    core.push(body);
    assert!(drain(&mut core).is_empty());
    core.select_with(0, 2, true);
    core.finish();
    assert!(drain(&mut core).is_empty(), "switching tracks clears the queue");

    core.reset(first, true);
    core.push(body);
    core.reset(first, true);
    core.finish();
    assert!(drain(&mut core).is_empty(), "reset clears the queue");

    // After either, only the selected track's payloads come out.
    core.push(body);
    core.finish();
    let all = raw_payloads(&drain(&mut core));
    assert_eq!(all.iter().map(|p| p.1.clone()).collect::<Vec<_>>(), (0..5).map(|i| numbered(2, i)).collect::<Vec<_>>());
    assert!((all[0].0 - 0.01).abs() < 1e-9);

    // Selecting the same track again keeps what's queued; turning raw off drops it.
    core.reset(first, true);
    core.push(body);
    core.select_with(0, 2, true);
    core.finish();
    assert_eq!(raw_payloads(&drain(&mut core)).len(), 5);
    core.reset(first, true);
    core.push(body);
    core.select_with(0, 2, false);
    core.finish();
    assert!(drain(&mut core).is_empty());
    assert!(core.init_segment(2).is_none());
}

#[test]
fn raw_audio_alone_can_seek() {
    let clusters: Vec<_> = (0..4u64)
        .map(|c| (c * 1000, (0..10).map(|k| mkv::block(1, k * 100, 0x80, &numbered(1, (c * 10) as usize + k as usize))).collect()))
        .collect();
    let bytes = mkv::file(&[mkv::audio(1, "A_TRUEHD")], &clusters, true);
    let mut core = open(&bytes);
    assert_eq!(core.reader.header.cues.len(), 4);
    core.select_with(0, 1, true);
    let (offset, time, aligned) = core.seek_target(2.5);
    assert!(aligned);
    assert!((time - 2.0).abs() < 1e-9, "the cue at 2 s ({time})");
    let cluster_starts: Vec<usize> = bytes.windows(4).enumerate().filter(|(_, w)| *w == [0x1F, 0x43, 0xB6, 0x75]).map(|(i, _)| i).collect();
    assert_eq!(offset as usize, cluster_starts[2]);
    core.reset(offset, true);
    let fragments = stream(&mut core, &bytes, offset, 100);
    let all = raw_payloads(&fragments);
    assert_eq!(all.len(), 20, "the last two seconds");
    assert!((all[0].0 - 2.0).abs() < 1e-9);
    assert_eq!(all[0].1, numbered(1, 20));
    assert_eq!(fragments[0].start, all[0].0);
}

fn be32(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes(b[at..at + 4].try_into().unwrap())
}

/// The whole box of `kind`, found anywhere in `b`.
fn whole_box<'a>(b: &'a [u8], kind: &[u8; 4]) -> &'a [u8] {
    let at = find(b, kind).unwrap();
    &b[at..at + be32(b, at) as usize]
}

#[test]
fn opus_muxer_init_segment() {
    let init = OpusMuxer::new(2, 312).init();
    let top = boxes(&init);
    assert_eq!(top.iter().map(|b| &b.0).collect::<Vec<_>>(), vec![b"ftyp", b"moov"]);
    assert_eq!(top.iter().map(|b| b.2).sum::<usize>(), init.len());
    for kind in [b"mvhd", b"trak", b"tkhd", b"mdia", b"mdhd", b"hdlr", b"smhd", b"stbl", b"stsd", b"Opus", b"dOps", b"mvex", b"trex"] {
        assert!(find(&init, kind).is_some(), "{}", String::from_utf8_lossy(kind));
    }
    let mdhd = find(&init, b"mdhd").unwrap();
    assert_eq!(be32(&init, mdhd + 20), 48000, "timescale");
    assert_eq!(be32(&init, mdhd + 24), 0, "no duration: it's fragmented");
    assert_eq!(be32(&init, find(&init, b"tkhd").unwrap() + 20), 1, "track 1");
    assert_eq!(be32(&init, find(&init, b"trex").unwrap() + 12), 1, "trex for track 1");
    let entry = whole_box(&init, b"Opus");
    assert_eq!(u16::from_be_bytes([entry[24], entry[25]]), 2, "channel count");
    assert_eq!(be32(entry, 32) >> 16, 48000, "sample rate");
    let dops = whole_box(&init, b"dOps");
    // Version 0, 2 channels, pre-skip 312, 48 kHz, gain 0, mapping family 0.
    assert_eq!(&dops[8..], &[0, 2, 0x01, 0x38, 0, 0, 0xBB, 0x80, 0, 0, 0]);
    assert!(entry.ends_with(dops), "the dOps closes the sample entry");

    // The same sample entry as an Opus track passed through from Matroska.
    let bytes = fixture("opus");
    let core = open(&bytes);
    let (passthrough, _) = core.init_segment(track_id(&core, "A_OPUS")).unwrap();
    let head = &whole_box(&passthrough, b"dOps")[8..];
    let ours = OpusMuxer::new(head[1] as u32, u16::from_be_bytes([head[2], head[3]]) as u32).init();
    assert_eq!(whole_box(&ours, b"Opus"), whole_box(&passthrough, b"Opus"));
}

#[test]
fn opus_muxer_surround_uses_a_channel_mapping() {
    let init = OpusMuxer::new(6, 0).init();
    // Channel mapping family 1: four streams, two of them coupled, then the channel order.
    assert_eq!(&whole_box(&init, b"dOps")[8..], &[0, 6, 0, 0, 0, 0, 0xBB, 0x80, 0, 0, 1, 4, 2, 0, 4, 1, 2, 3, 5]);
    assert_eq!(OpusMuxer::new(0, 0).init(), OpusMuxer::new(1, 0).init(), "at least one channel");
    assert_eq!(OpusMuxer::new(1, 0).codec(), "opus");
}

#[test]
fn opus_muxer_fragments() {
    let mut muxer = OpusMuxer::new(2, 312);
    let payload: Vec<u8> = (0..30u8).collect();
    let sizes = vec![10, 5, 15];
    let durations = vec![960, 960, 1920];
    // Past 2^32 ticks the decode time needs all 64 bits (a day and a half of 48 kHz audio).
    let base = 6_000_000_000.0;
    let f = muxer.fragment(base, &payload, sizes.clone(), durations.clone());
    let top = boxes(&f);
    assert_eq!(top.iter().map(|b| &b.0).collect::<Vec<_>>(), vec![b"moof", b"mdat"]);
    let p = parse_fragment(&f, false);
    assert_eq!(p.base, 6_000_000_000);
    assert_eq!(p.sizes, sizes);
    assert_eq!(p.durations, durations);
    assert_eq!(p.sync, vec![true; 3], "every packet is a sync sample");
    let mdat = top[1];
    assert_eq!(&f[mdat.1 + 8..mdat.1 + mdat.2], &payload[..]);
    assert_eq!(be32(&f, find(&f, b"tfhd").unwrap() + 12), 1, "track 1");
    assert_eq!(be32(&f, find(&f, b"mfhd").unwrap() + 12), 1, "sequence starts at 1");

    let g = muxer.fragment(base + 4800.0, &payload[..10], vec![10], vec![960]);
    assert_eq!(be32(&g, find(&g, b"mfhd").unwrap() + 12), 2, "and counts up");
    assert_eq!(parse_fragment(&g, false).base, 6_000_004_800);

    // A packet the data doesn't hold is left out, and an empty batch is still a valid fragment.
    let h = muxer.fragment(0.0, &payload[..12], vec![10, 5], vec![960, 960]);
    assert_eq!(parse_fragment(&h, false).sizes, vec![10]);
    let empty = muxer.fragment(0.0, &[], vec![], vec![]);
    assert_eq!(parse_fragment(&empty, false).sizes.len(), 0);
}

// MARK: - Seek previews

use crate::remuxer::Thumb;

/// A VP9 picture and an audio track, written by hand, with several keyframes in one cluster and an
/// index entry (with its position inside the cluster) for each, as mkvmerge writes them.
mod thumbs {
    use super::mkv::{el, text, uint};

    pub struct Frame {
        pub track: u8,
        pub ms: i16,
        pub key: bool,
        /// A BlockGroup (a keyframe has no ReferenceBlock) instead of a SimpleBlock.
        pub group: bool,
        pub body: Vec<u8>,
    }

    pub fn frame(track: u8, ms: i16, key: bool, group: bool, fill: u8, len: usize) -> Frame {
        Frame { track, ms, key, group, body: vec![fill; len] }
    }

    fn block(f: &Frame) -> Vec<u8> {
        let mut payload = vec![0x80 | f.track];
        payload.extend_from_slice(&f.ms.to_be_bytes());
        // Audio frames always say "key", as real muxers do: only the picture track's count.
        payload.push(if f.key && !f.group || f.track == 2 { 0x80 } else { 0 });
        payload.extend_from_slice(&f.body);
        if !f.group {
            return el(0xA3, &payload);
        }
        let mut group = el(0xA1, &payload);
        if !f.key {
            group.extend(uint(0xFB, 1));
        }
        el(0xA0, &group)
    }

    /// A cluster and where each frame's element starts inside its payload (after the timecode).
    fn cluster(ms: u64, frames: &[Frame]) -> (Vec<u8>, Vec<u64>) {
        let mut body = uint(0xE7, ms);
        let mut at = Vec::new();
        for f in frames {
            at.push(body.len() as u64);
            body.extend(block(f));
        }
        (el(0x1F43B675, &body), at)
    }

    pub struct File {
        pub bytes: Vec<u8>,
        /// Each cluster's absolute offset.
        pub clusters: Vec<u64>,
    }

    /// `clusters`: start in ms and frames. Every keyframe of track 1 is indexed, with its position in the cluster when `relative`.
    pub fn file(clusters: &[(u64, Vec<Frame>)], relative: bool) -> File {
        let mut head = el(0x1A45DFA3, &[el(0x4282, b"matroska"), uint(0x4287, 4)].concat());
        let video = [uint(0xD7, 1), uint(0x83, 1), text(0x86, "V_VP9"), el(0xE0, &[uint(0xB0, 640), uint(0xBA, 360)].concat())].concat();
        let audio = [uint(0xD7, 2), uint(0x83, 2), text(0x86, "A_OPUS"), el(0xE1, &[el(0xB5, &48000f64.to_be_bytes()), uint(0x9F, 2)].concat())].concat();
        let mut segment = el(0x1549A966, &[uint(0x2AD7B1, 1_000_000), el(0x4489, &9000f64.to_be_bytes())].concat());
        segment.extend(el(0x1654AE6B, &[el(0xAE, &video), el(0xAE, &audio)].concat()));
        let built: Vec<(Vec<u8>, Vec<u64>)> = clusters.iter().map(|(ms, frames)| cluster(*ms, frames)).collect();
        let index = |first: u64| -> Vec<u8> {
            let mut position = first;
            let mut points = Vec::new();
            for ((ms, frames), (bytes, at)) in clusters.iter().zip(&built) {
                for (f, &rel) in frames.iter().zip(at) {
                    if f.track == 1 && f.key {
                        let mut place = el(0xF7, &[1]);
                        place.extend(el(0xF1, &(position as u32).to_be_bytes()));
                        if relative {
                            place.extend(el(0xF0, &(rel as u32).to_be_bytes()));
                        }
                        let mut point = uint(0xB3, (*ms as i64 + f.ms as i64) as u64);
                        point.extend(el(0xB7, &place));
                        points.extend(el(0xBB, &point));
                    }
                }
                position += bytes.len() as u64;
            }
            el(0x1C53BB6B, &points)
        };
        // Positions are relative to the Segment's payload.
        let first = (segment.len() + index(0).len()) as u64;
        segment.extend(index(first));
        let mut offsets = Vec::new();
        let mut position = first;
        for (bytes, _) in &built {
            offsets.push(position);
            segment.extend_from_slice(bytes);
            position += bytes.len() as u64;
        }
        let segment_len = segment.len();
        head.extend(el(0x18538067, &segment));
        // The EBML header and the Segment's own header come before its payload.
        let shift = (head.len() - segment_len) as u64;
        File { bytes: head, clusters: offsets.into_iter().map(|o| o + shift).collect() }
    }
}

use thumbs::{file as thumb_file, frame, File as ThumbFile};

fn thumb_sample(relative: bool) -> ThumbFile {
    thumb_file(
        &[
            (
                0,
                vec![
                    frame(2, 0, true, false, 0xEE, 40),
                    frame(1, 0, true, false, 0xA0, 300),
                    frame(1, 40, false, false, 0x11, 50),
                    frame(2, 40, true, false, 0xEE, 40),
                    frame(1, 1000, true, false, 0xB1, 500),
                    frame(1, 1040, false, true, 0x22, 60),
                    frame(1, 2000, true, true, 0xC2, 700),
                ],
            ),
            (3000, vec![frame(1, 0, true, false, 0xD3, 200), frame(1, 40, false, false, 0x33, 20)]),
        ],
        relative,
    )
}

fn thumb_core(f: &ThumbFile) -> Core {
    let mut core = open(&f.bytes);
    core.select(1, 2);
    core
}

fn expect_found(t: Thumb, time: f64, fill: u8, len: usize) {
    match t {
        Thumb::Found(at, payload) => {
            assert!((at - time).abs() < 1e-9, "keyframe at {at}, wanted {time}");
            assert_eq!(payload, vec![fill; len]);
        }
        other => panic!("expected a keyframe, got {other:?}"),
    }
}

#[test]
fn preview_goes_straight_to_the_indexed_keyframe() {
    let f = thumb_sample(true);
    let core = thumb_core(&f);
    // 1.4 s is inside the second keyframe's GOP, in the middle of the first cluster.
    let t = core.thumb_target(1.4);
    assert_eq!(t.offset, f.clusters[0]);
    assert!(t.aligned && (t.time - 1.0).abs() < 1e-9);
    assert!(t.relative.is_some_and(|r| r > 0), "the keyframe is not the cluster's first block");
    assert_eq!(t.key, Some(1_000_000_000));
    let bytes = &f.bytes[t.offset as usize..];
    expect_found(core.thumb_find(bytes, t.aligned, t.relative, t.key), 1.0, 0xB1, 500);
    // The audio keyframe before it and the delta frames are never taken, and a BlockGroup keyframe is.
    let t = core.thumb_target(2.5);
    expect_found(core.thumb_find(&f.bytes[t.offset as usize..], true, t.relative, t.key), 2.0, 0xC2, 700);
    // The next cluster.
    let t = core.thumb_target(3.9);
    assert_eq!(t.offset, f.clusters[1]);
    expect_found(core.thumb_find(&f.bytes[t.offset as usize..], true, t.relative, t.key), 3.0, 0xD3, 200);
    // Before the first keyframe: the first one.
    let t = core.thumb_target(0.0);
    expect_found(core.thumb_find(&f.bytes[t.offset as usize..], true, t.relative, t.key), 0.0, 0xA0, 300);
}

#[test]
fn preview_without_an_index_position_scans_to_the_named_keyframe() {
    // Older muxers write no CueRelativePosition: the cluster is read in order, up to the keyframe whose time the index gave.
    let f = thumb_sample(false);
    let core = thumb_core(&f);
    let t = core.thumb_target(2.2);
    assert_eq!(t.relative, None);
    expect_found(core.thumb_find(&f.bytes[t.offset as usize..], true, t.relative, t.key), 2.0, 0xC2, 700);
    // With nothing to say which, the cluster's first keyframe.
    expect_found(core.thumb_find(&f.bytes[t.offset as usize..], true, None, None), 0.0, 0xA0, 300);
    // A keyframe time the cluster doesn't have falls back to the first it does.
    expect_found(core.thumb_find(&f.bytes[t.offset as usize..], true, None, Some(8_000_000_000)), 0.0, 0xA0, 300);
    // An estimated offset, in the middle of something else, resynchronises on the next cluster.
    let sloppy = f.clusters[1] as usize - 9;
    expect_found(core.thumb_find(&f.bytes[sloppy..], false, None, None), 3.0, 0xD3, 200);
    // A relative position that points at something else is ignored.
    expect_found(core.thumb_find(&f.bytes[f.clusters[0] as usize..], true, Some(1), Some(2_000_000_000)), 2.0, 0xC2, 700);
}

#[test]
fn preview_says_how_much_more_it_needs_and_works_at_every_length() {
    for relative in [true, false] {
        let f = thumb_sample(relative);
        let core = thumb_core(&f);
        let t = core.thumb_target(1.4);
        let whole = &f.bytes[t.offset as usize..];
        let rel = if relative { t.relative } else { None };
        let mut found_at = None;
        for len in 0..=whole.len() {
            match core.thumb_find(&whole[..len], true, rel, t.key) {
                Thumb::More(n) => {
                    assert!(n as usize > len, "asking for {n} bytes when {len} are in hand would never end");
                    assert!(found_at.is_none(), "found at {found_at:?} but not at {len}");
                }
                Thumb::Found(time, payload) => {
                    found_at.get_or_insert(len);
                    assert!((time - 1.0).abs() < 1e-9);
                    assert_eq!(payload, vec![0xB1; 500]);
                }
                Thumb::Nothing => panic!("no keyframe at {len} bytes"),
            }
        }
        let at = found_at.expect("found by the end");
        if relative {
            // Nothing after the keyframe's block is needed: the cluster's header (12 bytes), what the index skips, and the block (9 bytes of header, 4 of its own, the frame).
            assert_eq!(at, 12 + t.relative.unwrap() as usize + 9 + 4 + 500, "needed {at} bytes");
            // And the answer to "how much" is exactly that, from the first bytes.
            let Thumb::More(n) = core.thumb_find(&whole[..12 + t.relative.unwrap() as usize + 9], true, rel, t.key) else { panic!("more is needed") };
            assert_eq!(n as usize, at, "asks for exactly what finds it");
        }
    }
}

#[test]
fn preview_has_nothing_to_show_without_a_picture_or_a_cluster() {
    let f = thumb_sample(true);
    let mut core = open(&f.bytes);
    // No picture track selected.
    core.select(0, 2);
    assert_eq!(core.thumb_find(&f.bytes[f.clusters[0] as usize..], true, None, None), Thumb::Nothing);
    assert!(core.thumb_config(None).is_none());
    // Not at a cluster.
    core.select(1, 2);
    assert_eq!(core.thumb_find(&f.bytes[..200], true, None, None), Thumb::Nothing);
    // A cluster with only audio in it.
    let audio_only = thumb_file(&[(0, vec![frame(2, 0, true, false, 0x01, 10)])], false);
    let mut core = open(&audio_only.bytes);
    core.select(1, 2);
    assert_eq!(core.thumb_find(&audio_only.bytes[audio_only.clusters[0] as usize..], true, None, None), Thumb::Nothing);
}

#[test]
fn preview_decoder_config_matches_what_mse_is_given() {
    // VP9 needs no description; its string is the header's until a frame refines it.
    let f = thumb_sample(true);
    let core = thumb_core(&f);
    let (codec, description) = core.thumb_config(None).unwrap();
    assert_eq!(codec, "vp09.00.31.08");
    assert!(description.is_empty());

    // H.264: the codec string the header gives, and avcC as CodecPrivate stores it.
    let bytes = fixture("avc-aac-srt");
    let mut core = open(&bytes);
    core.select(1, 2);
    let (codec, description) = core.thumb_config(None).unwrap();
    let track = core.reader.header.track(1).unwrap();
    assert!(codec.starts_with("avc1."), "{codec}");
    assert_eq!(description, track.codec_private);
    assert_eq!(description[0], 1, "an avcC record");
    assert!(core.header_json().contains(&format!("\"codec\":\"{codec}\"")));

    // HEVC: hvcC, and a base-layer string.
    let bytes = fixture("hevc-eac3-ac3");
    let mut core = open(&bytes);
    let video = track_id(&core, "V_MPEGH/ISO/HEVC");
    core.select(video, 0);
    let (codec, description) = core.thumb_config(None).unwrap();
    assert!(codec.starts_with("hvc1.2.4.L"), "{codec}");
    assert!(description.len() >= 23 && description[0] == 1, "an hvcC record");
}

#[test]
fn preview_of_a_real_file_is_the_keyframe_the_remuxer_would_start_from() {
    for name in ["avc-aac-srt", "hevc-eac3-ac3"] {
        let bytes = fixture(name);
        let mut core = open(&bytes);
        let video = core.reader.header.tracks.iter().find(|t| t.kind == crate::matroska::VIDEO).unwrap().number;
        core.select(video, 0);
        // Streaming has learned the timeline's delay by the time anyone hovers, and carries on undisturbed.
        let first = core.reader.header.first_cluster.unwrap();
        stream(&mut core, &bytes, first, 16 * 1024);
        let duration = core.reader.header.duration.unwrap() as f64 / 1e9;
        for at in [0.0, 1.2, duration * 0.5, duration - 0.5] {
            let t = core.thumb_target(at);
            let found = core.thumb_find(&bytes[t.offset as usize..], t.aligned, t.relative, t.key);
            let Thumb::Found(time, payload) = found else { panic!("{name} at {at}: {found:?}") };
            // Streaming from the same place starts on the same picture.
            let mut streaming = open(&bytes);
            streaming.select(video, 0);
            streaming.reset(t.offset, true);
            let fragments = stream(&mut streaming, &bytes, t.offset, 4096);
            let first = fragments.iter().find(|f| f.kind == KIND_VIDEO).unwrap();
            let sizes = parse_fragment(&first.data, true).sizes;
            let total: usize = sizes.iter().map(|&s| s as usize).sum();
            let body = &first.data[first.data.len() - total..];
            assert_eq!(&body[..sizes[0] as usize], &payload[..], "{name} at {at}: the same bytes");
            // The index's time is the keyframe's, and the fragment starts with the earliest picture, which can be a leading B-frame or two before it.
            // (A core that starts partway learns its own delay, so the two are compared in file time.)
            let (shown, started) = (time - core.delay_seconds(), first.start - streaming.delay_seconds());
            assert!((started - shown).abs() < 0.25, "{name} at {at}: {started} vs {shown}");
        }
    }
}

#[test]
fn preview_never_panics_on_corrupt_bytes() {
    let mut seed = 0x9E37_79B9_7F4A_7C15u64;
    let mut next = move |n: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % n.max(1) as u64) as usize
    };
    for name in ["avc-aac-srt", "hevc-eac3-ac3"] {
        let bytes = fixture(name);
        let mut core = open(&bytes);
        let video = core.reader.header.tracks.iter().find(|t| t.kind == crate::matroska::VIDEO).unwrap().number;
        core.select(video, 0);
        let start = core.reader.header.first_cluster.unwrap() as usize;
        for _ in 0..200 {
            let mut chunk = bytes[start..(start + 1 + next(20_000)).min(bytes.len())].to_vec();
            for _ in 0..next(12) {
                let i = next(chunk.len());
                chunk[i] = next(256) as u8;
            }
            let aligned = next(2) == 0;
            let relative = (next(2) == 0).then(|| next(30_000) as u64);
            let key = (next(2) == 0).then(|| next(6_000_000_000) as i64);
            let _ = core.thumb_find(&chunk, aligned, relative, key);
        }
        let _ = core.thumb_target(f64::NAN);
        let _ = core.thumb_target(1e12);
    }
}

// MARK: - Chapters, the header cache and picture subtitles

mod extras {
    use super::mkv::{el, text, uint};
    use super::*;
    use crate::picture::tests::{clear_set, show_set, vob_packet, IDX};

    fn chapter_string(title: &str) -> Vec<u8> {
        el(0x80, &[el(0x85, title.as_bytes()), text(0x437C, "eng")].concat())
    }

    /// A chapter at `seconds`, with `inside` (sub-chapters) in it.
    fn atom(title: &str, seconds: f64, inside: &[Vec<u8>]) -> Vec<u8> {
        let body = [uint(0x73C4, 1), uint(0x91, (seconds * 1e9) as u64), chapter_string(title), inside.concat()].concat();
        el(0xB6, &body)
    }

    fn edition(default: bool, atoms: &[Vec<u8>]) -> Vec<u8> {
        el(0x45B9, &[uint(0x45DB, default as u64), atoms.concat()].concat())
    }

    fn chapters(editions: &[Vec<u8>]) -> Vec<u8> {
        el(0x1043A770, &editions.concat())
    }

    fn video_entry() -> Vec<u8> {
        el(0xAE, &[uint(0xD7, 1), uint(0x83, 1), text(0x86, "V_VP9"), el(0xE0, &[uint(0xB0, 640), uint(0xBA, 360)].concat())].concat())
    }

    fn subtitle_entry(number: u64, codec: &str, private: &[u8]) -> Vec<u8> {
        el(0xAE, &[uint(0xD7, number), uint(0x83, 0x11), text(0x86, codec), el(0x63A2, private)].concat())
    }

    fn simple_block(track: u8, ms: i16, key: bool, body: &[u8]) -> Vec<u8> {
        let mut payload = vec![0x80 | track];
        payload.extend_from_slice(&ms.to_be_bytes());
        payload.push(if key { 0x80 } else { 0 });
        payload.extend_from_slice(body);
        el(0xA3, &payload)
    }

    /// A block with a BlockDuration, as muxers write a subtitle that knows how long it lasts.
    fn timed_block(track: u8, ms: i16, duration_ms: u64, body: &[u8]) -> Vec<u8> {
        let mut payload = vec![0x80 | track];
        payload.extend_from_slice(&ms.to_be_bytes());
        payload.push(0);
        payload.extend_from_slice(body);
        el(0xA0, &[el(0xA1, &payload), uint(0x9B, duration_ms)].concat())
    }

    /// EBML header, then a Segment of `head` (Tracks and friends), one cluster, then `tail`. With
    /// `seek_to_tail`, a SeekHead in front says where the tail's first element (Chapters) is.
    fn file(head: &[Vec<u8>], cluster_body: &[u8], tail: &[u8], seek_to_tail: bool) -> Vec<u8> {
        let info = el(0x1549A966, &uint(0x2AD7B1, 1_000_000));
        let seek = |position: u32| el(0x114D9B74, &el(0x4DBB, &[el(0x53AB, &0x1043A770u32.to_be_bytes()), el(0x53AC, &position.to_be_bytes())].concat()));
        let cluster = el(0x1F43B675, &[uint(0xE7, 0), cluster_body.to_vec()].concat());
        let mut rest = info;
        rest.extend(head.concat());
        let seek_len = if seek_to_tail { seek(0).len() } else { 0 };
        let tail_at = seek_len + rest.len() + cluster.len();
        let mut segment = if seek_to_tail { seek(tail_at as u32) } else { Vec::new() };
        segment.extend(rest);
        segment.extend(cluster);
        segment.extend_from_slice(tail);
        let mut out = el(0x1A45DFA3, &[el(0x4282, b"matroska"), uint(0x4287, 4)].concat());
        out.extend(el(0x18538067, &segment));
        out
    }

    fn chapter_file(list: &[u8], after: bool) -> Vec<u8> {
        let tracks = el(0x1654AE6B, &video_entry());
        let key = simple_block(1, 0, true, &[1, 2, 3]);
        if after {
            file(&[tracks], &key, list, true)
        } else {
            file(&[tracks, list.to_vec()], &key, &[], false)
        }
    }

    fn titles(core: &Core) -> Vec<(String, i64)> {
        core.reader.header.chapters.iter().map(|c| (c.title.clone(), c.start)).collect()
    }

    fn header_only(bytes: &[u8]) -> Core {
        let mut core = Core::new(Some(bytes.len() as u64));
        while let Some((offset, len)) = core.header_need() {
            let end = (offset + len).min(bytes.len() as u64);
            core.reader.feed(offset, &bytes[offset as usize..end as usize]);
        }
        core
    }

    #[test]
    fn chapters_before_the_clusters_come_with_the_header() {
        let list = chapters(&[edition(true, &[atom("Opening", 95.5, &[]), atom("Prologue", 0.0, &[]), atom("Part A", 185.0, &[])])]);
        let core = open(&chapter_file(&list, false));
        assert_eq!(titles(&core), vec![("Prologue".into(), 0), ("Opening".into(), 95_500_000_000), ("Part A".into(), 185_000_000_000)]);
        assert_eq!(core.chapters_need(), None);
        assert_eq!(core.chapters_json(), r#"[{"title":"Prologue","start":0},{"title":"Opening","start":95.5},{"title":"Part A","start":185}]"#);
    }

    #[test]
    fn chapters_after_the_clusters_are_found_through_the_seek_head() {
        let list = chapters(&[edition(true, &[atom("Act", 0.0, &[]), atom("Credits", 3000.0, &[])])]);
        let bytes = chapter_file(&list, true);
        // The header phase alone doesn't have them; the SeekHead says where to look.
        let mut core = header_only(&bytes);
        assert!(core.reader.is_ready(), "{:?}", core.reader.error);
        assert!(core.reader.header.chapters.is_empty());
        let (offset, len) = core.chapters_need().expect("a place to look");
        assert!(offset > core.reader.header.first_cluster.unwrap());
        let end = (offset + len).min(bytes.len() as u64);
        assert_eq!(core.chapters_feed(offset, &bytes[offset as usize..end as usize]), None);
        assert_eq!(titles(&core), vec![("Act".into(), 0), ("Credits".into(), 3_000_000_000_000)]);
        assert_eq!(core.chapters_need(), None, "read once");
    }

    #[test]
    fn a_short_answer_for_the_chapters_is_asked_again_once_then_given_up() {
        let list = chapters(&[edition(true, &[atom("Act", 0.0, &[])])]);
        let bytes = chapter_file(&list, true);
        let mut core = header_only(&bytes);
        let (offset, _) = core.chapters_need().unwrap();
        let half = &bytes[offset as usize..offset as usize + 12];
        let again = core.chapters_feed(offset, half).expect("asks for the whole element");
        assert_eq!(again.0, offset);
        assert_eq!(core.chapters_feed(offset, half), None, "the same short answer means the file ends early");
        assert!(core.reader.header.chapters.is_empty());
    }

    #[test]
    fn chapter_rules_follow_the_apps() {
        let hidden = el(0xB6, &[uint(0x91, 10_000_000_000), uint(0x98, 1), chapter_string("Hidden")].concat());
        let disabled = el(0xB6, &[uint(0x91, 11_000_000_000), uint(0x4598, 0), chapter_string("Disabled")].concat());
        let unnamed = el(0xB6, &uint(0x91, 20_000_000_000));
        let other_cut = edition(false, &[atom("Other cut", 5.0, &[])]);
        let list = chapters(&[
            other_cut.clone(),
            edition(true, &[atom("Act One", 0.0, &[atom("Opening", 30.0, &[])]), hidden, disabled, unnamed, atom("Act One", 0.0, &[]), atom("Ending", 1290.0, &[])]),
        ]);
        let core = open(&chapter_file(&list, false));
        // The default edition, not the first; sub-chapters in time order; hidden and disabled ones out; an unnamed one kept
        // (the player numbers it); a chapter listed twice once.
        assert_eq!(
            titles(&core),
            vec![("Act One".into(), 0), ("".into(), 20_000_000_000), ("Opening".into(), 30_000_000_000), ("Ending".into(), 1_290_000_000_000)]
        );
        // With no default edition, the first one is taken.
        let first = chapters(&[other_cut, edition(false, &[atom("Never", 1.0, &[])])]);
        assert_eq!(titles(&open(&chapter_file(&first, false))), vec![("Other cut".into(), 5_000_000_000)]);
    }

    #[test]
    fn a_real_files_chapters() {
        let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/lib/remux/__fixtures__/chapters.mkv")).unwrap();
        let core = open(&bytes);
        assert_eq!(titles(&core), vec![("Prologue".into(), 0), ("Opening".into(), 5_000_000_000), ("Part A".into(), 20_000_000_000)]);
        let sample = open(&sample());
        assert!(sample.reader.header.chapters.len() >= 2, "the sample has chapters");
    }

    #[test]
    fn broken_chapter_lists_are_empty_not_fatal() {
        // A list whose atom has a garbled child is just empty.
        let garbled = el(0x1043A770, &el(0x45B9, &[0xB6, 0x88, 0x91]));
        assert!(titles(&open(&chapter_file(&garbled, false))).is_empty());
        // A file cut inside the list fails cleanly, and asking for the chapters after that is harmless.
        let list = chapters(&[edition(true, &[atom("A", 1.0, &[])])]);
        let bytes = chapter_file(&list, false);
        let cut = &bytes[..bytes.len() - 60];
        let mut core = Core::new(Some(cut.len() as u64));
        for _ in 0..8 {
            let Some((offset, len)) = core.header_need() else { break };
            let end = (offset + len).min(cut.len() as u64);
            core.reader.feed(offset, &cut[offset as usize..end as usize]);
        }
        let _ = core.chapters_json();
    }

    // MARK: The header cache

    #[test]
    fn a_cached_header_needs_no_reads() {
        for (bytes, name) in [(sample(), "sample"), (fixture("avc-aac-srt"), "srt"), (fixture("hevc-eac3-ac3"), "hevc")] {
            let first = open(&bytes);
            let blob = first.export_header().unwrap_or_else(|| panic!("{name}: nothing to export"));
            assert!(blob.len() < 200_000, "{name}: {} bytes", blob.len());

            let mut again = Core::new(Some(bytes.len() as u64));
            assert!(again.import_header(&blob), "{name}");
            // No reads at all: the header, the index and the chapters are in.
            assert_eq!(again.header_need(), None);
            assert_eq!(again.cues_need(), None);
            assert_eq!(again.chapters_need(), None);
            assert_eq!(again.header_json(), first.header_json(), "{name}");
            assert_eq!(again.reader.header.cues, first.reader.header.cues);
            assert_eq!(again.reader.header.chapters, first.reader.header.chapters);
            assert_eq!(again.reader.header.first_cluster, first.reader.header.first_cluster);
            assert_eq!(again.chapters_json(), first.chapters_json());
            for at in [0.0, 1.5, 4.0] {
                assert_eq!(again.seek_target(at), first.seek_target(at), "{name} at {at}");
            }
            // It exports the same blob again, so a cached visit can refresh the cache.
            assert_eq!(again.export_header().unwrap(), blob);

            // And it streams exactly like one that read everything.
            let video = first.reader.header.tracks.iter().find(|t| t.kind == crate::matroska::VIDEO).unwrap().number;
            let mut a = open(&bytes);
            let mut b = again;
            a.select(video, 0);
            b.select(video, 0);
            let start = a.reader.header.first_cluster.unwrap();
            let one: Vec<Vec<u8>> = stream(&mut a, &bytes, start, 32 * 1024).into_iter().map(|f| f.data).collect();
            let two: Vec<Vec<u8>> = stream(&mut b, &bytes, start, 32 * 1024).into_iter().map(|f| f.data).collect();
            assert_eq!(one, two, "{name}");
        }
    }

    #[test]
    fn a_header_is_only_exported_once_the_far_reads_are_done() {
        let bytes = sample();
        let core = header_only(&bytes);
        assert!(core.cues_need().is_some(), "the sample's index is at the end");
        assert!(core.export_header().is_none());
    }

    #[test]
    fn other_blobs_are_refused_and_change_nothing() {
        let bytes = sample();
        let blob = open(&bytes).export_header().unwrap();
        let mut core = Core::new(Some(bytes.len() as u64));
        for bad in [Vec::new(), b"FHC1".to_vec(), blob[..blob.len() / 2].to_vec(), [b"XXXX".as_slice(), &blob[4..]].concat(), vec![0u8; 400]] {
            assert!(!core.import_header(&bad));
        }
        assert!(!core.reader.is_ready(), "still at the start");
        // Corrupting any single byte never panics.
        for at in (0..blob.len()).step_by(7) {
            let mut mutated = blob.clone();
            mutated[at] ^= 0xFF;
            let _ = Core::new(Some(bytes.len() as u64)).import_header(&mutated);
        }
    }

    // MARK: Picture subtitles

    /// What `picture::encode` wrote, read the way the page does.
    #[derive(Debug)]
    struct Read {
        start: f64,
        end: f64,
        canvas: (u16, u16),
        forced: bool,
        objects: Vec<(u16, u16, u16, u16, Vec<u8>)>,
        palette: Vec<[u8; 4]>,
    }

    fn read_cues(bytes: &[u8]) -> Vec<Read> {
        let count = u32::from_be_bytes(bytes[..4].try_into().unwrap());
        let mut at = 4usize;
        let u16_at = |at: usize| u16::from_be_bytes([bytes[at], bytes[at + 1]]);
        let f64_at = |at: usize| f64::from_be_bytes(bytes[at..at + 8].try_into().unwrap());
        let mut out = Vec::new();
        for _ in 0..count {
            let (start, end) = (f64_at(at), f64_at(at + 8));
            let canvas = (u16_at(at + 16), u16_at(at + 18));
            let (forced, objects, colours) = (bytes[at + 20] != 0, bytes[at + 21] as usize, u16_at(at + 22) as usize);
            at += 24;
            let palette = (0..colours).map(|k| bytes[at + k * 4..at + k * 4 + 4].try_into().unwrap()).collect();
            at += colours * 4;
            let mut list = Vec::new();
            for _ in 0..objects {
                let (x, y, w, h) = (u16_at(at), u16_at(at + 2), u16_at(at + 4), u16_at(at + 6));
                at += 8;
                let size = w as usize * h as usize;
                list.push((x, y, w, h, bytes[at..at + size].to_vec()));
                at += size;
            }
            out.push(Read { start, end, canvas, forced, objects: list, palette });
        }
        assert_eq!(at, bytes.len(), "every byte accounted for");
        out
    }

    const PGS: u64 = 2;
    const VOB: u64 = 3;

    fn subtitle_file() -> Vec<u8> {
        let tracks = el(0x1654AE6B, &[video_entry(), subtitle_entry(PGS, "S_HDMV/PGS", &[]), subtitle_entry(VOB, "S_VOBSUB", IDX.as_bytes())].concat());
        let body = [
            simple_block(1, 0, true, &[1, 2, 3]),
            timed_block(PGS as u8, 1000, 1500, &show_set()),
            timed_block(VOB as u8, 2000, 1000, &vob_packet()),
            // The clear is a packet of its own, as discs write it.
            simple_block(PGS as u8, 2500, true, &clear_set()),
            timed_block(PGS as u8, 4000, 1000, &show_set()),
        ]
        .concat();
        file(&[tracks], &body, &[], false)
    }

    fn streamed(bytes: &[u8]) -> Core {
        let mut core = open(bytes);
        core.select(1, 0);
        let first = core.reader.header.first_cluster.unwrap();
        stream(&mut core, bytes, first, 40);
        core
    }

    #[test]
    fn picture_tracks_are_listed_as_pictures() {
        let core = open(&subtitle_file());
        let json = core.header_json();
        assert!(json.contains("\"codecId\":\"S_HDMV/PGS\",\"codec\":\"\",\"supported\":true"), "{json}");
        assert_eq!(json.matches("\"subtitleKind\":\"image\"").count(), 2, "{json}");
        let mut dvb = crate::matroska::Track::new();
        dvb.codec_id = "S_DVBSUB".into();
        dvb.kind = crate::matroska::SUBTITLE;
        assert_eq!(crate::codecs::codec_of(&dvb), (crate::codecs::Codec::Unsupported, "DVB subtitles"));
    }

    #[test]
    fn choosing_a_picture_track_after_it_streamed_decodes_what_was_read() {
        let bytes = subtitle_file();
        let mut core = streamed(&bytes);
        assert!(core.take_picture_cues().is_none(), "nothing is decoded until a track is chosen");
        core.select_picture(PGS as u32);
        let cues = read_cues(&core.take_picture_cues().unwrap());
        assert_eq!(cues.len(), 3, "two displays and the clear between them: {cues:?}");
        let (first, clear, second) = (&cues[0], &cues[1], &cues[2]);
        assert_eq!((first.start, first.end), (1.0, 2.5), "the block's duration ends it");
        assert_eq!(first.canvas, (1920, 1080));
        assert_eq!(first.objects[0].4, vec![1, 1, 1, 1, 1, 0, 0, 1]);
        assert_eq!(first.palette[1], [255, 255, 255, 255]);
        assert!(!first.forced);
        assert!(clear.objects.is_empty());
        assert_eq!(clear.start, 2.5);
        assert_eq!(second.start, 4.0);
        // The other track is untouched, and nothing is handed over twice.
        assert!(core.take_picture_cues().is_none());
    }

    #[test]
    fn choosing_before_streaming_decodes_as_packets_arrive() {
        let bytes = subtitle_file();
        let mut core = open(&bytes);
        core.select(1, 0);
        core.select_picture(VOB as u32);
        let first = core.reader.header.first_cluster.unwrap();
        stream(&mut core, &bytes, first, 4096);
        let cues = read_cues(&core.take_picture_cues().unwrap());
        assert_eq!(cues.len(), 1);
        let cue = &cues[0];
        assert_eq!(cue.canvas, (720, 576), "the .idx header's size");
        assert_eq!(cue.start, 2.0);
        assert!((cue.end - (2.0 + 176.0 * 1024.0 / 90_000.0)).abs() < 0.001, "the packet's own stop beats the block's duration: {}", cue.end);
        assert_eq!(cue.objects[0].4, vec![1, 1, 1, 1, 2, 2, 2, 2]);
        assert_eq!(cue.palette[2], [255, 0, 0, 255]);
    }

    #[test]
    fn reading_a_stretch_again_adds_nothing_and_switching_tracks_starts_over() {
        let bytes = subtitle_file();
        let mut core = streamed(&bytes);
        core.select_picture(PGS as u32);
        core.take_picture_cues().unwrap();
        // A seek back to the start reads the same packets again: the store keeps one of each, but the selected track
        // is decoded again, because the page may have let go of those cues.
        let kept = core.pictures_bytes();
        assert!(kept > 0);
        let first = core.reader.header.first_cluster.unwrap();
        core.reset(first, true);
        stream(&mut core, &bytes, first, 4096);
        assert_eq!(core.pictures_bytes(), kept, "one of each");
        assert_eq!(read_cues(&core.take_picture_cues().unwrap()).len(), 3);
        // Choosing another track, then none.
        core.select_picture(VOB as u32);
        assert_eq!(read_cues(&core.take_picture_cues().unwrap()).len(), 1);
        core.select_picture(0);
        assert!(core.take_picture_cues().is_none());
        core.select_picture(1);
        assert!(core.take_picture_cues().is_none(), "a picture track only");
    }

    #[test]
    fn picture_cues_carry_the_timeline_delay() {
        let bytes = subtitle_file();
        let mut core = open(&bytes);
        core.select(1, 0);
        core.select_picture(PGS as u32);
        let first = core.reader.header.first_cluster.unwrap();
        stream(&mut core, &bytes, first, 4096);
        let delay = core.delay_seconds();
        let cues = read_cues(&core.take_picture_cues().unwrap());
        assert!((cues[0].start - (1.0 + delay)).abs() < 1e-9);
    }

    #[test]
    fn the_sample_files_pgs_track_decodes() {
        let bytes = sample();
        let mut core = open(&bytes);
        let pgs = track_id(&core, "S_HDMV/PGS");
        let video = track_id(&core, "V_MPEG4/ISO/AVC");
        core.select(video, 0);
        core.select_picture(pgs);
        let first = core.reader.header.first_cluster.unwrap();
        stream(&mut core, &bytes, first, 64 * 1024);
        let delay = core.delay_seconds();
        let cues = read_cues(&core.take_picture_cues().unwrap());
        // ffprobe -show_packets on the PGS track: display sets at 0.4, 6.0 (a clear), 6.3 and 11.6 (a clear).
        let times: Vec<f64> = cues.iter().map(|c| ((c.start - delay) * 1000.0).round() / 1000.0).collect();
        assert_eq!(times, vec![0.4, 6.0, 6.3, 11.6], "{cues:?}");
        let shown: Vec<bool> = cues.iter().map(|c| !c.objects.is_empty()).collect();
        assert_eq!(shown, vec![true, false, true, false]);
        for cue in cues.iter().filter(|c| !c.objects.is_empty()) {
            assert_eq!(cue.canvas, (1280, 720));
            let (x, y, w, h, indices) = &cue.objects[0];
            assert!(*w > 50 && *h > 10 && (*x as u32 + *w as u32) <= 1280 && (*y as u32 + *h as u32) <= 720, "{x},{y} {w}x{h}");
            assert_eq!(indices.len(), *w as usize * *h as usize);
            assert!(indices.iter().any(|&i| cue.palette[i as usize][3] > 0), "something is drawn");
        }
    }

    #[test]
    fn many_picture_packets_stay_within_the_store() {
        // Hundreds of 100 KB packets for a track nobody chose: the store keeps under its limit and nothing panics.
        let tracks = el(0x1654AE6B, &[video_entry(), subtitle_entry(PGS, "S_HDMV/PGS", &[])].concat());
        let packet = vec![0x80u8; 100 * 1024];
        let body: Vec<u8> = (0..400i16).flat_map(|k| timed_block(PGS as u8, k * 50, 100, &packet)).collect();
        let bytes = file(&[tracks], &[simple_block(1, 0, true, &[1]), body].concat(), &[], false);
        let core = streamed(&bytes);
        assert!(core.pictures_bytes() <= 16 * 1024 * 1024);
        assert!(core.pictures_bytes() > 8 * 1024 * 1024);
    }
}
