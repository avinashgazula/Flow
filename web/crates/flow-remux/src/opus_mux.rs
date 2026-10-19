//! Wraps Opus packets in fragmented MP4 for the audio SourceBuffer, for tracks the worker converted
//! itself (decoded in WebAssembly, then encoded by WebCodecs). The shape matches the init segments and
//! fragments of an Opus track that is passed through from Matroska.

use wasm_bindgen::prelude::*;

use crate::mp4::{self, Put};

const RATE: u32 = 48_000;

/// RFC 7845's channel mapping family 1 (Vorbis order) for 3 to 8 channels: the stream count, how
/// many of them are coupled pairs, and which stream channel feeds each output.
fn mapping(channels: u8) -> (u8, u8, &'static [u8]) {
    match channels {
        3 => (2, 1, &[0, 2, 1]),
        4 => (2, 2, &[0, 1, 2, 3]),
        5 => (3, 2, &[0, 4, 1, 2, 3]),
        6 => (4, 2, &[0, 4, 1, 2, 3, 5]),
        7 => (5, 2, &[0, 4, 1, 2, 3, 5, 6]),
        _ => (5, 3, &[0, 6, 1, 2, 3, 4, 5, 7]),
    }
}

/// The dOps box body: version 0, so every field is big-endian.
fn dops(channels: u8, pre_skip: u16) -> Vec<u8> {
    let mut out = vec![0, channels];
    out.u16(pre_skip);
    out.u32(RATE);
    out.u16(0);
    if channels <= 2 {
        out.push(0);
    } else {
        let (streams, coupled, table) = mapping(channels);
        out.extend_from_slice(&[1, streams, coupled]);
        out.extend_from_slice(table);
    }
    out
}

#[wasm_bindgen]
pub struct OpusMuxer {
    channels: u8,
    pre_skip: u16,
    sequence: u32,
}

#[wasm_bindgen]
impl OpusMuxer {
    /// `pre_skip` is the encoder's lookahead in 48 kHz samples, which players trim from the start.
    /// Channels run from 1 to 8.
    #[wasm_bindgen(constructor)]
    pub fn new(channels: u32, pre_skip: u32) -> OpusMuxer {
        OpusMuxer { channels: channels.clamp(1, 8) as u8, pre_skip: pre_skip.min(u16::MAX as u32) as u16, sequence: 0 }
    }

    /// ftyp + moov for one audio track (id 1) at 48 kHz, with no samples: they arrive as fragments.
    pub fn init(&self) -> Vec<u8> {
        let entry = mp4::audio_sample_entry(b"Opus", self.channels as u32, RATE, &mp4::boxed(b"dOps", &dops(self.channels, self.pre_skip)));
        mp4::init_segment(&mp4::TrackInfo { video: false, timescale: RATE, language: "und", width: 0, height: 0, sample_entry: &entry })
    }

    /// One moof+mdat. `base_time` is the first packet's time in 48 kHz ticks, `data` holds the packets
    /// back to back, and `sizes` and `durations` (ticks, usually 960) give each one's length and length
    /// in time. A packet that `data` doesn't fully hold, and any after it, is left out.
    pub fn fragment(&mut self, base_time: f64, data: &[u8], sizes: Vec<u32>, durations: Vec<u32>) -> Vec<u8> {
        let mut samples = Vec::with_capacity(sizes.len());
        let mut used = 0usize;
        for (&size, &duration) in sizes.iter().zip(&durations) {
            if used + size as usize > data.len() {
                break;
            }
            used += size as usize;
            samples.push(mp4::Sample { size, duration, composition_offset: 0, sync: true });
        }
        self.sequence = self.sequence.wrapping_add(1);
        let base = if base_time.is_finite() { base_time.max(0.0).round() as u64 } else { 0 };
        mp4::fragment(self.sequence, base, &samples, &data[..used], false)
    }

    /// The codec string for `addSourceBuffer`.
    pub fn codec(&self) -> String {
        "opus".into()
    }
}
