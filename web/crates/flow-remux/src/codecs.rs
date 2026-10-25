//! Turns a Matroska track into what MSE needs: a codec string for `isTypeSupported` and an MP4
//! sample entry for the init segment. Ported from FlowKit's AudioConfig.swift and the track
//! support in MatroskaRemuxer.swift, plus Opus and VP9, which browsers play and AVPlayer doesn't.

use crate::matroska::{Colour, Track, AUDIO, SUBTITLE, VIDEO};
use crate::mp4::{self, Put};
use crate::picture::PictureFormat;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Codec {
    H264,
    Hevc,
    Av1,
    Vp9,
    Aac,
    Mp3,
    Ac3,
    Eac3,
    Flac,
    Opus,
    /// SRT, ASS/SSA or WebVTT, delivered as cues.
    Text(TextFormat),
    /// Blu-ray PGS or DVD VobSub: bitmaps, decoded by `picture` and drawn by the player.
    Picture(PictureFormat),
    /// Recognised but not remuxable here (DTS, TrueHD, DVB subtitles, …): `reason` says why.
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextFormat {
    Srt,
    Ass,
    WebVtt,
}

pub fn codec_of(t: &Track) -> (Codec, &'static str) {
    if t.encrypted {
        return (Codec::Unsupported, "Encrypted track");
    }
    if t.compressed_unsupported {
        return (Codec::Unsupported, "Compressed track");
    }
    let id = t.codec_id.as_str();
    match t.kind {
        VIDEO => match id {
            "V_MPEG4/ISO/AVC" if t.codec_private.len() >= 4 => (Codec::H264, ""),
            "V_MPEG4/ISO/AVC" => (Codec::Unsupported, "H.264 without configuration"),
            "V_MPEGH/ISO/HEVC" if t.codec_private.len() >= 23 => (Codec::Hevc, ""),
            "V_MPEGH/ISO/HEVC" => (Codec::Unsupported, "HEVC without configuration"),
            "V_AV1" if t.codec_private.len() >= 4 => (Codec::Av1, ""),
            "V_AV1" => (Codec::Unsupported, "AV1 without configuration"),
            "V_VP9" => (Codec::Vp9, ""),
            "V_MPEG2" => (Codec::Unsupported, "MPEG-2 video"),
            "V_MS/VFW/FOURCC" => (Codec::Unsupported, "Legacy video (VC-1, DivX or Xvid)"),
            "V_VP8" => (Codec::Unsupported, "VP8 video"),
            _ => (Codec::Unsupported, "Video format"),
        },
        AUDIO => match id {
            _ if id.starts_with("A_AAC") => (Codec::Aac, ""),
            "A_MPEG/L3" => (Codec::Mp3, ""),
            "A_AC3" => (Codec::Ac3, ""),
            "A_EAC3" => (Codec::Eac3, ""),
            "A_FLAC" => (Codec::Flac, ""),
            "A_OPUS" => (Codec::Opus, ""),
            // Browsers can't decode these, and re-encoding them is a job for a server.
            _ if id.starts_with("A_DTS") => (Codec::Unsupported, "DTS audio"),
            "A_TRUEHD" | "A_MLP" => (Codec::Unsupported, "Dolby TrueHD audio"),
            "A_VORBIS" => (Codec::Unsupported, "Vorbis audio"),
            _ if id.starts_with("A_PCM") => (Codec::Unsupported, "Uncompressed PCM audio"),
            _ => (Codec::Unsupported, "Audio format"),
        },
        SUBTITLE => match id {
            "S_TEXT/UTF8" | "S_TEXT/ASCII" => (Codec::Text(TextFormat::Srt), ""),
            "S_TEXT/ASS" | "S_TEXT/SSA" | "S_ASS" | "S_SSA" => (Codec::Text(TextFormat::Ass), ""),
            "S_TEXT/WEBVTT" => (Codec::Text(TextFormat::WebVtt), ""),
            "S_HDMV/PGS" => (Codec::Picture(PictureFormat::Pgs), ""),
            "S_VOBSUB" => (Codec::Picture(PictureFormat::VobSub), ""),
            "S_DVBSUB" => (Codec::Unsupported, "DVB subtitles"),
            _ => (Codec::Unsupported, "Subtitle format"),
        },
        _ => (Codec::Unsupported, "Track type"),
    }
}

/// Which in-browser decoder a track needs when the browser can't play it: "ac3", "eac3", "dts" or
/// "truehd", else "" (also for encrypted or compressed tracks, whose frames can't be read).
pub fn decode_of(t: &Track) -> &'static str {
    if t.kind != AUDIO || t.encrypted || t.compressed_unsupported {
        return "";
    }
    match t.codec_id.as_str() {
        "A_AC3" => "ac3",
        "A_EAC3" => "eac3",
        "A_TRUEHD" | "A_MLP" => "truehd",
        id if id.starts_with("A_DTS") => "dts",
        _ => "",
    }
}

/// Codecs whose MP4 configuration comes from a real frame rather than the Matroska header.
pub fn needs_first_frame(codec: Codec) -> bool {
    matches!(codec, Codec::Ac3 | Codec::Eac3 | Codec::Vp9)
}

pub struct Output {
    pub codec: Codec,
    pub codec_string: String,
    pub timescale: u32,
    pub sample_entry: Vec<u8>,
    /// PCM samples per frame for fixed-frame audio codecs.
    pub frame_samples: u32,
}

/// The codec string before any frame has been read (enough for `isTypeSupported`).
pub fn header_codec_string(t: &Track, codec: Codec) -> String {
    let p = &t.codec_private;
    match codec {
        Codec::H264 => format!("avc1.{:02X}{:02X}{:02X}", p[1], p[2], p[3]),
        Codec::Hevc => hevc_codec_string(p),
        Codec::Av1 => av1_codec_string(p),
        Codec::Vp9 => {
            let (profile, level, depth) = vp9_features(t, None);
            format!("vp09.{profile:02}.{level:02}.{depth:02}")
        }
        Codec::Aac => format!("mp4a.40.{}", aac_object_type(&aac_config(t))),
        Codec::Mp3 => "mp4a.6B".into(),
        Codec::Ac3 => "ac-3".into(),
        Codec::Eac3 => "ec-3".into(),
        Codec::Flac => "flac".into(),
        Codec::Opus => "opus".into(),
        Codec::Text(_) | Codec::Picture(_) | Codec::Unsupported => String::new(),
    }
}

/// Everything the init segment needs. None when the codec needs a frame and `first_frame` is None,
/// or the configuration can't be read.
pub fn output(t: &Track, first_frame: Option<&[u8]>) -> Option<Output> {
    let (codec, _) = codec_of(t);
    if needs_first_frame(codec) && first_frame.is_none() {
        return None;
    }
    let rate = t.sample_rate as u32;
    let audio = |codec_string: String, timescale: u32, entry: Vec<u8>, frame_samples: u32| {
        Some(Output { codec, codec_string, timescale, sample_entry: entry, frame_samples })
    };
    match codec {
        Codec::H264 | Codec::Hevc | Codec::Av1 | Codec::Vp9 => video_output(t, codec, first_frame),
        Codec::Aac => {
            let asc = aac_config(t);
            let entry = mp4::audio_sample_entry(b"mp4a", t.channels, rate, &mp4::esds(0x40, &asc));
            audio(format!("mp4a.40.{}", aac_object_type(&asc)), rate, entry, 1024)
        }
        Codec::Mp3 => {
            let entry = mp4::audio_sample_entry(b"mp4a", t.channels, rate, &mp4::esds(0x6B, &[]));
            let samples = first_frame.map_or(1152, mp3_samples_per_frame);
            audio("mp4a.6B".into(), rate, entry, samples)
        }
        Codec::Ac3 => {
            let h = ac3::parse(first_frame?, 0)?;
            let entry = mp4::audio_sample_entry(b"ac-3", h.channels(), h.sample_rate(), &mp4::boxed(b"dac3", &ac3::dac3(&h)));
            audio("ac-3".into(), h.sample_rate(), entry, 1536)
        }
        Codec::Eac3 => {
            let frame = first_frame?;
            let first = eac3::parse(frame, 0)?;
            let channels = eac3::channels(frame);
            let entry = mp4::audio_sample_entry(b"ec-3", channels, first.sample_rate(), &mp4::boxed(b"dec3", &eac3::dec3(frame)?));
            audio("ec-3".into(), first.sample_rate(), entry, eac3::samples(frame))
        }
        Codec::Flac => {
            let info = flac_stream_info(&t.codec_private)?;
            let mut dfla = Vec::new();
            mp4::full(&mut dfla, b"dfLa", 0, 0, |w| w.extend_from_slice(&info));
            let entry = mp4::audio_sample_entry(b"fLaC", t.channels, rate, &dfla);
            let samples = first_frame.and_then(flac_block_size).unwrap_or(4096);
            audio("flac".into(), rate, entry, samples)
        }
        Codec::Opus => {
            let dops = opus_dops(&t.codec_private, t.channels)?;
            let channels = dops[1] as u32;
            let entry = mp4::audio_sample_entry(b"Opus", channels, 48000, &mp4::boxed(b"dOps", &dops));
            audio("opus".into(), 48000, entry, 960)
        }
        Codec::Text(_) | Codec::Picture(_) | Codec::Unsupported => None,
    }
}

pub fn video_output(t: &Track, codec: Codec, first_frame: Option<&[u8]>) -> Option<Output> {
    let p = &t.codec_private;
    let mut children = Vec::new();
    let mut kind = *b"avc1";
    let mut codec_string = header_codec_string(t, codec);
    match codec {
        Codec::H264 => children.extend(mp4::boxed(b"avcC", p)),
        Codec::Hevc => {
            kind = *b"hvc1";
            children.extend(mp4::boxed(b"hvcC", p));
        }
        Codec::Av1 => {
            kind = *b"av01";
            children.extend(mp4::boxed(b"av1C", p));
        }
        Codec::Vp9 => {
            kind = *b"vp09";
            let (profile, level, depth) = vp9_features(t, first_frame);
            codec_string = format!("vp09.{profile:02}.{level:02}.{depth:02}");
            let c = t.colour.clone().unwrap_or_default();
            mp4::full(&mut children, b"vpcC", 1, 0, |w| {
                w.push(profile);
                w.push(level);
                // Bit depth, 4:2:0 chroma (colocated with luma), full range flag.
                w.push(depth << 4 | 1 << 1 | u8::from(c.range == Some(2)));
                w.push(c.primaries.unwrap_or(2).min(255) as u8);
                w.push(c.transfer.unwrap_or(2).min(255) as u8);
                w.push(c.matrix.unwrap_or(2).min(255) as u8);
                w.u16(0);
            });
        }
        _ => return None,
    }
    let colour = t.colour.clone().filter(|c| c.primaries.is_some() || c.transfer.is_some()).or_else(|| colour_from_dolby_vision(t));
    if let Some(c) = colour {
        if codec != Codec::Vp9 {
            children.extend(mp4::colr(&c));
        }
        if let Some(m) = &c.mastering {
            children.extend(mp4::mdcv(m));
        }
        if c.max_cll.is_some() || c.max_fall.is_some() {
            children.extend(mp4::clli(c.max_cll.unwrap_or(0), c.max_fall.unwrap_or(0)));
        }
    }
    // Dolby Vision profiles 5 and 8 carry their configuration; Safari plays them, and browsers without
    // Dolby Vision play profile 8's HDR10 base layer and ignore the box. Profile 5 has no base layer, so
    // it must be signalled as Dolby Vision.
    if let (Codec::Hevc, Some((dv, box_type))) = (codec, &t.dolby_vision) {
        if dv.len() >= 4 {
            let profile = dv[2] >> 1;
            let level = (dv[2] & 1) << 5 | dv[3] >> 3;
            if profile == 5 || profile == 8 {
                children.extend(mp4::boxed(box_type, dv));
            }
            if profile == 5 {
                kind = *b"dvh1";
                codec_string = format!("dvh1.{profile:02}.{level:02}");
            }
        }
    }
    if let (Some(dw), Some(dh)) = (t.display_width, t.display_height) {
        let (w, h) = (t.width as u64, t.height as u64);
        if dw > 0 && dh > 0 && w > 0 && h > 0 && dw as u64 * h != dh as u64 * w {
            let (hs, vs) = (dw as u64 * h, dh as u64 * w);
            let g = gcd(hs, vs);
            children.extend(mp4::pasp((hs / g).min(u32::MAX as u64) as u32, (vs / g).min(u32::MAX as u64) as u32));
        }
    }
    let entry = mp4::visual_sample_entry(&kind, t.width, t.height, &children);
    Some(Output { codec, codec_string, timescale: 90000, sample_entry: entry, frame_samples: 0 })
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 { a.max(1) } else { gcd(b, a % b) }
}

pub fn hevc_codec_string(c: &[u8]) -> String {
    let space = (c[1] >> 6) as usize;
    let tier = (c[1] >> 5) & 1;
    let profile = c[1] & 0x1F;
    let compat = u32::from_be_bytes([c[2], c[3], c[4], c[5]]).reverse_bits();
    let mut constraints = &c[6..12];
    while let [rest @ .., 0] = constraints {
        constraints = rest;
    }
    let mut s = format!("hvc1.{}{}.{:X}.{}{}", ["", "A", "B", "C"][space], profile, compat, if tier == 1 { "H" } else { "L" }, c[12]);
    for b in constraints {
        s.push_str(&format!(".{b:02X}"));
    }
    s
}

pub fn av1_codec_string(c: &[u8]) -> String {
    let profile = c[1] >> 5;
    let level = c[1] & 0x1F;
    let tier = (c[2] >> 7) & 1;
    let depth = if (c[2] >> 6) & 1 == 1 { if (c[2] >> 5) & 1 == 1 { 12 } else { 10 } } else { 8 };
    format!("av01.{}.{:02}{}.{:02}", profile, level, if tier == 1 { "H" } else { "M" }, depth)
}

/// Profile, level and bit depth: from the CodecPrivate's feature list when the muxer wrote one,
/// else from the first frame's header, with the level guessed from the picture size.
fn vp9_features(t: &Track, frame: Option<&[u8]>) -> (u8, u8, u8) {
    let (mut profile, mut level, mut depth) = (None, None, None);
    let p = &t.codec_private;
    let mut i = 0;
    while i + 2 <= p.len() {
        let (id, len) = (p[i], p[i + 1] as usize);
        if let Some(&v) = p.get(i + 2).filter(|_| len == 1) {
            match id {
                1 => profile = Some(v),
                2 => level = Some(v),
                3 => depth = Some(v),
                _ => {}
            }
        }
        i += 2 + len;
    }
    if let Some(f) = frame.filter(|f| !f.is_empty() && f[0] >> 6 == 2) {
        let mut r = BitReader::new(f, 0);
        r.skip(2);
        let low = r.read(1);
        let high = r.read(1);
        let found = (high << 1 | low) as u8;
        profile.get_or_insert(found);
        if found == 3 {
            r.skip(1);
        }
        // A keyframe's colour config says the bit depth for profiles 2 and 3.
        if r.read(1) == 0 && r.read(1) == 0 {
            r.skip(2);
            if r.read(24) == 0x498342 && found >= 2 {
                depth.get_or_insert(if r.read(1) == 1 { 12 } else { 10 });
            }
        }
    }
    let pixels = t.width as u64 * t.height as u64;
    let guessed = match pixels {
        0..=921_600 => 31,
        921_601..=2_228_224 => 41,
        2_228_225..=8_912_896 => 51,
        _ => 61,
    };
    (profile.unwrap_or(0), level.filter(|&l| l > 0).unwrap_or(guessed), depth.unwrap_or(8))
}

/// What a Dolby Vision stream's base layer is, from its compatibility ID, for files whose Matroska
/// header says nothing about colour: 1 and 6 are HDR10, 2 SDR (BT.709), 4 HLG.
fn colour_from_dolby_vision(t: &Track) -> Option<Colour> {
    let (dv, _) = t.dolby_vision.as_ref()?;
    let compatibility = dv.get(4)? >> 4;
    let (matrix, transfer, primaries) = match compatibility {
        1 | 6 => (9, 16, 9),
        2 => (1, 1, 1),
        4 => (9, 18, 9),
        _ => return None,
    };
    Some(Colour { matrix: Some(matrix), transfer: Some(transfer), primaries: Some(primaries), ..Default::default() })
}

// MARK: - Bits

pub struct BitReader<'a> {
    bytes: &'a [u8],
    bit: usize,
}

impl<'a> BitReader<'a> {
    pub fn new(bytes: &'a [u8], byte_offset: usize) -> Self {
        BitReader { bytes, bit: byte_offset * 8 }
    }

    pub fn bits_left(&self) -> isize {
        (self.bytes.len() * 8) as isize - self.bit as isize
    }

    /// Past the end reads as zeros.
    pub fn read(&mut self, count: u32) -> u32 {
        let mut value = 0u32;
        for _ in 0..count {
            let byte = self.bytes.get(self.bit / 8).copied().unwrap_or(0);
            value = value << 1 | ((byte >> (7 - self.bit % 8)) & 1) as u32;
            self.bit += 1;
        }
        value
    }

    pub fn skip(&mut self, count: usize) {
        self.bit += count;
    }
}

#[derive(Default)]
pub struct BitWriter {
    pub bytes: Vec<u8>,
    bit: usize,
}

impl BitWriter {
    pub fn write(&mut self, value: u32, count: u32) {
        for k in (0..count).rev() {
            if self.bit % 8 == 0 {
                self.bytes.push(0);
            }
            if (value >> k) & 1 == 1 {
                if let Some(last) = self.bytes.last_mut() {
                    *last |= 1 << (7 - self.bit % 8);
                }
            }
            self.bit += 1;
        }
    }
}

// MARK: - AAC

const AAC_RATES: [u32; 13] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/// The AudioSpecificConfig: the CodecPrivate, or one built for old-style codec IDs
/// ("A_AAC/MPEG4/LC") that carry none.
pub fn aac_config(t: &Track) -> Vec<u8> {
    if t.codec_private.len() >= 2 {
        return t.codec_private.clone();
    }
    let id = &t.codec_id;
    let profile = if id.contains("MAIN") { 1 } else if id.contains("SSR") { 3 } else if id.contains("LTP") { 4 } else { 2 };
    let index = AAC_RATES.iter().position(|&r| r == t.sample_rate as u32).unwrap_or(3);
    let mut w = BitWriter::default();
    w.write(profile, 5);
    w.write(index as u32, 4);
    w.write(t.channels.min(7), 4);
    w.write(0, 3);
    w.bytes
}

/// Audio object type ("mp4a.40.<aot>").
pub fn aac_object_type(asc: &[u8]) -> u32 {
    let mut r = BitReader::new(asc, 0);
    let aot = r.read(5);
    if aot == 31 { 32 + r.read(6) } else { aot }
}

// MARK: - AC-3

pub mod ac3 {
    use super::{BitReader, BitWriter};

    const BITRATES: [u32; 19] = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640];
    pub const ACMOD_CHANNELS: [u32; 8] = [2, 1, 2, 3, 3, 4, 4, 5];

    pub struct Header {
        pub fscod: u32,
        pub frmsizecod: u32,
        pub bsid: u32,
        pub bsmod: u32,
        pub acmod: u32,
        pub lfeon: u32,
    }

    impl Header {
        pub fn frame_bytes(&self) -> usize {
            let rate = BITRATES[((self.frmsizecod >> 1) as usize).min(BITRATES.len() - 1)] as usize;
            match self.fscod {
                0 => rate * 4,
                1 => (rate * 320 / 147 + (self.frmsizecod & 1) as usize) * 2,
                _ => rate * 6,
            }
        }
        pub fn sample_rate(&self) -> u32 {
            [48000, 44100, 32000, 48000][self.fscod as usize & 3]
        }
        pub fn channels(&self) -> u32 {
            ACMOD_CHANNELS[self.acmod as usize & 7] + self.lfeon
        }
    }

    pub fn parse(b: &[u8], offset: usize) -> Option<Header> {
        if offset + 7 > b.len() || b[offset] != 0x0B || b[offset + 1] != 0x77 {
            return None;
        }
        let mut r = BitReader::new(b, offset + 4);
        let fscod = r.read(2);
        let frmsizecod = r.read(6);
        let bsid = r.read(5);
        if bsid > 10 || fscod == 3 {
            return None;
        }
        let bsmod = r.read(3);
        let acmod = r.read(3);
        if acmod & 1 != 0 && acmod != 1 {
            r.skip(2);
        }
        if acmod & 4 != 0 {
            r.skip(2);
        }
        if acmod == 2 {
            r.skip(2);
        }
        let lfeon = r.read(1);
        Some(Header { fscod, frmsizecod, bsid, bsmod, acmod, lfeon })
    }

    /// dac3 payload (ETSI TS 102 366 F.4).
    pub fn dac3(h: &Header) -> Vec<u8> {
        let mut w = BitWriter::default();
        w.write(h.fscod, 2);
        w.write(h.bsid, 5);
        w.write(h.bsmod, 3);
        w.write(h.acmod, 3);
        w.write(h.lfeon, 1);
        w.write(h.frmsizecod >> 1, 5);
        w.write(0, 5);
        w.bytes
    }

    /// Splits a block into syncframes, so each MP4 sample is one frame of 1536 samples.
    pub fn frames(b: &[u8]) -> Vec<&[u8]> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < b.len() {
            match parse(b, i) {
                Some(h) if h.frame_bytes() > 0 && i + h.frame_bytes() <= b.len() => {
                    out.push(&b[i..i + h.frame_bytes()]);
                    i += h.frame_bytes();
                }
                _ => break,
            }
        }
        if out.is_empty() || i < b.len() { vec![b] } else { out }
    }
}

// MARK: - E-AC-3

pub mod eac3 {
    use super::{ac3::ACMOD_CHANNELS, BitReader, BitWriter};

    pub struct Frame {
        /// 0 independent, 1 dependent, 2 AC-3 converted.
        pub stream_type: u32,
        pub bytes: usize,
        pub fscod: u32,
        pub blocks: u32,
        pub acmod: u32,
        pub lfeon: u32,
        pub bsid: u32,
        pub chanmap: Option<u32>,
        /// Dolby Atmos (joint object coding): the complexity index from the frame's addbsi.
        pub atmos_complexity: Option<u32>,
    }

    impl Frame {
        pub fn sample_rate(&self) -> u32 {
            [48000, 44100, 32000, 24000, 22050, 16000][(self.fscod as usize).min(5)]
        }
    }

    pub fn parse(b: &[u8], offset: usize) -> Option<Frame> {
        if offset + 6 > b.len() || b[offset] != 0x0B || b[offset + 1] != 0x77 {
            return None;
        }
        let mut r = BitReader::new(b, offset + 2);
        let strmtyp = r.read(2);
        r.skip(3); // substreamid
        let frmsiz = r.read(11);
        let mut fscod = r.read(2);
        let mut numblks = 6;
        if fscod == 3 {
            fscod = 3 + r.read(2);
        } else {
            numblks = [1, 2, 3, 6][r.read(2) as usize];
        }
        let acmod = r.read(3);
        let lfeon = r.read(1);
        let bsid = r.read(5);
        if !(11..=16).contains(&bsid) {
            return None;
        }
        r.skip(5); // dialnorm
        if r.read(1) == 1 {
            r.skip(8); // compr
        }
        if acmod == 0 {
            r.skip(5);
            if r.read(1) == 1 {
                r.skip(8);
            }
        }
        let mut chanmap = None;
        if strmtyp == 1 && r.read(1) == 1 {
            chanmap = Some(r.read(16));
        }
        let atmos_complexity = atmos(&mut r, strmtyp, fscod, numblks, acmod, lfeon);
        Some(Frame { stream_type: strmtyp, bytes: (frmsiz as usize + 1) * 2, fscod, blocks: numblks, acmod, lfeon, bsid, chanmap, atmos_complexity })
    }

    /// Reads the rest of the bit stream information (ETSI TS 102 366 E.1.2.2) to reach addbsi, where
    /// encoders flag Atmos.
    fn atmos(r: &mut BitReader, strmtyp: u32, fscod: u32, numblks: u32, acmod: u32, lfeon: u32) -> Option<u32> {
        if r.read(1) == 1 {
            // mixmdate
            if acmod > 2 {
                r.skip(2);
            }
            if acmod & 1 == 1 && acmod > 2 {
                r.skip(6);
            }
            if acmod & 4 != 0 {
                r.skip(6);
            }
            if lfeon == 1 && r.read(1) == 1 {
                r.skip(5);
            }
            if strmtyp == 0 {
                if r.read(1) == 1 {
                    r.skip(6);
                }
                if acmod == 0 && r.read(1) == 1 {
                    r.skip(6);
                }
                if r.read(1) == 1 {
                    r.skip(6);
                }
                match r.read(2) {
                    1 => r.skip(5),
                    2 => r.skip(12),
                    3 => {
                        let n = r.read(5) as usize;
                        r.skip((n + 2) * 8)
                    }
                    _ => {}
                }
                if acmod < 2 {
                    if r.read(1) == 1 {
                        r.skip(14);
                    }
                    if acmod == 0 && r.read(1) == 1 {
                        r.skip(14);
                    }
                }
                if r.read(1) == 1 {
                    if numblks == 1 {
                        r.skip(5);
                    } else {
                        for _ in 0..numblks {
                            if r.read(1) == 1 {
                                r.skip(5);
                            }
                        }
                    }
                }
            }
        }
        if r.read(1) == 1 {
            // infomdate
            r.skip(5);
            if acmod == 2 {
                r.skip(4);
            }
            if acmod >= 6 {
                r.skip(2);
            }
            if r.read(1) == 1 {
                r.skip(8);
            }
            if acmod == 0 && r.read(1) == 1 {
                r.skip(8);
            }
            if fscod < 3 {
                r.skip(1);
            }
        }
        if strmtyp == 0 && numblks != 6 {
            r.skip(1);
        }
        if strmtyp == 2 {
            let blkid = if numblks == 6 { 1 } else { r.read(1) };
            if blkid == 1 {
                r.skip(6);
            }
        }
        if r.read(1) != 1 {
            return None;
        }
        let length = r.read(6) + 1;
        if length < 2 || r.bits_left() < 16 {
            return None;
        }
        r.skip(7);
        if r.read(1) != 1 {
            return None;
        }
        Some(r.read(8))
    }

    pub fn frames(b: &[u8]) -> Vec<Frame> {
        let mut out = Vec::new();
        let mut i = 0;
        while let Some(f) = parse(b, i) {
            if f.bytes == 0 || i + f.bytes > b.len() {
                break;
            }
            i += f.bytes;
            out.push(f);
        }
        out
    }

    /// PCM samples carried by one block (independent substream frames only).
    pub fn samples(b: &[u8]) -> u32 {
        let total: u32 = frames(b).iter().filter(|f| f.stream_type != 1).map(|f| f.blocks * 256).sum();
        if total == 0 { 1536 } else { total }
    }

    pub fn channels(b: &[u8]) -> u32 {
        let all = frames(b);
        let Some(first) = all.iter().find(|f| f.stream_type != 1) else { return 2 };
        let count = ACMOD_CHANNELS[first.acmod as usize & 7] + first.lfeon;
        if all.iter().any(|f| f.stream_type == 1) { count.max(8) } else { count }
    }

    /// dec3 payload (ETSI TS 102 366 F.6) from the frames of one block.
    pub fn dec3(block: &[u8]) -> Option<Vec<u8>> {
        let all = frames(block);
        let first = all.iter().find(|f| f.stream_type != 1)?;
        let independents: Vec<&Frame> = all.iter().filter(|f| f.stream_type != 1).collect();
        let bytes: usize = all.iter().map(|f| f.bytes).sum();
        let samples: usize = independents.iter().map(|f| f.blocks as usize * 256).sum();
        let kbps = if samples > 0 { bytes * 8 * first.sample_rate() as usize / samples / 1000 } else { 0 };
        let mut w = BitWriter::default();
        w.write(kbps.min(8191) as u32, 13);
        w.write(independents.len().saturating_sub(1) as u32, 3);
        // Dependent substreams follow the independent one they extend.
        let mut groups: Vec<Vec<&Frame>> = Vec::new();
        for frame in &all {
            match groups.last_mut() {
                Some(group) if frame.stream_type == 1 => group.push(frame),
                _ => groups.push(vec![frame]),
            }
        }
        for group in &groups {
            let frame = group[0];
            let dependents = &group[1..];
            w.write(frame.fscod.min(3), 2);
            w.write(frame.bsid, 5);
            w.write(0, 1);
            w.write(0, 1);
            w.write(0, 3);
            w.write(frame.acmod, 3);
            w.write(frame.lfeon, 1);
            w.write(0, 3);
            w.write(dependents.len() as u32, 4);
            if dependents.is_empty() {
                w.write(0, 1);
            } else {
                let location = dependents.iter().fold(0, |v, f| v | (f.chanmap.unwrap_or(0) >> 5) & 0x1FF);
                w.write(location, 9);
            }
        }
        if let Some(complexity) = first.atmos_complexity {
            w.write(0, 7);
            w.write(1, 1);
            w.write(complexity, 8);
        }
        Some(w.bytes)
    }
}

// MARK: - FLAC, MP3, Opus

/// Samples in one FLAC frame, from the frame header.
pub fn flac_block_size(f: &[u8]) -> Option<u32> {
    if f.len() <= 6 || f[0] != 0xFF || f[1] & 0xFE != 0xF8 {
        return None;
    }
    let code = f[2] >> 4;
    match code {
        1 => Some(192),
        2..=5 => Some(576 << (code - 2)),
        8..=15 => Some(256 << (code - 8)),
        6 | 7 => {
            // Skip the UTF-8 coded frame/sample number, then read the explicit size.
            let lead = if f[4].leading_zeros() == 0 { (!f[4]).leading_zeros() as usize } else { 0 };
            let i = 4 + lead.max(1);
            if code == 6 { f.get(i).map(|&v| v as u32 + 1) } else { Some((u16::from_be_bytes([*f.get(i)?, *f.get(i + 1)?]) as u32) + 1) }
        }
        _ => None,
    }
}

/// STREAMINFO, flagged as the last metadata block: all a decoder needs.
pub fn flac_stream_info(codec_private: &[u8]) -> Option<Vec<u8>> {
    let b = codec_private.strip_prefix(b"fLaC").unwrap_or(codec_private);
    if b.len() < 38 {
        return None;
    }
    let mut info = b[..38].to_vec();
    info[0] = 0x80 | (info[0] & 0x7F);
    Some(info)
}

pub fn mp3_samples_per_frame(f: &[u8]) -> u32 {
    if f.len() < 4 || f[0] != 0xFF || f[1] & 0xE0 != 0xE0 {
        return 1152;
    }
    let version = (f[1] >> 3) & 0x03; // 3 = MPEG-1
    let layer = (f[1] >> 1) & 0x03; // 1 = Layer III
    if layer == 3 {
        384
    } else if layer == 1 && version != 3 {
        576
    } else {
        1152
    }
}

/// dOps (Opus in ISO BMFF) from the OpusHead in CodecPrivate: the same fields, big-endian.
pub fn opus_dops(head: &[u8], channels: u32) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    if head.len() >= 19 && &head[..8] == b"OpusHead" {
        let count = head[9];
        out.push(0);
        out.push(count);
        out.extend_from_slice(&u16::from_le_bytes([head[10], head[11]]).to_be_bytes());
        out.extend_from_slice(&u32::from_le_bytes([head[12], head[13], head[14], head[15]]).to_be_bytes());
        out.extend_from_slice(&i16::from_le_bytes([head[16], head[17]]).to_be_bytes());
        out.push(head[18]);
        if head[18] != 0 {
            out.extend_from_slice(head.get(19..21 + count as usize)?);
        }
    } else {
        // No header: a plain stereo (or mono) stream at 48 kHz.
        if channels > 2 {
            return None;
        }
        out.extend_from_slice(&[0, channels.max(1) as u8, 0x01, 0x38, 0, 0, 0xBB, 0x80, 0, 0, 0]);
    }
    Some(out)
}

/// Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1).
pub fn opus_samples(packet: &[u8]) -> u32 {
    let Some(&toc) = packet.first() else { return 960 };
    let config = toc >> 3;
    // Frame length in units of 2.5 ms.
    let tenths = match config {
        0..=11 => [4, 8, 16, 24][(config % 4) as usize],
        12..=15 => [4, 8][(config % 2) as usize],
        _ => [1, 2, 4, 8][(config % 4) as usize],
    };
    let frames = match toc & 3 {
        0 => 1,
        1 | 2 => 2,
        _ => packet.get(1).map_or(1, |b| (b & 0x3F) as u32),
    };
    frames * tenths * 120
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configurations() {
        // A 48 kHz, 448 kb/s, 5.1 AC-3 header: fscod 0, frmsizecod 0x1A, bsid 8, bsmod 0, acmod 7, lfe on.
        let frame = [0x0B, 0x77, 0, 0, 0x1E, 0x40, 0xE1, 0x00];
        let h = ac3::parse(&frame, 0).unwrap();
        assert_eq!(h.acmod, 7);
        assert_eq!(h.channels(), 6);
        assert_eq!(h.frame_bytes(), 1792);
        assert_eq!(ac3::dac3(&h).len(), 3);

        assert_eq!(aac_object_type(&[0x11, 0x90]), 2);
        let mut t = Track { codec_id: "A_AAC/MPEG4/LC".into(), sample_rate: 48000.0, channels: 2, ..Track::new() };
        assert_eq!(aac_config(&t), vec![0x11, 0x90]);
        t.codec_private = vec![0x13, 0x10];
        assert_eq!(aac_config(&t), vec![0x13, 0x10]);

        assert_eq!(opus_samples(&[0xFC]), 960, "CELT 20 ms, one frame");
        assert_eq!(opus_samples(&[0x11, 0, 0]), 1920 * 2, "SILK 40 ms, two frames");
        assert_eq!(opus_samples(&[0x7B, 0x03]), 3 * 960, "CELT 20 ms, code 3 with three frames");
        assert_eq!(mp3_samples_per_frame(&[0xFF, 0xFB, 0x90, 0x00]), 1152);
        assert_eq!(flac_block_size(&[0xFF, 0xF8, 0xC9, 0x18, 0x00, 0xC2, 0]), Some(4096));
    }

    #[test]
    fn codec_strings() {
        // An hvcC opening: Main 10, compatibility 0x20000000 (reversed 4), level 153 (5.1), constraint 0xB0.
        let mut hvcc = vec![1, 0x02, 0x20, 0, 0, 0, 0xB0, 0, 0, 0, 0, 0, 153];
        hvcc.resize(23, 0);
        assert_eq!(hevc_codec_string(&hvcc), "hvc1.2.4.L153.B0");
        assert_eq!(av1_codec_string(&[0x81, 0x08, 0x0C, 0]), "av01.0.08M.08");
        let t = Track { kind: VIDEO, codec_id: "V_MPEG4/ISO/AVC".into(), codec_private: vec![1, 0x64, 0x00, 0x28], ..Track::new() };
        assert_eq!(header_codec_string(&t, Codec::H264), "avc1.640028");
        let dts = Track { kind: AUDIO, codec_id: "A_DTS".into(), ..Track::new() };
        assert_eq!(codec_of(&dts), (Codec::Unsupported, "DTS audio"));
        let truehd = Track { kind: AUDIO, codec_id: "A_TRUEHD".into(), ..Track::new() };
        assert_eq!(codec_of(&truehd).0, Codec::Unsupported);
    }

    #[test]
    fn opus_head_becomes_dops() {
        let mut head = b"OpusHead".to_vec();
        head.extend_from_slice(&[1, 2, 0x38, 0x01, 0x80, 0xBB, 0, 0, 0, 0, 0]);
        assert_eq!(opus_dops(&head, 2).unwrap(), vec![0, 2, 0x01, 0x38, 0, 0, 0xBB, 0x80, 0, 0, 0]);
    }
}
