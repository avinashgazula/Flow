import Foundation

/// Anything that can offer playable sources for a movie or episode.
public protocol SourceProvider: Sendable {
    var providerID: String { get }
    var providerName: String { get }
    var category: SourceCategory { get }
    func sources(for request: PlaybackRequest) async throws -> [StreamSource]
}

// MARK: - Stremio add-ons

public struct AddonManifest: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var version: String?
    public var description: String?
    public var logo: String?
    public var types: [String]?
    public var idPrefixes: [String]?
    public var resources: [Resource]

    public enum Resource: Codable, Hashable, Sendable {
        case name(String)
        case detailed(name: String, types: [String]?, idPrefixes: [String]?)

        public init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) { self = .name(s); return }
            struct D: Decodable { var name: String; var types: [String]?; var idPrefixes: [String]? }
            let d = try c.decode(D.self)
            self = .detailed(name: d.name, types: d.types, idPrefixes: d.idPrefixes)
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case .name(let s): try c.encode(s)
            case .detailed(let name, let types, let prefixes):
                try c.encode(["name": JSONValue.string(name),
                              "types": types.map { .array($0.map(JSONValue.string)) } ?? .null,
                              "idPrefixes": prefixes.map { .array($0.map(JSONValue.string)) } ?? .null])
            }
        }

        var name: String {
            switch self {
            case .name(let n): return n
            case .detailed(let n, _, _): return n
            }
        }
    }

    /// Whether this add-on can answer `stream` requests for the given type and id.
    public func servesStreams(type: String, id: String) -> Bool {
        for resource in resources where resource.name == "stream" {
            switch resource {
            case .name:
                let typeOK = types?.contains(type) ?? true
                let prefixOK = idPrefixes.map { $0.contains { id.hasPrefix($0) } } ?? true
                if typeOK && prefixOK { return true }
            case .detailed(_, let rTypes, let rPrefixes):
                let typeOK = (rTypes ?? types)?.contains(type) ?? true
                let prefixOK = (rPrefixes ?? idPrefixes).map { $0.contains { id.hasPrefix($0) } } ?? true
                if typeOK && prefixOK { return true }
            }
        }
        return false
    }
}

public struct AddonClient: SourceProvider {
    public var config: AddonConfig
    let http: HTTPClient
    let timeout: TimeInterval

    public init(config: AddonConfig, http: HTTPClient = HTTPClient(), timeout: TimeInterval = 15) {
        self.config = config
        self.http = http
        self.timeout = timeout
    }

    public var providerID: String { config.id }
    public var providerName: String { config.name }
    public var category: SourceCategory { .addons }

    public static func fetchManifest(_ url: URL, http: HTTPClient = HTTPClient()) async throws -> AddonManifest {
        // Accept stremio:// links copied from configure pages.
        var target = url
        if url.scheme == "stremio", let fixed = URL(string: "https" + url.absoluteString.dropFirst("stremio".count)) { target = fixed }
        return try await http.json(AddonManifest.self, HTTPRequest(.get, url: target))
    }

    struct StreamResponse: Decodable { var streams: [StreamDTO]? }

    struct StreamDTO: Decodable {
        var name: String?
        var title: String?
        var description: String?
        var url: String?
        var ytId: String?
        var infoHash: String?
        var fileIdx: Int?
        var externalUrl: String?
        var behaviorHints: Hints?

        struct Hints: Decodable {
            var bingeGroup: String?
            var filename: String?
            var videoSize: LossyInt?
            var notWebReady: Bool?
            var proxyHeaders: Proxy?
            struct Proxy: Decodable { var request: [String: String]? }
        }
    }

    public func sources(for request: PlaybackRequest) async throws -> [StreamSource] {
        guard let id = request.stremioID else { return [] }
        let type = request.item.type.stremioType
        let url = config.baseURL.appendingPathComponent("stream").appendingPathComponent(type).appendingPathComponent("\(id).json")
        let response = try await http.json(StreamResponse.self, HTTPRequest(.get, url: url, timeout: timeout))
        return (response.streams ?? []).enumerated().compactMap { index, dto in
            Self.source(from: dto, index: index, config: config)
        }
    }

    static func source(from dto: StreamDTO, index: Int, config: AddonConfig) -> StreamSource? {
        let location: StreamLocation
        if let raw = dto.url, let url = URL(string: raw) {
            location = .url(url, headers: dto.behaviorHints?.proxyHeaders?.request ?? [:])
        } else if let hash = dto.infoHash {
            location = .torrent(infoHash: hash, fileIndex: dto.fileIdx)
        } else if let external = dto.externalUrl.flatMap(URL.init(string:)) {
            location = .external(external)
        } else if let yt = dto.ytId, let url = URL(string: "https://www.youtube.com/watch?v=\(yt)") {
            location = .external(url)
        } else {
            return nil
        }
        let body = dto.description ?? dto.title ?? ""
        var traits = StreamParser.parse(dto.name, body, dto.behaviorHints?.filename)
        if let size = dto.behaviorHints?.videoSize?.value, size > 0 { traits.sizeBytes = Int64(size) }
        let headline = dto.name?.components(separatedBy: "\n").first?.trimmingCharacters(in: .whitespaces)
        return StreamSource(
            id: "\(config.id)#\(index)",
            category: .addons,
            providerID: config.id,
            providerName: config.name,
            title: [dto.name, body].compactMap { $0 }.joined(separator: "\n"),
            detail: body,
            filename: dto.behaviorHints?.filename ?? headline,
            location: location,
            traits: traits,
            bingeGroup: dto.behaviorHints?.bingeGroup
        )
    }
}

// MARK: - Ranking

public enum SourceRanker {
    /// Orders sources: category order → provider order → (custom sort rules) → original order.
    /// The preferred resolution cap always applies; filters and the result cap only when custom ordering is on.
    public static func rank(_ sources: [StreamSource], settings: SourceSettings, resolutionCap: VideoResolution) -> [StreamSource] {
        var list = sources.filter { $0.traits.resolution == .unknown || $0.traits.resolution <= resolutionCap }
        if settings.useCustomOrdering { list = list.filter { passes($0, settings.filters) } }

        let categoryIndex = Dictionary(uniqueKeysWithValues: settings.categoryOrder.enumerated().map { ($1, $0) })
        let original = Dictionary(sources.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })

        func providerIndex(_ s: StreamSource) -> Int {
            settings.providerOrder[s.category.rawValue]?.firstIndex(of: s.providerID) ?? Int.max
        }

        list.sort { a, b in
            let ca = categoryIndex[a.category] ?? Int.max, cb = categoryIndex[b.category] ?? Int.max
            if ca != cb { return ca < cb }
            let pa = providerIndex(a), pb = providerIndex(b)
            if pa != pb { return pa < pb }
            if a.providerID != b.providerID { return a.providerName < b.providerName }
            if settings.useCustomOrdering, let decided = compare(a, b, rules: settings.sortRules, filters: settings.filters) { return decided }
            return (original[a.id] ?? 0) < (original[b.id] ?? 0)
        }

        if settings.useCustomOrdering, let cap = settings.resultCap, cap > 0 { list = Array(list.prefix(cap)) }
        return list
    }

    public static func passes(_ s: StreamSource, _ f: SourceFilters) -> Bool {
        let t = s.traits
        if f.excludeCinemaCaptures && t.quality.isCinemaCapture { return false }
        if f.excludeUncached && t.isCached == false { return false }
        if f.minResolution != .unknown && t.resolution != .unknown && t.resolution < f.minResolution { return false }
        if let size = t.sizeBytes {
            let gb = Double(size) / 1_073_741_824
            if let min = f.minSizeGB, gb < min { return false }
            if let max = f.maxSizeGB, gb > max { return false }
        }
        let text = (s.title + " " + (s.filename ?? "")).lowercased()
        if f.excludedKeywords.contains(where: { !$0.isEmpty && text.contains($0.lowercased()) }) { return false }
        if !f.requiredKeywords.isEmpty && !f.requiredKeywords.contains(where: { text.contains($0.lowercased()) }) { return false }
        if let codec = t.videoCodec, f.excludedCodecs.contains(where: { $0.caseInsensitiveCompare(codec) == .orderedSame }) { return false }
        return true
    }

    /// nil when every rule ties.
    static func compare(_ a: StreamSource, _ b: StreamSource, rules: [SourceSortRule], filters: SourceFilters) -> Bool? {
        for rule in rules {
            let va = value(a, rule.key, filters), vb = value(b, rule.key, filters)
            if va != vb { return rule.descending ? va > vb : va < vb }
        }
        return nil
    }

    static func value(_ s: StreamSource, _ key: SourceSortKey, _ filters: SourceFilters) -> Double {
        let t = s.traits
        switch key {
        case .resolution: return Double(t.resolution.rawValue)
        case .quality: return Double(ReleaseQuality.allCases.firstIndex(of: t.quality) ?? 0)
        case .size: return Double(t.sizeBytes ?? 0)
        case .cached: return t.isCached == true ? 2 : t.isCached == nil ? 1 : 0
        case .seeders: return Double(t.seeders ?? 0)
        case .hdr: return t.hdr.contains("DV") ? 3 : t.hdr.contains("HDR10+") ? 2 : t.hdr.isEmpty ? 0 : 1
        case .language:
            guard !filters.preferredLanguages.isEmpty else { return 0 }
            let langs = Set(t.languages.map { $0.lowercased() })
            for (i, lang) in filters.preferredLanguages.enumerated() where langs.contains(lang.lowercased()) {
                return Double(filters.preferredLanguages.count - i)
            }
            return 0
        }
    }
}

// MARK: - Aggregation

public enum SourceUpdate: Sendable {
    case loading(providerID: String, name: String)
    case loaded(providerID: String, sources: [StreamSource])
    case failed(providerID: String, name: String, error: String)
    case finished
}

public enum SourceAggregator {
    /// Queries every provider concurrently, yielding results as each one answers.
    public static func stream(_ providers: [SourceProvider], request: PlaybackRequest, timeout: TimeInterval) -> AsyncStream<SourceUpdate> {
        AsyncStream { continuation in
            let task = Task {
                for p in providers { continuation.yield(.loading(providerID: p.providerID, name: p.providerName)) }
                await withTaskGroup(of: SourceUpdate.self) { group in
                    for provider in providers {
                        group.addTask {
                            do {
                                let sources = try await withTimeout(timeout) { try await provider.sources(for: request) }
                                return .loaded(providerID: provider.providerID, sources: sources.filter { !SourceSafety.isUnsafe($0) })
                            } catch {
                                return .failed(providerID: provider.providerID, name: provider.providerName, error: error.localizedDescription)
                            }
                        }
                    }
                    for await update in group { continuation.yield(update) }
                }
                continuation.yield(.finished)
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Collects all results at once.
    public static func collect(_ providers: [SourceProvider], request: PlaybackRequest, timeout: TimeInterval) async -> [StreamSource] {
        var all: [StreamSource] = []
        for await update in stream(providers, request: request, timeout: timeout) {
            if case .loaded(_, let sources) = update { all += sources }
        }
        return all
    }
}

/// Runs `operation`, throwing `FlowError.timedOut` if it takes longer than `seconds`.
public func withTimeout<T: Sendable>(_ seconds: TimeInterval, _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw FlowError.timedOut
        }
        guard let result = try await group.next() else { throw FlowError.timedOut }
        group.cancelAll()
        return result
    }
}
