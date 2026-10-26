//! Picture subtitles: Blu-ray PGS and DVD VobSub, decoded to palette-indexed bitmaps the player draws on a
//! canvas. A port of FlowKit's PGS.swift and VobSub.swift, with one difference: colours leave here as straight
//! (not premultiplied) RGBA, which is what a canvas's `ImageData` takes.
//!
//! Nothing here may panic: the build aborts on a panic, and subtitles come from files nobody has vetted. Every
//! read is bounds-checked, every allocation is sized by a value that was range-checked first.

use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PictureFormat {
    Pgs,
    VobSub,
}

/// One bitmap on the subtitle canvas.
#[derive(Clone, Debug, PartialEq)]
pub struct Object {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// One palette index per pixel, row by row.
    pub indices: Vec<u8>,
}

/// A subtitle ready to draw: what is on screen from `start` until the next cue (or `end`, when the packet says).
#[derive(Clone, Debug, PartialEq)]
pub struct PictureCue {
    /// Nanoseconds on the file's timeline.
    pub start: i64,
    pub end: Option<i64>,
    /// The canvas the positions refer to (usually the video's coded size).
    pub canvas_width: u16,
    pub canvas_height: u16,
    /// Empty: the screen is cleared.
    pub objects: Vec<Object>,
    /// Straight RGBA for each palette index the objects use.
    pub palette: Vec<[u8; 4]>,
    /// Forced captions (signs, foreign dialogue) show even when subtitles are off.
    pub forced: bool,
}

/// Decodes one track's packets, in time order. PGS keeps palettes and objects between packets (a display set
/// can update only part of the screen); VobSub packets stand alone.
pub enum Decoder {
    Pgs(Pgs),
    VobSub(VobSub),
}

impl Decoder {
    pub fn new(format: PictureFormat, codec_private: &[u8], video: (u32, u32)) -> Decoder {
        match format {
            PictureFormat::Pgs => Decoder::Pgs(Pgs::default()),
            PictureFormat::VobSub => Decoder::VobSub(VobSub::new(codec_private, video)),
        }
    }

    pub fn decode(&mut self, data: &[u8], start: i64) -> Option<PictureCue> {
        match self {
            Decoder::Pgs(pgs) => pgs.decode(data, start),
            Decoder::VobSub(vob) => vob.decode(data, start),
        }
    }

    /// Forgets what earlier packets set up (after a seek, the next packet comes from somewhere else).
    pub fn reset(&mut self) {
        if let Decoder::Pgs(pgs) = self {
            *pgs = Pgs::default();
        }
    }
}

// MARK: PGS

/// Blu-ray graphics fit a 1920×1080 plane (4K discs use the same); anything larger is corrupt and would
/// otherwise allocate gigabytes.
const PGS_MAX_WIDTH: usize = 4096;
const PGS_MAX_HEIGHT: usize = 2304;
const PGS_MAX_OBJECT_DATA: usize = 8 * 1024 * 1024;

struct PgsObject {
    width: usize,
    height: usize,
    indices: Vec<u8>,
}

struct Pending {
    width: usize,
    height: usize,
    data: Vec<u8>,
}

struct Placement {
    object: u16,
    x: u16,
    y: u16,
    forced: bool,
    crop: Option<(usize, usize, usize, usize)>,
}

struct Composition {
    width: u16,
    height: u16,
    palette: u8,
    placements: Vec<Placement>,
}

#[derive(Default)]
pub struct Pgs {
    palettes: HashMap<u8, Vec<[u8; 4]>>,
    objects: HashMap<u16, PgsObject>,
    pending: HashMap<u16, Pending>,
}

fn be16(p: &[u8], i: usize) -> Option<usize> {
    Some((*p.get(i)? as usize) << 8 | *p.get(i + 1)? as usize)
}

impl Pgs {
    /// One display set as Matroska stores it: segments of (type, 16-bit length, payload), without the "PG"
    /// timestamp header. A cue with objects, an empty cue (clear the screen), or None for nothing to say.
    pub fn decode(&mut self, data: &[u8], start: i64) -> Option<PictureCue> {
        let mut i = 0;
        let mut composition: Option<Composition> = None;
        while i + 3 <= data.len() {
            let kind = data[i];
            let length = be16(data, i + 1)?;
            let from = i + 3;
            let to = data.len().min(from + length);
            let payload = &data[from..to];
            i = to;
            match kind {
                0x16 => {
                    composition = Self::composition(payload);
                    // An epoch start forgets everything earlier.
                    if payload.get(7) == Some(&0x80) {
                        self.palettes.clear();
                        self.objects.clear();
                        self.pending.clear();
                    }
                }
                0x14 => self.palette(payload),
                0x15 => self.object(payload),
                // End of the display set.
                0x80 => return Some(self.render(&composition?, start)),
                // 0x17 window definitions: positions come from the composition.
                _ => {}
            }
        }
        composition.map(|c| self.render(&c, start))
    }

    fn composition(p: &[u8]) -> Option<Composition> {
        if p.len() < 11 {
            return None;
        }
        let mut c = Composition { width: be16(p, 0)? as u16, height: be16(p, 2)? as u16, palette: p[9], placements: Vec::new() };
        let count = p[10] as usize;
        let mut i = 11;
        for _ in 0..count {
            if i + 8 > p.len() {
                break;
            }
            let object = be16(p, i)? as u16;
            let flags = p[i + 3];
            let (x, y) = (be16(p, i + 4)? as u16, be16(p, i + 6)? as u16);
            i += 8;
            let mut crop = None;
            if flags & 0x80 != 0 && i + 8 <= p.len() {
                crop = Some((be16(p, i)?, be16(p, i + 2)?, be16(p, i + 4)?, be16(p, i + 6)?));
                i += 8;
            }
            c.placements.push(Placement { object, x, y, forced: flags & 0x40 != 0, crop });
        }
        Some(c)
    }

    fn palette(&mut self, p: &[u8]) {
        let Some(&id) = p.first() else { return };
        let palette = self.palettes.entry(id).or_insert_with(|| vec![[0; 4]; 256]);
        let mut i = 2;
        while i + 5 <= p.len() {
            palette[p[i] as usize] = rgba(p[i + 1], p[i + 2], p[i + 3], p[i + 4]);
            i += 5;
        }
    }

    fn object(&mut self, p: &[u8]) {
        let (Some(id), Some(&sequence)) = (be16(p, 0).map(|v| v as u16), p.get(3)) else { return };
        let mut i = 4;
        if sequence & 0x80 != 0 {
            // First fragment: the data length (3 bytes) and the size follow.
            let (Some(width), Some(height)) = (be16(p, 7), be16(p, 9)) else { return };
            i = 11;
            if width == 0 || height == 0 || width > PGS_MAX_WIDTH || height > PGS_MAX_HEIGHT {
                self.pending.remove(&id);
                return;
            }
            self.pending.insert(id, Pending { width, height, data: Vec::new() });
        }
        let Some(pending) = self.pending.get_mut(&id) else { return };
        if i > p.len() {
            return;
        }
        pending.data.extend_from_slice(&p[i..]);
        if pending.data.len() > PGS_MAX_OBJECT_DATA {
            self.pending.remove(&id);
            return;
        }
        if sequence & 0x40 != 0 {
            if let Some(done) = self.pending.remove(&id) {
                let indices = decode_rle(&done.data, done.width, done.height);
                self.objects.insert(id, PgsObject { width: done.width, height: done.height, indices });
            }
        }
    }

    fn render(&self, c: &Composition, start: i64) -> PictureCue {
        let mut placed = Vec::new();
        let mut forced = !c.placements.is_empty();
        for p in &c.placements {
            let Some(object) = self.objects.get(&p.object) else { continue };
            forced = forced && p.forced;
            let whole = || Object { x: p.x, y: p.y, width: object.width as u16, height: object.height as u16, indices: object.indices.clone() };
            match p.crop {
                Some((cx, cy, cw, ch)) if cw > 0 && ch > 0 && cx + cw <= object.width && cy + ch <= object.height => {
                    let mut indices = Vec::with_capacity(cw * ch);
                    for row in cy..cy + ch {
                        let base = row * object.width + cx;
                        indices.extend_from_slice(&object.indices[base..base + cw]);
                    }
                    placed.push(Object { x: p.x, y: p.y, width: cw as u16, height: ch as u16, indices });
                }
                _ => placed.push(whole()),
            }
        }
        let palette = self.palettes.get(&c.palette).cloned().unwrap_or_else(|| vec![[0; 4]; 256]);
        PictureCue { start, end: None, canvas_width: c.width, canvas_height: c.height, objects: placed, palette, forced }
    }
}

/// BT.709 limited range to straight RGBA.
pub fn rgba(y: u8, cr: u8, cb: u8, alpha: u8) -> [u8; 4] {
    let yf = 1.164 * (y as f64 - 16.0);
    let (crf, cbf) = (cr as f64 - 128.0, cb as f64 - 128.0);
    let clamp = |v: f64| v.round().clamp(0.0, 255.0) as u8;
    [clamp(yf + 1.793 * crf), clamp(yf - 0.213 * cbf - 0.533 * crf), clamp(yf + 2.112 * cbf), alpha]
}

/// PGS run-length coding: a non-zero byte is one pixel; 0x00 introduces a run or ends the line.
pub fn decode_rle(data: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut out = vec![0u8; width * height];
    let (mut x, mut y, mut i) = (0usize, 0usize, 0usize);
    let mut put = |x: &mut usize, y: usize, colour: u8, count: usize| {
        if y >= height {
            return;
        }
        let n = count.min(width.saturating_sub(*x));
        if n > 0 && colour != 0 {
            let base = y * width + *x;
            out[base..base + n].fill(colour);
        }
        *x += n;
    };
    while i < data.len() && y < height {
        let b = data[i];
        i += 1;
        if b != 0 {
            put(&mut x, y, b, 1);
            continue;
        }
        let Some(&c) = data.get(i) else { break };
        i += 1;
        if c == 0 {
            x = 0;
            y += 1;
            continue;
        }
        let low = (c & 0x3F) as usize;
        match c & 0xC0 {
            0x00 => put(&mut x, y, 0, low),
            0x40 => {
                let Some(&next) = data.get(i) else { break };
                i += 1;
                put(&mut x, y, 0, low << 8 | next as usize);
            }
            0x80 => {
                let Some(&colour) = data.get(i) else { break };
                i += 1;
                put(&mut x, y, colour, low);
            }
            _ => {
                let (Some(&count), Some(&colour)) = (data.get(i), data.get(i + 1)) else { break };
                i += 2;
                put(&mut x, y, colour, low << 8 | count as usize);
            }
        }
    }
    out
}

// MARK: VobSub

pub struct VobSub {
    canvas_width: u16,
    canvas_height: u16,
    /// 0xRRGGBB for each of the DVD's 16 palette entries.
    palette: [u32; 16],
}

impl VobSub {
    /// The track's CodecPrivate is the .idx header, with the canvas size and the 16-colour palette.
    pub fn new(codec_private: &[u8], video: (u32, u32)) -> VobSub {
        let text = String::from_utf8_lossy(codec_private);
        let (mut width, mut height) = (video.0.clamp(1, 4096), video.1.clamp(1, 4096));
        let mut palette = [0u32; 16];
        for (i, entry) in palette.iter_mut().enumerate() {
            *entry = [0x000000, 0xFFFFFF, 0x808080, 0x000000][i % 4];
        }
        for line in text.lines() {
            let Some((key, value)) = line.split_once(':') else { continue };
            let (key, value) = (key.trim().to_ascii_lowercase(), value.trim());
            if key == "size" {
                let dims: Vec<u32> = value.to_ascii_lowercase().split('x').filter_map(|d| d.trim().parse().ok()).collect();
                if let [w, h] = dims[..] {
                    if (1..=4096).contains(&w) && (1..=4096).contains(&h) {
                        (width, height) = (w, h);
                    }
                }
            } else if key == "palette" {
                let colours: Vec<u32> = value.split(',').filter_map(|c| u32::from_str_radix(c.trim(), 16).ok()).collect();
                if colours.len() >= 16 {
                    palette.copy_from_slice(&colours[..16]);
                }
            }
        }
        VobSub { canvas_width: width as u16, canvas_height: height as u16, palette }
    }

    /// One subpicture unit: a cue with its picture (ending when the packet says to stop), or None.
    pub fn decode(&mut self, data: &[u8], start: i64) -> Option<PictureCue> {
        if data.len() < 4 {
            return None;
        }
        let u16_at = |i: usize| be16(data, i).unwrap_or(0);
        let size = if u16_at(0) == 0 { data.len() } else { data.len().min(u16_at(0)) };
        let mut sequence = u16_at(2);

        let mut colours = [0usize, 1, 2, 3];
        let mut alphas = [0u32, 15, 15, 15];
        let mut area: Option<(usize, usize, usize, usize)> = None;
        let mut fields: Option<(usize, usize)> = None;
        let (mut forced, mut shows) = (false, false);
        let mut stop: Option<f64> = None;

        // Control sequences: a delay (in 1024/90000 s), the next sequence's offset, then commands.
        let mut visited: Vec<usize> = Vec::new();
        while sequence + 4 <= size && !visited.contains(&sequence) {
            visited.push(sequence);
            let raw_delay = u16_at(sequence);
            // Some muxers write the largest delay to mean "until the next picture".
            let delay = if raw_delay == 0xFFFF { 0.0 } else { raw_delay as f64 * 1024.0 / 90_000.0 };
            let next = u16_at(sequence + 2);
            let mut i = sequence + 4;
            while i < size {
                let command = data[i];
                i += 1;
                match command {
                    0x00 => (forced, shows) = (true, true),
                    0x01 => shows = true,
                    0x02 => {
                        if delay > 0.0 {
                            stop = Some(delay);
                        }
                    }
                    0x03 => {
                        if i + 2 > size {
                            break;
                        }
                        colours = [(data[i + 1] & 0x0F) as usize, (data[i + 1] >> 4) as usize, (data[i] & 0x0F) as usize, (data[i] >> 4) as usize];
                        i += 2;
                    }
                    0x04 => {
                        if i + 2 > size {
                            break;
                        }
                        alphas = [(data[i + 1] & 0x0F) as u32, (data[i + 1] >> 4) as u32, (data[i] & 0x0F) as u32, (data[i] >> 4) as u32];
                        i += 2;
                    }
                    0x05 => {
                        if i + 6 > size {
                            break;
                        }
                        let x1 = (data[i] as usize) << 4 | (data[i + 1] as usize) >> 4;
                        let x2 = ((data[i + 1] & 0x0F) as usize) << 8 | data[i + 2] as usize;
                        let y1 = (data[i + 3] as usize) << 4 | (data[i + 4] as usize) >> 4;
                        let y2 = ((data[i + 4] & 0x0F) as usize) << 8 | data[i + 5] as usize;
                        area = Some((x1, y1, x2, y2));
                        i += 6;
                    }
                    0x06 => {
                        if i + 4 > size {
                            break;
                        }
                        fields = Some((u16_at(i), u16_at(i + 2)));
                        i += 4;
                    }
                    // Extended commands: a length, then data we don't use.
                    0x07 => {
                        if i + 2 > size {
                            break;
                        }
                        i += u16_at(i).max(2);
                    }
                    // 0xFF ends the sequence.
                    _ => break,
                }
            }
            if next == sequence {
                break;
            }
            sequence = next;
        }

        let (x1, y1, x2, y2) = area?;
        let (top, bottom) = fields?;
        if !shows || x2 < x1 || y2 < y1 {
            return None;
        }
        let (width, height) = (x2 - x1 + 1, y2 - y1 + 1);
        // DVD subpictures fit the 720×576 frame; allow some slack for odd authoring, not corrupt sizes.
        if width > (self.canvas_width as usize).max(720) * 2 || height > (self.canvas_height as usize).max(576) * 2 {
            return None;
        }
        let mut indices = vec![0u8; width * height];
        // Interlaced: even lines from the top field, odd lines from the bottom.
        decode_field(data, top, size, width, 0, height, &mut indices);
        decode_field(data, bottom, size, width, 1, height, &mut indices);

        let mut palette = vec![[0u8; 4]; 4];
        for k in 0..4 {
            let rgb = self.palette[colours[k] & 0x0F];
            palette[k] = [(rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8, (alphas[k] * 17) as u8];
        }
        if !indices.iter().any(|&i| palette[(i & 3) as usize][3] != 0) {
            return None;
        }
        let object = Object { x: x1 as u16, y: y1 as u16, width: width as u16, height: height as u16, indices };
        Some(PictureCue {
            start,
            end: stop.map(|s| start + (s * 1e9) as i64),
            canvas_width: self.canvas_width,
            canvas_height: self.canvas_height,
            objects: vec![object],
            palette,
            forced,
        })
    }
}

/// Nibble run-length coding: 1–4 nibbles give a run (value >> 2) of colour (value & 3); a zero run fills to the
/// end of the line, and each line starts on a byte boundary. Rows `first, first + 2, …` below `height`.
fn decode_field(data: &[u8], offset: usize, limit: usize, width: usize, first: usize, height: usize, out: &mut [u8]) {
    struct Nibbles<'a> {
        data: &'a [u8],
        at: usize,
    }
    impl Nibbles<'_> {
        fn next(&mut self) -> Option<usize> {
            let byte = *self.data.get(self.at / 2)?;
            let value = if self.at % 2 == 0 { byte >> 4 } else { byte & 0x0F };
            self.at += 1;
            Some(value as usize)
        }
    }
    let mut nibbles = Nibbles { data: &data[..limit.min(data.len())], at: offset * 2 };
    let mut row = first;
    while row < height {
        let mut x = 0;
        while x < width {
            let Some(mut v) = nibbles.next() else { return };
            if v < 0x4 {
                let Some(n) = nibbles.next() else { return };
                v = v << 4 | n;
                if v < 0x10 {
                    let Some(n) = nibbles.next() else { return };
                    v = v << 4 | n;
                    if v < 0x40 {
                        let Some(n) = nibbles.next() else { return };
                        v = v << 4 | n;
                    }
                }
            }
            let colour = (v & 3) as u8;
            let run = if v >> 2 == 0 { width - x } else { (v >> 2).min(width - x) };
            if colour != 0 {
                let base = row * width + x;
                out[base..base + run].fill(colour);
            }
            x += run;
        }
        if nibbles.at % 2 == 1 {
            nibbles.at += 1;
        }
        row += 2;
    }
}

// MARK: Handing cues to the page

/// The bytes the page reads (see lib/remux/pictures.ts), all big-endian:
/// `u32 cues`, then per cue `f64 start`, `f64 end` (NaN: none), `u16 canvasWidth`, `u16 canvasHeight`, `u8 forced`,
/// `u8 objects`, `u16 palette entries` and that many `u8×4` RGBA, then per object `u16 x, y, width, height` and
/// `width × height` palette indices. `delay` is added to every time.
pub fn encode(cues: &[PictureCue], delay: i64) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&(cues.len() as u32).to_be_bytes());
    for cue in cues {
        out.extend_from_slice(&((cue.start + delay) as f64 / 1e9).to_be_bytes());
        out.extend_from_slice(&cue.end.map_or(f64::NAN, |e| (e + delay) as f64 / 1e9).to_be_bytes());
        out.extend_from_slice(&cue.canvas_width.to_be_bytes());
        out.extend_from_slice(&cue.canvas_height.to_be_bytes());
        out.push(cue.forced as u8);
        out.push(cue.objects.len().min(255) as u8);
        // Only the colours the pictures can name.
        let used = cue.objects.iter().flat_map(|o| o.indices.iter()).copied().max().map_or(0, |m| m as usize + 1).min(cue.palette.len());
        out.extend_from_slice(&(used as u16).to_be_bytes());
        for colour in &cue.palette[..used] {
            out.extend_from_slice(colour);
        }
        for object in cue.objects.iter().take(255) {
            for v in [object.x, object.y, object.width, object.height] {
                out.extend_from_slice(&v.to_be_bytes());
            }
            out.extend_from_slice(&object.indices);
        }
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn segment(kind: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![kind, (payload.len() >> 8) as u8, payload.len() as u8];
        out.extend_from_slice(payload);
        out
    }

    /// One display set: a 4×2 white-and-clear object at (100, 900) on a 1920×1080 canvas (FlowKit's PGSTests).
    pub(crate) fn show_set() -> Vec<u8> {
        let pcs = [0x07, 0x80, 0x04, 0x38, 0x10, 0x00, 0x01, 0x80, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x03, 0x84];
        let pds = [0x00, 0x00, 0x01, 235, 128, 128, 255];
        // Row 0: four pixels of colour 1. Row 1: 1, two transparent, 1.
        let rle = [0x00, 0x84, 0x01, 0x00, 0x00, 0x01, 0x00, 0x02, 0x01, 0x00, 0x00];
        let length = rle.len() + 4;
        let mut ods = vec![0x00, 0x00, 0x00, 0xC0, (length >> 16) as u8, (length >> 8) as u8, length as u8, 0x00, 0x04, 0x00, 0x02];
        ods.extend_from_slice(&rle);
        [segment(0x16, &pcs), segment(0x14, &pds), segment(0x15, &ods), segment(0x80, &[])].concat()
    }

    pub(crate) fn clear_set() -> Vec<u8> {
        [segment(0x16, &[0x07, 0x80, 0x04, 0x38, 0x10, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]), segment(0x80, &[])].concat()
    }

    #[test]
    fn pgs_decodes_a_display_set() {
        let mut pgs = Pgs::default();
        let cue = pgs.decode(&show_set(), 12_500_000_000).unwrap();
        assert_eq!(cue.start, 12_500_000_000);
        assert_eq!((cue.canvas_width, cue.canvas_height), (1920, 1080));
        let object = &cue.objects[0];
        assert_eq!((object.x, object.y, object.width, object.height), (100, 900, 4, 2));
        assert_eq!(object.indices, [1, 1, 1, 1, 1, 0, 0, 1]);
        assert_eq!(cue.palette[1], [255, 255, 255, 255], "Y 235 is full white, opaque");
        assert_eq!(cue.palette[0][3], 0, "palette index 0 is transparent");
        assert!(!cue.forced);

        let cleared = pgs.decode(&clear_set(), 15_000_000_000).unwrap();
        assert!(cleared.objects.is_empty());
    }

    #[test]
    fn pgs_colours_are_straight_not_premultiplied() {
        // Half-transparent white keeps its full colour; only the alpha says how much shows.
        assert_eq!(rgba(235, 128, 128, 128), [255, 255, 255, 128]);
        assert_eq!(rgba(16, 128, 128, 255), [0, 0, 0, 255]);
        // Pure BT.709 red: Y 63, Cr 240, Cb 102.
        let red = rgba(63, 240, 102, 255);
        assert!(red[0] > 240 && red[1] < 20 && red[2] < 20, "{red:?}");
    }

    #[test]
    fn pgs_cropped_objects_and_forced_flags() {
        // The same object placed with a crop window (bit 0x80) of its right two columns and the forced flag (0x40).
        let mut pcs = vec![0x07, 0x80, 0x04, 0x38, 0x10, 0x00, 0x01, 0x80, 0x00, 0x00, 0x01];
        pcs.extend_from_slice(&[0x00, 0x00, 0x00, 0xC0, 0x00, 0x64, 0x03, 0x84]);
        pcs.extend_from_slice(&[0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02]);
        let set = show_set();
        // Keep the palette and object segments of the plain set, and swap in the new composition.
        let rest = &set[3 + 19..];
        let cue = Pgs::default().decode(&[segment(0x16, &pcs), rest.to_vec()].concat(), 0).unwrap();
        assert!(cue.forced);
        let object = &cue.objects[0];
        assert_eq!((object.width, object.height), (2, 2));
        assert_eq!(object.indices, [1, 1, 0, 1]);
    }

    #[test]
    fn pgs_objects_in_several_fragments() {
        let mut pgs = Pgs::default();
        let set = show_set();
        // Split the object's data over two segments: first fragment (0x80) then last (0x40).
        let ods = &set[3 + 19 + 3 + 7 + 3..set.len() - 3];
        let (head, tail) = ods.split_at(13);
        let mut first = head.to_vec();
        first[3] = 0x80;
        let mut last = vec![0x00, 0x00, 0x00, 0x40];
        last.extend_from_slice(tail);
        let pcs = &set[3..3 + 19];
        let pds = &set[3 + 19 + 3..3 + 19 + 3 + 7];
        let rebuilt = [segment(0x16, pcs), segment(0x14, pds), segment(0x15, &first), segment(0x15, &last), segment(0x80, &[])].concat();
        assert_eq!(pgs.decode(&rebuilt, 0).unwrap().objects[0].indices, [1, 1, 1, 1, 1, 0, 0, 1]);
    }

    #[test]
    fn pgs_epoch_start_forgets_older_objects() {
        let mut pgs = Pgs::default();
        pgs.decode(&show_set(), 0).unwrap();
        // A display set that places object 0 without defining it, in a new epoch (state 0x80): nothing to draw.
        let pcs = [0x07, 0x80, 0x04, 0x38, 0x10, 0x00, 0x01, 0x80, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x03, 0x84];
        let again = pgs.decode(&[segment(0x16, &pcs), segment(0x80, &[])].concat(), 1).unwrap();
        assert!(again.objects.is_empty());
    }

    #[test]
    fn pgs_run_length_edge_cases() {
        // 0x40 long transparent run, 0x80 coloured run, 0xC0 long coloured run, a line break, and a run that overshoots the line.
        let data = [0x00, 0x42, 0x01, 0x00, 0x83, 0x05, 0x00, 0xC0, 0x02, 0x07, 0x00, 0x00, 0x00, 0x88, 0x09, 0x00, 0x00];
        let out = decode_rle(&data, 3, 2);
        assert_eq!(&out[..3], &[0, 0, 0], "a 0x201-wide transparent run is clipped to the line");
        assert_eq!(&out[3..], &[9, 9, 9], "a run longer than the line is clipped to it");
        // Truncated data ends the picture quietly.
        assert_eq!(decode_rle(&[0x00], 2, 2), vec![0; 4]);
        assert_eq!(decode_rle(&[0x00, 0xC0, 0x01], 2, 2), vec![0; 4]);
    }

    #[test]
    fn pgs_refuses_absurd_sizes() {
        // An object announcing 60000×60000 pixels is dropped, not allocated.
        let ods = [0x00, 0x00, 0x00, 0xC0, 0, 0, 8, 0xEA, 0x60, 0xEA, 0x60, 0x01, 0x01];
        let mut pgs = Pgs::default();
        pgs.decode(&segment(0x15, &ods), 0);
        assert!(pgs.objects.is_empty() && pgs.pending.is_empty());
    }

    /// A 4×2 subpicture at (10, 20): a white top line, a red bottom line, shown for two seconds (FlowKit's VobSubTests).
    pub(crate) fn vob_packet() -> Vec<u8> {
        let pixels = [0x11u8, 0x12];
        let (x1, x2, y1, y2) = (10usize, 13usize, 20usize, 21usize);
        let first = 4 + pixels.len();
        let mut seq1 = vec![
            0x00, 0x00, 0, 0, 0x01, 0x03, 0x32, 0x10, 0x04, 0xFF, 0xF0, 0x05, (x1 >> 4) as u8, ((x1 & 0xF) << 4 | x2 >> 8) as u8, (x2 & 0xFF) as u8, (y1 >> 4) as u8,
            ((y1 & 0xF) << 4 | y2 >> 8) as u8, (y2 & 0xFF) as u8, 0x06, 0x00, 0x04, 0x00, 0x05, 0xFF,
        ];
        let second = first + seq1.len();
        seq1[2] = (second >> 8) as u8;
        seq1[3] = (second & 0xFF) as u8;
        let seq2 = [0x00, 176, (second >> 8) as u8, (second & 0xFF) as u8, 0x02, 0xFF];
        let total = second + seq2.len();
        let mut out = vec![(total >> 8) as u8, (total & 0xFF) as u8, (first >> 8) as u8, (first & 0xFF) as u8];
        out.extend_from_slice(&pixels);
        out.extend_from_slice(&seq1);
        out.extend_from_slice(&seq2);
        out
    }

    pub(crate) const IDX: &str = "# VobSub index file\nsize: 720x576\npalette: 000000, ffffff, ff0000, 00ff00, 0000ff, 111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888, 999999, aaaaaa, bbbbbb\n";

    #[test]
    fn vobsub_decodes_a_subpicture() {
        let mut vob = VobSub::new(IDX.as_bytes(), (1920, 1080));
        assert_eq!((vob.canvas_width, vob.canvas_height), (720, 576), "the .idx header's size wins over the video's");
        let cue = vob.decode(&vob_packet(), 5_000_000_000).unwrap();
        let end = cue.end.unwrap() as f64 / 1e9;
        assert!((end - (5.0 + 176.0 * 1024.0 / 90_000.0)).abs() < 0.001, "{end}");
        assert!(!cue.forced);
        let object = &cue.objects[0];
        assert_eq!((object.x, object.y, object.width, object.height), (10, 20, 4, 2));
        assert_eq!(object.indices, [1, 1, 1, 1, 2, 2, 2, 2]);
        assert_eq!(cue.palette[1], [255, 255, 255, 255]);
        assert_eq!(cue.palette[2], [255, 0, 0, 255]);
        assert_eq!(cue.palette[0][3], 0);
    }

    #[test]
    fn vobsub_without_an_idx_header_uses_the_video_size() {
        let vob = VobSub::new(b"", (1280, 720));
        assert_eq!((vob.canvas_width, vob.canvas_height), (1280, 720));
    }

    #[test]
    fn corrupt_packets_never_panic() {
        // A cheap deterministic shuffle: flip bytes and cut packets short, many times over.
        let mut seed = 0x2545F491u32;
        let mut rand = move || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            seed
        };
        let mut vob = VobSub::new(IDX.as_bytes(), (720, 576));
        let mut pgs = Pgs::default();
        for _ in 0..4000 {
            for original in [show_set(), vob_packet(), clear_set()] {
                let mut bytes = original.clone();
                if rand() % 2 == 0 && !bytes.is_empty() {
                    bytes.truncate(rand() as usize % bytes.len());
                }
                for _ in 0..1 + rand() % 6 {
                    if !bytes.is_empty() {
                        let at = rand() as usize % bytes.len();
                        bytes[at] = rand() as u8;
                    }
                }
                let _ = pgs.decode(&bytes, 1);
                let _ = vob.decode(&bytes, 1);
            }
        }
    }

    #[test]
    fn the_page_gets_compact_big_endian_cues() {
        let cue = Pgs::default().decode(&show_set(), 1_000_000_000).unwrap();
        let bytes = encode(&[cue], 500_000_000);
        assert_eq!(&bytes[..4], &1u32.to_be_bytes());
        assert_eq!(f64::from_be_bytes(bytes[4..12].try_into().unwrap()), 1.5, "the delay is added");
        assert!(f64::from_be_bytes(bytes[12..20].try_into().unwrap()).is_nan(), "no end yet");
        assert_eq!(u16::from_be_bytes([bytes[20], bytes[21]]), 1920);
        assert_eq!((bytes[24], bytes[25]), (0, 1), "not forced, one object");
        assert_eq!(u16::from_be_bytes([bytes[26], bytes[27]]), 2, "only the colours the picture names");
        // Two colours (8 bytes), then the object's geometry and its 8 pixels.
        assert_eq!(&bytes[36..44], &[0, 100, 3, 132, 0, 4, 0, 2]);
        assert_eq!(&bytes[44..], &[1, 1, 1, 1, 1, 0, 0, 1]);
    }
}
