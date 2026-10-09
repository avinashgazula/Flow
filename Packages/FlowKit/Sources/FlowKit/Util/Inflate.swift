import Foundation

/// Pure-Swift DEFLATE (RFC 1951) decoder with gzip (RFC 1952) and ZIP container helpers.
/// Used for gzipped XMLTV guides and zipped subtitle downloads on every platform.
public enum Inflate {
    public enum Failure: Error { case corrupt(String) }

    private struct BitReader {
        let bytes: [UInt8]
        var position: Int
        var bitBuffer: UInt32 = 0
        var bitCount: Int = 0

        init(_ bytes: [UInt8], start: Int) {
            self.bytes = bytes
            self.position = start
        }

        mutating func bits(_ n: Int) throws -> Int {
            while bitCount < n {
                guard position < bytes.count else { throw Failure.corrupt("unexpected end of data") }
                bitBuffer |= UInt32(bytes[position]) << UInt32(bitCount)
                position += 1
                bitCount += 8
            }
            let value = Int(bitBuffer & ((1 << UInt32(n)) - 1))
            bitBuffer >>= UInt32(n)
            bitCount -= n
            return value
        }

        mutating func alignToByte() {
            bitBuffer = 0
            bitCount = 0
        }
    }

    /// Canonical Huffman decoding table.
    private struct Huffman {
        var counts = [Int](repeating: 0, count: 16)
        var symbols: [Int]

        init(lengths: [Int]) {
            symbols = [Int](repeating: 0, count: lengths.count)
            for len in lengths { counts[len] += 1 }
            counts[0] = 0
            var offsets = [Int](repeating: 0, count: 16)
            for i in 1..<16 { offsets[i] = offsets[i - 1] + counts[i - 1] }
            for (symbol, len) in lengths.enumerated() where len != 0 {
                symbols[offsets[len]] = symbol
                offsets[len] += 1
            }
        }

        func decode(_ reader: inout BitReader) throws -> Int {
            var code = 0, first = 0, index = 0
            for len in 1..<16 {
                code |= try reader.bits(1)
                let count = counts[len]
                if code - count < first { return symbols[index + (code - first)] }
                index += count
                first += count
                first <<= 1
                code <<= 1
            }
            throw Failure.corrupt("bad huffman code")
        }
    }

    private static let lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
    private static let lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
    private static let distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
    private static let distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

    private static let fixedLiteral: Huffman = {
        var lengths = [Int](repeating: 8, count: 288)
        for i in 144..<256 { lengths[i] = 9 }
        for i in 256..<280 { lengths[i] = 7 }
        return Huffman(lengths: lengths)
    }()
    private static let fixedDistance = Huffman(lengths: [Int](repeating: 5, count: 30))

    /// Decodes a raw DEFLATE stream starting at `offset`.
    public static func raw(_ data: Data, offset: Int = 0) throws -> Data {
        var reader = BitReader([UInt8](data), start: offset)
        var out: [UInt8] = []
        out.reserveCapacity(data.count * 4)
        var final = false
        while !final {
            final = try reader.bits(1) == 1
            switch try reader.bits(2) {
            case 0:
                reader.alignToByte()
                let p = reader.position
                guard p + 4 <= reader.bytes.count else { throw Failure.corrupt("stored header") }
                let len = Int(reader.bytes[p]) | Int(reader.bytes[p + 1]) << 8
                guard p + 4 + len <= reader.bytes.count else { throw Failure.corrupt("stored length") }
                out.append(contentsOf: reader.bytes[(p + 4)..<(p + 4 + len)])
                reader.position = p + 4 + len
            case 1:
                try inflateBlock(&reader, &out, literal: fixedLiteral, distance: fixedDistance)
            case 2:
                let (lit, dist) = try dynamicTables(&reader)
                try inflateBlock(&reader, &out, literal: lit, distance: dist)
            default:
                throw Failure.corrupt("invalid block type")
            }
        }
        return Data(out)
    }

    private static func dynamicTables(_ reader: inout BitReader) throws -> (Huffman, Huffman) {
        let hlit = try reader.bits(5) + 257
        let hdist = try reader.bits(5) + 1
        let hclen = try reader.bits(4) + 4
        let order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
        var codeLengths = [Int](repeating: 0, count: 19)
        for i in 0..<hclen { codeLengths[order[i]] = try reader.bits(3) }
        let codeTable = Huffman(lengths: codeLengths)
        var lengths: [Int] = []
        while lengths.count < hlit + hdist {
            let sym = try codeTable.decode(&reader)
            switch sym {
            case 0..<16: lengths.append(sym)
            case 16:
                guard let last = lengths.last else { throw Failure.corrupt("repeat with no previous") }
                lengths += [Int](repeating: last, count: 3 + (try reader.bits(2)))
            case 17: lengths += [Int](repeating: 0, count: 3 + (try reader.bits(3)))
            default: lengths += [Int](repeating: 0, count: 11 + (try reader.bits(7)))
            }
        }
        return (Huffman(lengths: Array(lengths[0..<hlit])), Huffman(lengths: Array(lengths[hlit..<(hlit + hdist)])))
    }

    private static func inflateBlock(_ reader: inout BitReader, _ out: inout [UInt8], literal: Huffman, distance: Huffman) throws {
        while true {
            let sym = try literal.decode(&reader)
            if sym < 256 {
                out.append(UInt8(sym))
            } else if sym == 256 {
                return
            } else {
                let li = sym - 257
                guard li < lengthBase.count else { throw Failure.corrupt("length symbol") }
                let length = lengthBase[li] + (try reader.bits(lengthExtra[li]))
                let di = try distance.decode(&reader)
                guard di < distBase.count else { throw Failure.corrupt("distance symbol") }
                let dist = distBase[di] + (try reader.bits(distExtra[di]))
                guard dist <= out.count else { throw Failure.corrupt("distance too far") }
                let start = out.count - dist
                for i in 0..<length { out.append(out[start + i]) }
            }
        }
    }
}

public enum Gzip {
    public static func isGzip(_ data: Data) -> Bool {
        data.count > 10 && data[data.startIndex] == 0x1f && data[data.startIndex + 1] == 0x8b
    }

    public static func decompress(_ data: Data) throws -> Data {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 8 else { throw Inflate.Failure.corrupt("not gzip") }
        let flags = bytes[3]
        var p = 10
        if flags & 0x04 != 0 { p += 2 + (Int(bytes[p]) | Int(bytes[p + 1]) << 8) }
        if flags & 0x08 != 0 { while p < bytes.count && bytes[p] != 0 { p += 1 }; p += 1 }
        if flags & 0x10 != 0 { while p < bytes.count && bytes[p] != 0 { p += 1 }; p += 1 }
        if flags & 0x02 != 0 { p += 2 }
        return try Inflate.raw(Data(bytes), offset: p)
    }
}

public enum ZipArchive {
    public struct Entry: Sendable {
        public var name: String
        public var data: Data
    }

    /// Extracts stored and deflated entries by walking local file headers.
    public static func entries(_ data: Data) throws -> [Entry] {
        let b = [UInt8](data)
        func u16(_ i: Int) -> Int { Int(b[i]) | Int(b[i + 1]) << 8 }
        func u32(_ i: Int) -> Int { u16(i) | u16(i + 2) << 16 }
        var out: [Entry] = []
        var p = 0
        while p + 30 <= b.count, u32(p) == 0x04034b50 {
            let flags = u16(p + 6)
            let method = u16(p + 8)
            var compressedSize = u32(p + 18)
            let nameLength = u16(p + 26)
            let extraLength = u16(p + 28)
            let name = String(decoding: b[(p + 30)..<(p + 30 + nameLength)], as: UTF8.self)
            let start = p + 30 + nameLength + extraLength
            if flags & 0x08 != 0 && compressedSize == 0 {
                // Sizes live in the data descriptor; find them in the central directory instead.
                compressedSize = centralDirectorySize(b, name: name) ?? 0
            }
            guard start + compressedSize <= b.count else { throw Inflate.Failure.corrupt("zip entry truncated") }
            let slice = Data(b[start..<(start + compressedSize)])
            switch method {
            case 0: out.append(Entry(name: name, data: slice))
            case 8: out.append(Entry(name: name, data: try Inflate.raw(slice)))
            default: break
            }
            p = start + compressedSize
            if flags & 0x08 != 0 { p += (p + 4 <= b.count && u32(p) == 0x08074b50) ? 16 : 12 }
        }
        return out
    }

    private static func centralDirectorySize(_ b: [UInt8], name: String) -> Int? {
        func u16(_ i: Int) -> Int { Int(b[i]) | Int(b[i + 1]) << 8 }
        func u32(_ i: Int) -> Int { u16(i) | u16(i + 2) << 16 }
        var p = 0
        while p + 46 <= b.count {
            if u32(p) == 0x02014b50 {
                let nameLength = u16(p + 28)
                let entryName = String(decoding: b[(p + 46)..<min(b.count, p + 46 + nameLength)], as: UTF8.self)
                if entryName == name { return u32(p + 20) }
                p += 46 + nameLength + u16(p + 30) + u16(p + 32)
            } else {
                p += 1
            }
        }
        return nil
    }
}
