import XCTest
@testable import FlowKit

/// Source filters and order (testdata/contracts/source-rank.json).
extension Contracts {
    private static func streamSource(_ s: JSONValue) -> StreamSource {
        var traits = StreamTraits()
        traits.resolution = VideoResolution(rawValue: s["resolution"]?.int ?? 0) ?? .unknown
        traits.quality = ReleaseQuality(rawValue: s["quality"]?.string ?? "") ?? .unknown
        traits.sizeBytes = s["sizeBytes"]?.int.map { Int64($0) } ?? s["size"]?.int.map { Int64($0) }
        traits.isCached = s["cached"]?.bool
        traits.seeders = s["seeders"]?.int
        traits.hdr = (s["hdr"]?.array ?? []).compactMap { $0.string }
        traits.languages = (s["languages"]?.array ?? []).compactMap { $0.string }
        traits.videoCodec = s["videoCodec"]?.string
        let provider = s["provider"]?.string ?? "a"
        return StreamSource(id: s["id"]?.string ?? "", category: SourceCategory(rawValue: s["category"]?.string ?? "addons") ?? .addons, providerID: provider, providerName: provider,
                            title: s["title"]?.string ?? "", detail: s["detail"]?.string, filename: s["filename"]?.string,
                            location: .url(URL(string: "https://example.com/\(s["id"]?.string ?? "")")!, headers: [:]), traits: traits)
    }

    private static func filters(_ f: JSONValue) -> SourceFilters {
        var out = SourceFilters()
        out.excludeCinemaCaptures = f["excludeCinemaCaptures"]?.bool ?? true
        out.excludeUncached = f["excludeUncached"]?.bool ?? false
        out.minSizeGB = f["minSizeGB"]?.double
        out.maxSizeGB = f["maxSizeGB"]?.double
        out.minResolution = VideoResolution(rawValue: f["minResolution"]?.int ?? 0) ?? .unknown
        out.requiredKeywords = (f["requiredKeywords"]?.array ?? []).compactMap { $0.string }
        out.excludedKeywords = (f["excludedKeywords"]?.array ?? []).compactMap { $0.string }
        out.preferredLanguages = (f["preferredLanguages"]?.array ?? []).compactMap { $0.string }
        out.excludedCodecs = (f["excludedCodecs"]?.array ?? []).compactMap { $0.string }
        return out
    }

    static func sourceRank(_ c: ContractCase) throws -> JSONValue {
        let input = c.input
        switch c.op {
        case "passes":
            return .bool(SourceRanker.passes(streamSource(input["source"] ?? .null), filters(input["filters"] ?? .null)))
        case "arrange":
            var settings = SourceSettings()
            settings.useCustomOrdering = input["custom"]?.bool ?? false
            settings.categoryOrder = (input["categoryOrder"]?.array ?? []).compactMap { $0.string.flatMap { SourceCategory(rawValue: $0) } }
            for (category, ids) in input["providerOrder"]?.object ?? [:] { settings.providerOrder[category] = (ids.array ?? []).compactMap { $0.string } }
            settings.sortRules = (input["rules"]?.array ?? []).compactMap { rule in
                guard let key = rule["key"]?.string.flatMap({ SourceSortKey(rawValue: $0) }) else { return nil }
                return SourceSortRule(key: key, descending: rule["descending"]?.bool ?? true)
            }
            settings.filters = filters(input["filters"] ?? .null)
            settings.resultCap = input["cap"]?.int
            let sources = (input["sources"]?.array ?? []).map(streamSource)
            let ranked = SourceRanker.rank(sources, settings: settings, resolutionCap: .uhd4k, prefersHDR: input["hdrScreen"]?.bool ?? true, preferredAudioLanguage: input["audioLanguage"]?.string)
            return .array(ranked.map { .string($0.id) })
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }
}
