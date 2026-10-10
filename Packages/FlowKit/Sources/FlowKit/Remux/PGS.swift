import Foundation

/// A picture subtitle ready to draw: palette-indexed pixels, placed on the subtitle canvas.
public struct BitmapSubtitle: Sendable, Hashable {
    public struct Object: Sendable, Hashable {
        public let x: Int
        public let y: Int
        public let width: Int
        public let height: Int
        /// One palette index per pixel, row by row.
        public let indices: [UInt8]
    }

    /// Seconds on the media timeline.
    public let start: Double
    /// When the next display set clears or replaces it; nil until known.
    public var end: Double?
    /// The canvas the positions refer to (usually the video's coded size, e.g. 1920×1080).
    public let canvasWidth: Int
    public let canvasHeight: Int
    public let objects: [Object]
    /// Premultiplied RGBA for each palette index (0x00 = transparent).
    public let palette: [UInt32]
    /// Forced captions (signs, foreign dialogue) show even when subtitles are off.
    public let isForced: Bool

    public var id: Double { start }

    /// Premultiplied RGBA pixels for one object, ready for a CGImage.
    public func rgba(for object: Object) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: object.width * object.height * 4)
        for (i, index) in object.indices.enumerated() {
            let c = palette[Int(index)]
            out[i * 4] = UInt8(c >> 24)
            out[i * 4 + 1] = UInt8((c >> 16) & 0xFF)
            out[i * 4 + 2] = UInt8((c >> 8) & 0xFF)
            out[i * 4 + 3] = UInt8(c & 0xFF)
        }
        return out
    }
}

/// Decodes Blu-ray Presentation Graphic Stream subtitles as Matroska stores them: each block is
/// one display set of segments (type, 16-bit length, payload) without the "PG" timestamp header.
struct PGSDecoder {
    private var palettes: [Int: [UInt32]] = [:]
    private var objects: [Int: (width: Int, height: Int, indices: [UInt8])] = [:]
    private var pendingObjectData: [Int: (width: Int, height: Int, data: [UInt8])] = [:]

    private struct Composition {
        var width = 0
        var height = 0
        var state = 0
        var paletteID = 0
        var placements: [(objectID: Int, x: Int, y: Int, forced: Bool, crop: (x: Int, y: Int, w: Int, h: Int)?)] = []
    }

    /// Decodes one display set. Returns a cue with objects, an empty cue (clears the screen), or nil.
    mutating func decode(_ data: [UInt8], at seconds: Double) -> BitmapSubtitle? {
        var i = 0
        var composition: Composition?
        while i + 3 <= data.count {
            let type = data[i]
            let length = Int(data[i + 1]) << 8 | Int(data[i + 2])
            let start = i + 3
            let end = min(data.count, start + length)
            let payload = Array(data[start..<end])
            i = end
            switch type {
            case 0x16: composition = Self.parseComposition(payload)
                if let state = composition?.state, state == 0x80 {
                    // Epoch start: everything earlier is forgotten.
                    palettes = [:]
                    objects = [:]
                }
            case 0x14: parsePalette(payload)
            case 0x15: parseObject(payload)
            case 0x80: // end of display set
                guard let composition else { return nil }
                return render(composition, at: seconds)
            default: break // 0x17 window definitions: positions come from the composition
            }
        }
        return composition.map { render($0, at: seconds) } ?? nil
    }

    private static func parseComposition(_ p: [UInt8]) -> Composition? {
        guard p.count >= 11 else { return nil }
        var c = Composition()
        c.width = Int(p[0]) << 8 | Int(p[1])
        c.height = Int(p[2]) << 8 | Int(p[3])
        c.state = Int(p[7])
        c.paletteID = Int(p[9])
        let count = Int(p[10])
        var i = 11
        for _ in 0..<count {
            guard i + 8 <= p.count else { break }
            let objectID = Int(p[i]) << 8 | Int(p[i + 1])
            let flags = p[i + 3]
            let x = Int(p[i + 4]) << 8 | Int(p[i + 5])
            let y = Int(p[i + 6]) << 8 | Int(p[i + 7])
            i += 8
            var crop: (Int, Int, Int, Int)?
            if flags & 0x80 != 0, i + 8 <= p.count {
                crop = (Int(p[i]) << 8 | Int(p[i + 1]), Int(p[i + 2]) << 8 | Int(p[i + 3]),
                        Int(p[i + 4]) << 8 | Int(p[i + 5]), Int(p[i + 6]) << 8 | Int(p[i + 7]))
                i += 8
            }
            c.placements.append((objectID, x, y, flags & 0x40 != 0, crop.map { (x: $0.0, y: $0.1, w: $0.2, h: $0.3) }))
        }
        return c
    }

    private mutating func parsePalette(_ p: [UInt8]) {
        guard p.count >= 2 else { return }
        let id = Int(p[0])
        var palette = palettes[id] ?? [UInt32](repeating: 0, count: 256)
        var i = 2
        while i + 5 <= p.count {
            palette[Int(p[i])] = Self.rgba(y: p[i + 1], cr: p[i + 2], cb: p[i + 3], alpha: p[i + 4])
            i += 5
        }
        palettes[id] = palette
    }

    /// BT.709 limited range to premultiplied RGBA.
    static func rgba(y: UInt8, cr: UInt8, cb: UInt8, alpha: UInt8) -> UInt32 {
        let yf = 1.164 * (Double(y) - 16)
        let crf = Double(cr) - 128, cbf = Double(cb) - 128
        func clamp(_ v: Double) -> UInt32 { UInt32(max(0, min(255, v.rounded()))) }
        let a = Double(alpha) / 255
        let r = clamp((yf + 1.793 * crf) * a)
        let g = clamp((yf - 0.213 * cbf - 0.533 * crf) * a)
        let b = clamp((yf + 2.112 * cbf) * a)
        return r << 24 | g << 16 | b << 8 | UInt32(alpha)
    }

    private mutating func parseObject(_ p: [UInt8]) {
        guard p.count >= 4 else { return }
        let id = Int(p[0]) << 8 | Int(p[1])
        let sequence = p[3]
        var i = 4
        if sequence & 0x80 != 0 { // first fragment: length and size follow
            guard p.count >= 11 else { return }
            let width = Int(p[7]) << 8 | Int(p[8])
            let height = Int(p[9]) << 8 | Int(p[10])
            i = 11
            // Blu-ray graphics fit a 1920×1080 plane (4K discs use the same); anything larger is corrupt
            // and would otherwise allocate gigabytes.
            guard width > 0, height > 0, width <= 4096, height <= 2304 else { pendingObjectData[id] = nil; return }
            pendingObjectData[id] = (width, height, [])
        }
        guard var pending = pendingObjectData[id], i <= p.count else { return }
        pending.data += p[i...]
        guard pending.data.count <= 8 * 1024 * 1024 else { pendingObjectData[id] = nil; return }
        pendingObjectData[id] = pending
        if sequence & 0x40 != 0 { // last fragment
            objects[id] = (pending.width, pending.height, Self.decodeRLE(pending.data, width: pending.width, height: pending.height))
            pendingObjectData[id] = nil
        }
    }

    /// PGS run-length coding: a non-zero byte is one pixel; 0x00 introduces a run or ends the line.
    static func decodeRLE(_ data: [UInt8], width: Int, height: Int) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: width * height)
        var x = 0, y = 0, i = 0
        func put(_ color: UInt8, _ count: Int) {
            guard y < height else { return }
            let n = min(count, width - x)
            if n > 0, color != 0 {
                let base = y * width + x
                for k in 0..<n { out[base + k] = color }
            }
            x += max(0, n)
        }
        while i < data.count, y < height {
            let b = data[i]; i += 1
            if b != 0 { put(b, 1); continue }
            guard i < data.count else { break }
            let c = data[i]; i += 1
            if c == 0 { x = 0; y += 1; continue }
            switch c & 0xC0 {
            case 0x00: put(0, Int(c & 0x3F))
            case 0x40:
                guard i < data.count else { break }
                put(0, Int(c & 0x3F) << 8 | Int(data[i])); i += 1
            case 0x80:
                guard i < data.count else { break }
                put(data[i], Int(c & 0x3F)); i += 1
            default:
                guard i + 1 < data.count else { break }
                put(data[i + 1], Int(c & 0x3F) << 8 | Int(data[i])); i += 2
            }
        }
        return out
    }

    private func render(_ c: Composition, at seconds: Double) -> BitmapSubtitle {
        let palette = palettes[c.paletteID] ?? [UInt32](repeating: 0, count: 256)
        var placed: [BitmapSubtitle.Object] = []
        var forced = !c.placements.isEmpty
        for placement in c.placements {
            guard let object = objects[placement.objectID], object.width > 0, object.height > 0 else { continue }
            forced = forced && placement.forced
            if let crop = placement.crop, crop.w > 0, crop.h > 0, crop.x + crop.w <= object.width, crop.y + crop.h <= object.height {
                var indices = [UInt8]()
                indices.reserveCapacity(crop.w * crop.h)
                for row in crop.y..<(crop.y + crop.h) {
                    let base = row * object.width
                    indices += object.indices[(base + crop.x)..<(base + crop.x + crop.w)]
                }
                placed.append(.init(x: placement.x, y: placement.y, width: crop.w, height: crop.h, indices: indices))
            } else {
                placed.append(.init(x: placement.x, y: placement.y, width: object.width, height: object.height, indices: object.indices))
            }
        }
        return BitmapSubtitle(start: seconds, end: nil, canvasWidth: c.width, canvasHeight: c.height, objects: placed, palette: palette, isForced: forced)
    }
}
