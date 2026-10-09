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

    /// Which segment (if any) should show its skip button at `time`.
    public static func active(_ segments: [SkipSegment], at time: Double) -> SkipSegment? {
        segments.first { $0.contains(time) }
    }
}
