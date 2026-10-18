//! Matroska → fragmented MP4 for Media Source Extensions, in WebAssembly.
//!
//! The worker (web/src/lib/remux/worker.ts) owns the network; this crate never does I/O. The
//! calls, in order:
//!
//! 1. `new Remuxer(fileLength)`, then loop `headerNeed()` → fetch that range → `headerFeed(offset, bytes)`
//!    until `headerNeed()` is empty. `headerError()` says why a file can't be read; `headerJson()`
//!    describes the tracks.
//! 2. The seek index (often at the end of the file): `cuesNeed()` → fetch → `cuesFeed()`, or
//!    `loadCues(cached)`. Streaming doesn't wait for it; seeking does.
//! 3. `select(videoTrack, audioTrack)`, then `push(bytes)` the clusters from `firstCluster()` (or from
//!    `seekTarget(t)` after `reset()`), draining `nextFragment()` and `takeCues()` after each push.
//!    `initSegment(track)` is ready once the first fragment is (it may need a real audio frame).
//! 4. `finish()` at the end of the file sends what's held back.

use wasm_bindgen::prelude::*;

mod codecs;
mod ebml;
mod inflate;
mod matroska;
mod mp4;
pub mod remuxer;
mod subtitle;

use remuxer::{Core, Fragment};

#[wasm_bindgen]
pub struct Remuxer {
    core: Core,
    fragment: Option<Fragment>,
    codec: String,
}

fn range(r: Option<(u64, u64)>) -> Vec<f64> {
    r.map_or_else(Vec::new, |(o, l)| vec![o as f64, l as f64])
}

#[wasm_bindgen]
impl Remuxer {
    /// `length` is the file's size in bytes, or 0 when the server didn't say.
    #[wasm_bindgen(constructor)]
    pub fn new(length: f64) -> Remuxer {
        let length = (length.is_finite() && length > 0.0).then_some(length as u64);
        Remuxer { core: Core::new(length), fragment: None, codec: String::new() }
    }

    /// [offset, length] of the next header read, or an empty array when the header is done (or failed).
    #[wasm_bindgen(js_name = headerNeed)]
    pub fn header_need(&mut self) -> Vec<f64> {
        range(self.core.header_need())
    }

    #[wasm_bindgen(js_name = headerFeed)]
    pub fn header_feed(&mut self, offset: f64, bytes: &[u8]) {
        self.core.reader.feed(offset as u64, bytes);
    }

    /// Why the file can't be played, in words for the viewer.
    #[wasm_bindgen(js_name = headerError)]
    pub fn header_error(&self) -> Option<String> {
        self.core.reader.error.clone()
    }

    #[wasm_bindgen(js_name = headerJson)]
    pub fn header_json(&self) -> String {
        self.core.header_json()
    }

    #[wasm_bindgen(js_name = firstCluster)]
    pub fn first_cluster(&self) -> f64 {
        self.core.reader.header.first_cluster.unwrap_or(0) as f64
    }

    #[wasm_bindgen(js_name = cuesNeed)]
    pub fn cues_need(&self) -> Vec<f64> {
        range(self.core.cues_need())
    }

    /// Returns the next range the index needs, if any.
    #[wasm_bindgen(js_name = cuesFeed)]
    pub fn cues_feed(&mut self, offset: f64, bytes: &[u8]) -> Vec<f64> {
        range(self.core.cues_feed(offset as u64, bytes))
    }

    /// Loads a Cues element saved from an earlier visit.
    #[wasm_bindgen(js_name = loadCues)]
    pub fn load_cues(&mut self, raw: &[u8]) -> bool {
        self.core.reader.load_cues(raw)
    }

    /// The raw Cues element, for caching.
    #[wasm_bindgen(js_name = cuesBytes)]
    pub fn cues_bytes(&self) -> Vec<u8> {
        self.core.reader.cues_raw.clone()
    }

    #[wasm_bindgen(js_name = cueCount)]
    pub fn cue_count(&self) -> u32 {
        self.core.reader.header.cues.len() as u32
    }

    pub fn select(&mut self, video: u32, audio: u32) {
        self.core.select(video, audio);
    }

    /// [byte offset, media time of the keyframe there, 1 if the offset is a cluster's start].
    #[wasm_bindgen(js_name = seekTarget)]
    pub fn seek_target(&self, seconds: f64) -> Vec<f64> {
        let (offset, time, aligned) = self.core.seek_target(seconds);
        vec![offset as f64, time, if aligned { 1.0 } else { 0.0 }]
    }

    pub fn reset(&mut self, offset: f64, aligned: bool) {
        self.fragment = None;
        self.core.reset(offset as u64, aligned);
    }

    /// Drops video fragments that end before `seconds`, while audio is rebuilt under a picture
    /// that's already buffered.
    #[wasm_bindgen(js_name = setVideoFloor)]
    pub fn set_video_floor(&mut self, seconds: f64) {
        self.core.set_video_floor(seconds);
    }

    /// Absolute offset just past the bytes pushed so far.
    pub fn position(&self) -> f64 {
        self.core.position() as f64
    }

    pub fn push(&mut self, bytes: &[u8]) {
        self.core.push(bytes);
    }

    pub fn finish(&mut self) {
        self.core.finish();
    }

    /// The track's init segment, or undefined until the frame it's configured from has been read.
    /// `codecString()` then holds its codec string.
    #[wasm_bindgen(js_name = initSegment)]
    pub fn init_segment(&mut self, track: u32) -> Option<Vec<u8>> {
        let (bytes, codec) = self.core.init_segment(track)?;
        self.codec = codec;
        Some(bytes)
    }

    #[wasm_bindgen(js_name = codecString)]
    pub fn codec_string(&self) -> String {
        self.codec.clone()
    }

    /// The next moof+mdat, or undefined. `fragmentKind()` (0 video, 1 audio), `fragmentStart()` and
    /// `fragmentEnd()` (media seconds) and `fragmentKey()` describe it.
    #[wasm_bindgen(js_name = nextFragment)]
    pub fn next_fragment(&mut self) -> Option<Vec<u8>> {
        let mut fragment = self.core.next_fragment()?;
        let data = std::mem::take(&mut fragment.data);
        self.fragment = Some(fragment);
        Some(data)
    }

    #[wasm_bindgen(js_name = fragmentKind)]
    pub fn fragment_kind(&self) -> u8 {
        self.fragment.as_ref().map_or(0, |f| f.kind)
    }

    #[wasm_bindgen(js_name = fragmentStart)]
    pub fn fragment_start(&self) -> f64 {
        self.fragment.as_ref().map_or(0.0, |f| f.start)
    }

    #[wasm_bindgen(js_name = fragmentEnd)]
    pub fn fragment_end(&self) -> f64 {
        self.fragment.as_ref().map_or(0.0, |f| f.end)
    }

    /// True when the fragment starts on a keyframe (audio always does).
    #[wasm_bindgen(js_name = fragmentKey)]
    pub fn fragment_key(&self) -> bool {
        self.fragment.as_ref().is_some_and(|f| f.key)
    }

    /// Text subtitle cues read since the last call, as JSON [{track, start, end, text}], or undefined.
    #[wasm_bindgen(js_name = takeCues)]
    pub fn take_cues(&mut self) -> Option<String> {
        self.core.take_cues()
    }

    /// Seconds added to every timestamp so B-frames never need a negative decode time.
    pub fn delay(&self) -> f64 {
        self.core.delay_seconds()
    }

    #[wasm_bindgen(js_name = timingKnown)]
    pub fn timing_known(&self) -> bool {
        self.core.timing_known()
    }
}

#[cfg(test)]
mod tests;
