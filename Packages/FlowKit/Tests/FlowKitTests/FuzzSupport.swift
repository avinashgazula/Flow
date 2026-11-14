import XCTest
@testable import FlowKit

/// A small seeded generator (SplitMix64), so a failing mutation can be reproduced from its seed.
struct SeededRandom: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// The ways outside bytes go wrong: cut short, flipped bits, length fields set to extremes, chunks
/// repeated or moved. Every mutation is a pure function of the input and the generator.
enum Mutation {
    /// Values a length or count field is most likely to trap on.
    static let extremes: [[UInt8]] = [
        [0x00], [0xFF], [0x7F], [0x80], [0x01],
        [0x00, 0x00], [0xFF, 0xFF], [0x7F, 0xFF], [0x80, 0x00],
        [0x00, 0x00, 0x00, 0x00], [0xFF, 0xFF, 0xFF, 0xFF], [0x7F, 0xFF, 0xFF, 0xFF], [0x80, 0x00, 0x00, 0x00],
        [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        [0x0F, 0xFF, 0xFF, 0xFF], [0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], [0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    ]

    static func truncated(_ b: [UInt8], at n: Int) -> [UInt8] { Array(b.prefix(max(0, n))) }

    static func bitFlips(_ b: [UInt8], count: Int, using g: inout SeededRandom) -> [UInt8] {
        guard !b.isEmpty else { return b }
        var out = b
        for _ in 0..<count { out[Int.random(in: 0..<out.count, using: &g)] ^= UInt8(1) << UInt8.random(in: 0..<8, using: &g) }
        return out
    }

    /// Overwrites `count` places with extreme values; `within` limits where (headers are dense with sizes).
    static func extremeValues(_ b: [UInt8], count: Int, within: Range<Int>? = nil, using g: inout SeededRandom) -> [UInt8] {
        var out = b
        let range = (within ?? 0..<b.count).clamped(to: 0..<b.count)
        guard !range.isEmpty else { return b }
        for _ in 0..<count {
            let value = extremes[Int.random(in: 0..<extremes.count, using: &g)]
            let at = Int.random(in: range, using: &g)
            for (k, byte) in value.enumerated() where at + k < out.count { out[at + k] = byte }
        }
        return out
    }

    static func duplicatedChunk(_ b: [UInt8], using g: inout SeededRandom) -> [UInt8] {
        guard b.count > 4 else { return b }
        let from = Int.random(in: 0..<b.count - 1, using: &g)
        let length = Int.random(in: 1...min(64, b.count - from), using: &g)
        var out = b
        out.insert(contentsOf: b[from..<from + length], at: Int.random(in: 0...b.count, using: &g))
        return out
    }

    static func swappedChunks(_ b: [UInt8], using g: inout SeededRandom) -> [UInt8] {
        guard b.count > 32 else { return b }
        let length = Int.random(in: 1...16, using: &g)
        let x = Int.random(in: 0..<b.count - length, using: &g)
        let y = Int.random(in: 0..<b.count - length, using: &g)
        var out = b
        for k in 0..<length { out.swapAt(x + k, y + k) }
        return out
    }

    static func insertedGarbage(_ b: [UInt8], using g: inout SeededRandom) -> [UInt8] {
        var out = b
        let garbage = (0..<Int.random(in: 1...32, using: &g)).map { _ in UInt8.random(in: 0...255, using: &g) }
        out.insert(contentsOf: garbage, at: Int.random(in: 0...b.count, using: &g))
        return out
    }

    /// One random mutation of any kind.
    static func random(_ b: [UInt8], within: Range<Int>? = nil, using g: inout SeededRandom) -> [UInt8] {
        switch Int.random(in: 0..<6, using: &g) {
        case 0: return truncated(b, at: Int.random(in: 0...b.count, using: &g))
        case 1: return bitFlips(b, count: Int.random(in: 1...8, using: &g), using: &g)
        case 2, 3: return extremeValues(b, count: Int.random(in: 1...4, using: &g), within: within, using: &g)
        case 4: return Bool.random(using: &g) ? duplicatedChunk(b, using: &g) : swappedChunks(b, using: &g)
        default: return insertedGarbage(b, using: &g)
        }
    }
}

/// Runs `body` over many mutated inputs. A case that takes longer than `limit` seconds aborts the
/// run with the seed and case number, so a hang fails loudly instead of stalling CI.
enum Fuzz {
    /// FLOW_FUZZ_SCALE=20 runs twenty times as many cases per test, with different seeds, for a deeper local hunt.
    static let scale = Int(ProcessInfo.processInfo.environment["FLOW_FUZZ_SCALE"] ?? "") ?? 1
    static func seed(_ base: UInt64) -> UInt64 { base &+ UInt64(scale - 1) &* 7_919_000 }

    static func cases(_ label: String, seed: UInt64, count: Int, limit: TimeInterval = 20, _ body: (_ index: Int, _ rng: inout SeededRandom) throws -> Void) rethrows {
        for index in 0..<(count * scale) {
            var rng = SeededRandom(seed: Self.seed(seed) &+ UInt64(index) &* 0x1000_0001)
            let watchdog = DispatchWorkItem { fatalError("fuzz hang: \(label) seed \(seed) case \(index) ran over \(limit)s") }
            DispatchQueue.global().asyncAfter(deadline: .now() + limit, execute: watchdog)
            defer { watchdog.cancel() }
            try body(index, &rng)
        }
    }

    /// Async variant for the remuxer, which reads through an actor.
    static func casesAsync(_ label: String, seed: UInt64, count: Int, limit: TimeInterval = 20, _ body: (_ index: Int, _ rng: inout SeededRandom) async throws -> Void) async rethrows {
        for index in 0..<(count * scale) {
            var rng = SeededRandom(seed: Self.seed(seed) &+ UInt64(index) &* 0x1000_0001)
            let watchdog = DispatchWorkItem { fatalError("fuzz hang: \(label) seed \(seed) case \(index) ran over \(limit)s") }
            DispatchQueue.global().asyncAfter(deadline: .now() + limit, execute: watchdog)
            defer { watchdog.cancel() }
            try await body(index, &rng)
        }
    }

    /// The offsets of every size field in an EBML file, so mutations can aim at them.
    static func ebmlSizeFields(_ b: [UInt8], limit: Int = 4096) -> [Range<Int>] {
        var out: [Range<Int>] = []
        func walk(_ start: Int, _ end: Int, depth: Int) {
            var i = start
            while i < end, out.count < limit, let e = try? EBML.readElement(b, at: i) {
                var p = e.start
                _ = try? EBML.readID(b, &p)
                out.append(p..<e.dataStart)
                // Descend into the master elements Flow reads.
                let masters: Set<UInt32> = [MKV.segment, MKV.tracks, MKV.cues, MKV.chapters, MKV.info, MKV.seekHead, MKV.cluster, MKV.ebml]
                if masters.contains(e.id) || e.id == 0xAE || e.id == 0xE0 || e.id == 0xE1 || e.id == 0xBB || e.id == 0xA0 || e.id == 0xB7 {
                    if depth < 6 { walk(e.dataStart, min(end, e.end ?? end), depth: depth + 1) }
                }
                guard let next = e.end, next > i else { break }
                i = next
            }
        }
        walk(0, b.count, depth: 0)
        return out
    }
}
