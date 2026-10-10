import Foundation

/// Decodes DVD subtitles (VobSub) as Matroska stores them: each block is one subpicture unit, and
/// the track's CodecPrivate is the .idx header with the canvas size and the 16-colour palette.
struct VobSubDecoder {
    let canvasWidth: Int
    let canvasHeight: Int
    /// 0xRRGGBB for each of the DVD's 16 palette entries.
    let palette: [UInt32]

    init(codecPrivate: [UInt8], videoWidth: Int, videoHeight: Int) {
        let text = String(decoding: codecPrivate, as: UTF8.self)
        var width = videoWidth, height = videoHeight
        var palette = (0..<16).map { i -> UInt32 in [0x000000, 0xFFFFFF, 0x808080, 0x000000][i % 4] }
        for line in text.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let key = parts[0].trimmingCharacters(in: .whitespaces).lowercased()
            let value = parts[1].trimmingCharacters(in: .whitespaces)
            if key == "size" {
                let dims = value.lowercased().split(separator: "x").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
                if dims.count == 2, dims[0] > 0, dims[1] > 0 { width = dims[0]; height = dims[1] }
            } else if key == "palette" {
                let colours = value.split(separator: ",").compactMap { UInt32($0.trimmingCharacters(in: .whitespaces), radix: 16) }
                if colours.count >= 16 { palette = Array(colours.prefix(16)) }
            }
        }
        canvasWidth = width
        canvasHeight = height
        self.palette = palette
    }

    /// One subpicture: a cue with its picture (ending when the packet says to stop), or nil.
    func decode(_ data: [UInt8], at seconds: Double) -> BitmapSubtitle? {
        guard data.count >= 4 else { return nil }
        func u16(_ i: Int) -> Int { i + 1 < data.count ? Int(data[i]) << 8 | Int(data[i + 1]) : 0 }
        let size = min(data.count, u16(0) == 0 ? data.count : u16(0))
        var sequence = u16(2)

        var colours: [Int] = [0, 1, 2, 3]
        var alphas: [Int] = [0, 15, 15, 15]
        var area: (x1: Int, y1: Int, x2: Int, y2: Int)?
        var fields: (top: Int, bottom: Int)?
        var forced = false
        var shows = false
        var stop: Double?

        // Control sequences: a delay (in 1024/90000 s), the next sequence's offset, then commands.
        var visited = Set<Int>()
        while sequence + 4 <= size, visited.insert(sequence).inserted {
            let rawDelay = u16(sequence)
            // Some muxers write the largest delay to mean "until the next picture".
            let delay = rawDelay == 0xFFFF ? 0 : Double(rawDelay) * 1024 / 90_000
            let next = u16(sequence + 2)
            var i = sequence + 4
            commands: while i < size {
                let command = data[i]; i += 1
                switch command {
                case 0x00: forced = true; shows = true
                case 0x01: shows = true
                case 0x02: if delay > 0 { stop = delay }
                case 0x03:
                    guard i + 2 <= size else { break commands }
                    colours = [Int(data[i + 1] & 0x0F), Int(data[i + 1] >> 4), Int(data[i] & 0x0F), Int(data[i] >> 4)]
                    i += 2
                case 0x04:
                    guard i + 2 <= size else { break commands }
                    alphas = [Int(data[i + 1] & 0x0F), Int(data[i + 1] >> 4), Int(data[i] & 0x0F), Int(data[i] >> 4)]
                    i += 2
                case 0x05:
                    guard i + 6 <= size else { break commands }
                    let x1 = Int(data[i]) << 4 | Int(data[i + 1]) >> 4
                    let x2 = Int(data[i + 1] & 0x0F) << 8 | Int(data[i + 2])
                    let y1 = Int(data[i + 3]) << 4 | Int(data[i + 4]) >> 4
                    let y2 = Int(data[i + 4] & 0x0F) << 8 | Int(data[i + 5])
                    area = (x1, y1, x2, y2)
                    i += 6
                case 0x06:
                    guard i + 4 <= size else { break commands }
                    fields = (u16(i), u16(i + 2))
                    i += 4
                case 0x07: // extended commands: a length, then data we don't use
                    guard i + 2 <= size else { break commands }
                    i += max(2, u16(i))
                default: break commands // 0xFF ends the sequence
                }
            }
            if next == sequence { break }
            sequence = next
        }

        guard shows, let area, let fields, area.x2 >= area.x1, area.y2 >= area.y1 else { return nil }
        let width = area.x2 - area.x1 + 1, height = area.y2 - area.y1 + 1
        // DVD subpictures fit the 720×576 frame; allow some slack for odd authoring, not corrupt sizes.
        guard width <= max(canvasWidth, 720) * 2, height <= max(canvasHeight, 576) * 2 else { return nil }
        var indices = [UInt8](repeating: 0, count: width * height)
        // Interlaced: even lines from the top field, odd lines from the bottom.
        for (field, offset) in [fields.top, fields.bottom].enumerated() {
            Self.decodeField(data, from: offset, limit: size, width: width, rows: stride(from: field, to: height, by: 2), into: &indices)
        }

        var rgba = [UInt32](repeating: 0, count: 256)
        for k in 0..<4 {
            let rgb = palette[colours[k] & 0x0F]
            let a = UInt32(alphas[k] * 17)
            func premultiplied(_ c: UInt32) -> UInt32 { (c * a + 127) / 255 }
            rgba[k] = premultiplied(rgb >> 16 & 0xFF) << 24 | premultiplied(rgb >> 8 & 0xFF) << 16 | premultiplied(rgb & 0xFF) << 8 | a
        }
        guard indices.contains(where: { rgba[Int($0)] & 0xFF != 0 }) else { return nil }
        let object = BitmapSubtitle.Object(x: area.x1, y: area.y1, width: width, height: height, indices: indices)
        return BitmapSubtitle(start: seconds, end: stop.map { seconds + $0 }, canvasWidth: canvasWidth, canvasHeight: canvasHeight,
                              objects: [object], palette: rgba, isForced: forced)
    }

    /// Nibble run-length coding: 1–4 nibbles give a run (value >> 2) of colour (value & 3);
    /// a zero run fills to the end of the line, and each line starts on a byte boundary.
    static func decodeField(_ data: [UInt8], from offset: Int, limit: Int, width: Int, rows: StrideTo<Int>, into out: inout [UInt8]) {
        var nibble = offset * 2
        func next() -> Int? {
            guard nibble / 2 < limit else { return nil }
            let byte = data[nibble / 2]
            defer { nibble += 1 }
            return Int(nibble % 2 == 0 ? byte >> 4 : byte & 0x0F)
        }
        for row in rows {
            var x = 0
            while x < width {
                guard var v = next() else { return }
                if v < 0x4 { guard let n = next() else { return }; v = v << 4 | n
                    if v < 0x10 { guard let n = next() else { return }; v = v << 4 | n
                        if v < 0x40 { guard let n = next() else { return }; v = v << 4 | n }
                    }
                }
                let colour = UInt8(v & 3)
                let run = v >> 2 == 0 ? width - x : min(v >> 2, width - x)
                if colour != 0 {
                    let base = row * width + x
                    for k in 0..<run { out[base + k] = colour }
                }
                x += run
            }
            if nibble % 2 == 1 { nibble += 1 }
        }
    }
}
