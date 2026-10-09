import Foundation

public struct SubtitleCue: Hashable, Sendable, Identifiable {
    public var index: Int
    public var start: Double
    public var end: Double
    public var text: String
    public var id: Int { index }

    public init(index: Int, start: Double, end: Double, text: String) {
        self.index = index
        self.start = start
        self.end = end
        self.text = text
    }
}

/// Cues sorted by start time with fast lookup for the player overlay.
public struct SubtitleDocument: Sendable {
    public var cues: [SubtitleCue]

    public init(cues: [SubtitleCue]) { self.cues = cues.sorted { $0.start < $1.start } }

    /// Text visible at `time` (seconds), applying `offset` (positive delays subtitles).
    public func text(at time: Double, offset: Double = 0) -> String? {
        let t = time - offset
        var lo = 0, hi = cues.count - 1, found = -1
        while lo <= hi {
            let mid = (lo + hi) / 2
            if cues[mid].start <= t { found = mid; lo = mid + 1 } else { hi = mid - 1 }
        }
        guard found >= 0 else { return nil }
        // Overlapping cues: gather every cue active at t, scanning back a little.
        var lines: [String] = []
        var i = found
        while i >= 0 && i >= found - 5 {
            if cues[i].start <= t && t < cues[i].end { lines.insert(cues[i].text, at: 0) }
            i -= 1
        }
        return lines.isEmpty ? nil : lines.joined(separator: "\n")
    }
}

public enum SubtitleParser {
    public static func decode(_ data: Data) -> String {
        if data.starts(with: [0xEF, 0xBB, 0xBF]) { return String(decoding: data.dropFirst(3), as: UTF8.self) }
        if data.starts(with: [0xFF, 0xFE]) || data.starts(with: [0xFE, 0xFF]) { return String(data: data, encoding: .utf16) ?? "" }
        if let s = String(data: data, encoding: .utf8) { return s }
        return String(data: data, encoding: .windowsCP1252) ?? String(decoding: data, as: UTF8.self)
    }

    public static func parse(_ data: Data) -> SubtitleDocument { parse(decode(data)) }

    public static func parse(_ text: String) -> SubtitleDocument {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var cues: [SubtitleCue] = []
        for block in normalized.components(separatedBy: "\n\n") {
            let lines = block.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            guard let timeIndex = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
            let parts = lines[timeIndex].components(separatedBy: "-->")
            guard parts.count == 2, let start = timestamp(parts[0]), let end = timestamp(parts[1].trimmingCharacters(in: .whitespaces).components(separatedBy: " ").first ?? "") else { continue }
            let body = lines[(timeIndex + 1)...].map(stripTags).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !body.isEmpty else { continue }
            cues.append(SubtitleCue(index: cues.count, start: start, end: end, text: body))
        }
        return SubtitleDocument(cues: cues)
    }

    /// "01:02:03,456", "01:02:03.456", "02:03.456"
    static func timestamp(_ raw: String) -> Double? {
        let s = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        let parts = s.split(separator: ":")
        guard parts.count == 2 || parts.count == 3 else { return nil }
        let nums = parts.compactMap { Double($0) }
        guard nums.count == parts.count else { return nil }
        return nums.count == 3 ? nums[0] * 3600 + nums[1] * 60 + nums[2] : nums[0] * 60 + nums[1]
    }

    static func stripTags(_ line: String) -> String {
        line.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\{\\[^}]*\}"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
    }
}

// MARK: - Providers

public struct SubtitleTrackInfo: Hashable, Sendable, Identifiable {
    public var id: String
    public var provider: String
    public var language: String
    public var languageName: String
    public var release: String
    public var hearingImpaired: Bool
    public var downloads: Int?
    /// Opaque token handed back to the provider's `download`.
    public var downloadToken: String

    public init(id: String, provider: String, language: String, languageName: String, release: String, hearingImpaired: Bool = false, downloads: Int? = nil, downloadToken: String) {
        self.id = id
        self.provider = provider
        self.language = language
        self.languageName = languageName
        self.release = release
        self.hearingImpaired = hearingImpaired
        self.downloads = downloads
        self.downloadToken = downloadToken
    }
}

public protocol SubtitleProvider: Sendable {
    var id: String { get }
    var name: String { get }
    func search(_ request: PlaybackRequest, languages: [String]) async throws -> [SubtitleTrackInfo]
    func download(_ track: SubtitleTrackInfo) async throws -> SubtitleDocument
}

extension SubtitleProvider {
    /// Downloads a file and unpacks it if it's a ZIP archive.
    func fetchDocument(_ url: URL, http: HTTPClient, headers: [String: String] = [:]) async throws -> SubtitleDocument {
        var h = headers
        h["Accept"] = "*/*"
        let (data, _) = try await http.data(HTTPRequest(.get, url: url, headers: h, timeout: 30))
        if data.starts(with: [0x50, 0x4B, 0x03, 0x04]) {
            let entries = try ZipArchive.entries(data)
            guard let entry = entries.first(where: { entry in [".srt", ".vtt"].contains { entry.name.lowercased().hasSuffix($0) } }) ?? entries.first else {
                throw FlowError.decoding("empty subtitle archive")
            }
            return SubtitleParser.parse(entry.data)
        }
        if Gzip.isGzip(data) { return SubtitleParser.parse(try Gzip.decompress(data)) }
        return SubtitleParser.parse(data)
    }
}

public enum SubtitleLanguages {
    public static func name(_ code: String) -> String {
        Locale(identifier: "en").localizedString(forLanguageCode: code) ?? code.uppercased()
    }
}

public actor OpenSubtitlesProvider: SubtitleProvider {
    public nonisolated let id = "opensubtitles"
    public nonisolated let name = "OpenSubtitles"
    let apiKey: String
    let username: String?
    let password: String?
    let http: HTTPClient
    var token: String?
    let base = "https://api.opensubtitles.com/api/v1"

    public init(apiKey: String, username: String? = nil, password: String? = nil, http: HTTPClient = HTTPClient()) {
        self.apiKey = apiKey
        self.username = username
        self.password = password
        self.http = http
    }

    func headers() async -> [String: String] {
        var h = ["Api-Key": apiKey, "User-Agent": "Flow v1.0", "Content-Type": "application/json"]
        if token == nil, let username, let password, !username.isEmpty {
            struct Body: Encodable { var username: String; var password: String }
            struct R: Decodable { var token: String }
            if var r = try? HTTPRequest(.post, base + "/login", headers: h) {
                try? r.setJSONBody(Body(username: username, password: password))
                token = try? await http.json(R.self, r).token
            }
        }
        if let token { h["Authorization"] = "Bearer \(token)" }
        return h
    }

    public func search(_ request: PlaybackRequest, languages: [String]) async throws -> [SubtitleTrackInfo] {
        guard !apiKey.isEmpty else { throw FlowError.missingCredential("OpenSubtitles API key") }
        var q: [String: String?] = ["languages": languages.joined(separator: ",").lowercased()]
        if let ep = request.episode {
            q["parent_tmdb_id"] = request.item.ids.tmdb.map(String.init)
            q["season_number"] = String(ep.season)
            q["episode_number"] = String(ep.number)
            q["type"] = "episode"
        } else {
            q["tmdb_id"] = request.item.ids.tmdb.map(String.init)
            q["type"] = "movie"
        }
        let json = try await http.json(JSONValue.self, HTTPRequest(.get, base + "/subtitles", query: q, headers: await headers()))
        return (json["data"]?.array ?? []).compactMap { e in
            let a = e["attributes"]
            guard let fileID = a?["files"]?.array?.first?["file_id"]?.string, let lang = a?["language"]?.string else { return nil }
            return SubtitleTrackInfo(id: "os-\(fileID)", provider: name, language: lang, languageName: SubtitleLanguages.name(lang),
                                     release: a?["release"]?.string ?? "", hearingImpaired: a?["hearing_impaired"]?.bool ?? false,
                                     downloads: a?["download_count"]?.int, downloadToken: fileID)
        }
    }

    public func download(_ track: SubtitleTrackInfo) async throws -> SubtitleDocument {
        struct Body: Encodable { var file_id: Int }
        var r = try HTTPRequest(.post, base + "/download", headers: await headers())
        try r.setJSONBody(Body(file_id: Int(track.downloadToken) ?? 0))
        let json = try await http.json(JSONValue.self, r)
        guard let link = json["link"]?.string.flatMap(URL.init(string:)) else { throw FlowError.decoding("OpenSubtitles download link") }
        return try await fetchDocument(link, http: http)
    }
}

public struct SubDLProvider: SubtitleProvider {
    public let id = "subdl"
    public let name = "SubDL"
    let apiKey: String
    let http: HTTPClient

    public init(apiKey: String, http: HTTPClient = HTTPClient()) {
        self.apiKey = apiKey
        self.http = http
    }

    public func search(_ request: PlaybackRequest, languages: [String]) async throws -> [SubtitleTrackInfo] {
        guard !apiKey.isEmpty else { throw FlowError.missingCredential("SubDL API key") }
        var q: [String: String?] = [
            "api_key": apiKey, "tmdb_id": request.item.ids.tmdb.map(String.init),
            "type": request.item.type == .movie ? "movie" : "tv", "languages": languages.joined(separator: ",").uppercased(), "subs_per_page": "30",
        ]
        if let ep = request.episode { q["season_number"] = String(ep.season); q["episode_number"] = String(ep.number) }
        let json = try await http.json(JSONValue.self, HTTPRequest(.get, "https://api.subdl.com/api/v1/subtitles", query: q))
        return (json["subtitles"]?.array ?? []).compactMap { e in
            guard let path = e["url"]?.string else { return nil }
            let lang = (e["lang"]?.string ?? e["language"]?.string ?? "en").lowercased()
            return SubtitleTrackInfo(id: "subdl-\(path)", provider: name, language: lang, languageName: e["language"]?.string ?? SubtitleLanguages.name(lang),
                                     release: e["release_name"]?.string ?? e["name"]?.string ?? "", hearingImpaired: e["hi"]?.bool ?? false, downloadToken: path)
        }
    }

    public func download(_ track: SubtitleTrackInfo) async throws -> SubtitleDocument {
        guard let url = URL(string: "https://dl.subdl.com" + track.downloadToken) else { throw FlowError.invalidURL(track.downloadToken) }
        return try await fetchDocument(url, http: http)
    }
}

/// Wyzie Subs: keyless aggregator returning direct SRT links.
public struct WyzieProvider: SubtitleProvider {
    public let id = "wyzie"
    public let name = "Wyzie"
    let http: HTTPClient
    public init(http: HTTPClient = HTTPClient()) { self.http = http }

    public func search(_ request: PlaybackRequest, languages: [String]) async throws -> [SubtitleTrackInfo] {
        guard let mediaID = request.item.ids.tmdb.map(String.init) ?? request.item.ids.imdb else { return [] }
        var q: [String: String?] = ["id": mediaID, "language": languages.joined(separator: ","), "format": "srt"]
        if let ep = request.episode { q["season"] = String(ep.season); q["episode"] = String(ep.number) }
        let json = try await http.json(JSONValue.self, HTTPRequest(.get, "https://sub.wyzie.ru/search", query: q))
        return (json.array ?? []).compactMap { e in
            guard let url = e["url"]?.string else { return nil }
            let lang = e["language"]?.string ?? "en"
            return SubtitleTrackInfo(id: "wyzie-\(e["id"]?.string ?? url)", provider: name, language: lang, languageName: e["display"]?.string ?? SubtitleLanguages.name(lang),
                                     release: e["media"]?.string ?? e["fileName"]?.string ?? "", hearingImpaired: e["isHearingImpaired"]?.bool ?? false, downloadToken: url)
        }
    }

    public func download(_ track: SubtitleTrackInfo) async throws -> SubtitleDocument {
        guard let url = URL(string: track.downloadToken) else { throw FlowError.invalidURL(track.downloadToken) }
        return try await fetchDocument(url, http: http)
    }
}

/// SubSource API (key-based). Looks the title up by IMDb id, then lists subtitles per language.
public struct SubSourceProvider: SubtitleProvider {
    public let id = "subsource"
    public let name = "SubSource"
    let apiKey: String
    let http: HTTPClient
    let base = "https://api.subsource.net/api/v1"

    public init(apiKey: String, http: HTTPClient = HTTPClient()) {
        self.apiKey = apiKey
        self.http = http
    }

    var headers: [String: String] { ["X-API-Key": apiKey] }

    public func search(_ request: PlaybackRequest, languages: [String]) async throws -> [SubtitleTrackInfo] {
        guard !apiKey.isEmpty else { throw FlowError.missingCredential("SubSource API key") }
        guard let imdb = request.item.ids.imdb else { return [] }
        let found = try await http.json(JSONValue.self, HTTPRequest(.get, base + "/movies/search", query: ["searchType": "imdb", "imdb": imdb, "season": request.episode.map { String($0.season) }], headers: headers))
        guard let movieID = (found["data"]?.array?.first ?? found.array?.first)?["movieId"]?.string else { return [] }
        var results: [SubtitleTrackInfo] = []
        for code in languages {
            let languageName = SubtitleLanguages.name(code).lowercased()
            let json = try await http.json(JSONValue.self, HTTPRequest(.get, base + "/subtitles", query: ["movieId": movieID, "language": languageName], headers: headers))
            for e in json["data"]?.array ?? [] {
                guard let subID = e["subtitleId"]?.string else { continue }
                let release = e["releaseInfo"]?.string ?? e["release_info"]?.string ?? ""
                if let ep = request.episode, let ref = StreamParser.episodeRef(in: release), ref != ep.ref { continue }
                results.append(SubtitleTrackInfo(id: "subsource-\(subID)", provider: name, language: code, languageName: SubtitleLanguages.name(code),
                                                 release: release, hearingImpaired: e["hearingImpaired"]?.bool ?? false, downloads: e["downloads"]?.int, downloadToken: subID))
            }
        }
        return results
    }

    public func download(_ track: SubtitleTrackInfo) async throws -> SubtitleDocument {
        guard let url = URL(string: "\(base)/subtitles/\(track.downloadToken)/download") else { throw FlowError.invalidURL(track.downloadToken) }
        return try await fetchDocument(url, http: http, headers: headers)
    }
}

public enum SubtitleSearch {
    /// Searches every provider concurrently; ranks preferred language order, then downloads.
    public static func search(_ providers: [SubtitleProvider], request: PlaybackRequest, languages: [String], hearingImpaired: Bool) async -> [SubtitleTrackInfo] {
        let all = await withTaskGroup(of: [SubtitleTrackInfo].self) { group in
            for p in providers { group.addTask { (try? await withTimeout(15) { try await p.search(request, languages: languages) }) ?? [] } }
            var all: [SubtitleTrackInfo] = []
            for await chunk in group { all += chunk }
            return all
        }
        let order = Dictionary(languages.enumerated().map { ($1.lowercased().prefix(2).description, $0) }, uniquingKeysWith: { a, _ in a })
        return all.sorted { a, b in
            let la = order[String(a.language.lowercased().prefix(2))] ?? 99, lb = order[String(b.language.lowercased().prefix(2))] ?? 99
            if la != lb { return la < lb }
            if a.hearingImpaired != b.hearingImpaired { return a.hearingImpaired == hearingImpaired }
            return (a.downloads ?? 0) > (b.downloads ?? 0)
        }
    }
}
