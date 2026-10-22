//! Seek previews: one keyframe, read on its own. The page decodes it with WebCodecs and draws it
//! small, so a viewer who hovers the scrubber sees where they would land. Nothing here touches the
//! streaming state (the buffer, the GOP being built): the worker can ask for a picture while the
//! file is playing.
//!
//! `thumb_target` says where to read, `thumb_find` turns the bytes that came back into the keyframe's
//! payload or says how many more it needs, and `thumb_config` is what the decoder is opened with.

use super::{find_cluster, Core};
use crate::codecs::{self, Codec};
use crate::ebml::{self, id};
use crate::matroska::Block;

/// Where a preview's keyframe lives.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ThumbTarget {
    /// Absolute offset to read from: a cluster's start, or an estimate when the file has no index.
    pub offset: u64,
    /// Media time of the keyframe (the requested time when there is no index to say).
    pub time: f64,
    /// The offset is a cluster's exact start. If not, the first cluster after it is used.
    pub aligned: bool,
    /// The keyframe's block starts this far into the cluster's payload, when the index said.
    pub relative: Option<u64>,
    /// The index entry's time in file time (ns): which keyframe of the cluster is wanted. It is
    /// handed back to `thumb_find` as it is, so a timeline that shifts while the bytes are on their
    /// way (the delay is learned a second into playback) can't make it miss.
    pub key: Option<i64>,
}

#[derive(Debug, PartialEq)]
pub enum Thumb {
    /// The keyframe's media time and its payload, as WebCodecs wants it (length-prefixed NAL units
    /// for H.264 and HEVC, as stored in Matroska).
    Found(f64, Vec<u8>),
    /// Not enough bytes: at least this many from the start of what was given.
    More(u64),
    /// This cluster holds no keyframe of the picture track (or the offset isn't a cluster).
    Nothing,
}

/// A keyframe is taken for the indexed one when it starts within this of the index's time.
const SAME_FRAME_NS: i64 = 1_000_000;

impl Core {
    /// The cluster to read for a preview at `seconds` of media time. Without an index the position is
    /// estimated from the bitrate, as for seeking.
    pub fn thumb_target(&self, seconds: f64) -> ThumbTarget {
        let target = self.target_ns(seconds);
        if let Some(cue) = self.cue_at(target) {
            let h = &self.reader.header;
            let first = h.first_cluster.unwrap_or(h.segment_data_start);
            return ThumbTarget {
                offset: (h.segment_data_start + cue.cluster_position).max(first),
                time: (cue.time + self.delay) as f64 / 1e9,
                aligned: true,
                relative: cue.relative_position,
                key: Some(cue.time),
            };
        }
        let (offset, time, aligned) = self.seek_target(seconds);
        ThumbTarget { offset, time, aligned, relative: None, key: None }
    }

    /// What the picture track's decoder is opened with: the codec string MSE would be given, and the
    /// configuration record (avcC, hvcC or av1C, as in CodecPrivate; nothing for VP9). `frame` is a
    /// keyframe's payload, which VP9's string is refined from. A Dolby Vision profile 8 file is its
    /// HEVC base layer (hvc1), as for MSE; profile 5 is "dvh1", which few decoders take.
    pub fn thumb_config(&self, frame: Option<&[u8]>) -> Option<(String, Vec<u8>)> {
        let selected = self.video.as_ref()?;
        let track = self.reader.header.track(selected.track)?;
        let output = codecs::video_output(track, selected.codec, frame.filter(|f| !f.is_empty()))?;
        let description = if selected.codec == Codec::Vp9 { Vec::new() } else { track.codec_private.clone() };
        Some((output.codec_string, description))
    }

    /// Finds the keyframe to show in `bytes`, which start at `ThumbTarget::offset`. With `relative` and
    /// `key` (from the index) it goes straight to that block; without them, or if the block isn't what
    /// the index promised, it takes the first keyframe of the cluster, or of the first cluster after an
    /// estimated offset (`aligned` false).
    pub fn thumb_find(&self, bytes: &[u8], aligned: bool, relative: Option<u64>, key: Option<i64>) -> Thumb {
        let Some(video) = self.video.as_ref().map(|v| v.track) else { return Thumb::Nothing };
        let mut start = 0;
        if !aligned {
            match find_cluster(bytes, 0) {
                Some(found) => start = found,
                None => return Thumb::More(bytes.len() as u64 + 16),
            }
        }
        let cluster = match ebml::read_element(bytes, start) {
            Ok(e) if e.id == id::CLUSTER => e,
            Err(ebml::Error::Truncated) => return Thumb::More(bytes.len() as u64 + 16),
            _ => return Thumb::Nothing,
        };
        let delay = self.delay;
        let found = |time_ns: i64, block: Block| Thumb::Found((time_ns + delay) as f64 / 1e9, block.frames.concat());

        // The index says exactly where the keyframe is: read that block and nothing before it.
        if let (Some(relative), Some(key)) = (relative, key) {
            let at = cluster.data_start as u64 + relative;
            if at >= bytes.len() as u64 {
                return Thumb::More(at + 16);
            }
            let at = at as usize;
            match ebml::read_element(bytes, at) {
                Err(ebml::Error::Truncated) => return Thumb::More(at as u64 + 16),
                Ok(e) if matches!(e.id, id::SIMPLE_BLOCK | id::BLOCK_GROUP) => {
                    let Some(end) = e.end_within(bytes.len()) else { return Thumb::More(e.end().unwrap_or(bytes.len() as u64 + 16)) };
                    // The block's own time is relative to the cluster's, which isn't needed: the index's time is it.
                    let block = if e.id == id::SIMPLE_BLOCK { self.block_in(bytes, e.data_start, end, 0, true) } else { self.group_in(bytes, e.data_start, end, 0) };
                    if let Some(block) = block.filter(|b| b.track == video && b.keyframe) {
                        return found(key, block);
                    }
                }
                _ => {}
            }
        }

        // Otherwise the cluster's blocks in order, to the keyframe the index named or the first there is.
        let mut cursor = cluster.data_start;
        let mut cluster_time = 0i64;
        let mut first: Option<(i64, Block)> = None;
        loop {
            // A sized cluster ends where its size says, even when that is the end of what was read.
            if cluster.size.is_some_and(|size| cursor as u64 >= cluster.data_start as u64 + size) {
                break;
            }
            let element = match ebml::read_element(bytes, cursor) {
                Ok(e) => e,
                Err(ebml::Error::Truncated) => return Thumb::More(cursor as u64 + 16),
                Err(_) => break,
            };
            // Without a size the cluster is over at the next top-level element.
            let Some(size) = element.size else { break };
            if cluster.size.is_none() && id::is_top_level(element.id) {
                break;
            }
            let Some(end) = element.end_within(bytes.len()) else { return Thumb::More(element.data_start as u64 + size + 16) };
            match element.id {
                id::TIMECODE => cluster_time = ebml::uint(bytes, &element) as i64,
                id::SIMPLE_BLOCK | id::BLOCK_GROUP => {
                    let block = if element.id == id::SIMPLE_BLOCK {
                        self.block_in(bytes, element.data_start, end, cluster_time, true)
                    } else {
                        self.group_in(bytes, element.data_start, end, cluster_time)
                    };
                    if let Some(block) = block.filter(|b| b.track == video && b.keyframe) {
                        let time = block.time;
                        if key.is_none_or(|k| time >= k - SAME_FRAME_NS) {
                            return found(time, block);
                        }
                        first.get_or_insert((time, block));
                    }
                }
                _ => {}
            }
            cursor = end;
        }
        match first {
            Some((time, block)) => found(time, block),
            None => Thumb::Nothing,
        }
    }
}
