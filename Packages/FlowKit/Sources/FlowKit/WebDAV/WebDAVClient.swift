import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

public struct WebDAVEntry: Codable, Hashable, Sendable, Identifiable {
    public var href: String
    public var name: String
    public var isDirectory: Bool
    public var size: Int64?
    public var modified: Date?
    public var contentType: String?
    public var id: String { href }

    public static let videoExtensions: Set<String> = ["mkv", "mp4", "m4v", "avi", "mov", "ts", "m2ts", "webm", "wmv", "mpg"]
    public var isVideo: Bool { !isDirectory && Self.videoExtensions.contains((name as NSString).pathExtension.lowercased()) }
}

/// Minimal WebDAV client (PROPFIND) plus a filename matcher that turns a share into a source.
public struct WebDAVClient: SourceProvider {
    public let config: WebDAVConfig
    let http: HTTPClient

    public init(config: WebDAVConfig, http: HTTPClient = HTTPClient()) {
        self.config = config
        self.http = http
    }

    public var providerID: String { config.id }
    public var providerName: String { config.name }
    public var category: SourceCategory { .webDAV }

    var authHeaders: [String: String] {
        guard let user = config.username, let pass = config.password else { return [:] }
        let encoded = Data("\(user):\(pass)".utf8).base64EncodedString()
        return ["Authorization": "Basic \(encoded)"]
    }

    /// A configured path ("/Movies") relative to the share's base URL.
    func url(forPath path: String) -> URL {
        var base = config.baseURL.absoluteString
        if base.hasSuffix("/") { base.removeLast() }
        let encoded = path.split(separator: "/").map {
            String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0)
        }.joined(separator: "/")
        return URL(string: base + "/" + encoded) ?? config.baseURL
    }

    /// An href from a PROPFIND response: absolute path on the host, or a full URL.
    func url(forHref href: String) -> URL {
        URL(string: href, relativeTo: config.baseURL)?.absoluteURL ?? config.baseURL
    }

    public func list(_ path: String) async throws -> [WebDAVEntry] {
        try await list(at: url(forPath: path))
    }

    public func list(at target: URL) async throws -> [WebDAVEntry] {
        let body = #"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:displayname/></d:prop></d:propfind>"#
        var headers = authHeaders
        headers["Depth"] = "1"
        headers["Content-Type"] = "application/xml"
        headers["Accept"] = "application/xml"
        let request = HTTPRequest(.propfind, url: target, headers: headers, body: Data(body.utf8))
        let (data, _) = try await http.data(request, acceptStatus: 200..<300)
        let requestedPath = target.path
        return WebDAVParser.parse(data).filter { entry in
            let p = url(forHref: entry.href).path
            return p.trimmingCharacters(in: CharacterSet(charactersIn: "/")) != requestedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
    }

    public func testConnection() async throws -> Int {
        try await list("/").count
    }

    /// Recursively collects video files under `path` up to `depth` levels.
    public func videos(under path: String, depth: Int = 3) async throws -> [WebDAVEntry] {
        try await videos(at: url(forPath: path), depth: depth)
    }

    public func videos(at target: URL, depth: Int = 3) async throws -> [WebDAVEntry] {
        let entries = try await list(at: target)
        var found = entries.filter(\.isVideo)
        guard depth > 0 else { return found }
        let dirs = entries.filter(\.isDirectory)
        try await withThrowingTaskGroup(of: [WebDAVEntry].self) { group in
            for dir in dirs.prefix(400) {
                group.addTask { (try? await self.videos(at: self.url(forHref: dir.href), depth: depth - 1)) ?? [] }
            }
            for try await chunk in group { found += chunk }
        }
        return found
    }

    public func fileURL(_ entry: WebDAVEntry) -> URL {
        var url = self.url(forHref: entry.href)
        // Embed credentials so AVPlayer can authenticate without custom headers.
        if let user = config.username, let pass = config.password, var c = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            c.user = user
            c.password = pass
            url = c.url ?? url
        }
        return url
    }

    public func sources(for request: PlaybackRequest) async throws -> [StreamSource] {
        let item = request.item
        let matches: [WebDAVEntry]
        if let episode = request.episode {
            let showDirs = try await list(config.showsPath).filter(\.isDirectory)
            let target = StreamParser.normalizeTitle(item.title)
            let dir = showDirs.first { StreamParser.titleAndYear(from: $0.name).title == target }
                ?? showDirs.first { StreamParser.normalizeTitle($0.name).hasPrefix(target) }
            guard let dir else { return [] }
            matches = try await videos(at: url(forHref: dir.href), depth: 2).filter { StreamParser.episodeRef(in: $0.name) == episode.ref }
        } else {
            let all = try await videos(under: config.moviesPath, depth: 2)
            matches = all.filter { WebDAVMatcher.matchesMovie($0, title: item.title, originalTitle: item.originalTitle, year: item.year) }
        }
        return matches.map { entry in
            var traits = StreamParser.parse(entry.name)
            traits.sizeBytes = entry.size ?? traits.sizeBytes
            traits.isCached = true
            return StreamSource(id: "\(config.id)#\(entry.href)", category: .webDAV, providerID: config.id, providerName: config.name,
                                title: entry.name, detail: entry.href.removingPercentEncoding, filename: entry.name,
                                location: .url(fileURL(entry), headers: authHeaders), traits: traits)
        }
    }
}

public enum WebDAVMatcher {
    public static func matchesMovie(_ entry: WebDAVEntry, title: String, originalTitle: String?, year: Int?) -> Bool {
        // Try the file name, then its parent folder ("Movie (2020)/movie.mkv").
        let parent = ((entry.href.removingPercentEncoding ?? entry.href) as NSString).deletingLastPathComponent
        let candidates = [entry.name, (parent as NSString).lastPathComponent]
        let wanted = Set([title, originalTitle].compactMap { $0 }.map(StreamParser.normalizeTitle))
        return candidates.contains { name in
            let parsed = StreamParser.titleAndYear(from: name)
            guard wanted.contains(parsed.title) else { return false }
            guard let year, let fileYear = parsed.year else { return true }
            return abs(year - fileYear) <= 1
        }
    }
}

/// Parses a DAV:multistatus response, tolerant of namespace prefixes.
final class WebDAVParser: NSObject, XMLParserDelegate {
    private var entries: [WebDAVEntry] = []
    private var current: [String: String] = [:]
    private var isCollection = false
    private var text = ""

    static func parse(_ data: Data) -> [WebDAVEntry] {
        let delegate = WebDAVParser()
        let parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = true
        parser.delegate = delegate
        parser.parse()
        return delegate.entries
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        let name = Self.local(elementName)
        if name == "response" { current = [:]; isCollection = false }
        if name == "collection" { isCollection = true }
        text = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let name = Self.local(elementName)
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name {
        case "href", "getcontentlength", "getlastmodified", "getcontenttype", "displayname":
            if !value.isEmpty { current[name] = value }
        case "response":
            guard let href = current["href"] else { return }
            let decoded = href.removingPercentEncoding ?? href
            let trimmed = decoded.hasSuffix("/") ? String(decoded.dropLast()) : decoded
            let name = current["displayname"] ?? (trimmed as NSString).lastPathComponent
            let modified: Date? = current["getlastmodified"].flatMap { raw in
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_US_POSIX")
                f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
                return f.date(from: raw)
            }
            entries.append(WebDAVEntry(href: href, name: name, isDirectory: isCollection || href.hasSuffix("/"), size: current["getcontentlength"].flatMap { Int64($0) },
                                       modified: modified, contentType: current["getcontenttype"]))
        default: break
        }
        text = ""
    }

    static func local(_ name: String) -> String {
        (name.split(separator: ":").last.map(String.init) ?? name).lowercased()
    }
}
