import Foundation

public protocol SkipSegmentProvider: Sendable {
    var name: String { get }
    func segments(for request: PlaybackRequest) async throws -> [SkipSegment]
}

/// Generic key-authenticated segments API. IntroDB and PublicMetaDB both expose a
/// `/segments` lookup by TMDb/IMDb id (+ season/episode); response shapes vary slightly,
/// so parsing is deliberately tolerant. The base URL is configurable in Settings.
public struct KeyedSegmentsClient: SkipSegmentProvider {
    public let name: String
    let baseURL: String
    let apiKey: String
    let header: String
    let http: HTTPClient

    public init(name: String, baseURL: String, apiKey: String, header: String = "X-API-Key", http: HTTPClient = HTTPClient()) {
        self.name = name
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.apiKey = apiKey
        self.header = header
        self.http = http
    }

    public static func introDB(baseURL: String, apiKey: String) -> KeyedSegmentsClient {
        KeyedSegmentsClient(name: "IntroDB", baseURL: baseURL, apiKey: apiKey)
    }

    public static func publicMetaDB(baseURL: String, apiKey: String) -> KeyedSegmentsClient {
        KeyedSegmentsClient(name: "PublicMetaDB", baseURL: baseURL, apiKey: apiKey, header: "Authorization")
    }

    public func segments(for request: PlaybackRequest) async throws -> [SkipSegment] {
        guard !apiKey.isEmpty else { throw FlowError.missingCredential("\(name) API key") }
        var q: [String: String?] = ["tmdb_id": request.item.ids.tmdb.map(String.init), "imdb_id": request.item.ids.imdb, "type": request.item.type.rawValue]
        if let ep = request.episode { q["season"] = String(ep.season); q["episode"] = String(ep.number) }
        let value = header == "Authorization" ? "Bearer \(apiKey)" : apiKey
        let json = try await http.json(JSONValue.self, HTTPRequest(.get, baseURL + "/segments", query: q, headers: [header: value]))
        return Self.parse(json)
    }

    public static func parse(_ json: JSONValue) -> [SkipSegment] {
        let list = json.array ?? json["segments"]?.array ?? json["data"]?.array ?? []
        var out: [SkipSegment] = list.compactMap { e in
            let typeName = (e["type"] ?? e["segment_type"] ?? e["kind"])?.string?.lowercased() ?? ""
            let kind: SkipSegmentKind?
            switch typeName {
            case "intro", "opening", "op": kind = .intro
            case "recap", "previously": kind = .recap
            case "credits", "outro", "ending", "ed": kind = .credits
            case "preview", "next": kind = .preview
            case "commercial", "ad": kind = .commercial
            default: kind = nil
            }
            guard let kind else { return nil }
            func seconds(_ keys: [String]) -> Double? {
                for k in keys {
                    if let v = e[k]?.double { return k.hasSuffix("_ms") || k.hasSuffix("Ms") ? v / 1000 : v }
                }
                return nil
            }
            guard let start = seconds(["start", "start_sec", "startTime", "start_ms", "startMs"]),
                  let end = seconds(["end", "end_sec", "endTime", "end_ms", "endMs"]), end > start else { return nil }
            return SkipSegment(kind: kind, start: start, end: end)
        }
        // Object form: {"intro": {"start": 10, "end": 70}, ...}
        if out.isEmpty, let object = json.object ?? json["data"]?.object {
            for (key, value) in object {
                guard let kind = SkipSegmentKind(rawValue: key.lowercased()), let s = value["start"]?.double, let e = value["end"]?.double, e > s else { continue }
                out.append(SkipSegment(kind: kind, start: s, end: e))
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
