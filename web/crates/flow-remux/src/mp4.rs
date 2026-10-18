//! Fragmented MP4 (CMAF-style), ported from FlowKit's MP4.swift: one init segment per track,
//! then moof/mdat fragments. Each track gets its own SourceBuffer, so every init segment holds
//! exactly one track, numbered 1.

use crate::matroska::Colour;

/// Writes a box: a placeholder size, the type, the body from `build`, then the real size.
pub fn bx(out: &mut Vec<u8>, kind: &[u8; 4], build: impl FnOnce(&mut Vec<u8>)) {
    let start = out.len();
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(kind);
    build(out);
    let size = (out.len() - start) as u32;
    out[start..start + 4].copy_from_slice(&size.to_be_bytes());
}

pub fn full(out: &mut Vec<u8>, kind: &[u8; 4], version: u8, flags: u32, build: impl FnOnce(&mut Vec<u8>)) {
    bx(out, kind, |w| {
        w.push(version);
        w.extend_from_slice(&flags.to_be_bytes()[1..]);
        build(w);
    });
}

pub fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 8);
    bx(&mut out, kind, |w| w.extend_from_slice(body));
    out
}

pub trait Put {
    fn u16(&mut self, v: u16);
    fn u32(&mut self, v: u32);
    fn u64(&mut self, v: u64);
    fn zeros(&mut self, n: usize);
}

impl Put for Vec<u8> {
    fn u16(&mut self, v: u16) {
        self.extend_from_slice(&v.to_be_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.extend_from_slice(&v.to_be_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.extend_from_slice(&v.to_be_bytes());
    }
    fn zeros(&mut self, n: usize) {
        self.resize(self.len() + n, 0);
    }
}

const UNITY_MATRIX: [u32; 9] = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];

pub struct TrackInfo<'a> {
    pub video: bool,
    pub timescale: u32,
    pub language: &'a str,
    /// Display size (anamorphic video shows wider than it's coded).
    pub width: u32,
    pub height: u32,
    /// The complete sample entry box (avc1, hvc1, mp4a, ac-3, …).
    pub sample_entry: &'a [u8],
}

pub fn init_segment(t: &TrackInfo) -> Vec<u8> {
    let mut out = Vec::with_capacity(t.sample_entry.len() + 700);
    bx(&mut out, b"ftyp", |w| {
        w.extend_from_slice(b"iso6");
        w.u32(0);
        for brand in [b"iso6", b"cmfc", b"mp41", b"isom"] {
            w.extend_from_slice(brand);
        }
    });
    bx(&mut out, b"moov", |w| {
        full(w, b"mvhd", 0, 0, |w| {
            w.u32(0);
            w.u32(0);
            w.u32(1000);
            w.u32(0);
            w.u32(0x0001_0000);
            w.u16(0x0100);
            w.zeros(10);
            UNITY_MATRIX.iter().for_each(|&m| w.u32(m));
            w.zeros(24);
            w.u32(2);
        });
        bx(w, b"trak", |w| {
            full(w, b"tkhd", 0, 0x7, |w| {
                w.u32(0);
                w.u32(0);
                w.u32(1);
                w.u32(0);
                w.u32(0);
                w.zeros(8);
                w.u16(0);
                w.u16(if t.video { 0 } else { 1 });
                w.u16(if t.video { 0 } else { 0x0100 });
                w.u16(0);
                UNITY_MATRIX.iter().for_each(|&m| w.u32(m));
                w.u32(t.width.min(0xFFFF) << 16);
                w.u32(t.height.min(0xFFFF) << 16);
            });
            bx(w, b"mdia", |w| {
                full(w, b"mdhd", 0, 0, |w| {
                    w.u32(0);
                    w.u32(0);
                    w.u32(t.timescale);
                    w.u32(0);
                    w.u16(packed_language(t.language));
                    w.u16(0);
                });
                full(w, b"hdlr", 0, 0, |w| {
                    w.u32(0);
                    w.extend_from_slice(if t.video { b"vide" } else { b"soun" });
                    w.zeros(12);
                    w.extend_from_slice(if t.video { b"VideoHandler\0" } else { b"SoundHandler\0" });
                });
                bx(w, b"minf", |w| {
                    if t.video {
                        full(w, b"vmhd", 0, 1, |w| w.zeros(8));
                    } else {
                        full(w, b"smhd", 0, 0, |w| w.zeros(4));
                    }
                    bx(w, b"dinf", |w| {
                        full(w, b"dref", 0, 0, |w| {
                            w.u32(1);
                            full(w, b"url ", 0, 1, |_| {});
                        })
                    });
                    bx(w, b"stbl", |w| {
                        full(w, b"stsd", 0, 0, |w| {
                            w.u32(1);
                            w.extend_from_slice(t.sample_entry);
                        });
                        full(w, b"stts", 0, 0, |w| w.u32(0));
                        full(w, b"stsc", 0, 0, |w| w.u32(0));
                        full(w, b"stsz", 0, 0, |w| {
                            w.u32(0);
                            w.u32(0);
                        });
                        full(w, b"stco", 0, 0, |w| w.u32(0));
                    });
                });
            });
        });
        bx(w, b"mvex", |w| {
            full(w, b"trex", 0, 0, |w| {
                w.u32(1);
                w.u32(1);
                w.u32(0);
                w.u32(0);
                w.u32(0);
            })
        });
    });
    out
}

pub struct Sample {
    pub size: u32,
    pub duration: u32,
    pub composition_offset: i32,
    pub sync: bool,
}

/// One moof + mdat. `payload` is every sample's bytes, back to back, in sample order.
pub fn fragment(sequence: u32, base_decode_time: u64, samples: &[Sample], payload: &[u8], video: bool) -> Vec<u8> {
    let per_sample = if video { 16 } else { 12 };
    let moof_size = 8 + 16 + 8 + 16 + 20 + 20 + samples.len() * per_sample;
    let mut out = Vec::with_capacity(moof_size + 8 + payload.len());
    bx(&mut out, b"moof", |w| {
        full(w, b"mfhd", 0, 0, |w| w.u32(sequence));
        bx(w, b"traf", |w| {
            // default-base-is-moof: data offsets count from the start of this moof.
            full(w, b"tfhd", 0, 0x020000, |w| w.u32(1));
            full(w, b"tfdt", 1, 0, |w| w.u64(base_decode_time));
            let mut flags = 0x000001 | 0x000100 | 0x000200 | 0x000400;
            if video {
                flags |= 0x000800;
            }
            full(w, b"trun", 1, flags, |w| {
                w.u32(samples.len() as u32);
                w.u32((moof_size + 8) as u32);
                for s in samples {
                    w.u32(s.duration);
                    w.u32(s.size);
                    w.u32(if s.sync { 0x0200_0000 } else { 0x0101_0000 });
                    if video {
                        w.u32(s.composition_offset as u32);
                    }
                }
            });
        });
    });
    debug_assert_eq!(out.len(), moof_size);
    out.u32(8 + payload.len() as u32);
    out.extend_from_slice(b"mdat");
    out.extend_from_slice(payload);
    out
}

/// ISO-639-2/T code packed into 15 bits; "und" when unknown.
pub fn packed_language(code: &str) -> u16 {
    let letters: Vec<u8> = code.bytes().map(|c| c.to_ascii_lowercase()).collect();
    if letters.len() != 3 || !letters.iter().all(|c| c.is_ascii_lowercase()) {
        return packed_language("und");
    }
    letters.iter().fold(0u16, |v, &c| v << 5 | (c - 0x60) as u16)
}

// MARK: Sample entries

pub fn visual_sample_entry(kind: &[u8; 4], width: u32, height: u32, children: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(children.len() + 100);
    bx(&mut out, kind, |w| {
        w.zeros(6);
        w.u16(1);
        w.u16(0);
        w.u16(0);
        w.zeros(12);
        w.u16(width.min(0xFFFF) as u16);
        w.u16(height.min(0xFFFF) as u16);
        w.u32(0x0048_0000);
        w.u32(0x0048_0000);
        w.u32(0);
        w.u16(1);
        w.zeros(32);
        w.u16(0x0018);
        w.u16(0xFFFF);
        w.extend_from_slice(children);
    });
    out
}

pub fn audio_sample_entry(kind: &[u8; 4], channels: u32, sample_rate: u32, children: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(children.len() + 40);
    bx(&mut out, kind, |w| {
        w.zeros(6);
        w.u16(1);
        w.zeros(8);
        w.u16(channels.min(0xFFFF) as u16);
        w.u16(16);
        w.u16(0);
        w.u16(0);
        w.u32(sample_rate.min(65535) << 16);
        w.extend_from_slice(children);
    });
    out
}

pub fn esds(object_type: u8, decoder_specific_info: &[u8]) -> Vec<u8> {
    fn descriptor(tag: u8, body: &[u8]) -> Vec<u8> {
        // The four-byte size form keeps every decoder happy.
        let n = body.len();
        let mut out = vec![tag, 0x80 | (n >> 21) as u8 & 0x7F, 0x80 | (n >> 14) as u8 & 0x7F, 0x80 | (n >> 7) as u8 & 0x7F, n as u8 & 0x7F];
        out.extend_from_slice(body);
        out
    }
    let mut config = vec![object_type, 0x15, 0, 0, 0];
    config.zeros(8);
    if !decoder_specific_info.is_empty() {
        config.extend(descriptor(0x05, decoder_specific_info));
    }
    let mut es = vec![0, 1, 0];
    es.extend(descriptor(0x04, &config));
    es.extend(descriptor(0x06, &[0x02]));
    let mut out = Vec::new();
    full(&mut out, b"esds", 0, 0, |w| w.extend(descriptor(0x03, &es)));
    out
}

pub fn colr(c: &Colour) -> Vec<u8> {
    let mut out = Vec::new();
    bx(&mut out, b"colr", |w| {
        w.extend_from_slice(b"nclx");
        w.u16(c.primaries.unwrap_or(2).min(0xFFFF) as u16);
        w.u16(c.transfer.unwrap_or(2).min(0xFFFF) as u16);
        w.u16(c.matrix.unwrap_or(2).min(0xFFFF) as u16);
        w.push(if c.range == Some(2) { 0x80 } else { 0 });
    });
    out
}

/// Mastering display colour volume: primaries in G, B, R order, units of 0.00002; luminance in 0.0001 cd/m².
pub fn mdcv(m: &[f64; 10]) -> Vec<u8> {
    let chroma = |v: f64| (v * 50000.0).round().clamp(0.0, 65535.0) as u16;
    let mut out = Vec::new();
    bx(&mut out, b"mdcv", |w| {
        for (x, y) in [(2, 3), (4, 5), (0, 1)] {
            w.u16(chroma(m[x]));
            w.u16(chroma(m[y]));
        }
        w.u16(chroma(m[6]));
        w.u16(chroma(m[7]));
        w.u32((m[8] * 10000.0).round().clamp(0.0, u32::MAX as f64) as u32);
        w.u32((m[9] * 10000.0).round().clamp(0.0, u32::MAX as f64) as u32);
    });
    out
}

pub fn clli(max_cll: u32, max_fall: u32) -> Vec<u8> {
    let mut out = Vec::new();
    bx(&mut out, b"clli", |w| {
        w.u16(max_cll.min(0xFFFF) as u16);
        w.u16(max_fall.min(0xFFFF) as u16);
    });
    out
}

pub fn pasp(h: u32, v: u32) -> Vec<u8> {
    let mut out = Vec::new();
    bx(&mut out, b"pasp", |w| {
        w.u32(h);
        w.u32(v);
    });
    out
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// (type, offset, size) of each box at the top level of `b`.
    pub fn boxes(b: &[u8]) -> Vec<([u8; 4], usize, usize)> {
        let mut out = Vec::new();
        let mut i = 0;
        while i + 8 <= b.len() {
            let size = u32::from_be_bytes(b[i..i + 4].try_into().unwrap()) as usize;
            out.push((b[i + 4..i + 8].try_into().unwrap(), i, size));
            if size < 8 {
                break;
            }
            i += size;
        }
        out
    }

    /// The first box of `kind` anywhere under `b`, found by its type bytes.
    pub fn find(b: &[u8], kind: &[u8; 4]) -> Option<usize> {
        b.windows(4).position(|w| w == kind).map(|p| p - 4)
    }

    #[test]
    fn languages() {
        assert_eq!(packed_language("eng"), 0x15C7);
        assert_eq!(packed_language("en"), packed_language("und"));
    }

    #[test]
    fn init_segment_structure() {
        let entry = audio_sample_entry(b"mp4a", 2, 48000, &esds(0x40, &[0x11, 0x90]));
        let init = init_segment(&TrackInfo { video: false, timescale: 48000, language: "eng", width: 0, height: 0, sample_entry: &entry });
        let top = boxes(&init);
        assert_eq!(top.iter().map(|b| &b.0).collect::<Vec<_>>(), vec![b"ftyp", b"moov"]);
        assert_eq!(top.iter().map(|b| b.2).sum::<usize>(), init.len(), "box sizes add up");
        for kind in [b"mvhd", b"trak", b"tkhd", b"mdia", b"mdhd", b"hdlr", b"minf", b"smhd", b"stbl", b"stsd", b"mp4a", b"esds", b"mvex", b"trex"] {
            assert!(find(&init, kind).is_some(), "{}", String::from_utf8_lossy(kind));
        }
        let mdhd = find(&init, b"mdhd").unwrap();
        assert_eq!(u32::from_be_bytes(init[mdhd + 20..mdhd + 24].try_into().unwrap()), 48000, "timescale");
        // Every box nested in moov closes inside it.
        let moov = top[1];
        let mut i = moov.1 + 8;
        while i < moov.1 + moov.2 {
            let size = u32::from_be_bytes(init[i..i + 4].try_into().unwrap()) as usize;
            assert!(size >= 8 && i + size <= moov.1 + moov.2);
            i += size;
        }
        assert_eq!(i, moov.1 + moov.2);
    }

    #[test]
    fn fragment_offsets_point_at_the_payload() {
        let samples = [
            Sample { size: 3, duration: 3750, composition_offset: 7500, sync: true },
            Sample { size: 2, duration: 3750, composition_offset: 0, sync: false },
        ];
        let payload = [1, 2, 3, 4, 5];
        let f = fragment(7, 90_000, &samples, &payload, true);
        let top = boxes(&f);
        assert_eq!(top.iter().map(|b| &b.0).collect::<Vec<_>>(), vec![b"moof", b"mdat"]);
        let trun = find(&f, b"trun").unwrap();
        let count = u32::from_be_bytes(f[trun + 12..trun + 16].try_into().unwrap());
        let offset = u32::from_be_bytes(f[trun + 16..trun + 20].try_into().unwrap()) as usize;
        assert_eq!(count, 2);
        assert_eq!(&f[offset..offset + 5], &payload);
        let tfdt = find(&f, b"tfdt").unwrap();
        assert_eq!(u64::from_be_bytes(f[tfdt + 12..tfdt + 20].try_into().unwrap()), 90_000);
        let mfhd = find(&f, b"mfhd").unwrap();
        assert_eq!(u32::from_be_bytes(f[mfhd + 12..mfhd + 16].try_into().unwrap()), 7);
    }
}
