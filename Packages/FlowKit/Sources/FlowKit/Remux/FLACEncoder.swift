import Foundation

/// A small lossless FLAC encoder, for audio Flow decodes itself (DTS, Dolby TrueHD) and hands to
/// AVPlayer as FLAC in fragmented MP4. Fixed predictors (orders 0–4) with partitioned Rice coding:
/// a little larger than libFLAC's output, but fast, and bit-exact.
struct FLACEncoder {
    let sampleRate: Int
    let channels: Int
    let bitsPerSample: Int
    static let blockSize = 4096
    private var frameNumber: UInt32 = 0

    init(sampleRate: Int, channels: Int, bitsPerSample: Int) {
        self.sampleRate = sampleRate
        self.channels = max(1, min(8, channels))
        self.bitsPerSample = bitsPerSample
    }

    /// STREAMINFO as a dfLa payload (one metadata block, marked last).
    var dfLa: [UInt8] {
        var w = BitWriter()
        w.write(1, 1); w.write(0, 7); w.write(34, 24)                  // last block, STREAMINFO, length
        w.write(UInt32(Self.blockSize), 16); w.write(UInt32(Self.blockSize), 16)
        w.write(0, 24); w.write(0, 24)                                  // frame sizes unknown
        w.write(UInt32(sampleRate), 20)
        w.write(UInt32(channels - 1), 3)
        w.write(UInt32(bitsPerSample - 1), 5)
        w.write(0, 4); w.write(0, 32)                                   // total samples unknown
        for _ in 0..<4 { w.write(0, 32) }                               // no MD5
        return w.bytes
    }

    /// Encodes one frame from interleaved samples (`count` per channel, at most `blockSize`).
    mutating func encodeFrame(_ interleaved: UnsafeBufferPointer<Int32>, count: Int) -> [UInt8] {
        var w = FastBitWriter(capacity: count * channels * bitsPerSample / 8 + 64)
        // Header
        w.write(0b11111111111110, 14); w.write(0, 1); w.write(0, 1)     // sync, reserved, fixed blocking
        let sizeCode: UInt64 = count == Self.blockSize ? 12 : 7
        w.write(sizeCode, 4)
        let rateCode: UInt64 = [88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7,
                                32000: 8, 44100: 9, 48000: 10, 96000: 11][sampleRate] ?? 0
        w.write(rateCode, 4)
        w.write(UInt64(channels - 1), 4)                                 // independent channels
        let depthCode: UInt64 = [8: 1, 12: 2, 16: 4, 20: 5, 24: 6, 32: 7][bitsPerSample] ?? 0
        w.write(depthCode, 3); w.write(0, 1)
        Self.writeUTF8(UInt64(frameNumber), &w)
        if sizeCode == 7 { w.write(UInt64(count - 1), 16) }
        w.write(UInt64(Self.crc8(w.bytesSoFar)), 8)

        var samples = [Int64](repeating: 0, count: count)
        for c in 0..<channels {
            for i in 0..<count { samples[i] = Int64(interleaved[i * channels + c]) }
            writeSubframe(samples, &w)
        }
        w.alignToByte()
        var bytes = w.finish()
        let crc = Self.crc16(bytes)
        bytes.append(UInt8(crc >> 8)); bytes.append(UInt8(crc & 0xFF))
        frameNumber &+= 1
        return bytes
    }

    private func writeSubframe(_ x: [Int64], _ w: inout FastBitWriter) {
        let n = x.count
        let bps = bitsPerSample
        if x.allSatisfy({ $0 == x[0] }) {                                // silence, or any constant
            w.write(0, 1); w.write(0, 6); w.write(0, 1)
            w.writeSigned(x[0], bps)
            return
        }
        // The fixed predictor order whose residual is smallest.
        var best = 0
        var bestSum = Int64.max
        var residuals: [[Int64]] = []
        for order in 0...min(4, n - 1) {
            var e = [Int64](repeating: 0, count: n - order)
            var sum: Int64 = 0
            for i in order..<n {
                let v: Int64
                switch order {
                case 0: v = x[i]
                case 1: v = x[i] - x[i - 1]
                case 2: v = x[i] - 2 * x[i - 1] + x[i - 2]
                case 3: v = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]
                default: v = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]
                }
                e[i - order] = v
                sum &+= abs(v)
            }
            residuals.append(e)
            if sum < bestSum { bestSum = sum; best = order }
        }
        let residual = residuals[best]
        // VERBATIM when prediction can't help (noise); costs n × bps bits.
        let riceCost = Self.bestRice(residual, order: best, blockSize: n)
        if riceCost.bits + best * bps >= n * bps {
            w.write(0, 1); w.write(1, 6); w.write(0, 1)
            for v in x { w.writeSigned(v, bps) }
            return
        }
        w.write(0, 1); w.write(UInt64(8 | best), 6); w.write(0, 1)
        for i in 0..<best { w.writeSigned(x[i], bps) }
        Self.writeResidual(residual, order: best, blockSize: n, partitionOrder: riceCost.partitionOrder, &w)
    }

    // MARK: Rice coding

    private static func zigzag(_ v: Int64) -> UInt64 { UInt64(bitPattern: (v << 1) ^ (v >> 63)) }

    /// The partition order (0–4) and parameters that code the residual in the fewest bits.
    private static func bestRice(_ e: [Int64], order: Int, blockSize: Int) -> (bits: Int, partitionOrder: Int) {
        var best = (bits: Int.max, partitionOrder: 0)
        for p in 0...4 {
            let parts = 1 << p
            guard blockSize % parts == 0, blockSize >> p > order else { break }
            var bits = 6
            for range in partitions(count: e.count, order: order, blockSize: blockSize, partitionOrder: p) {
                bits += 5 + parameter(e, range).bits
            }
            if bits < best.bits { best = (bits, p) }
        }
        return best
    }

    private static func partitions(count: Int, order: Int, blockSize: Int, partitionOrder p: Int) -> [Range<Int>] {
        let size = blockSize >> p
        var out: [Range<Int>] = []
        var start = 0
        for k in 0..<(1 << p) {
            let length = k == 0 ? size - order : size
            out.append(start..<min(count, start + length))
            start += length
        }
        return out
    }

    /// The best Rice parameter for a partition, and its cost in bits.
    private static func parameter(_ e: [Int64], _ range: Range<Int>) -> (k: Int, bits: Int) {
        guard !range.isEmpty else { return (0, 0) }
        var sum: UInt64 = 0
        for i in range { sum &+= zigzag(e[i]) }
        let mean = sum / UInt64(range.count)
        let guess = mean == 0 ? 0 : 63 - mean.leadingZeroBitCount
        var best = (k: 0, bits: Int.max)
        for k in max(0, guess - 1)...min(30, guess + 1) {
            var bits = range.count * (k + 1)
            for i in range { bits += Int(zigzag(e[i]) >> UInt64(k)) }
            if bits < best.bits { best = (k, bits) }
        }
        return best
    }

    private static func writeResidual(_ e: [Int64], order: Int, blockSize: Int, partitionOrder p: Int, _ w: inout FastBitWriter) {
        w.write(1, 2)                                                    // 5-bit Rice parameters
        w.write(UInt64(p), 4)
        for range in partitions(count: e.count, order: order, blockSize: blockSize, partitionOrder: p) {
            let k = parameter(e, range).k
            w.write(UInt64(k), 5)
            for i in range {
                let u = zigzag(e[i])
                w.writeUnary(u >> UInt64(k))
                if k > 0 { w.write(u & ((1 << UInt64(k)) - 1), k) }
            }
        }
    }

    // MARK: Framing

    private static func writeUTF8(_ value: UInt64, _ w: inout FastBitWriter) {
        if value < 0x80 { w.write(value, 8); return }
        var bytesNeeded = 2
        while value >= (1 << UInt64(5 * bytesNeeded + 1)) { bytesNeeded += 1 }
        let lead = (UInt64(0xFF) << UInt64(8 - bytesNeeded)) & 0xFF
        w.write(lead | (value >> UInt64(6 * (bytesNeeded - 1))), 8)
        for k in stride(from: bytesNeeded - 2, through: 0, by: -1) {
            w.write(0x80 | ((value >> UInt64(6 * k)) & 0x3F), 8)
        }
    }

    static func crc8(_ bytes: [UInt8]) -> UInt8 {
        var crc: UInt8 = 0
        for byte in bytes {
            crc ^= byte
            for _ in 0..<8 { crc = crc & 0x80 != 0 ? (crc << 1) ^ 0x07 : crc << 1 }
        }
        return crc
    }

    static func crc16(_ bytes: [UInt8]) -> UInt16 {
        var crc: UInt16 = 0
        for byte in bytes {
            crc = crc16Table[Int((crc >> 8) ^ UInt16(byte))] ^ (crc << 8)
        }
        return crc
    }

    private static let crc16Table: [UInt16] = (0..<256).map { i in
        var crc = UInt16(i) << 8
        for _ in 0..<8 { crc = crc & 0x8000 != 0 ? (crc << 1) ^ 0x8005 : crc << 1 }
        return crc
    }
}

/// Bit writer with a 64-bit accumulator, fast enough for millions of residuals.
struct FastBitWriter {
    private var bytes: [UInt8]
    private var accumulator: UInt64 = 0
    private var filled = 0

    init(capacity: Int) {
        bytes = []
        bytes.reserveCapacity(capacity)
    }

    /// Writes the low `count` bits of `value` (count ≤ 56).
    mutating func write(_ value: UInt64, _ count: Int) {
        guard count > 0 else { return }
        if count > 32 {
            write(value >> 32, count - 32)
            write(value & 0xFFFF_FFFF, 32)
            return
        }
        accumulator = accumulator << UInt64(count) | (value & ((1 << UInt64(count)) - 1))
        filled += count
        while filled >= 8 {
            filled -= 8
            bytes.append(UInt8(truncatingIfNeeded: accumulator >> UInt64(filled)))
        }
    }

    mutating func writeSigned(_ value: Int64, _ count: Int) {
        write(UInt64(bitPattern: value) & ((1 << UInt64(count)) - 1), count)
    }

    /// `q` zeros, then a one.
    mutating func writeUnary(_ q: UInt64) {
        var q = q
        while q >= 32 { write(0, 32); q -= 32 }
        write(1, Int(q) + 1)
    }

    mutating func alignToByte() {
        if filled > 0 { write(0, 8 - filled) }
    }

    /// The whole bytes written so far (for the header CRC, before any partial byte).
    var bytesSoFar: [UInt8] { bytes }

    mutating func finish() -> [UInt8] {
        alignToByte()
        return bytes
    }
}
