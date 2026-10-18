//! Matroska is EBML: a tree of elements, each an ID, a size and a payload, with IDs and sizes
//! written as variable-length integers. This is the small part of EBML Flow needs (a port of
//! FlowKit's EBML.swift). Offsets inside a buffer are `usize`; sizes are `u64` because a Segment
//! or Cluster can be larger than 4 GB and wasm32 has 32-bit pointers.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Element {
    pub id: u32,
    /// Offset of the element's first header byte.
    pub start: usize,
    /// Offset of the payload.
    pub data_start: usize,
    /// Payload size, or None for "unknown" (live streams, unfinished files).
    pub size: Option<u64>,
}

impl Element {
    /// End of the payload, when the size is known.
    pub fn end(&self) -> Option<u64> {
        self.size.map(|s| self.data_start as u64 + s)
    }

    /// End of the payload when it lies inside a buffer of `len` bytes.
    pub fn end_within(&self, len: usize) -> Option<usize> {
        match self.end() {
            Some(end) if end <= len as u64 => Some(end as usize),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Truncated,
    Invalid(&'static str),
}

/// Element IDs keep their length marker bits, as the spec writes them (0x1A45DFA3).
pub fn read_id(b: &[u8], i: &mut usize) -> Result<u32, Error> {
    let first = *b.get(*i).ok_or(Error::Truncated)?;
    let length = first.leading_zeros() as usize + 1;
    if length > 4 {
        return Err(Error::Invalid("element ID longer than 4 bytes"));
    }
    if *i + length > b.len() {
        return Err(Error::Truncated);
    }
    let mut value = 0u32;
    for k in 0..length {
        value = value << 8 | b[*i + k] as u32;
    }
    *i += length;
    Ok(value)
}

/// A vint with its marker removed, its byte length, and whether every value bit was set.
pub fn read_vint(b: &[u8], i: &mut usize) -> Result<(u64, usize, bool), Error> {
    let first = *b.get(*i).ok_or(Error::Truncated)?;
    if first == 0 {
        return Err(Error::Invalid("vint longer than 8 bytes"));
    }
    let length = first.leading_zeros() as usize + 1;
    if *i + length > b.len() {
        return Err(Error::Truncated);
    }
    let mask = (0xFFu16 >> length) as u8;
    let mut value = (first & mask) as u64;
    let mut all_ones = (first & mask) == mask;
    for k in 1..length {
        let byte = b[*i + k];
        value = value << 8 | byte as u64;
        if byte != 0xFF {
            all_ones = false;
        }
    }
    *i += length;
    Ok((value, length, all_ones))
}

/// Sizes drop the marker bit; all ones means unknown.
pub fn read_size(b: &[u8], i: &mut usize) -> Result<Option<u64>, Error> {
    let (value, _, all_ones) = read_vint(b, i)?;
    if all_ones {
        return Ok(None);
    }
    // 2^56 bytes is far beyond any real file: only corruption produces more.
    if value >= 1 << 56 {
        return Err(Error::Invalid("size overflow"));
    }
    Ok(Some(value))
}

pub fn read_element(b: &[u8], offset: usize) -> Result<Element, Error> {
    let mut i = offset;
    let id = read_id(b, &mut i)?;
    let size = read_size(b, &mut i)?;
    Ok(Element { id, start: offset, data_start: i, size })
}

/// Children of a known-size element whose payload is fully in `b`.
pub fn children(b: &[u8], parent: &Element) -> Result<Vec<Element>, Error> {
    let end = parent.end_within(b.len()).ok_or(Error::Truncated)?;
    children_in(b, parent.data_start, end)
}

pub fn children_in(b: &[u8], start: usize, end: usize) -> Result<Vec<Element>, Error> {
    let mut out = Vec::new();
    let mut i = start;
    while i < end {
        let element = read_element(b, i)?;
        let element_end = element.end().ok_or(Error::Invalid("unknown size inside a sized parent"))?;
        if element_end > end as u64 {
            return Err(Error::Truncated);
        }
        out.push(element);
        i = element_end as usize;
    }
    Ok(out)
}

/// The payload's raw bits, unclamped (floats need every one).
fn bits(b: &[u8], e: &Element) -> u64 {
    let Some(end) = e.end_within(b.len()) else { return 0 };
    b[e.data_start..end].iter().fold(0u64, |v, &byte| v << 8 | byte as u64)
}

/// Clamped to 2^48 so a corrupt value can't overflow when multiplied by a timecode scale.
/// Real positions and times stay far below it (2^48 bytes is 281 TB).
pub fn uint(b: &[u8], e: &Element) -> u64 {
    bits(b, e).min(1 << 48)
}

pub fn float(b: &[u8], e: &Element) -> f64 {
    let Some(end) = e.end_within(b.len()) else { return 0.0 };
    let raw = bits(b, e);
    let value = match end - e.data_start {
        4 => f32::from_bits(raw as u32) as f64,
        8 => f64::from_bits(raw),
        _ => 0.0,
    };
    // NaN, infinities and absurd magnitudes only come from corrupt files.
    if value.is_finite() {
        value.clamp(-1e12, 1e12)
    } else {
        0.0
    }
}

pub fn string(b: &[u8], e: &Element) -> String {
    let Some(end) = e.end_within(b.len()) else { return String::new() };
    let mut bytes = &b[e.data_start..end];
    while let [rest @ .., 0] = bytes {
        bytes = rest;
    }
    String::from_utf8_lossy(bytes).into_owned()
}

pub fn bytes(b: &[u8], e: &Element) -> Vec<u8> {
    match e.end_within(b.len()) {
        Some(end) => b[e.data_start..end].to_vec(),
        None => Vec::new(),
    }
}

/// Element IDs used by Flow's Matroska reader.
pub mod id {
    pub const DOC_TYPE: u32 = 0x4282;
    pub const SEGMENT: u32 = 0x18538067;
    pub const SEEK_HEAD: u32 = 0x114D9B74;
    pub const SEEK: u32 = 0x4DBB;
    pub const SEEK_ID: u32 = 0x53AB;
    pub const SEEK_POSITION: u32 = 0x53AC;
    pub const INFO: u32 = 0x1549A966;
    pub const TIMECODE_SCALE: u32 = 0x2AD7B1;
    pub const DURATION: u32 = 0x4489;
    pub const TITLE: u32 = 0x7BA9;
    pub const TRACKS: u32 = 0x1654AE6B;
    pub const TRACK_ENTRY: u32 = 0xAE;
    pub const TRACK_NUMBER: u32 = 0xD7;
    pub const TRACK_TYPE: u32 = 0x83;
    pub const FLAG_ENABLED: u32 = 0xB9;
    pub const FLAG_DEFAULT: u32 = 0x88;
    pub const FLAG_FORCED: u32 = 0x55AA;
    pub const FLAG_HEARING_IMPAIRED: u32 = 0x55AB;
    pub const FLAG_COMMENTARY: u32 = 0x55AF;
    pub const DEFAULT_DURATION: u32 = 0x23E383;
    pub const NAME: u32 = 0x536E;
    pub const LANGUAGE: u32 = 0x22B59C;
    pub const LANGUAGE_BCP47: u32 = 0x22B59D;
    pub const CODEC_ID: u32 = 0x86;
    pub const CODEC_PRIVATE: u32 = 0x63A2;
    pub const CONTENT_ENCODINGS: u32 = 0x6D80;
    pub const CONTENT_ENCODING: u32 = 0x6240;
    pub const CONTENT_COMPRESSION: u32 = 0x5034;
    pub const CONTENT_COMP_ALGO: u32 = 0x4254;
    pub const CONTENT_COMP_SETTINGS: u32 = 0x4255;
    pub const CONTENT_ENCRYPTION: u32 = 0x5035;
    pub const VIDEO: u32 = 0xE0;
    pub const PIXEL_WIDTH: u32 = 0xB0;
    pub const PIXEL_HEIGHT: u32 = 0xBA;
    pub const DISPLAY_WIDTH: u32 = 0x54B0;
    pub const DISPLAY_HEIGHT: u32 = 0x54BA;
    pub const COLOUR: u32 = 0x55B0;
    pub const MATRIX_COEFFICIENTS: u32 = 0x55B1;
    pub const BITS_PER_CHANNEL: u32 = 0x55B2;
    pub const COLOUR_RANGE: u32 = 0x55B9;
    pub const TRANSFER_CHARACTERISTICS: u32 = 0x55BA;
    pub const PRIMARIES: u32 = 0x55BB;
    pub const MAX_CLL: u32 = 0x55BC;
    pub const MAX_FALL: u32 = 0x55BD;
    pub const MASTERING_METADATA: u32 = 0x55D0;
    pub const BLOCK_ADDITION_MAPPING: u32 = 0x41E4;
    pub const BLOCK_ADD_ID_TYPE: u32 = 0x41E7;
    pub const BLOCK_ADD_ID_EXTRA_DATA: u32 = 0x41ED;
    pub const AUDIO: u32 = 0xE1;
    pub const SAMPLING_FREQUENCY: u32 = 0xB5;
    pub const OUTPUT_SAMPLING_FREQUENCY: u32 = 0x78B5;
    pub const CHANNELS: u32 = 0x9F;
    pub const BIT_DEPTH: u32 = 0x6264;
    pub const CUES: u32 = 0x1C53BB6B;
    pub const CUE_POINT: u32 = 0xBB;
    pub const CUE_TIME: u32 = 0xB3;
    pub const CUE_TRACK_POSITIONS: u32 = 0xB7;
    pub const CUE_TRACK: u32 = 0xF7;
    pub const CUE_CLUSTER_POSITION: u32 = 0xF1;
    pub const CHAPTERS: u32 = 0x1043A770;
    pub const CLUSTER: u32 = 0x1F43B675;
    pub const TIMECODE: u32 = 0xE7;
    pub const SIMPLE_BLOCK: u32 = 0xA3;
    pub const BLOCK_GROUP: u32 = 0xA0;
    pub const BLOCK: u32 = 0xA1;
    pub const BLOCK_DURATION: u32 = 0x9B;
    pub const REFERENCE_BLOCK: u32 = 0xFB;
    pub const TAGS: u32 = 0x1254C367;
    pub const ATTACHMENTS: u32 = 0x1941A469;
    pub const CRC32: u32 = 0xBF;

    /// Top-level Segment children: an unknown-size Cluster ends where one of these begins.
    pub fn is_top_level(id: u32) -> bool {
        matches!(id, SEEK_HEAD | INFO | TRACKS | CUES | CHAPTERS | CLUSTER | TAGS | ATTACHMENTS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vints_and_ids() {
        let mut i = 0;
        assert_eq!(read_vint(&[0x81], &mut i), Ok((1, 1, false)));
        let mut i = 0;
        assert_eq!(read_vint(&[0x40, 0x02], &mut i), Ok((2, 2, false)));
        assert_eq!(i, 2);
        let mut i = 0;
        assert_eq!(read_vint(&[0x10, 0x00, 0x00, 0x01], &mut i), Ok((1, 4, false)));
        // All value bits set is the reserved "unknown size".
        let mut i = 0;
        assert_eq!(read_size(&[0xFF], &mut i), Ok(None));
        let mut i = 0;
        assert_eq!(read_size(&[0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], &mut i), Ok(None));
        let mut i = 0;
        assert_eq!(read_vint(&[0x00], &mut i), Err(Error::Invalid("vint longer than 8 bytes")));
        let mut i = 0;
        assert_eq!(read_vint(&[0x40], &mut i), Err(Error::Truncated));
        let mut i = 0;
        assert_eq!(read_id(&[0x1A, 0x45, 0xDF, 0xA3], &mut i), Ok(0x1A45DFA3));
        let mut i = 0;
        assert_eq!(read_id(&[0x08, 0, 0, 0, 0], &mut i), Err(Error::Invalid("element ID longer than 4 bytes")));
    }

    #[test]
    fn values() {
        // TimecodeScale 1_000_000 in three bytes.
        let b = [0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40];
        let e = read_element(&b, 0).unwrap();
        assert_eq!(e.id, id::TIMECODE_SCALE);
        assert_eq!(uint(&b, &e), 1_000_000);
        // A float element (Duration) in four bytes: 6000.0.
        let mut f = vec![0x44, 0x89, 0x84];
        f.extend_from_slice(&6000f32.to_bits().to_be_bytes());
        assert_eq!(float(&f, &read_element(&f, 0).unwrap()), 6000.0);
        // Strings drop trailing zero padding.
        let t = [0x86, 0x84, b'A', b'_', 0, 0];
        assert_eq!(string(&t, &read_element(&t, 0).unwrap()), "A_");
    }

    #[test]
    fn children_must_fit() {
        // A parent of 6 bytes holding one child of 4 bytes (ID 0xD7, size 1, value) and a void.
        let b = [0xAE, 0x86, 0xD7, 0x81, 0x01, 0xEC, 0x81, 0x00];
        let parent = read_element(&b, 0).unwrap();
        let kids = children(&b, &parent).unwrap();
        assert_eq!(kids.len(), 2);
        assert_eq!(uint(&b, &kids[0]), 1);
        let cut = &b[..6];
        assert_eq!(children(cut, &parent), Err(Error::Truncated));
    }
}
