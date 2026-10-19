//! The incremental remuxer: bytes go in as they arrive from the network, fragmented MP4 comes
//! out. Ported from FlowKit's MatroskaRemuxer.swift, reshaped for MSE: instead of HLS segments
//! planned from the Cues, clusters are parsed as they stream in and each track's samples leave as
//! soon as their decode times are certain.
//!
//! Timeline: B-frames make presentation run ahead of decode order, and MP4 decode times can't be
//! negative, so every track's presentation time is shifted by a small `delay` (as FlowKit does).
//! Media time (what `<video>.currentTime` reports) is file time plus that delay, everywhere: in
//! fragments, subtitle cues and seek targets.

use std::collections::VecDeque;

use crate::codecs::{self, Codec, Output, TextFormat};
use crate::ebml::{self, id};
use crate::matroska::{self, Block, Decoding, HeaderReader, Need, AUDIO, MAX_TIME, SUBTITLE, VIDEO};
use crate::mp4;
use crate::subtitle;

/// Frames held back before their decode times are assigned: B-frame reordering never reaches further.
const LOOKAHEAD: usize = 16;
/// Frames per fragment once playing; the first fragment after a seek is smaller, for a quick start.
const CHUNK: usize = 48;
const FIRST_CHUNK: usize = 4;
/// A single element bigger than this is corruption: resynchronise instead of buffering it.
const MAX_ELEMENT: u64 = 64 * 1024 * 1024;

pub const KIND_VIDEO: u8 = 0;
pub const KIND_AUDIO: u8 = 1;
/// Undecoded audio payloads for the worker to convert (see `Core::select`), not an MP4 fragment.
pub const KIND_RAW: u8 = 2;

pub struct Fragment {
    pub kind: u8,
    /// A moof+mdat, or for `KIND_RAW` the payloads back to back.
    pub data: Vec<u8>,
    /// Media time, seconds.
    pub start: f64,
    pub end: f64,
    /// Starts on a keyframe, so everything before this fragment can be removed without touching it.
    pub key: bool,
    /// `KIND_RAW` only: each payload's length and media time (seconds).
    pub sizes: Vec<u32>,
    pub times: Vec<f64>,
}

struct VideoFrame {
    /// Presentation time (file time, snapped to the frame grid), ns.
    pts: i64,
    data: Vec<u8>,
    key: bool,
}

struct AudioFrame {
    time: i64,
    data: Vec<u8>,
}

#[derive(Clone, Copy)]
struct ClusterState {
    time: i64,
    /// Absolute end, when the cluster's size is known.
    end: Option<u64>,
}

struct Selected {
    track: u32,
    codec: Codec,
    output: Option<Output>,
    /// The frames leave undecoded as `KIND_RAW`, because the browser can't play the codec.
    raw: bool,
}

pub struct TextCue {
    pub track: u32,
    pub start: i64,
    pub end: i64,
    pub text: String,
}

pub struct Core {
    pub reader: HeaderReader,
    codecs: Vec<(u32, Codec)>,
    first_frames: Vec<(u32, Vec<u8>)>,

    buf: Vec<u8>,
    /// Absolute offset of `buf[0]`.
    buf_start: u64,
    /// Bytes before this absolute offset are skipped (an element Flow doesn't need).
    skip_to: u64,
    cluster: Option<ClusterState>,
    resync: bool,

    video: Option<Selected>,
    audio: Option<Selected>,
    default_duration: Option<i64>,

    delay: i64,
    delay_known: bool,

    gop: Vec<VideoFrame>,
    gop_emitted: usize,
    waiting_for_key: bool,
    video_fragments: u32,
    /// Video fragments ending before this media time are dropped (the picture is already buffered).
    video_floor: f64,

    audio_pending: Vec<AudioFrame>,
    audio_next: Option<i64>,
    /// Frames of a raw audio track waiting to leave, with their file times.
    raw_pending: Vec<AudioFrame>,

    fragments: VecDeque<Fragment>,
    sequence: u32,
    cues: Vec<TextCue>,
}

impl Core {
    pub fn new(length: Option<u64>) -> Core {
        Core {
            reader: HeaderReader::new(length),
            codecs: Vec::new(),
            first_frames: Vec::new(),
            buf: Vec::new(),
            buf_start: 0,
            skip_to: 0,
            cluster: None,
            resync: false,
            video: None,
            audio: None,
            default_duration: None,
            delay: 0,
            delay_known: false,
            gop: Vec::new(),
            gop_emitted: 0,
            waiting_for_key: true,
            video_fragments: 0,
            video_floor: 0.0,
            audio_pending: Vec::new(),
            audio_next: None,
            raw_pending: Vec::new(),
            fragments: VecDeque::new(),
            sequence: 0,
            cues: Vec::new(),
        }
    }

    // MARK: Header

    pub fn header_need(&mut self) -> Option<(u64, u64)> {
        match self.reader.need() {
            Need::Bytes(o, l) => Some((o, l)),
            Need::Nothing => {
                if self.reader.is_ready() && self.codecs.is_empty() {
                    self.codecs = self.reader.header.tracks.iter().map(|t| (t.number, codecs::codec_of(t).0)).collect();
                    let start = self.reader.header.first_cluster.unwrap_or(0);
                    self.reset(start, true);
                }
                None
            }
        }
    }

    fn codec(&self, track: u32) -> Codec {
        self.codecs.iter().find(|(n, _)| *n == track).map_or(Codec::Unsupported, |c| c.1)
    }

    /// Tracks and timing, as JSON for the worker.
    pub fn header_json(&self) -> String {
        let h = &self.reader.header;
        let mut j = Json::default();
        j.raw("{\"duration\":");
        match h.duration {
            Some(d) => j.num(d as f64 / 1e9),
            None => j.raw("null"),
        }
        j.raw(",\"title\":");
        j.opt_str(h.title.as_deref());
        j.raw(",\"tracks\":[");
        for (i, t) in h.tracks.iter().enumerate() {
            if i > 0 {
                j.raw(",");
            }
            let (codec, reason) = codecs::codec_of(t);
            let kind = match t.kind {
                VIDEO => "video",
                AUDIO => "audio",
                SUBTITLE => "subtitle",
                _ => "other",
            };
            j.raw("{\"id\":");
            j.num(t.number as f64);
            j.field_str("type", kind);
            j.field_str("codecId", &t.codec_id);
            j.field_str("codec", &codecs::header_codec_string(t, codec));
            j.field_bool("supported", codec != Codec::Unsupported && t.enabled);
            j.field_str("reason", if t.enabled { reason } else { "Disabled track" });
            j.field_str("language", &t.language);
            j.raw(",\"name\":");
            j.opt_str(t.name.as_deref());
            j.field_bool("default", t.default);
            j.field_bool("forced", t.forced);
            j.field_bool("commentary", t.is_commentary());
            j.field_bool("hearingImpaired", t.hearing_impaired);
            match t.kind {
                VIDEO => {
                    j.field_num("width", t.width as f64);
                    j.field_num("height", t.height as f64);
                    if let Some(d) = t.default_duration.filter(|&d| d > 0) {
                        j.field_num("frameRate", (1e12 / d as f64).round() / 1000.0);
                    }
                    j.field_str("range", dynamic_range(t));
                }
                AUDIO => {
                    j.field_num("channels", t.channels as f64);
                    j.field_num("sampleRate", t.sample_rate);
                    j.field_str("decode", codecs::decode_of(t));
                }
                SUBTITLE => j.field_str("subtitleKind", if matches!(codec, Codec::Text(_)) { "text" } else { "image" }),
                _ => {}
            }
            j.raw("}");
        }
        j.raw("]}");
        j.0
    }

    // MARK: Seek index

    pub fn cues_need(&self) -> Option<(u64, u64)> {
        self.reader.cues_need()
    }

    pub fn cues_feed(&mut self, offset: u64, bytes: &[u8]) -> Option<(u64, u64)> {
        self.reader.feed_cues(offset, bytes)
    }

    /// Where to start reading for `seconds` of media time: the cluster holding the nearest keyframe at
    /// or before it, that keyframe's media time, and whether the offset is a cluster's exact start.
    /// Without Cues, the position is estimated from the bitrate and the parser finds the next cluster.
    pub fn seek_target(&self, seconds: f64) -> (u64, f64, bool) {
        let h = &self.reader.header;
        let first = h.first_cluster.unwrap_or(h.segment_data_start);
        let target = ((seconds.max(0.0) * 1e9) as i64 - self.delay).clamp(0, MAX_TIME);
        let anchor = self.video.as_ref().or(self.audio.as_ref()).map(|s| s.track);
        let mut cues: Vec<&matroska::Cue> = h.cues.iter().filter(|c| Some(c.track) == anchor).collect();
        if cues.is_empty() {
            cues = h.cues.iter().collect();
        }
        if let Some(cue) = cues.iter().rev().find(|c| c.time <= target).or(cues.first()) {
            let offset = h.segment_data_start + cue.cluster_position;
            return (offset.max(first), (cue.time + self.delay) as f64 / 1e9, true);
        }
        match (h.duration, h.segment_end) {
            (Some(d), Some(end)) if d > 0 && end > first && target > 0 => {
                // A little early, so the keyframe before the target is likely inside what's read.
                let fraction = ((target as f64 - 5e9) / d as f64).clamp(0.0, 1.0);
                (first + ((end - first) as f64 * fraction) as u64, seconds, fraction == 0.0)
            }
            _ => (first, self.delay as f64 / 1e9, true),
        }
    }

    // MARK: Streaming

    /// Chooses the video and audio tracks to remux (0 for none).
    pub fn select(&mut self, video: u32, audio: u32) {
        self.select_with(video, audio, false);
    }

    /// `select`, and with `raw` an audio track the browser can't play but the worker can decode
    /// (`decode_of`) is selectable too: its frames then leave as `KIND_RAW` payloads, not muxed.
    pub fn select_with(&mut self, video: u32, audio: u32, raw: bool) {
        let pick = |core: &Core, track: u32, kind: u8, raw: bool| -> Option<Selected> {
            let t = core.reader.header.track(track).filter(|t| t.kind == kind)?;
            let codec = core.codec(track);
            if raw && kind == AUDIO && !codecs::decode_of(t).is_empty() {
                return Some(Selected { track: t.number, codec, output: None, raw: true });
            }
            if codec == Codec::Unsupported {
                return None;
            }
            Some(Selected { track: t.number, codec, output: None, raw: false })
        };
        let changed_video = self.video.as_ref().map(|s| s.track) != Some(video).filter(|&v| v != 0);
        if changed_video {
            self.video = pick(self, video, VIDEO, false);
            self.default_duration = self.video.as_ref().and_then(|v| self.reader.header.track(v.track)?.default_duration).filter(|&d| d > 0);
        }
        let wanted = pick(self, audio, AUDIO, raw);
        // Changing the track, or only whether it's raw, starts the audio over.
        if self.audio.as_ref().map(|s| (s.track, s.raw)) != wanted.as_ref().map(|s| (s.track, s.raw)) || self.audio.is_none() {
            self.audio = wanted;
            self.audio_pending.clear();
            self.audio_next = None;
            self.raw_pending.clear();
        }
        if self.video.is_none() {
            self.delay_known = true;
        }
    }

    /// Starts reading again at an absolute offset (after a seek or an audio switch). `aligned` is
    /// false when the offset is a guess, and the parser looks for the next cluster.
    pub fn reset(&mut self, offset: u64, aligned: bool) {
        self.buf.clear();
        self.buf_start = offset;
        self.skip_to = 0;
        self.cluster = None;
        self.resync = !aligned;
        self.gop.clear();
        self.gop_emitted = 0;
        self.waiting_for_key = true;
        self.video_fragments = 0;
        self.video_floor = 0.0;
        self.audio_pending.clear();
        self.audio_next = None;
        self.raw_pending.clear();
        self.fragments.clear();
    }

    pub fn set_video_floor(&mut self, seconds: f64) {
        self.video_floor = seconds;
    }

    /// The absolute offset just past the bytes pushed so far.
    pub fn position(&self) -> u64 {
        self.buf_start + self.buf.len() as u64
    }

    pub fn push(&mut self, mut bytes: &[u8]) {
        let end = self.position();
        if self.skip_to > end {
            let n = ((self.skip_to - end) as usize).min(bytes.len());
            bytes = &bytes[n..];
            self.buf_start += n as u64;
        }
        self.buf.extend_from_slice(bytes);
        let consumed = self.parse();
        self.buf.drain(..consumed);
        self.buf_start += consumed as u64;
    }

    /// The end of the file: whatever is held back goes out.
    pub fn finish(&mut self) {
        if !self.gop.is_empty() {
            self.flush_video(None);
        }
        self.delay_known = true;
        self.flush_audio();
    }

    /// Parses as much of `buf` as is complete; returns how many bytes are done with.
    fn parse(&mut self) -> usize {
        let mut pos = 0;
        loop {
            if self.resync {
                match find_cluster(&self.buf, pos) {
                    Some(found) => {
                        pos = found;
                        self.resync = false;
                        self.cluster = None;
                    }
                    None => return self.buf.len().saturating_sub(3).max(pos),
                }
            }
            let abs = self.buf_start + pos as u64;
            if let Some(ClusterState { end: Some(end), .. }) = self.cluster {
                if abs >= end {
                    self.cluster = None;
                }
            }
            let element = match ebml::read_element(&self.buf, pos) {
                Ok(e) => e,
                Err(ebml::Error::Truncated) => return pos,
                Err(_) => {
                    self.resync = true;
                    pos += 1;
                    continue;
                }
            };
            let Some(size) = element.size else {
                if element.id == id::CLUSTER {
                    self.cluster = Some(ClusterState { time: 0, end: None });
                    pos = element.data_start;
                    continue;
                }
                if self.cluster.is_some_and(|c| c.end.is_none()) && id::is_top_level(element.id) {
                    self.cluster = None;
                    continue;
                }
                self.resync = true;
                pos += 1;
                continue;
            };
            let data_abs = self.buf_start + element.data_start as u64;
            let end_abs = data_abs + size;
            match self.cluster {
                None => {
                    if element.id == id::CLUSTER {
                        self.cluster = Some(ClusterState { time: 0, end: Some(end_abs) });
                        pos = element.data_start;
                        continue;
                    }
                    // Anything else between clusters (Cues, Tags, Void): skip it.
                }
                Some(cluster) => {
                    if cluster.end.is_none() && id::is_top_level(element.id) {
                        self.cluster = None;
                        continue;
                    }
                    if matches!(element.id, id::TIMECODE | id::SIMPLE_BLOCK | id::BLOCK_GROUP) {
                        if size > MAX_ELEMENT {
                            self.resync = true;
                            pos += 1;
                            continue;
                        }
                        let Some(end) = element.end_within(self.buf.len()) else { return pos };
                        let start = element.data_start;
                        match element.id {
                            id::TIMECODE => {
                                let time = ebml::uint(&self.buf, &element) as i64;
                                self.cluster = Some(ClusterState { time, end: cluster.end });
                            }
                            id::SIMPLE_BLOCK => {
                                if let Some(block) = self.block(start, end, cluster.time, true) {
                                    self.handle(block);
                                }
                            }
                            _ => self.block_group(start, end, cluster.time),
                        }
                        pos = end;
                        continue;
                    }
                }
            }
            // Skip the element, even when it runs past what's buffered.
            match element.end_within(self.buf.len()) {
                Some(end) => pos = end,
                None => {
                    self.skip_to = end_abs;
                    return self.buf.len();
                }
            }
        }
    }

    fn decoding(&self, track: u32) -> Option<Decoding<'_>> {
        let selected = self.video.as_ref().is_some_and(|s| s.track == track) || self.audio.as_ref().is_some_and(|s| s.track == track);
        let codec = self.codec(track);
        let wanted = selected
            || matches!(codec, Codec::Text(_))
            || (codecs::needs_first_frame(codec) && !self.first_frames.iter().any(|(n, _)| *n == track));
        if !wanted {
            return None;
        }
        let t = self.reader.header.track(track)?;
        Some(Decoding { stripped: &t.stripped_header, zlib: t.zlib })
    }

    fn block(&self, start: usize, end: usize, cluster_time: i64, simple: bool) -> Option<Block> {
        let scale = self.reader.header.timecode_scale;
        matroska::parse_block(&self.buf[start..end], cluster_time, scale, simple, |t| self.decoding(t))
    }

    fn block_group(&mut self, start: usize, end: usize, cluster_time: i64) {
        let Ok(children) = ebml::children_in(&self.buf, start, end) else { return };
        let mut block = None;
        let mut duration = None;
        let mut reference = false;
        let scale = self.reader.header.timecode_scale;
        for child in children {
            match child.id {
                id::BLOCK => {
                    if let Some(e) = child.end_within(self.buf.len()) {
                        block = self.block(child.data_start, e, cluster_time, false);
                    }
                }
                id::BLOCK_DURATION => duration = Some((ebml::uint(&self.buf, &child) as i64).saturating_mul(scale).min(MAX_TIME)),
                id::REFERENCE_BLOCK => reference = true,
                _ => {}
            }
        }
        if let Some(mut block) = block {
            block.duration = duration;
            block.keyframe = !reference;
            self.handle(block);
        }
    }

    fn handle(&mut self, block: Block) {
        let track = block.track;
        let codec = self.codec(track);
        if codecs::needs_first_frame(codec) && !self.first_frames.iter().any(|(n, _)| *n == track) {
            if let Some(frame) = block.frames.first() {
                self.first_frames.push((track, frame.clone()));
            }
        }
        if let Codec::Text(format) = codec {
            self.text(block, format);
        } else if self.video.as_ref().is_some_and(|s| s.track == track) {
            self.video_block(block);
        } else if self.audio.as_ref().is_some_and(|s| s.track == track) {
            self.audio_block(block);
        }
    }

    fn text(&mut self, block: Block, format: TextFormat) {
        for frame in &block.frames {
            let text = subtitle::plain_text(frame, format);
            if !text.is_empty() {
                let end = block.time + block.duration.filter(|&d| d > 0).unwrap_or(3_000_000_000);
                self.cues.push(TextCue { track: block.track, start: block.time, end, text });
            }
        }
    }

    // MARK: Video

    fn snap(&self, t: i64) -> i64 {
        match self.default_duration {
            Some(frame) => ((t as f64 / frame as f64).round() as i64).saturating_mul(frame),
            None => t,
        }
    }

    fn video_block(&mut self, block: Block) {
        if self.waiting_for_key {
            // After a seek the decoder needs a keyframe before anything else.
            if !block.keyframe {
                return;
            }
            self.waiting_for_key = false;
        }
        let pts = self.snap(block.time.max(0));
        if block.keyframe && !self.gop.is_empty() {
            self.flush_video(Some(pts));
        }
        let data = if block.frames.len() == 1 { block.frames.into_iter().next().unwrap_or_default() } else { block.frames.concat() };
        self.gop.push(VideoFrame { pts, data, key: block.keyframe });

        if !self.delay_known {
            if self.gop.len() < LOOKAHEAD + FIRST_CHUNK {
                return;
            }
            self.learn_delay();
        }
        let chunk = if self.video_fragments == 0 { FIRST_CHUNK } else { CHUNK };
        if self.gop.len() - self.gop_emitted >= LOOKAHEAD + chunk {
            self.emit_video(self.gop.len() - LOOKAHEAD, None);
        }
    }

    /// How far presentation runs ahead of decode order in the opening frames, with headroom.
    fn learn_delay(&mut self) {
        let pts: Vec<i64> = self.gop.iter().map(|f| f.pts).collect();
        self.delay = reorder_delay(&pts, self.default_duration);
        self.delay_known = true;
    }

    /// Sends the rest of the GOP. `next_key` is the next keyframe's presentation time, which ends the
    /// GOP's last frame; at the end of the file the frame rate does.
    fn flush_video(&mut self, next_key: Option<i64>) {
        if !self.delay_known {
            self.learn_delay();
        }
        self.emit_video(self.gop.len(), next_key);
        self.gop.clear();
        self.gop_emitted = 0;
    }

    /// Sends frames `gop_emitted..until` as one fragment. Decode times are the GOP's presentation
    /// times in order: the k-th frame decoded takes the k-th earliest picture time.
    fn emit_video(&mut self, until: usize, next_key: Option<i64>) {
        let from = self.gop_emitted;
        if until <= from {
            return;
        }
        let mut sorted: Vec<i64> = self.gop.iter().map(|f| f.pts).collect();
        sorted.sort_unstable();
        let ticks = |ns: i64| (ns.saturating_mul(9) + 50_000).div_euclid(100_000);
        let fallback = self.default_duration.map_or(3750, ticks).max(1);
        let delay = self.delay;
        let mut samples = Vec::with_capacity(until - from);
        let mut size = 0;
        let (mut start, mut end) = (i64::MAX, i64::MIN);
        for i in from..until {
            let frame = &self.gop[i];
            let dts = ticks(sorted[i]);
            let next = match (sorted.get(i + 1), next_key) {
                (Some(&t), _) => ticks(t),
                // A keyframe far from the frame grid (a gap in the stream) doesn't stretch the last frame.
                (None, Some(t)) if ticks(t) > dts && ticks(t) - dts <= fallback * 4 => ticks(t),
                _ => dts + fallback,
            };
            let duration = (next - dts).max(1);
            let pts = ticks(frame.pts + delay);
            samples.push(mp4::Sample {
                size: frame.data.len() as u32,
                duration: duration.min(u32::MAX as i64) as u32,
                composition_offset: (pts - dts).clamp(0, i32::MAX as i64) as i32,
                sync: frame.key,
            });
            size += frame.data.len();
            start = start.min(pts);
            end = end.max(pts + duration);
        }
        let mut payload = Vec::with_capacity(size);
        for frame in &mut self.gop[from..until] {
            payload.append(&mut frame.data);
        }
        self.gop_emitted = until;
        let (start, end) = (start as f64 / 90_000.0, end as f64 / 90_000.0);
        if end > self.video_floor {
            self.sequence += 1;
            let base = ticks(sorted[from]).max(0) as u64;
            let data = mp4::fragment(self.sequence, base, &samples, &payload, true);
            self.fragments.push_back(Fragment { kind: KIND_VIDEO, data, start, end, key: samples[0].sync, sizes: Vec::new(), times: Vec::new() });
            self.video_fragments += 1;
        }
        self.flush_audio();
    }

    // MARK: Audio

    /// Queues a raw track's frames as they are, one payload per frame (Matroska lacing undone, header
    /// stripping already restored by the block parser). A laced block has one timestamp, so its frames
    /// are spaced by the track's frame duration, else by the block's duration shared out, else they
    /// share the block's time. The decoder's own parser finds frame boundaries inside each payload.
    fn raw_block(&mut self, block: Block) {
        let count = block.frames.len().max(1) as i64;
        let spacing = match self.audio.as_ref().and_then(|a| self.reader.header.track(a.track)).and_then(|t| t.default_duration) {
            Some(d) if d > 0 => d,
            _ => block.duration.filter(|&d| d > 0).map_or(0, |d| d / count),
        };
        for (i, data) in block.frames.into_iter().enumerate() {
            self.raw_pending.push(AudioFrame { time: block.time + spacing * i as i64, data });
        }
        // Without a picture, payloads leave about once a second, like audio.
        if self.video.is_none() {
            if let (Some(first), Some(last)) = (self.raw_pending.first(), self.raw_pending.last()) {
                if last.time - first.time >= 1_000_000_000 {
                    self.flush_raw();
                }
            }
        }
    }

    /// Sends the queued raw payloads as one `KIND_RAW` fragment, once the timeline's delay is known.
    fn flush_raw(&mut self) {
        if self.raw_pending.is_empty() || !self.delay_known {
            return;
        }
        let delay = self.delay;
        let seconds = |t: i64| (t.max(0) + delay) as f64 / 1e9;
        let times: Vec<f64> = self.raw_pending.iter().map(|f| seconds(f.time)).collect();
        let sizes: Vec<u32> = self.raw_pending.iter().map(|f| f.data.len().min(u32::MAX as usize) as u32).collect();
        let mut data = Vec::with_capacity(sizes.iter().map(|&s| s as usize).sum());
        for frame in &mut self.raw_pending {
            data.append(&mut frame.data);
        }
        self.raw_pending.clear();
        let (start, end) = (times[0], times[times.len() - 1]);
        self.fragments.push_back(Fragment { kind: KIND_RAW, data, start, end, key: true, sizes, times });
    }

    fn audio_block(&mut self, block: Block) {
        if self.audio.as_ref().is_some_and(|a| a.raw) {
            return self.raw_block(block);
        }
        let is_ac3 = self.audio.as_ref().is_some_and(|a| a.codec == Codec::Ac3);
        for frame in block.frames {
            if is_ac3 {
                for f in codecs::ac3::frames(&frame) {
                    self.audio_pending.push(AudioFrame { time: block.time, data: f.to_vec() });
                }
            } else {
                self.audio_pending.push(AudioFrame { time: block.time, data: frame });
            }
        }
        // Without a picture, audio leaves about once a second.
        if self.video.is_none() {
            if let (Some(first), Some(last)) = (self.audio_pending.first(), self.audio_pending.last()) {
                if last.time - first.time >= 1_000_000_000 {
                    self.flush_audio();
                }
            }
        }
    }

    fn flush_audio(&mut self) {
        self.flush_raw();
        if self.audio_pending.is_empty() || !self.delay_known {
            return;
        }
        let Some(selected) = self.audio.as_mut() else { return };
        if selected.output.is_none() {
            let track = self.reader.header.track(selected.track);
            let first = self.first_frames.iter().find(|(n, _)| *n == selected.track).map(|(_, f)| f.as_slice());
            selected.output = track.and_then(|t| codecs::output(t, first.or(self.audio_pending.first().map(|f| f.data.as_slice()))));
        }
        let Some(output) = selected.output.as_ref() else {
            self.audio_pending.clear();
            return;
        };
        let rate = output.timescale as i64;
        let mut samples = Vec::with_capacity(self.audio_pending.len());
        let mut size = 0;
        let mut total = 0i64;
        for frame in &self.audio_pending {
            let duration = match output.codec {
                Codec::Eac3 => codecs::eac3::samples(&frame.data),
                Codec::Flac => codecs::flac_block_size(&frame.data).unwrap_or(output.frame_samples),
                Codec::Mp3 => codecs::mp3_samples_per_frame(&frame.data),
                Codec::Opus => codecs::opus_samples(&frame.data),
                _ => output.frame_samples,
            };
            samples.push(mp4::Sample { size: frame.data.len() as u32, duration, composition_offset: 0, sync: true });
            size += frame.data.len();
            total += duration as i64;
        }
        let first_time = self.audio_pending[0].time.max(0);
        let computed = (first_time + self.delay).saturating_mul(rate) / 1_000_000_000;
        // Consecutive fragments join exactly: Matroska's millisecond timestamps would otherwise leave
        // tiny gaps and overlaps that the browser splices audibly.
        let base = match self.audio_next {
            Some(next) if (computed - next).abs() <= rate / 10 => next,
            _ => computed,
        };
        let mut payload = Vec::with_capacity(size);
        for frame in &mut self.audio_pending {
            payload.append(&mut frame.data);
        }
        self.audio_pending.clear();
        self.audio_next = Some(base + total);
        self.sequence += 1;
        let data = mp4::fragment(self.sequence, base.max(0) as u64, &samples, &payload, false);
        self.fragments.push_back(Fragment { kind: KIND_AUDIO, data, start: base as f64 / rate as f64, end: (base + total) as f64 / rate as f64, key: true, sizes: Vec::new(), times: Vec::new() });
    }

    // MARK: Output

    pub fn next_fragment(&mut self) -> Option<Fragment> {
        self.fragments.pop_front()
    }

    /// The init segment for a track and its final codec string. None until the frame it needs
    /// (AC-3, E-AC-3, VP9) has been read.
    pub fn init_segment(&self, track: u32) -> Option<(Vec<u8>, String)> {
        // A raw track is decoded by the worker, so it has nothing to initialise.
        if self.audio.as_ref().is_some_and(|a| a.raw && a.track == track) {
            return None;
        }
        let t = self.reader.header.track(track)?;
        let first = self.first_frames.iter().find(|(n, _)| *n == track).map(|(_, f)| f.as_slice());
        let out = codecs::output(t, first)?;
        let video = t.kind == VIDEO;
        let (mut width, mut height) = (t.width, t.height);
        if let (Some(dw), Some(dh)) = (t.display_width, t.display_height) {
            if dw > 0 && dh > 0 {
                width = (t.height as u64 * dw as u64 / dh as u64).min(u32::MAX as u64) as u32;
                height = t.height;
            }
        }
        let info = mp4::TrackInfo { video, timescale: out.timescale, language: &t.language, width, height, sample_entry: &out.sample_entry };
        Some((mp4::init_segment(&info), out.codec_string))
    }

    pub fn delay_seconds(&self) -> f64 {
        self.delay as f64 / 1e9
    }

    pub fn timing_known(&self) -> bool {
        self.delay_known
    }

    /// Subtitle cues read so far, as JSON, once the timeline is settled.
    pub fn take_cues(&mut self) -> Option<String> {
        if self.cues.is_empty() || !self.delay_known {
            return None;
        }
        let mut j = Json::default();
        j.raw("[");
        for (i, cue) in self.cues.drain(..).enumerate() {
            if i > 0 {
                j.raw(",");
            }
            j.raw("{\"track\":");
            j.num(cue.track as f64);
            j.field_num("start", (cue.start + self.delay) as f64 / 1e9);
            j.field_num("end", (cue.end + self.delay) as f64 / 1e9);
            j.field_str("text", &cue.text);
            j.raw("}");
        }
        j.raw("]");
        Some(j.0)
    }
}

pub fn reorder_delay(pts: &[i64], frame: Option<i64>) -> i64 {
    let mut sorted = pts.to_vec();
    sorted.sort_unstable();
    let reorder = sorted.iter().zip(pts).map(|(s, p)| s - p).max().unwrap_or(0);
    if reorder <= 0 {
        return 0;
    }
    (reorder * 2).max(frame.unwrap_or(41_708_333) * 3).min(1_000_000_000)
}

fn dynamic_range(t: &matroska::Track) -> &'static str {
    if let Some((dv, _)) = &t.dolby_vision {
        if dv.len() >= 4 {
            return "Dolby Vision";
        }
    }
    match t.colour.as_ref().and_then(|c| c.transfer) {
        Some(16) => "HDR10",
        Some(18) => "HLG",
        _ => "SDR",
    }
}

/// Finds a Cluster ID that really starts a cluster: it parses, and its first child is a Timecode
/// (or the buffer ends before that can be checked).
fn find_cluster(b: &[u8], from: usize) -> Option<usize> {
    let mut i = from;
    while i + 4 <= b.len() {
        if b[i..i + 4] == [0x1F, 0x43, 0xB6, 0x75] {
            match ebml::read_element(b, i) {
                Ok(e) => match ebml::read_element(b, e.data_start) {
                    Ok(child) if child.id == id::TIMECODE || child.id == id::CRC32 => return Some(i),
                    Err(ebml::Error::Truncated) => return Some(i),
                    _ => {}
                },
                Err(ebml::Error::Truncated) => return Some(i),
                Err(_) => {}
            }
        }
        i += 1;
    }
    None
}

/// Just enough JSON writing for the header and cues, without pulling in serde.
#[derive(Default)]
struct Json(String);

impl Json {
    fn raw(&mut self, s: &str) {
        self.0.push_str(s);
    }
    /// Microsecond precision, written with integer arithmetic: Rust's float formatting would add
    /// about 15 KB of WebAssembly.
    fn num(&mut self, v: f64) {
        if !v.is_finite() || v.abs() > 9e12 {
            self.0.push_str("null");
            return;
        }
        let micros = (v * 1e6).round() as i64;
        if micros < 0 {
            self.0.push('-');
        }
        let micros = micros.unsigned_abs();
        self.0.push_str(&(micros / 1_000_000).to_string());
        let mut fraction = micros % 1_000_000;
        if fraction > 0 {
            let mut digits = 6;
            while fraction % 10 == 0 {
                fraction /= 10;
                digits -= 1;
            }
            self.0.push('.');
            let text = fraction.to_string();
            for _ in text.len()..digits {
                self.0.push('0');
            }
            self.0.push_str(&text);
        }
    }
    fn string(&mut self, s: &str) {
        self.0.push('"');
        for c in s.chars() {
            match c {
                '"' => self.0.push_str("\\\""),
                '\\' => self.0.push_str("\\\\"),
                '\n' => self.0.push_str("\\n"),
                '\r' => self.0.push_str("\\r"),
                '\t' => self.0.push_str("\\t"),
                c if (c as u32) < 0x20 => self.0.push_str(&format!("\\u{:04x}", c as u32)),
                c => self.0.push(c),
            }
        }
        self.0.push('"');
    }
    fn opt_str(&mut self, s: Option<&str>) {
        match s {
            Some(s) => self.string(s),
            None => self.raw("null"),
        }
    }
    fn key(&mut self, k: &str) {
        self.0.push_str(",\"");
        self.0.push_str(k);
        self.0.push_str("\":");
    }
    fn field_str(&mut self, k: &str, v: &str) {
        self.key(k);
        self.string(v);
    }
    fn field_num(&mut self, k: &str, v: f64) {
        self.key(k);
        self.num(v);
    }
    fn field_bool(&mut self, k: &str, v: bool) {
        self.key(k);
        self.raw(if v { "true" } else { "false" });
    }
}
