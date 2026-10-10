import Foundation

/// Dolby Vision's per-frame metadata (the RPU, HEVC NAL unit type 62), parsed and written back, so
/// UHD Blu-ray profile 7 can play as profile 8.1 on Apple devices.
///
/// Profile 7 is a base layer (HDR10), an enhancement layer (NAL type 63) and an RPU that describes how
/// to combine them; Apple's decoders only do single-layer profile 8. Converting keeps the base layer,
/// drops the enhancement layer, and rewrites each RPU the way profile 8.1 expects: no residual (so no
/// enhancement-layer quantisation data) and no-op mapping curves. The display-management metadata —
/// the per-shot trims that make Dolby Vision worth having — is carried over byte for byte.
enum DolbyVisionRPU {
    /// One RPU, parsed as far as conversion needs. Everything from the display-management extension
    /// blocks onward is kept as raw bytes: it starts byte-aligned and needs no change.
    struct RPU: Equatable {
        var rpuType: Int
        var rpuFormat: Int
        var vdrRPUProfile: Int
        var vdrRPULevel: Int
        var chromaResamplingExplicitFilter: Bool
        var coefDataType: Int
        var coefLog2Denom: Int
        var vdrRPUNormalizedIdc: Int
        var blVideoFullRange: Bool
        /// Present when `rpuFormat & 0x700 == 0`.
        var bitDepths: (bl: Int, el: Int, vdr: Int)?
        var spatialResamplingFilter = false
        var elSpatialResamplingFilter = false
        var disableResidual = false
        var dmMetadataPresent: Bool
        var mapping: Mapping
        var dm: DisplayManagement?

        static func == (a: RPU, b: RPU) -> Bool { a.write() == b.write() }

        var blBitDepth: Int { bitDepths?.bl ?? 10 }
        var elBitDepth: Int { bitDepths?.el ?? 10 }
        var usesNLQ: Bool { rpuFormat & 0x700 == 0 && !disableResidual }
    }

    enum Mapping: Equatable {
        /// Refers to an earlier RPU's mapping by id.
        case previous(id: Int)
        case explicit(ExplicitMapping)
    }

    struct ExplicitMapping: Equatable {
        var rpuID: Int
        var colorSpace: Int
        var chromaFormatIdc: Int
        /// Per component: pivot deltas as coded (the first is absolute).
        var pivotDeltas: [[Int]]
        var nlqMethod: Int?
        var nlqPivotDeltas: [Int] = []
        var xPartitionsMinus1: Int
        var yPartitionsMinus1: Int
        /// Per component, per piece.
        var pieces: [[Piece]]
        /// Per component, when `usesNLQ`.
        var nlq: [NLQ] = []
    }

    enum Piece: Equatable {
        case polynomial(orderMinus1: Int, coefficients: [Coefficient])
        case mmr(orderMinus1: Int, constant: Coefficient, coefficients: [Coefficient])
    }

    /// A fixed-point (integer and fraction) or 32-bit float coefficient, as coded.
    struct Coefficient: Equatable {
        var integer: Int
        var fraction: UInt32
        var isUnsignedInteger = false
    }

    struct NLQ: Equatable {
        var offset: Int
        var vdrInMax: Coefficient
        var deadzoneSlope: Coefficient?
        var deadzoneThreshold: Coefficient?
    }

    struct DisplayManagement: Equatable {
        var affectedID: Int
        var currentID: Int
        var sceneRefresh: Int
        /// The fixed-width fields from the YCC-to-RGB matrix to the source diagonal, as raw bits.
        var fixedFields: [Bool]
        var extensionBlockCount: Int
        /// The extension blocks and anything after them, up to the CRC: byte-aligned, copied as is.
        var tail: [UInt8]
    }

    // MARK: Sample rewriting

    /// A length-prefixed HEVC sample with enhancement-layer NALs removed and RPUs converted to 8.1.
    /// An RPU that can't be parsed is dropped: that frame plays as plain HDR10 rather than wrong.
    static func profile81Sample(_ data: [UInt8], lengthSize: Int) -> [UInt8] {
        guard (1...4).contains(lengthSize) else { return data }
        var out: [UInt8] = []
        out.reserveCapacity(data.count)
        var i = 0
        while i + lengthSize <= data.count {
            var length = 0
            for k in 0..<lengthSize { length = length << 8 | Int(data[i + k]) }
            let start = i + lengthSize
            guard length > 0, start + length <= data.count else { return data }
            let nal = Array(data[start..<(start + length)])
            i = start + length
            switch (nal[0] >> 1) & 0x3F {
            case 63:
                continue
            case 62:
                guard let converted = convertToProfile81(nal: nal) else { continue }
                append(converted, to: &out, lengthSize: lengthSize)
            default:
                append(nal, to: &out, lengthSize: lengthSize)
            }
        }
        return out
    }

    private static func append(_ nal: [UInt8], to out: inout [UInt8], lengthSize: Int) {
        for k in stride(from: lengthSize - 1, through: 0, by: -1) { out.append(UInt8((nal.count >> (8 * k)) & 0xFF)) }
        out += nal
    }

    /// An RPU NAL (2-byte header plus escaped payload) rewritten as profile 8.1.
    static func convertToProfile81(nal: [UInt8]) -> [UInt8]? {
        guard nal.count > 8, var rpu = parse(nal: nal) else { return nil }
        rpu.convertToProfile81()
        return Array(nal[0..<2]) + escape(rpu.write())
    }

    // MARK: Parsing

    /// The RPU in a NAL unit, or nil when it isn't one Flow understands (or its CRC is wrong).
    static func parse(nal: [UInt8]) -> RPU? {
        guard nal.count > 8, (nal[0] >> 1) & 0x3F == 62 else { return nil }
        var payload = unescape(Array(nal[2...]))
        // The NAL ends with 0x80 (and maybe zero padding); the CRC sits just before it.
        while payload.last == 0 { payload.removeLast() }
        guard payload.first == 0x19, payload.last == 0x80, payload.count > 6 else { return nil }
        let body = Array(payload[1..<(payload.count - 5)])
        let crc = payload[(payload.count - 5)..<(payload.count - 1)].reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
        guard crc32(body) == crc else { return nil }
        var r = Reader(body)
        return r.rpu()
    }

    private struct Reader {
        var bits: BitReader
        init(_ bytes: [UInt8]) { bits = BitReader(bytes) }

        mutating func u(_ n: Int) -> Int { Int(bits.read(n)) }
        mutating func flag() -> Bool { bits.read(1) == 1 }
        mutating func ue() -> Int? {
            var zeros = 0
            while bits.read(1) == 0 {
                zeros += 1
                if zeros > 31 || bits.bitsLeft <= 0 { return nil }
            }
            return (1 << zeros) - 1 + Int(bits.read(zeros))
        }
        mutating func se() -> Int? {
            guard let k = ue() else { return nil }
            return k & 1 == 1 ? (k + 1) / 2 : -(k / 2)
        }

        mutating func coefficient(_ rpu: RPU, signed: Bool) -> Coefficient? {
            if rpu.coefDataType == 0 {
                guard let integer = signed ? se() : ue() else { return nil }
                return Coefficient(integer: integer, fraction: bits.read(rpu.coefLog2Denom), isUnsignedInteger: !signed)
            }
            return Coefficient(integer: 0, fraction: bits.read(32), isUnsignedInteger: !signed)
        }

        mutating func rpu() -> RPU? {
            let rpuType = u(6)
            guard rpuType == 2 else { return nil }
            let rpuFormat = u(11)
            let profile = u(4), level = u(4)
            // Without sequence info there's nothing to anchor the rest; such RPUs don't occur in practice.
            guard flag() else { return nil }
            let explicitFilter = flag()
            let coefDataType = u(2)
            guard coefDataType <= 1 else { return nil }
            var denom = 32
            if coefDataType == 0 {
                guard let d = ue(), (13...32).contains(d) else { return nil }
                denom = d
            }
            let normalizedIdc = u(2)
            let fullRange = flag()
            var rpu = RPU(rpuType: rpuType, rpuFormat: rpuFormat, vdrRPUProfile: profile, vdrRPULevel: level,
                          chromaResamplingExplicitFilter: explicitFilter, coefDataType: coefDataType, coefLog2Denom: denom,
                          vdrRPUNormalizedIdc: normalizedIdc, blVideoFullRange: fullRange, dmMetadataPresent: false,
                          mapping: .previous(id: 0))
            if rpuFormat & 0x700 == 0 {
                guard let bl = ue(), let el = ue(), let vdr = ue(), bl <= 8, el <= 8, vdr <= 8 else { return nil }
                rpu.bitDepths = (bl + 8, el + 8, vdr + 8)
                rpu.spatialResamplingFilter = flag()
                _ = u(3)
                rpu.elSpatialResamplingFilter = flag()
                rpu.disableResidual = flag()
            }
            rpu.dmMetadataPresent = flag()
            if flag() {
                guard let id = ue() else { return nil }
                rpu.mapping = .previous(id: id)
            } else {
                guard let mapping = explicitMapping(rpu) else { return nil }
                rpu.mapping = .explicit(mapping)
            }
            if rpu.dmMetadataPresent {
                guard let dm = displayManagement() else { return nil }
                rpu.dm = dm
            } else {
                // Only alignment before the CRC.
            }
            return rpu
        }

        mutating func explicitMapping(_ rpu: RPU) -> ExplicitMapping? {
            guard let id = ue(), let colorSpace = ue(), let chroma = ue() else { return nil }
            var pivots: [[Int]] = []
            for _ in 0..<3 {
                guard let minus2 = ue(), minus2 <= 8 else { return nil }
                pivots.append((0..<(minus2 + 2)).map { _ in u(rpu.blBitDepth) })
            }
            var mapping = ExplicitMapping(rpuID: id, colorSpace: colorSpace, chromaFormatIdc: chroma, pivotDeltas: pivots,
                                          xPartitionsMinus1: 0, yPartitionsMinus1: 0, pieces: [])
            if rpu.usesNLQ {
                mapping.nlqMethod = u(3)
                mapping.nlqPivotDeltas = [u(rpu.blBitDepth), u(rpu.blBitDepth)]
            }
            guard let x = ue(), let y = ue() else { return nil }
            mapping.xPartitionsMinus1 = x
            mapping.yPartitionsMinus1 = y
            for component in 0..<3 {
                var pieces: [Piece] = []
                for _ in 0..<(pivots[component].count - 1) {
                    guard let idc = ue() else { return nil }
                    switch idc {
                    case 0:
                        guard let orderMinus1 = ue(), orderMinus1 <= 1 else { return nil }
                        // Linear interpolation (a flag on first-order pieces) is never set in practice.
                        if orderMinus1 == 0, flag() { return nil }
                        var coefficients: [Coefficient] = []
                        for _ in 0...(orderMinus1 + 1) {
                            guard let c = coefficient(rpu, signed: true) else { return nil }
                            coefficients.append(c)
                        }
                        pieces.append(.polynomial(orderMinus1: orderMinus1, coefficients: coefficients))
                    case 1:
                        let orderMinus1 = u(2)
                        guard orderMinus1 <= 2, let constant = coefficient(rpu, signed: true) else { return nil }
                        var coefficients: [Coefficient] = []
                        for _ in 0..<((orderMinus1 + 1) * 7) {
                            guard let c = coefficient(rpu, signed: true) else { return nil }
                            coefficients.append(c)
                        }
                        pieces.append(.mmr(orderMinus1: orderMinus1, constant: constant, coefficients: coefficients))
                    default:
                        return nil
                    }
                }
                mapping.pieces.append(pieces)
            }
            if rpu.usesNLQ {
                for _ in 0..<3 {
                    let offset = u(rpu.elBitDepth)
                    guard let inMax = coefficient(rpu, signed: false) else { return nil }
                    var nlq = NLQ(offset: offset, vdrInMax: inMax)
                    if mapping.nlqMethod == 0 {
                        guard let slope = coefficient(rpu, signed: false), let threshold = coefficient(rpu, signed: false) else { return nil }
                        nlq.deadzoneSlope = slope
                        nlq.deadzoneThreshold = threshold
                    }
                    mapping.nlq.append(nlq)
                }
            }
            return mapping
        }

        mutating func displayManagement() -> DisplayManagement? {
            guard let affected = ue(), let current = ue(), let refresh = ue() else { return nil }
            // ycc_to_rgb 9×16, offsets 3×32, rgb_to_lms 9×16, eotf 16, params 16+16+32,
            // bit depth 5, colour space 2, chroma 2, full range 2, min/max PQ 12+12, diagonal 10.
            let fixedWidth = 9 * 16 + 3 * 32 + 9 * 16 + 16 + 16 + 16 + 32 + 5 + 2 + 2 + 2 + 12 + 12 + 10
            let fixed = (0..<fixedWidth).map { _ in bits.read(1) == 1 }
            guard let count = ue() else { return nil }
            while bits.bit % 8 != 0 { guard bits.read(1) == 0 else { return nil } }
            let start = bits.bit / 8
            guard start <= bits.bytes.count else { return nil }
            // Everything after this alignment up to the CRC is data (extension blocks end on a byte).
            let tail = Array(bits.bytes[start...])
            return DisplayManagement(affectedID: affected, currentID: current, sceneRefresh: refresh, fixedFields: fixed,
                                     extensionBlockCount: count, tail: tail)
        }
    }

    // MARK: Writing

    private struct Writer {
        var bytes: [UInt8] = []
        var bit = 0

        mutating func u(_ value: Int, _ n: Int) {
            for k in stride(from: n - 1, through: 0, by: -1) { flag((value >> k) & 1 == 1) }
        }
        mutating func u32(_ value: UInt32, _ n: Int) {
            for k in stride(from: n - 1, through: 0, by: -1) { flag((value >> UInt32(k)) & 1 == 1) }
        }
        mutating func flag(_ on: Bool) {
            if bit % 8 == 0 { bytes.append(0) }
            if on { bytes[bytes.count - 1] |= 0x80 >> UInt8(bit % 8) }
            bit += 1
        }
        mutating func ue(_ value: Int) {
            let v = value + 1
            let length = Int.bitWidth - v.leadingZeroBitCount
            u(0, length - 1)
            u(v, length)
        }
        mutating func se(_ value: Int) { ue(value > 0 ? 2 * value - 1 : -2 * value) }
        mutating func align() { while bit % 8 != 0 { flag(false) } }
        mutating func append(_ raw: [UInt8]) {
            align()
            bytes += raw
            bit += raw.count * 8
        }
        mutating func coefficient(_ c: Coefficient, _ rpu: RPU) {
            if rpu.coefDataType == 0 {
                if c.isUnsignedInteger { ue(c.integer) } else { se(c.integer) }
                u32(c.fraction, rpu.coefLog2Denom)
            } else {
                u32(c.fraction, 32)
            }
        }
    }

    // MARK: Escaping

    /// Removes emulation-prevention bytes (00 00 03 → 00 00).
    static func unescape(_ b: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(b.count)
        var zeros = 0
        for byte in b {
            if zeros >= 2 && byte == 3 { zeros = 0; continue }
            out.append(byte)
            zeros = byte == 0 ? zeros + 1 : 0
        }
        return out
    }

    /// Adds emulation-prevention bytes so the payload never contains a start code.
    static func escape(_ b: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(b.count + b.count / 64)
        var zeros = 0
        for byte in b {
            if zeros >= 2 && byte <= 3 { out.append(3); zeros = 0 }
            out.append(byte)
            zeros = byte == 0 ? zeros + 1 : 0
        }
        return out
    }

    /// CRC-32/MPEG-2, what Dolby Vision RPUs carry.
    static func crc32(_ b: [UInt8]) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in b {
            crc ^= UInt32(byte) << 24
            for _ in 0..<8 { crc = crc & 0x8000_0000 != 0 ? (crc << 1) ^ 0x04C1_1DB7 : crc << 1 }
        }
        return crc
    }
}

extension DolbyVisionRPU.RPU {
    /// The changes profile 8.1 needs: no residual, no enhancement-layer data, no-op mapping curves.
    mutating func convertToProfile81() {
        vdrRPUProfile = 1
        blVideoFullRange = false
        elSpatialResamplingFilter = false
        disableResidual = true
        guard case .explicit(var mapping) = mapping else { return }
        let top = (1 << blBitDepth) - 1
        mapping.pivotDeltas = Array(repeating: [0, top], count: 3)
        mapping.nlqMethod = nil
        mapping.nlqPivotDeltas = []
        mapping.nlq = []
        let one: DolbyVisionRPU.Coefficient = coefDataType == 0
            ? .init(integer: 1, fraction: 0)
            : .init(integer: 0, fraction: Float(1).bitPattern)
        let zero = DolbyVisionRPU.Coefficient(integer: 0, fraction: 0)
        mapping.pieces = Array(repeating: [.polynomial(orderMinus1: 0, coefficients: [zero, one])], count: 3)
        self.mapping = .explicit(mapping)
    }

    /// The RPU's bytes from the 0x19 prefix to the 0x80 terminator, CRC included (unescaped).
    func write() -> [UInt8] {
        var w = DolbyVisionRPU.WriterBox()
        w.write(self)
        return w.bytes
    }
}

extension DolbyVisionRPU {
    /// Wraps the private writer for the extension above.
    struct WriterBox {
        private var w = Writer()
        var bytes: [UInt8] = []

        mutating func write(_ rpu: RPU) {
            w.u(rpu.rpuType, 6)
            w.u(rpu.rpuFormat, 11)
            w.u(rpu.vdrRPUProfile, 4)
            w.u(rpu.vdrRPULevel, 4)
            w.flag(true)
            w.flag(rpu.chromaResamplingExplicitFilter)
            w.u(rpu.coefDataType, 2)
            if rpu.coefDataType == 0 { w.ue(rpu.coefLog2Denom) }
            w.u(rpu.vdrRPUNormalizedIdc, 2)
            w.flag(rpu.blVideoFullRange)
            if let depths = rpu.bitDepths, rpu.rpuFormat & 0x700 == 0 {
                w.ue(depths.bl - 8)
                w.ue(depths.el - 8)
                w.ue(depths.vdr - 8)
                w.flag(rpu.spatialResamplingFilter)
                w.u(0, 3)
                w.flag(rpu.elSpatialResamplingFilter)
                w.flag(rpu.disableResidual)
            }
            w.flag(rpu.dmMetadataPresent)
            switch rpu.mapping {
            case .previous(let id):
                w.flag(true)
                w.ue(id)
            case .explicit(let m):
                w.flag(false)
                w.ue(m.rpuID)
                w.ue(m.colorSpace)
                w.ue(m.chromaFormatIdc)
                for deltas in m.pivotDeltas {
                    w.ue(deltas.count - 2)
                    for d in deltas { w.u(d, rpu.blBitDepth) }
                }
                if rpu.usesNLQ {
                    w.u(m.nlqMethod ?? 0, 3)
                    for d in m.nlqPivotDeltas { w.u(d, rpu.blBitDepth) }
                }
                w.ue(m.xPartitionsMinus1)
                w.ue(m.yPartitionsMinus1)
                for pieces in m.pieces {
                    for piece in pieces {
                        switch piece {
                        case .polynomial(let orderMinus1, let coefficients):
                            w.ue(0)
                            w.ue(orderMinus1)
                            if orderMinus1 == 0 { w.flag(false) }
                            for c in coefficients { w.coefficient(c, rpu) }
                        case .mmr(let orderMinus1, let constant, let coefficients):
                            w.ue(1)
                            w.u(orderMinus1, 2)
                            w.coefficient(constant, rpu)
                            for c in coefficients { w.coefficient(c, rpu) }
                        }
                    }
                }
                if rpu.usesNLQ {
                    for nlq in m.nlq {
                        w.u(nlq.offset, rpu.elBitDepth)
                        w.coefficient(nlq.vdrInMax, rpu)
                        if let slope = nlq.deadzoneSlope, let threshold = nlq.deadzoneThreshold {
                            w.coefficient(slope, rpu)
                            w.coefficient(threshold, rpu)
                        }
                    }
                }
            }
            if let dm = rpu.dm {
                w.ue(dm.affectedID)
                w.ue(dm.currentID)
                w.ue(dm.sceneRefresh)
                for bit in dm.fixedFields { w.flag(bit) }
                w.ue(dm.extensionBlockCount)
                w.append(dm.tail)
            }
            w.align()
            let crc = DolbyVisionRPU.crc32(w.bytes)
            bytes = [0x19] + w.bytes + [UInt8(crc >> 24), UInt8((crc >> 16) & 0xFF), UInt8((crc >> 8) & 0xFF), UInt8(crc & 0xFF), 0x80]
        }
    }
}
