import Foundation

public protocol SkipSegmentProvider: Sendable {
    var name: String { get }
    func segments(for request: PlaybackRequest) async throws -> [SkipSegment]
}

/// IntroDB and PublicMetaDB, the two community services that know where an intro, recap or
/// credits run. They are asked differently (checked against the live services, October 2026):
/// - IntroDB: `GET /segments?imdb_id=…&season=…&episode=…` (`is_movie=true` for a film). Reading
///   needs no key; one is sent when there is one.
/// - PublicMetaDB: `GET /api/external/skips?tmdb_id=…&media_type=tv|movie&season=…&episode=…` with
///   the key as a Bearer token.
/// Their answers differ too, so parsing is deliberately tolerant and also reads the older shapes
/// (a list of typed records, or an object keyed by kind). The base URLs are configurable in Settings.
public struct KeyedSegmentsClient: SkipSegmentProvider {
    public enum Service: Sendable { case introDB, publicMetaDB }

    public let name: String
    let service: Service
    let baseURL: String
    let apiKey: String
    let http: HTTPClient

    public init(service: Service, baseURL: String, apiKey: String, http: HTTPClient = HTTPClient()) {
        self.service = service
        self.name = service == .introDB ? "IntroDB" : "PublicMetaDB"
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.apiKey = apiKey
        self.http = http
    }

    /// IntroDB can be read without a key, so `apiKey` may be empty; a key is still sent when given.
    public static func introDB(baseURL: String, apiKey: String = "", http: HTTPClient = HTTPClient()) -> KeyedSegmentsClient {
        KeyedSegmentsClient(service: .introDB, baseURL: baseURL, apiKey: apiKey, http: http)
    }

    public static func publicMetaDB(baseURL: String, apiKey: String, http: HTTPClient = HTTPClient()) -> KeyedSegmentsClient {
        KeyedSegmentsClient(service: .publicMetaDB, baseURL: baseURL, apiKey: apiKey, http: http)
    }

    /// The lookup for a film or episode, or nil when the service can't be asked about it: IntroDB
    /// goes by IMDb id, and an episode needs its season and number.
    func lookup(for request: PlaybackRequest) throws -> HTTPRequest? {
        let isShow = request.item.type == .show
        var query: [String: String?] = [:]
        if isShow {
            guard let ep = request.episode else { return nil }
            query["season"] = String(ep.season)
            query["episode"] = String(ep.number)
        }
        switch service {
        case .introDB:
            guard let imdb = request.item.ids.imdb, !imdb.isEmpty else { return nil }
            query["imdb_id"] = imdb
            if !isShow { query["is_movie"] = "true" }
            let headers = apiKey.isEmpty ? [:] : ["X-API-Key": apiKey]
            return try HTTPRequest(.get, baseURL + "/segments", query: query, headers: headers)
        case .publicMetaDB:
            guard let tmdb = request.item.ids.tmdb else { return nil }
            query["tmdb_id"] = String(tmdb)
            query["media_type"] = isShow ? "tv" : "movie"
            return try HTTPRequest(.get, baseURL + "/api/external/skips", query: query, headers: ["Authorization": "Bearer \(apiKey)"])
        }
    }

    public func segments(for request: PlaybackRequest) async throws -> [SkipSegment] {
        if service == .publicMetaDB, apiKey.isEmpty { throw FlowError.missingCredential("\(name) API key") }
        guard let lookup = try lookup(for: request) else { return [] }
        return Self.parse(try await http.json(JSONValue.self, lookup))
    }

    /// The kind a service's name for a segment stands for. IntroDB's "outro" is the credits. Its
    /// "post_credits" is a scene after them, which isn't something to skip, so it has no kind.
    static func kind(named name: String) -> SkipSegmentKind? {
        switch name.lowercased() {
        case "intro", "opening", "op": return .intro
        case "recap", "previously": return .recap
        case "credits", "outro", "ending", "ed": return .credits
        case "preview", "next": return .preview
        case "commercial", "ad": return .commercial
        default: return nil
        }
    }

    /// The first of `keys` the record has as a number, in seconds (a key ending in "_ms" or "Ms" is milliseconds).
    private static func seconds(_ record: JSONValue, _ keys: [String]) -> Double? {
        for key in keys {
            if let v = record[key]?.double { return key.hasSuffix("_ms") || key.hasSuffix("Ms") ? v / 1000 : v }
        }
        return nil
    }

    private static func segment(_ kind: SkipSegmentKind?, _ record: JSONValue) -> SkipSegment? {
        guard let kind,
              let start = seconds(record, ["start", "start_sec", "startTime", "start_ms", "startMs"]),
              let end = seconds(record, ["end", "end_sec", "endTime", "end_ms", "endMs"]), end > start else { return nil }
        return SkipSegment(kind: kind, start: start, end: end)
    }

    public static func parse(_ json: JSONValue) -> [SkipSegment] {
        // List form: [{"type": "intro", "start": 10, "end": 70}, ...], bare or under "segments" or "data".
        let list = json.array ?? json["segments"]?.array ?? json["data"]?.array ?? []
        var out: [SkipSegment] = list.compactMap { e in
            segment(kind(named: (e["type"] ?? e["segment_type"] ?? e["kind"])?.string ?? ""), e)
        }
        // Object form, IntroDB's: {"intro": {"start_sec": 10, "end_sec": 70}, "outro": {...}, "recap": null, ...}
        if out.isEmpty, let object = json["data"]?.object ?? json.object {
            out = object.compactMap { key, value in segment(kind(named: key), value) }
        }
        // PublicMetaDB's flat records, one per source: {"items": [{"source": "streaming", "intro_start_ms": 0, ...}]}.
        // The streaming cut goes first, and the first record to name a kind has it.
        if out.isEmpty, let items = json["items"]?.array {
            let records = items.filter { $0.object != nil }
            let ordered = records.filter { $0["source"]?.string == "streaming" } + records.filter { $0["source"]?.string != "streaming" }
            var seen = Set<SkipSegmentKind>()
            for record in ordered {
                for kind in [SkipSegmentKind.intro, .recap, .credits, .preview] where !seen.contains(kind) {
                    guard let start = record["\(kind.rawValue)_start_ms"]?.double, let end = record["\(kind.rawValue)_end_ms"]?.double, end > start else { continue }
                    seen.insert(kind)
                    out.append(SkipSegment(kind: kind, start: start / 1000, end: end / 1000))
                }
            }
        }
        return out.sorted { $0.start < $1.start }
    }
}

public enum SkipSegmentResolver {
    /// Source-provided segments win; otherwise the first provider with an answer.
    public static func resolve(source: StreamSource?, providers: [SkipSegmentProvider], request: PlaybackRequest) async -> [SkipSegment] {
        if let segments = source?.segments, !segments.isEmpty { return segments }
        for provider in providers {
            if let segments = try? await withTimeout(8, { try await provider.segments(for: request) }), !segments.isEmpty { return segments }
        }
        return []
    }

    /// Segments read from chapter names ("Opening", "Ending", "Recap", "Preview"), as anime and many
    /// TV releases name them. Each runs to the next chapter. Implausibly short or long ones are ignored.
    public static func fromChapters(_ chapters: [(title: String, start: Double)], duration: Double) -> [SkipSegment] {
        let sorted = chapters.sorted { $0.start < $1.start }
        var out: [SkipSegment] = []
        for (i, chapter) in sorted.enumerated() {
            guard let kind = kind(ofChapter: chapter.title) else { continue }
            let end = i + 1 < sorted.count ? sorted[i + 1].start : duration
            let length = end - chapter.start
            let longest: Double = kind == .credits ? 900 : 360
            guard length >= 8, length <= longest else { continue }
            out.append(SkipSegment(kind: kind, start: chapter.start, end: end))
        }
        return out
    }

    static func kind(ofChapter title: String) -> SkipSegmentKind? {
        let t = title.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let words = Set(t.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init))
        func has(_ phrase: String) -> Bool { t.contains(phrase) }
        if words.contains("recap") || has("previously") { return .recap }
        if words.contains("preview") || has("next episode") || has("next time") { return .preview }
        if words.contains("op") || words.contains("opening") || words.contains("intro") || has("title sequence") || has("main title") { return .intro }
        if words.contains("ed") || words.contains("ending") || words.contains("credits") || words.contains("outro") { return .credits }
        return nil
    }

    /// Which segment (if any) should show its skip button at `time`.
    public static func active(_ segments: [SkipSegment], at time: Double) -> SkipSegment? {
        segments.first { $0.contains(time) }
    }
}
