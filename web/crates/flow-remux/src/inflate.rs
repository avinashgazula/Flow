//! DEFLATE (RFC 1951) for zlib-compressed tracks: mkvmerge compresses subtitle tracks this way
//! by default. A port of FlowKit's Inflate.swift; small and only ever fed short frames.

struct Bits<'a> {
    bytes: &'a [u8],
    position: usize,
    buffer: u32,
    count: u32,
}

impl Bits<'_> {
    fn bits(&mut self, n: u32) -> Option<u32> {
        while self.count < n {
            let byte = *self.bytes.get(self.position)?;
            self.buffer |= (byte as u32) << self.count;
            self.position += 1;
            self.count += 8;
        }
        let value = self.buffer & ((1u32 << n) - 1);
        self.buffer = if n == 32 { 0 } else { self.buffer >> n };
        self.count -= n;
        Some(value)
    }
}

/// Canonical Huffman decoding table.
struct Huffman {
    counts: [u16; 16],
    symbols: Vec<u16>,
}

impl Huffman {
    fn new(lengths: &[u8]) -> Huffman {
        let mut counts = [0u16; 16];
        for &len in lengths {
            counts[len as usize & 15] += 1;
        }
        counts[0] = 0;
        let mut offsets = [0u16; 16];
        for i in 1..16 {
            offsets[i] = offsets[i - 1] + counts[i - 1];
        }
        let mut symbols = vec![0u16; lengths.len()];
        for (symbol, &len) in lengths.iter().enumerate() {
            if len != 0 {
                let slot = &mut offsets[len as usize & 15];
                if let Some(s) = symbols.get_mut(*slot as usize) {
                    *s = symbol as u16;
                }
                *slot += 1;
            }
        }
        Huffman { counts, symbols }
    }

    fn decode(&self, bits: &mut Bits) -> Option<u16> {
        let (mut code, mut first, mut index) = (0i32, 0i32, 0i32);
        for len in 1..16 {
            code |= bits.bits(1)? as i32;
            let count = self.counts[len] as i32;
            if code - count < first {
                return self.symbols.get((index + code - first) as usize).copied();
            }
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        None
    }
}

const LENGTH_BASE: [u16; 29] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/// Output larger than this is a decompression bomb, not a subtitle.
const MAX_OUTPUT: usize = 16 * 1024 * 1024;

/// A zlib stream (two header bytes, then DEFLATE).
pub fn zlib(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 2 || data[0] & 0x0F != 8 || (u16::from(data[0]) << 8 | u16::from(data[1])) % 31 != 0 {
        return None;
    }
    raw(&data[2..])
}

pub fn raw(data: &[u8]) -> Option<Vec<u8>> {
    let mut bits = Bits { bytes: data, position: 0, buffer: 0, count: 0 };
    let mut out = Vec::with_capacity(data.len() * 3);
    loop {
        let last = bits.bits(1)? == 1;
        match bits.bits(2)? {
            0 => {
                bits.buffer = 0;
                bits.count = 0;
                let p = bits.position;
                let header = data.get(p..p + 4)?;
                let len = u16::from_le_bytes([header[0], header[1]]) as usize;
                out.extend_from_slice(data.get(p + 4..p + 4 + len)?);
                bits.position = p + 4 + len;
            }
            1 => {
                let mut lengths = [8u8; 288];
                lengths[144..256].fill(9);
                lengths[256..280].fill(7);
                block(&mut bits, &mut out, &Huffman::new(&lengths), &Huffman::new(&[5u8; 30]))?;
            }
            2 => {
                let (literal, distance) = dynamic_tables(&mut bits)?;
                block(&mut bits, &mut out, &literal, &distance)?;
            }
            _ => return None,
        }
        if last {
            return Some(out);
        }
    }
}

fn dynamic_tables(bits: &mut Bits) -> Option<(Huffman, Huffman)> {
    let hlit = bits.bits(5)? as usize + 257;
    let hdist = bits.bits(5)? as usize + 1;
    let hclen = bits.bits(4)? as usize + 4;
    const ORDER: [usize; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    let mut code_lengths = [0u8; 19];
    for &slot in ORDER.iter().take(hclen) {
        code_lengths[slot] = bits.bits(3)? as u8;
    }
    let table = Huffman::new(&code_lengths);
    let mut lengths: Vec<u8> = Vec::with_capacity(hlit + hdist);
    while lengths.len() < hlit + hdist {
        let (value, repeat) = match table.decode(bits)? {
            sym @ 0..=15 => (sym as u8, 1),
            16 => (*lengths.last()?, 3 + bits.bits(2)? as usize),
            17 => (0, 3 + bits.bits(3)? as usize),
            _ => (0, 11 + bits.bits(7)? as usize),
        };
        lengths.extend(std::iter::repeat(value).take(repeat));
    }
    if lengths.len() > hlit + hdist {
        return None;
    }
    Some((Huffman::new(&lengths[..hlit]), Huffman::new(&lengths[hlit..])))
}

fn block(bits: &mut Bits, out: &mut Vec<u8>, literal: &Huffman, distance: &Huffman) -> Option<()> {
    loop {
        let sym = literal.decode(bits)? as usize;
        if sym < 256 {
            out.push(sym as u8);
        } else if sym == 256 {
            return Some(());
        } else {
            let li = sym - 257;
            let length = *LENGTH_BASE.get(li)? as usize + bits.bits(LENGTH_EXTRA[li] as u32)? as usize;
            let di = distance.decode(bits)? as usize;
            let dist = *DIST_BASE.get(di)? as usize + bits.bits(DIST_EXTRA[di] as u32)? as usize;
            if dist > out.len() || out.len() + length > MAX_OUTPUT {
                return None;
            }
            let start = out.len() - dist;
            for k in 0..length {
                let byte = out[start + k];
                out.push(byte);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inflates_zlib() {
        // zlib.compress(b"Hello, Hello, Hello, subtitles!") from Python.
        let data = [
            0x78, 0x9c, 0xf3, 0x48, 0xcd, 0xc9, 0xc9, 0xd7, 0x51, 0xf0, 0x40, 0xa1, 0x8a, 0x4b, 0x93, 0x4a, 0x32, 0x4b, 0x72, 0x52, 0x8b, 0x15, 0x01,
            0xa8, 0x0b, 0x0a, 0xc1,
        ];
        assert_eq!(zlib(&data).as_deref(), Some(&b"Hello, Hello, Hello, subtitles!"[..]));
        assert_eq!(zlib(b"plain text"), None);
        assert_eq!(zlib(&data[..10]), None);
    }
}
