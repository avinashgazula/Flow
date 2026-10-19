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
