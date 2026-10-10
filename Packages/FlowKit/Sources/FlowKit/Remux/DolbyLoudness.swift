import Foundation

/// Volume boost for Dolby Digital (AC-3) and Dolby Digital Plus (E-AC-3), without decoding.
///
/// Every syncframe carries a dialogue level ("dialnorm", −1 to −31 dB) and decoders turn the whole
/// mix down so dialogue lands at −31 dB: a film mixed with dialogue at −24 dB plays 7 dB quieter than
/// it was mastered. Rewriting dialnorm closer to −31 hands that headroom back as real loudness, and
/// AVPlayer can't otherwise play louder than 100%. Each rewritten frame's CRC is solved again, so
/// decoders accept it.
enum DolbyLoudness {
    /// Raises every syncframe in `data` (one Matroska block: a frame, or an E-AC-3 independent frame
    /// with its dependent substreams) by up to `dB`, limited by the headroom each frame leaves.
    static func boost(_ data: [UInt8], dB: Int) -> [UInt8] {
        guard dB > 0 else { return data }
        var out = data
        var i = 0
        while i + 8 <= out.count, out[i] == 0x0B, out[i + 1] == 0x77 {
            let bsid = Int(out[i + 5] >> 3)
            let size: Int
            if bsid <= 10 {
                guard let header = AC3.parse(out, at: i) else { break }
                size = header.frameBytes
                guard size > 0, i + size <= out.count else { break }
                rewriteAC3(&out, at: i, size: size, acmod: header.acmod, dB: dB)
            } else if bsid <= 16 {
                size = (Int(out[i + 2] & 0x07) << 8 | Int(out[i + 3])) * 2 + 2
                guard size > 6, i + size <= out.count else { break }
                rewriteEAC3(&out, at: i, size: size, dB: dB)
            } else {
                break
            }
            i += size
        }
        return out
    }

    /// The dialogue level a frame declares, in dB below full scale (1–31), for tests and the info panel.
    static func dialogueLevel(_ data: [UInt8]) -> Int? {
        guard data.count >= 8, data[0] == 0x0B, data[1] == 0x77 else { return nil }
        let bsid = Int(data[5] >> 3)
        if bsid <= 10 {
            guard let header = AC3.parse(data) else { return nil }
            return Int(readBits(data, at: ac3DialnormBit(acmod: header.acmod), count: 5))
        }
        return Int(readBits(data, at: 45, count: 5))
    }

    // MARK: AC-3 (ATSC A/52 §5.4.2)

    private static func ac3DialnormBit(acmod: Int) -> Int {
        // syncword, crc1, fscod, frmsizecod, bsid, bsmod, acmod, then the mix levels this acmod carries, lfeon.
        var bit = 16 + 16 + 2 + 6 + 5 + 3 + 3
        if acmod & 1 != 0 && acmod != 1 { bit += 2 }
        if acmod & 4 != 0 { bit += 2 }
        if acmod == 2 { bit += 2 }
        return bit + 1
    }

    private static func rewriteAC3(_ b: inout [UInt8], at start: Int, size: Int, acmod: Int, dB: Int) {
        var bit = start * 8 + ac3DialnormBit(acmod: acmod)
        var changed = raise(&b, bit: bit, dB: dB)
        if acmod == 0 {
            // Dual mono has a second programme with its own dialnorm, after compr, langcod and the mixing info.
            bit += 5
            if readBits(b, at: bit, count: 1) == 1 { bit += 8 }; bit += 1
            if readBits(b, at: bit, count: 1) == 1 { bit += 8 }; bit += 1
            if readBits(b, at: bit, count: 1) == 1 { bit += 7 }; bit += 1
            changed = raise(&b, bit: bit, dB: dB) || changed
        }
        guard changed else { return }
        // crc1 guards the first 5/8 of the frame (after the syncword) and sits at its start.
        let fiveEighths = ((size >> 2) + (size >> 4)) << 1
        solveCRC(&b, region: (start + 2)..<(start + fiveEighths), field: start + 2)
    }

    // MARK: E-AC-3 (ETSI TS 102 366 Annex E)

    private static func rewriteEAC3(_ b: inout [UInt8], at start: Int, size: Int, dB: Int) {
        // syncword, strmtyp, substreamid, frmsiz, fscod, fscod2/numblkscod, acmod, lfeon, bsid.
        var bit = start * 8 + 45
        let acmod = Int(readBits(b, at: start * 8 + 40 - 4, count: 3))
        var changed = raise(&b, bit: bit, dB: dB)
        if acmod == 0 {
            bit += 5
            if readBits(b, at: bit, count: 1) == 1 { bit += 8 }; bit += 1
            changed = raise(&b, bit: bit, dB: dB) || changed
        }
        guard changed else { return }
        // E-AC-3 has a single CRC, the frame's last two bytes, over everything after the syncword.
        solveCRC(&b, region: (start + 2)..<(start + size), field: start + size - 2)
    }

    // MARK: Bits

    /// Lowers the declared dialogue level (−24 → −31 at most), which raises playback by as much.
    private static func raise(_ b: inout [UInt8], bit: Int, dB: Int) -> Bool {
        let current = Int(readBits(b, at: bit, count: 5))
        // 0 is reserved and decoders treat it as −31: nothing to give back.
        guard current > 0, current < 31 else { return false }
        let target = min(31, current + dB)
        writeBits(&b, at: bit, count: 5, value: UInt32(target))
        return true
    }

    static func readBits(_ b: [UInt8], at bit: Int, count: Int) -> UInt32 {
        var value: UInt32 = 0
        for k in 0..<count {
            let index = bit + k
            value = value << 1 | UInt32((b[index >> 3] >> (7 - UInt8(index & 7))) & 1)
        }
        return value
    }

    private static func writeBits(_ b: inout [UInt8], at bit: Int, count: Int, value: UInt32) {
        for k in 0..<count {
            let index = bit + k
            let mask = UInt8(1) << (7 - UInt8(index & 7))
            if (value >> UInt32(count - 1 - k)) & 1 == 1 { b[index >> 3] |= mask } else { b[index >> 3] &= ~mask }
        }
    }

    // MARK: CRC

    /// CRC-16 (x¹⁶ + x¹⁵ + x² + 1), most significant bit first, starting from zero: what A/52 decoders
    /// run over a protected region, expecting zero when the stored CRC is right.
    static func crc16(_ b: [UInt8], _ range: Range<Int>) -> UInt16 {
        var crc: UInt16 = 0
        for i in range {
            crc ^= UInt16(b[i]) << 8
            for _ in 0..<8 { crc = crc & 0x8000 != 0 ? (crc << 1) ^ 0x8005 : crc << 1 }
        }
        return crc
    }

    /// For each region length and field position, the CRC each of the field's 16 bits contributes.
    /// The CRC is linear, so the field that zeroes it is the solution of a 16×16 system over GF(2).
    private static let basisLock = NSLock()
    nonisolated(unsafe) private static var basisCache: [Int: [UInt16]] = [:]

    private static func basis(length: Int, fieldOffset: Int) -> [UInt16] {
        let key = length << 16 | fieldOffset
        if let hit = basisLock.withLock({ basisCache[key] }) { return hit }
        var columns: [UInt16] = []
        var probe = [UInt8](repeating: 0, count: length)
        for bit in 0..<16 {
            probe[fieldOffset] = 0
            probe[fieldOffset + 1] = 0
            probe[fieldOffset + bit / 8] = 0x80 >> UInt8(bit % 8)
            columns.append(crc16(probe, 0..<length))
        }
        basisLock.withLock { basisCache[key] = columns }
        return columns
    }

    /// Writes the 16-bit value at `field` that makes the CRC over `region` zero.
    private static func solveCRC(_ b: inout [UInt8], region: Range<Int>, field: Int) {
        b[field] = 0
        b[field + 1] = 0
        let target = crc16(b, region)
        let columns = basis(length: region.count, fieldOffset: field - region.lowerBound)
        // Gaussian elimination on [columns | target], tracking which field bits make up each row.
        var rows: [(value: UInt16, combo: UInt16)] = columns.enumerated().map { ($0.element, UInt16(1) << UInt16($0.offset)) }
        var solution: UInt16 = 0
        var remaining = target
        for pivot in (0..<16).reversed() {
            let mask = UInt16(1) << UInt16(pivot)
            guard let index = rows.firstIndex(where: { $0.value & mask != 0 }) else { continue }
            let row = rows.remove(at: index)
            for j in rows.indices where rows[j].value & mask != 0 {
                rows[j].value ^= row.value
                rows[j].combo ^= row.combo
            }
            if remaining & mask != 0 {
                remaining ^= row.value
                solution ^= row.combo
            }
        }
        guard remaining == 0 else { return }
        for bit in 0..<16 where solution & (UInt16(1) << UInt16(bit)) != 0 {
            b[field + bit / 8] |= 0x80 >> UInt8(bit % 8)
        }
    }
}
