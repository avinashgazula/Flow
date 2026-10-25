//! The Matroska header (tracks, timing, seek index) and block parsing, ported from FlowKit's
//! Matroska.swift. The header is read incrementally: the reader says which byte range it needs
//! next, the worker fetches it, and the reader carries on, so nothing here does I/O.

use crate::ebml::{self, id, Element};
use crate::inflate;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Colour {
    pub matrix: Option<u32>,
    pub bits_per_channel: Option<u32>,
    pub range: Option<u32>,
    pub transfer: Option<u32>,
    pub primaries: Option<u32>,
    pub max_cll: Option<u32>,
    pub max_fall: Option<u32>,
    /// Mastering display: R, G, B, white point chromaticities (x, y) and max/min luminance.
    pub mastering: Option<[f64; 10]>,
}

pub const VIDEO: u8 = 1;
pub const AUDIO: u8 = 2;
pub const SUBTITLE: u8 = 0x11;

#[derive(Clone, Debug, PartialEq)]
pub struct Track {
    pub number: u32,
    pub kind: u8,
    pub codec_id: String,
    pub codec_private: Vec<u8>,
    pub name: Option<String>,
    pub language: String,
    pub enabled: bool,
    pub default: bool,
    pub forced: bool,
    pub hearing_impaired: bool,
    pub commentary: bool,
    /// Nanoseconds per frame, when the muxer recorded it.
    pub default_duration: Option<i64>,
    /// Bytes removed from the start of every frame by "header stripping" compression.
    pub stripped_header: Vec<u8>,
    pub encrypted: bool,
    pub compressed_unsupported: bool,
    /// Frames are zlib-compressed (mkvmerge does this to subtitle tracks by default).
    pub zlib: bool,
    pub width: u32,
    pub height: u32,
    pub display_width: Option<u32>,
    pub display_height: Option<u32>,
    pub colour: Option<Colour>,
    /// Dolby Vision configuration record ("dvcC"/"dvvC" payload) and its box type.
    pub dolby_vision: Option<(Vec<u8>, [u8; 4])>,
    pub sample_rate: f64,
    pub output_sample_rate: Option<f64>,
    pub channels: u32,
    pub bit_depth: Option<u32>,
}

impl Track {
    pub fn new() -> Track {
        Track {
            number: 0,
            kind: 0,
            codec_id: String::new(),
            codec_private: Vec::new(),
            name: None,
            language: "eng".into(),
            enabled: true,
            default: true,
            forced: false,
            hearing_impaired: false,
            commentary: false,
            default_duration: None,
            stripped_header: Vec::new(),
            encrypted: false,
            compressed_unsupported: false,
            zlib: false,
            width: 0,
            height: 0,
            display_width: None,
            display_height: None,
            colour: None,
            dolby_vision: None,
            sample_rate: 0.0,
            output_sample_rate: None,
            channels: 0,
            bit_depth: None,
        }
    }

    /// A commentary track, by flag or by name: never a stand-in for the soundtrack.
    pub fn is_commentary(&self) -> bool {
        self.commentary || self.name.as_deref().is_some_and(|n| n.to_ascii_lowercase().contains("comment"))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cue {
    /// Presentation time in nanoseconds.
    pub time: i64,
    pub track: u32,
    /// Cluster offset relative to the Segment's payload.
    pub cluster_position: u64,
    /// Where the keyframe's block starts inside the cluster, from the first byte after the cluster's
    /// header, when the muxer wrote it (CueRelativePosition is optional).
    pub relative_position: Option<u64>,
}

#[derive(Clone, Debug, Default)]
pub struct Header {
    pub doc_type: String,
    /// Absolute offset of the Segment payload; cluster and seek positions are relative to it.
    pub segment_data_start: u64,
    /// Absolute end of the Segment, when known.
    pub segment_end: Option<u64>,
    pub timecode_scale: i64,
    /// Nanoseconds.
    pub duration: Option<i64>,
    pub title: Option<String>,
    pub tracks: Vec<Track>,
    pub cues: Vec<Cue>,
    /// Absolute offset of the first Cluster.
    pub first_cluster: Option<u64>,
}

impl Header {
    pub fn track(&self, number: u32) -> Option<&Track> {
        self.tracks.iter().find(|t| t.number == number)
    }
}

/// Times beyond about three years only come from corrupt files; dropping them keeps every later
/// calculation (×90 kHz, + delays) clear of overflow.
pub const MAX_TIME: i64 = 100_000_000_000_000_000;

// MARK: - Header

/// How much to ask for when probing for the next top-level element.
const PROBE: u64 = 256 * 1024;
/// Index elements bigger than this are corrupt or not worth the download.
const MAX_INDEX: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Stage {
    Start,
    TopLevel(u64),
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum CueStage {
    /// The SeekHead's entry for the Cues.
    Cues(u64),
    /// A second SeekHead, which sometimes indexes the Cues.
    SeekHead(u64),
    Done,
}

/// Reads everything before the first cluster, then the Cues wherever they live.
pub struct HeaderReader {
    pub header: Header,
    length: Option<u64>,
    window: Vec<u8>,
    window_start: u64,
    stage: Stage,
    cue_stage: CueStage,
    seek_positions: Vec<(u32, u64)>,
    last_request: Option<(u64, u64)>,
    pub error: Option<String>,
    /// The raw Cues element, kept so the worker can cache it.
    pub cues_raw: Vec<u8>,
    /// Play Dolby Vision as its HDR10 picture; set before the header is read (see `codecs::hdr10_only`).
    pub hdr10_only: bool,
}

/// What the reader needs next.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Need {
    Bytes(u64, u64),
    Nothing,
}

impl HeaderReader {
    pub fn new(length: Option<u64>) -> HeaderReader {
        HeaderReader {
            header: Header { timecode_scale: 1_000_000, ..Default::default() },
            length,
            window: Vec::new(),
            window_start: 0,
            stage: Stage::Start,
            cue_stage: CueStage::Done,
            seek_positions: Vec::new(),
            last_request: None,
            error: None,
            cues_raw: Vec::new(),
            hdr10_only: false,
        }
    }

    pub fn is_ready(&self) -> bool {
        self.stage == Stage::Ready
    }

    /// Bytes at `offset` for the header phase. They replace the previous window.
    pub fn feed(&mut self, offset: u64, bytes: &[u8]) {
        self.window_start = offset;
        self.window.clear();
        self.window.extend_from_slice(bytes);
    }

    fn fail(&mut self, message: &str) -> Need {
        self.stage = Stage::Failed;
        self.error = Some(message.into());
        Need::Nothing
    }

    /// Asks for a range, unless that same range was just fed and still wasn't enough (a short file
    /// or a server that cut the response): then the file ends early.
    fn request(&mut self, offset: u64, len: u64) -> Need {
        if self.last_request == Some((offset, len)) && self.window_start == offset {
            return self.fail("The file ends before its first cluster.");
        }
        self.last_request = Some((offset, len));
        Need::Bytes(offset, len)
    }

    fn window_end(&self) -> u64 {
        self.window_start + self.window.len() as u64
    }

    fn at_end(&self, offset: u64) -> bool {
        self.length.is_some_and(|l| offset >= l) || self.header.segment_end.is_some_and(|e| offset >= e)
    }

    /// Runs the header phase as far as the bytes in hand allow.
    pub fn need(&mut self) -> Need {
        loop {
            match self.stage {
                Stage::Ready | Stage::Failed => return Need::Nothing,
                Stage::Start => {
                    if self.window_start != 0 || self.window.is_empty() {
                        if self.window_start == 0 && self.last_request.is_some() {
                            return self.fail("This isn't a Matroska file.");
                        }
                        return self.request(0, PROBE * 2);
                    }
                    if self.window.len() < 4 || self.window[..4] != [0x1A, 0x45, 0xDF, 0xA3] {
                        return self.fail("This isn't a Matroska file.");
                    }
                    let b = &self.window;
                    let Ok(ebml) = ebml::read_element(b, 0) else { return self.fail("The file's EBML header is damaged.") };
                    let Some(ebml_end) = ebml.end_within(b.len()) else { return self.fail("The file's EBML header is damaged.") };
                    let mut doc_type = "matroska".to_string();
                    for child in ebml::children(b, &ebml).unwrap_or_default() {
                        if child.id == id::DOC_TYPE {
                            doc_type = ebml::string(b, &child);
                        }
                    }
                    if doc_type != "matroska" && doc_type != "webm" {
                        return self.fail("This isn't a Matroska file.");
                    }
                    let Ok(segment) = ebml::read_element(b, ebml_end) else { return self.fail("The file has no Segment.") };
                    if segment.id != id::SEGMENT {
                        return self.fail("The file has no Segment.");
                    }
                    self.header.doc_type = doc_type;
                    self.header.segment_data_start = segment.data_start as u64;
                    self.header.segment_end = match segment.size {
                        Some(size) => Some(segment.data_start as u64 + size),
                        None => self.length,
                    };
                    self.stage = Stage::TopLevel(segment.data_start as u64);
                }
                Stage::TopLevel(offset) => {
                    // Walk top-level children until the first cluster, jumping straight over anything
                    // Flow doesn't need (attachments such as fonts can be many megabytes).
                    if self.at_end(offset) {
                        return self.fail("The file has no video or audio clusters.");
                    }
                    let has_file_end = self.length.is_some_and(|l| self.window_end() >= l);
                    if offset < self.window_start || offset >= self.window_end() || (offset + 12 > self.window_end() && !has_file_end) {
                        return self.request(offset, PROBE);
                    }
                    let local = (offset - self.window_start) as usize;
                    let element = match ebml::read_element(&self.window, local) {
                        Ok(e) => e,
                        Err(ebml::Error::Truncated) => return self.fail("The file ends before its first cluster."),
                        Err(_) => return self.fail("The file's header is damaged."),
                    };
                    if element.id == id::CLUSTER {
                        self.header.first_cluster = Some(offset);
                        self.finish_top_level();
                        continue;
                    }
                    let Some(size) = element.size else { return self.fail("The file's header is damaged (an element of unknown size).") };
                    let header_len = (element.data_start - local) as u64;
                    let end = offset + header_len + size;
                    let wanted = matches!(element.id, id::SEEK_HEAD | id::INFO | id::TRACKS | id::CUES);
                    if wanted && end > self.window_end() {
                        if end - offset > MAX_INDEX {
                            self.stage = Stage::TopLevel(end);
                            continue;
                        }
                        return self.request(offset, end - offset);
                    }
                    if wanted {
                        let b = std::mem::take(&mut self.window);
                        let result = self.parse_top_level(&b, &element);
                        self.window = b;
                        if let Err(message) = result {
                            return self.fail(message);
                        }
                    }
                    self.stage = Stage::TopLevel(end);
                }
            }
        }
    }

    fn parse_top_level(&mut self, b: &[u8], e: &Element) -> Result<(), &'static str> {
        let damaged = "The file's header is damaged.";
        match e.id {
            id::SEEK_HEAD => {
                let entries = parse_seek_head(b, e).map_err(|_| damaged)?;
                self.seek_positions.extend(entries);
            }
            id::INFO => parse_info(b, e, &mut self.header).map_err(|_| damaged)?,
            id::TRACKS => {
                self.header.tracks = parse_tracks(b, e).map_err(|_| damaged)?;
                if self.hdr10_only {
                    self.header.tracks.iter_mut().for_each(crate::codecs::hdr10_only);
                }
            }
            id::CUES => {
                if let Some(end) = e.end_within(b.len()) {
                    self.cues_raw = b[e.start..end].to_vec();
                }
                self.header.cues = parse_cues(b, e, self.header.timecode_scale).unwrap_or_default();
            }
            _ => {}
        }
        Ok(())
    }

    fn finish_top_level(&mut self) {
        self.stage = Stage::Ready;
        if self.header.tracks.is_empty() {
            self.stage = Stage::Failed;
            self.error = Some("The file has no tracks.".into());
            return;
        }
        let base = self.header.segment_data_start;
        self.cue_stage = if !self.header.cues.is_empty() {
            CueStage::Done
        } else if let Some(&(_, p)) = self.seek_positions.iter().find(|(i, _)| *i == id::CUES) {
            CueStage::Cues(base + p)
        } else if let Some(&(_, p)) = self.seek_positions.iter().find(|(i, _)| *i == id::SEEK_HEAD) {
            CueStage::SeekHead(base + p)
        } else {
            CueStage::Done
        };
    }

    /// The byte range the seek index needs next, or None when it's read (or the file has none).
    pub fn cues_need(&self) -> Option<(u64, u64)> {
        match self.cue_stage {
            // A generous first read usually gets all of it in one round trip.
            CueStage::Cues(p) | CueStage::SeekHead(p) => {
                let len = self.length.map_or(1024 * 1024, |l| l.saturating_sub(p).min(1024 * 1024));
                if len == 0 { None } else { Some((p, len)) }
            }
            CueStage::Done => None,
        }
    }

    /// Bytes for the seek index phase, starting at `offset`. Returns the next range to read, if any.
    pub fn feed_cues(&mut self, offset: u64, b: &[u8]) -> Option<(u64, u64)> {
        let (position, expecting) = match self.cue_stage {
            CueStage::Cues(p) => (p, id::CUES),
            CueStage::SeekHead(p) => (p, id::SEEK_HEAD),
            CueStage::Done => return None,
        };
        if offset != position {
            return self.cues_need();
        }
        let Ok(element) = ebml::read_element(b, 0) else {
            self.cue_stage = CueStage::Done;
            return None;
        };
        let Some(end) = element.end() else {
            self.cue_stage = CueStage::Done;
            return None;
        };
        if element.id != expecting || end > MAX_INDEX {
            self.cue_stage = CueStage::Done;
            return None;
        }
        if end > b.len() as u64 {
            return Some((position, end));
        }
        if expecting == id::CUES {
            self.cues_raw = b[..end as usize].to_vec();
            self.header.cues = parse_cues(b, &element, self.header.timecode_scale).unwrap_or_default();
            self.cue_stage = CueStage::Done;
            None
        } else {
            let more = parse_seek_head(b, &element).unwrap_or_default();
            self.cue_stage = match more.iter().find(|(i, _)| *i == id::CUES) {
                Some(&(_, p)) => CueStage::Cues(self.header.segment_data_start + p),
                None => CueStage::Done,
            };
            self.cues_need()
        }
    }

    /// Loads a Cues element read earlier (from the worker's cache).
    pub fn load_cues(&mut self, raw: &[u8]) -> bool {
        let Ok(element) = ebml::read_element(raw, 0) else { return false };
        if element.id != id::CUES || element.end_within(raw.len()).is_none() {
            return false;
        }
        let Ok(cues) = parse_cues(raw, &element, self.header.timecode_scale) else { return false };
        self.header.cues = cues;
        self.cues_raw = raw.to_vec();
        self.cue_stage = CueStage::Done;
        true
    }
}

pub fn parse_seek_head(b: &[u8], e: &Element) -> Result<Vec<(u32, u64)>, ebml::Error> {
    let mut out = Vec::new();
    for seek in ebml::children(b, e)? {
        if seek.id != id::SEEK {
            continue;
        }
        let mut target = None;
        let mut position = None;
        for child in ebml::children(b, &seek)? {
            match child.id {
                id::SEEK_ID => target = Some(ebml::uint(b, &child) as u32),
                id::SEEK_POSITION => position = Some(ebml::uint(b, &child)),
                _ => {}
            }
        }
        if let (Some(t), Some(p)) = (target, position) {
            out.push((t, p));
        }
    }
    Ok(out)
}

fn parse_info(b: &[u8], e: &Element, header: &mut Header) -> Result<(), ebml::Error> {
    let mut raw_duration = None;
    for child in ebml::children(b, e)? {
        match child.id {
            id::TIMECODE_SCALE => header.timecode_scale = (ebml::uint(b, &child) as i64).clamp(1, 1_000_000_000),
            id::DURATION => raw_duration = Some(ebml::float(b, &child)),
            id::TITLE => header.title = Some(ebml::string(b, &child)),
            _ => {}
        }
    }
    // A corrupt duration (NaN, infinite, negative or absurd) is ignored rather than trusted.
    if let Some(raw) = raw_duration {
        let ns = raw * header.timecode_scale as f64;
        if ns.is_finite() && ns > 0.0 && ns < 1e17 {
            header.duration = Some(ns as i64);
        }
    }
    Ok(())
}

pub fn parse_tracks(b: &[u8], e: &Element) -> Result<Vec<Track>, ebml::Error> {
    let mut tracks = Vec::new();
    for entry in ebml::children(b, e)? {
        if entry.id != id::TRACK_ENTRY {
            continue;
        }
        let mut t = Track::new();
        let mut bcp47 = None;
        for child in ebml::children(b, &entry)? {
            let flag = || ebml::uint(b, &child) != 0;
            match child.id {
                id::TRACK_NUMBER => t.number = ebml::uint(b, &child) as u32,
                id::TRACK_TYPE => t.kind = ebml::uint(b, &child) as u8,
                id::FLAG_ENABLED => t.enabled = flag(),
                id::FLAG_DEFAULT => t.default = flag(),
                id::FLAG_FORCED => t.forced = flag(),
                id::FLAG_HEARING_IMPAIRED => t.hearing_impaired = flag(),
                id::FLAG_COMMENTARY => t.commentary = flag(),
                id::DEFAULT_DURATION => t.default_duration = Some(ebml::uint(b, &child) as i64),
                id::NAME => t.name = Some(ebml::string(b, &child)),
                id::LANGUAGE => t.language = ebml::string(b, &child),
                id::LANGUAGE_BCP47 => bcp47 = Some(ebml::string(b, &child)),
                id::CODEC_ID => t.codec_id = ebml::string(b, &child),
                id::CODEC_PRIVATE => t.codec_private = ebml::bytes(b, &child),
                id::CONTENT_ENCODINGS => parse_encodings(b, &child, &mut t)?,
                id::VIDEO => parse_video(b, &child, &mut t)?,
                id::AUDIO => {
                    for a in ebml::children(b, &child)? {
                        match a.id {
                            id::SAMPLING_FREQUENCY => t.sample_rate = ebml::float(b, &a),
                            id::OUTPUT_SAMPLING_FREQUENCY => t.output_sample_rate = Some(ebml::float(b, &a)),
                            id::CHANNELS => t.channels = ebml::uint(b, &a) as u32,
                            id::BIT_DEPTH => t.bit_depth = Some(ebml::uint(b, &a) as u32),
                            _ => {}
                        }
                    }
                }
                id::BLOCK_ADDITION_MAPPING => {
                    let mut kind = 0u64;
                    let mut extra = Vec::new();
                    for m in ebml::children(b, &child)? {
                        match m.id {
                            id::BLOCK_ADD_ID_TYPE => kind = ebml::uint(b, &m),
                            id::BLOCK_ADD_ID_EXTRA_DATA => extra = ebml::bytes(b, &m),
                            _ => {}
                        }
                    }
                    let fourcc = (kind as u32).to_be_bytes();
                    if matches!(&fourcc, b"dvcC" | b"dvvC" | b"dvwC") && !extra.is_empty() {
                        t.dolby_vision = Some((extra, fourcc));
                    }
                }
                _ => {}
            }
        }
        if let Some(tag) = bcp47.filter(|s| !s.is_empty()) {
            t.language = tag;
        }
        if !(1.0..=768_000.0).contains(&t.sample_rate) {
            t.sample_rate = 8000.0;
        }
        if t.output_sample_rate.is_some_and(|r| !(1.0..=768_000.0).contains(&r)) {
            t.output_sample_rate = None;
        }
        if t.channels == 0 {
            t.channels = 1;
        }
        tracks.push(t);
    }
    Ok(tracks)
}

fn parse_encodings(b: &[u8], e: &Element, t: &mut Track) -> Result<(), ebml::Error> {
    for encoding in ebml::children(b, e)? {
        if encoding.id != id::CONTENT_ENCODING {
            continue;
        }
        for child in ebml::children(b, &encoding)? {
            if child.id == id::CONTENT_ENCRYPTION {
                t.encrypted = true;
            }
            if child.id == id::CONTENT_COMPRESSION {
                let mut algorithm = 0;
                let mut settings = Vec::new();
                for c in ebml::children(b, &child)? {
                    match c.id {
                        id::CONTENT_COMP_ALGO => algorithm = ebml::uint(b, &c),
                        id::CONTENT_COMP_SETTINGS => settings = ebml::bytes(b, &c),
                        _ => {}
                    }
                }
                match algorithm {
                    0 => t.zlib = true,
                    3 => t.stripped_header = settings,
                    _ => t.compressed_unsupported = true,
                }
            }
        }
    }
    Ok(())
}

fn parse_video(b: &[u8], e: &Element, t: &mut Track) -> Result<(), ebml::Error> {
    for v in ebml::children(b, e)? {
        match v.id {
            id::PIXEL_WIDTH => t.width = ebml::uint(b, &v) as u32,
            id::PIXEL_HEIGHT => t.height = ebml::uint(b, &v) as u32,
            id::DISPLAY_WIDTH => t.display_width = Some(ebml::uint(b, &v) as u32),
            id::DISPLAY_HEIGHT => t.display_height = Some(ebml::uint(b, &v) as u32),
            id::COLOUR => {
                let mut c = Colour::default();
                for field in ebml::children(b, &v)? {
                    let value = Some(ebml::uint(b, &field) as u32);
                    match field.id {
                        id::MATRIX_COEFFICIENTS => c.matrix = value,
                        id::BITS_PER_CHANNEL => c.bits_per_channel = value,
                        id::COLOUR_RANGE => c.range = value,
                        id::TRANSFER_CHARACTERISTICS => c.transfer = value,
                        id::PRIMARIES => c.primaries = value,
                        id::MAX_CLL => c.max_cll = value,
                        id::MAX_FALL => c.max_fall = value,
                        id::MASTERING_METADATA => {
                            let mut values = [0f64; 10];
                            let mut found = false;
                            for m in ebml::children(b, &field)? {
                                if (0x55D1..=0x55DA).contains(&m.id) {
                                    values[(m.id - 0x55D1) as usize] = ebml::float(b, &m);
                                    found = true;
                                }
                            }
                            if found {
                                c.mastering = Some(values);
                            }
                        }
                        _ => {}
                    }
                }
                t.colour = Some(c);
            }
            _ => {}
        }
    }
    Ok(())
}

/// Cue points, sorted by time, in nanoseconds.
pub fn parse_cues(b: &[u8], e: &Element, timecode_scale: i64) -> Result<Vec<Cue>, ebml::Error> {
    let mut cues = Vec::new();
    for point in ebml::children(b, e)? {
        if point.id != id::CUE_POINT {
            continue;
        }
        let mut time = 0u64;
        let mut positions = Vec::new();
        for child in ebml::children(b, &point)? {
            match child.id {
                id::CUE_TIME => time = ebml::uint(b, &child),
                id::CUE_TRACK_POSITIONS => {
                    let mut track = 0;
                    let mut cluster = 0;
                    let mut relative = None;
                    for p in ebml::children(b, &child)? {
                        match p.id {
                            id::CUE_TRACK => track = ebml::uint(b, &p) as u32,
                            id::CUE_CLUSTER_POSITION => cluster = ebml::uint(b, &p),
                            id::CUE_RELATIVE_POSITION => relative = Some(ebml::uint(b, &p)),
                            _ => {}
                        }
                    }
                    positions.push((track, cluster, relative));
                }
                _ => {}
            }
        }
        let ns = (time as i64).saturating_mul(timecode_scale);
        if !(0..MAX_TIME).contains(&ns) {
            continue;
        }
        for (track, cluster_position, relative_position) in positions {
            cues.push(Cue { time: ns, track, cluster_position, relative_position });
        }
    }
    cues.sort_by_key(|c| c.time);
    Ok(cues)
}

// MARK: - Blocks

#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    pub track: u32,
    /// Presentation time in nanoseconds.
    pub time: i64,
    /// Nanoseconds, from BlockDuration when present.
    pub duration: Option<i64>,
    pub keyframe: bool,
    /// Laced blocks carry several frames.
    pub frames: Vec<Vec<u8>>,
}

/// What a track's frames need before they're usable: header stripping or zlib.
#[derive(Clone, Copy, Default)]
pub struct Decoding<'a> {
    pub stripped: &'a [u8],
    pub zlib: bool,
}

/// Parses a SimpleBlock or Block payload. `track_of` returns the decoding a track needs, or None to
/// skip the block without copying its frames.
pub fn parse_block<'a>(
    b: &[u8],
    cluster_time: i64,
    scale: i64,
    simple: bool,
    decoding: impl Fn(u32) -> Option<Decoding<'a>>,
) -> Option<Block> {
    let mut i = 0;
    let (track_number, _, _) = ebml::read_vint(b, &mut i).ok()?;
    if i + 3 > b.len() {
        return None;
    }
    let track = track_number as u32;
    let relative = i16::from_be_bytes([b[i], b[i + 1]]) as i64;
    let flags = b[i + 2];
    i += 3;
    let decoding = decoding(track)?;
    let time = cluster_time.checked_add(relative)?.checked_mul(scale)?;
    if time <= -MAX_TIME || time >= MAX_TIME {
        return None;
    }
    let keyframe = !simple || flags & 0x80 != 0;
    let end = b.len();

    let mut frames: Vec<Vec<u8>> = match (flags >> 1) & 0x03 {
        0 => vec![b[i..].to_vec()],
        1 => {
            // Xiph lacing
            let count = *b.get(i)? as usize + 1;
            i += 1;
            let mut sizes = Vec::with_capacity(count);
            for _ in 0..count - 1 {
                let mut size = 0usize;
                while i < end {
                    let v = b[i] as usize;
                    i += 1;
                    size += v;
                    if v != 255 {
                        break;
                    }
                }
                sizes.push(size);
            }
            slice(b, &mut i, &sizes)
        }
        2 => {
            // Fixed-size lacing
            let count = *b.get(i)? as usize + 1;
            i += 1;
            let size = (end - i) / count;
            (0..count).map(|k| b[i + k * size..i + (k + 1) * size].to_vec()).collect()
        }
        _ => {
            // EBML lacing: the first size as a vint, then signed differences.
            let count = *b.get(i)? as usize + 1;
            i += 1;
            let (first, _, _) = ebml::read_vint(b, &mut i).ok()?;
            let mut sizes = vec![first as i64];
            for _ in 1..count.saturating_sub(1) {
                let (raw, length, _) = ebml::read_vint(b, &mut i).ok()?;
                // Subtract half the range for this length.
                let bias = (1i64 << (7 * length - 1)) - 1;
                let last = *sizes.last()?;
                sizes.push(last + raw as i64 - bias);
            }
            if sizes.iter().any(|&s| s < 0) {
                return None;
            }
            let sizes: Vec<usize> = sizes.into_iter().map(|s| s as usize).collect();
            slice(b, &mut i, &sizes)
        }
    };
    if decoding.zlib {
        for frame in frames.iter_mut() {
            if let Some(inflated) = inflate::zlib(frame) {
                *frame = inflated;
            }
        }
    }
    if !decoding.stripped.is_empty() {
        for frame in frames.iter_mut() {
            let mut restored = Vec::with_capacity(decoding.stripped.len() + frame.len());
            restored.extend_from_slice(decoding.stripped);
            restored.extend_from_slice(frame);
            *frame = restored;
        }
    }
    Some(Block { track, time, duration: None, keyframe, frames })
}

/// Frames with explicit sizes, then the remainder as the last frame.
fn slice(b: &[u8], i: &mut usize, sizes: &[usize]) -> Vec<Vec<u8>> {
    let mut frames = Vec::with_capacity(sizes.len() + 1);
    for &size in sizes {
        if *i + size > b.len() {
            return frames;
        }
        frames.push(b[*i..*i + size].to_vec());
        *i += size;
    }
    if *i <= b.len() {
        frames.push(b[*i..].to_vec());
    }
    frames
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all(_: u32) -> Option<Decoding<'static>> {
        Some(Decoding::default())
    }

    #[test]
    fn lacing() {
        // Track 1, time +5, Xiph lacing (0x02), three frames of 2, 3 and 1 bytes.
        let xiph = [0x81, 0x00, 0x05, 0x02, 0x02, 2, 3, 0xA, 0xA, 0xB, 0xB, 0xB, 0xC];
        let block = parse_block(&xiph, 10, 1_000_000, true, all).unwrap();
        assert_eq!(block.frames, vec![vec![0xA, 0xA], vec![0xB, 0xB, 0xB], vec![0xC]]);
        assert_eq!(block.time, 15_000_000);
        assert!(!block.keyframe);

        // EBML lacing (0x06): first size 2 as a vint (0x82), then +1 as a signed vint (0xBF + 1 = 0xC0), remainder 1.
        let laced = [0x81, 0x00, 0x00, 0x86, 0x02, 0x82, 0xC0, 0xA, 0xA, 0xB, 0xB, 0xB, 0xC];
        let block = parse_block(&laced, 0, 1_000_000, true, all).unwrap();
        assert_eq!(block.frames, vec![vec![0xA, 0xA], vec![0xB, 0xB, 0xB], vec![0xC]]);
        assert!(block.keyframe);

        // Fixed lacing (0x04): two frames of 2 bytes, and header stripping puts the prefix back.
        let fixed = [0x81, 0x00, 0x00, 0x04, 0x01, 1, 2, 3, 4];
        let prefix = [0x0B, 0x77];
        let block = parse_block(&fixed, 0, 1_000_000, true, |_| Some(Decoding { stripped: &prefix, zlib: false })).unwrap();
        assert_eq!(block.frames, vec![vec![0x0B, 0x77, 1, 2], vec![0x0B, 0x77, 3, 4]]);

        // Negative relative time, and a track the caller skips.
        let early = [0x82, 0xFF, 0xFE, 0x80, 9];
        assert_eq!(parse_block(&early, 10, 1_000_000, true, all).unwrap().time, 8_000_000);
        assert!(parse_block(&early, 10, 1_000_000, true, |t| if t == 2 { None } else { all(t) }).is_none());
    }

    #[test]
    fn corrupt_lacing_never_panics() {
        let samples: [&[u8]; 5] = [
            &[0x81, 0x00, 0x00, 0x06, 0x05, 0x81],
            &[0x81, 0x00, 0x00, 0x02, 0xFF, 0xFF, 0xFF],
            &[0x81, 0x00, 0x00, 0x04, 0x09],
            &[0x81, 0x00],
            &[0x81, 0x00, 0x00, 0x06, 0x02, 0x82, 0x81],
        ];
        for s in samples {
            let _ = parse_block(s, 0, 1_000_000, true, all);
        }
    }

    #[test]
    fn reads_the_header_incrementally() {
        let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../Packages/FlowKit/Tests/FlowKitTests/Resources/avc-aac-srt.mkv")).unwrap();
        let mut reader = HeaderReader::new(Some(bytes.len() as u64));
        // Small reads, to exercise every "need more" path.
        let mut rounds = 0;
        while let Need::Bytes(offset, len) = reader.need() {
            let end = (offset + len.min(4096)).min(bytes.len() as u64);
            reader.feed(offset, &bytes[offset as usize..end as usize]);
            rounds += 1;
            assert!(rounds < 100);
        }
        assert!(reader.is_ready(), "{:?}", reader.error);
        let h = &reader.header;
        assert_eq!(h.doc_type, "matroska");
        assert_eq!(h.timecode_scale, 1_000_000);
        assert!((h.duration.unwrap() as f64 / 1e9 - 6.0).abs() < 0.1);
        let video = h.tracks.iter().find(|t| t.kind == VIDEO).unwrap();
        assert_eq!(video.codec_id, "V_MPEG4/ISO/AVC");
        assert_eq!((video.width, video.height), (160, 90));
        assert_eq!(video.codec_private.first(), Some(&1));
        let audio = h.tracks.iter().find(|t| t.kind == AUDIO).unwrap();
        assert_eq!(audio.codec_id, "A_AAC");
        assert_eq!(audio.sample_rate, 48000.0);
        assert_eq!(audio.channels, 2);
        assert_eq!(audio.language, "eng");
        assert_eq!(h.tracks.iter().find(|t| t.kind == SUBTITLE).unwrap().codec_id, "S_TEXT/UTF8");

        // ffmpeg writes the Cues after the clusters: the SeekHead says where.
        while let Some((offset, len)) = reader.cues_need() {
            let end = (offset + len).min(bytes.len() as u64);
            reader.feed_cues(offset, &bytes[offset as usize..end as usize]);
        }
        let times: Vec<i64> = reader.header.cues.iter().filter(|c| c.track == 1).map(|c| c.time / 1_000_000_000).collect();
        assert_eq!(times, vec![0, 1, 2, 3, 4, 5], "a keyframe every second");
        assert!(!reader.cues_raw.is_empty());

        // Cached Cues load without any reads.
        let mut again = HeaderReader::new(Some(bytes.len() as u64));
        again.feed(0, &bytes[..bytes.len().min(512 * 1024)]);
        assert_eq!(again.need(), Need::Nothing);
        assert!(again.load_cues(&reader.cues_raw.clone()));
        assert_eq!(again.header.cues, reader.header.cues);
        assert_eq!(again.cues_need(), None);
    }

    #[test]
    fn rejects_other_files() {
        let mut reader = HeaderReader::new(Some(18));
        reader.feed(0, b"not a video at all");
        assert_eq!(reader.need(), Need::Nothing);
        assert!(!reader.is_ready());
        assert_eq!(reader.error.as_deref(), Some("This isn't a Matroska file."));
    }

    #[test]
    fn skips_large_attachments() {
        // A 3 MB Attachments element before the clusters is jumped over, not read.
        let original = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../Packages/FlowKit/Tests/FlowKitTests/Resources/avc-aac-srt.mkv")).unwrap();
        let mut reader = HeaderReader::new(Some(original.len() as u64));
        reader.feed(0, &original);
        reader.need();
        let first_cluster = reader.header.first_cluster.unwrap() as usize;

        let payload = 3 * 1024 * 1024usize;
        let mut element = vec![0x19, 0x41, 0xA4, 0x69, 0x01];
        for shift in (0..=48).rev().step_by(8) {
            element.push((payload >> shift) as u8);
        }
        element.resize(element.len() + payload, 0x55);
        let mut bytes = original.clone();
        bytes.splice(first_cluster..first_cluster, element.iter().copied());
        // Grow the Segment's 8-byte size field to match (ffmpeg writes it right after the Segment ID).
        let at = (0..64).find(|&k| bytes[k..k + 4] == [0x18, 0x53, 0x80, 0x67]).unwrap();
        let mut size = 0usize;
        for k in 0..7 {
            size = size << 8 | bytes[at + 5 + k] as usize;
        }
        size += element.len();
        for k in 0..7 {
            bytes[at + 5 + k] = (size >> (8 * (6 - k))) as u8;
        }

        let mut reader = HeaderReader::new(Some(bytes.len() as u64));
        let mut read = 0u64;
        while let Need::Bytes(offset, len) = reader.need() {
            let end = (offset + len).min(bytes.len() as u64);
            read += end - offset;
            reader.feed(offset, &bytes[offset as usize..end as usize]);
        }
        assert_eq!(reader.header.first_cluster, Some((first_cluster + element.len()) as u64));
        assert!(read < 2 * 1024 * 1024, "the attachment's payload isn't downloaded ({read} bytes read)");
    }
}
