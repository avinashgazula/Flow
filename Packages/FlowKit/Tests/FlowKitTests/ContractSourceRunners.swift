import XCTest
@testable import FlowKit

/// Stream names and traits (testdata/contracts/source-parser.json).
extension Contracts {
    static func sourceParser(_ c: ContractCase) throws -> JSONValue {
        let input = c.input
        switch c.op {
        case "parse":
            let traits = StreamParser.parse((input.array ?? []).compactMap { $0.string }.joined(separator: "\n"))
            func text(_ value: String?) -> JSONValue { value.map { .string($0) } ?? .null }
            func whole(_ value: Int?) -> JSONValue { value.map { .int($0) } ?? .null }
            let all: [String: JSONValue] = [
                "resolution": .int(traits.resolution.rawValue),
                "quality": .string(traits.quality.rawValue),
                "videoCodec": text(traits.videoCodec),
                "hdr": .array(traits.hdr.map { .string($0) }),
                "audioCodec": text(traits.audioCodec),
                "audioChannels": text(traits.audioChannels),
                "sizeBytes": whole(traits.sizeBytes.map { Int($0) }),
                "languages": .array(traits.languages.map { .string($0) }),
                "isCached": traits.isCached.map { .bool($0) } ?? .null,
                "seeders": whole(traits.seeders),
                "bitDepth": whole(traits.bitDepth),
                "releaseGroup": text(traits.releaseGroup),
            ]
            // A case names the fields it checks.
            return .object(all.filter { c.expected.object?[$0.key] != nil })
        case "episodeRef":
            guard let ref = StreamParser.episodeRef(in: input.string ?? "") else { return .null }
            return .object(["season": .int(ref.season), "episode": .int(ref.episode)])
        case "titleAndYear":
            let parsed = StreamParser.titleAndYear(from: input.string ?? "")
            return .object(["title": .string(parsed.title), "year": parsed.year.map { .int($0) } ?? .null])
        case "normalizeTitle":
            return .string(StreamParser.normalizeTitle(input.string ?? ""))
        case "formatBytes":
            return .string(StreamParser.formatBytes(Int64(input.int ?? 0)))
        case "unsafeFile":
            return .bool(SourceSafety.isUnsafeFileName(input.string ?? ""))
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }
}
