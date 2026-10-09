import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

public struct Channel: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var providerID: String
    public var name: String
    public var number: Int?
    public var group: String
    public var logoURL: URL?
    public var streamURL: URL
    /// Id used to look up programmes in the EPG.
    public var epgID: String?
    public var userAgent: String?
    public var hasCatchup: Bool

    public init(id: String, providerID: String, name: String, number: Int? = nil, group: String, logoURL: URL? = nil, streamURL: URL, epgID: String? = nil, userAgent: String? = nil, hasCatchup: Bool = false) {
        self.id = id
        self.providerID = providerID
        self.name = name
        self.number = number
        self.group = group
        self.logoURL = logoURL
        self.streamURL = streamURL
        self.epgID = epgID
        self.userAgent = userAgent
        self.hasCatchup = hasCatchup
    }
}

public struct Programme: Codable, Hashable, Sendable, Identifiable {
    public var channelID: String
    public var title: String
    public var subtitle: String?
    public var description: String?
    public var start: Date
    public var end: Date
    public var category: String?
    public var iconURL: URL?

    public init(channelID: String, title: String, subtitle: String? = nil, description: String? = nil, start: Date, end: Date, category: String? = nil, iconURL: URL? = nil) {
        self.channelID = channelID
        self.title = title
        self.subtitle = subtitle
        self.description = description
        self.start = start
        self.end = end
        self.category = category
        self.iconURL = iconURL
    }

    public var id: String { "\(channelID)@\(Int(start.timeIntervalSince1970))" }
    public func isAiring(at date: Date) -> Bool { start <= date && date < end }
    public func progress(at date: Date) -> Double {
        let total = end.timeIntervalSince(start)
        guard total > 0 else { return 0 }
        return min(1, max(0, date.timeIntervalSince(start) / total))
    }
}

/// Programmes indexed by EPG channel id, sorted by start time.
public struct EPG: Codable, Sendable {
    public var programmes: [String: [Programme]]
    public var displayNames: [String: String]

    public init(programmes: [String: [Programme]] = [:], displayNames: [String: String] = [:]) {
        self.programmes = programmes
        self.displayNames = displayNames
    }

    public func nowAndNext(for epgID: String?, at date: Date = Date()) -> (now: Programme?, next: Programme?) {
        guard let epgID, let list = programmes[epgID] ?? programmes[epgID.lowercased()] else { return (nil, nil) }
        guard let index = list.firstIndex(where: { $0.end > date }) else { return (nil, nil) }
        let current = list[index].isAiring(at: date) ? list[index] : nil
        let nextIndex = current == nil ? index : index + 1
        return (current, nextIndex < list.count ? list[nextIndex] : nil)
    }

    public func schedule(for epgID: String?, from: Date, hours: Double) -> [Programme] {
        guard let epgID, let list = programmes[epgID] else { return [] }
        let to = from.addingTimeInterval(hours * 3600)
        return list.filter { $0.end > from && $0.start < to }
    }

    public mutating func merge(_ other: EPG) {
        for (k, v) in other.programmes { programmes[k] = ((programmes[k] ?? []) + v).sorted { $0.start < $1.start } }
        displayNames.merge(other.displayNames) { a, _ in a }
    }
}

// MARK: - M3U

public struct M3UPlaylist: Sendable {
    public var channels: [Channel]
    /// Entries that look like movies/series (VOD) rather than live channels.
    public var vod: [Channel]
    public var epgURL: URL?
}

public enum M3UParser {
    public static func parse(_ text: String, providerID: String, defaultUserAgent: String? = nil) -> M3UPlaylist {
        var channels: [Channel] = []
        var vod: [Channel] = []
        var epgURL: URL?
        var pending: (attrs: [String: String], name: String)?
        var userAgent: String?
        var groupOverride: String?

        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("#EXTM3U") {
                let attrs = attributes(in: line)
                epgURL = (attrs["x-tvg-url"] ?? attrs["url-tvg"])?.components(separatedBy: ",").first.flatMap(URL.init(string:))
            } else if line.hasPrefix("#EXTINF") {
                let attrs = attributes(in: line)
                let name = line.lastIndex(of: ",").map { String(line[line.index(after: $0)...]).trimmingCharacters(in: .whitespaces) } ?? attrs["tvg-name"] ?? "Channel"
                pending = (attrs, name)
            } else if line.hasPrefix("#EXTVLCOPT:http-user-agent=") {
                userAgent = String(line.dropFirst("#EXTVLCOPT:http-user-agent=".count))
            } else if line.hasPrefix("#EXTGRP:") {
                groupOverride = String(line.dropFirst("#EXTGRP:".count))
            } else if !line.hasPrefix("#"), let url = URL(string: line) {
                let attrs = pending?.attrs ?? [:]
                let name = pending?.name ?? url.lastPathComponent
                let group = attrs["group-title"] ?? groupOverride ?? "Uncategorised"
                let channel = Channel(
                    id: "\(providerID):\(attrs["tvg-id"].flatMap { $0.isEmpty ? nil : $0 } ?? name):\(channels.count + vod.count)",
                    providerID: providerID,
                    name: name,
                    number: attrs["tvg-chno"].flatMap(Int.init),
                    group: group,
                    logoURL: attrs["tvg-logo"].flatMap(URL.init(string:)),
                    streamURL: url,
                    epgID: attrs["tvg-id"].flatMap { $0.isEmpty ? nil : $0 },
                    userAgent: userAgent ?? defaultUserAgent,
                    hasCatchup: attrs["catchup"] != nil || attrs["tvg-rec"] != nil
                )
                if isVOD(url: url, group: group) { vod.append(channel) } else { channels.append(channel) }
                pending = nil
                userAgent = nil
                groupOverride = nil
            }
        }
        return M3UPlaylist(channels: channels, vod: vod, epgURL: epgURL)
    }

    static func isVOD(url: URL, group: String) -> Bool {
        let path = url.path.lowercased()
        if path.contains("/movie/") || path.contains("/series/") { return true }
        let ext = url.pathExtension.lowercased()
        if ["mkv", "mp4", "avi", "m4v"].contains(ext) { return true }
        let g = group.lowercased()
        return g.contains("vod") || g.hasPrefix("movies") || g.hasPrefix("series")
    }

    /// Parses key="value" pairs; tolerates single quotes and unquoted values.
    static func attributes(in line: String) -> [String: String] {
        var result: [String: String] = [:]
        guard let regex = try? NSRegularExpression(pattern: #"([a-zA-Z0-9\-_]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))"#) else { return result }
        let header = line.range(of: ",", options: .backwards).map { String(line[..<$0.lowerBound]) } ?? line
        for match in regex.matches(in: header, range: NSRange(header.startIndex..., in: header)) {
            guard let kr = Range(match.range(at: 1), in: header) else { continue }
            let value = [2, 3, 4].lazy.compactMap { Range(match.range(at: $0), in: header) }.first.map { String(header[$0]) } ?? ""
            result[String(header[kr]).lowercased()] = value
        }
        return result
    }
}

// MARK: - XMLTV

public final class XMLTVParser: NSObject, XMLParserDelegate {
    private var epg = EPG()
    private var current: [String: String] = [:]
    private var channelID: String?
    private var text = ""
    private let window: ClosedRange<Date>?

    init(window: ClosedRange<Date>?) { self.window = window }

    /// Parses an XMLTV document, keeping programmes within `window` when given.
    public static func parse(_ data: Data, window: ClosedRange<Date>? = nil) -> EPG {
        let delegate = XMLTVParser(window: window)
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        for key in delegate.epg.programmes.keys { delegate.epg.programmes[key]?.sort { $0.start < $1.start } }
        return delegate.epg
    }

    public func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        text = ""
        switch elementName {
        case "channel": channelID = attributeDict["id"]
        case "programme":
            current = ["channel": attributeDict["channel"] ?? "", "start": attributeDict["start"] ?? "", "stop": attributeDict["stop"] ?? ""]
        case "icon":
            if !current.isEmpty, let src = attributeDict["src"] { current["icon"] = src }
        default: break
        }
    }

    public func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    public func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch elementName {
        case "display-name":
            if let channelID, epg.displayNames[channelID] == nil { epg.displayNames[channelID] = value }
        case "channel": channelID = nil
        case "title", "desc", "category", "sub-title":
            if !current.isEmpty, current[elementName] == nil { current[elementName] = value }
        case "programme":
            if let start = Self.date(current["start"] ?? ""), let end = Self.date(current["stop"] ?? ""), let ch = current["channel"], !ch.isEmpty {
                if window.map({ end >= $0.lowerBound && start <= $0.upperBound }) ?? true {
                    epg.programmes[ch, default: []].append(Programme(channelID: ch, title: current["title"] ?? "Untitled", subtitle: current["sub-title"], description: current["desc"],
                                                                      start: start, end: end, category: current["category"], iconURL: current["icon"].flatMap(URL.init(string:))))
                }
            }
            current = [:]
        default: break
        }
        text = ""
    }

    /// "20240501193000 +0100" → Date
    static func date(_ raw: String) -> Date? {
        let parts = raw.split(separator: " ")
        guard let stamp = parts.first, stamp.count >= 14 else { return nil }
        var comps = DateComponents()
        let s = Array(stamp)
        func num(_ a: Int, _ b: Int) -> Int? { Int(String(s[a..<b])) }
        comps.year = num(0, 4); comps.month = num(4, 6); comps.day = num(6, 8)
        comps.hour = num(8, 10); comps.minute = num(10, 12); comps.second = num(12, 14)
        var offset = 0
        if parts.count > 1 {
            let tz = String(parts[1])
            if tz.count == 5, let h = Int(tz.dropFirst().prefix(2)), let m = Int(tz.suffix(2)) {
                offset = (h * 3600 + m * 60) * (tz.hasPrefix("-") ? -1 : 1)
            }
        }
        comps.timeZone = TimeZone(secondsFromGMT: offset)
        return Calendar(identifier: .gregorian).date(from: comps)
    }
}

// MARK: - Provider abstraction

/// Live channels and EPG from one IPTV provider.
public protocol IPTVProvider: Sendable {
    var config: IPTVProviderConfig { get }
    func channels() async throws -> [Channel]
    func epg(window: ClosedRange<Date>) async throws -> EPG
}

public struct M3UProvider: IPTVProvider {
    public let config: IPTVProviderConfig
    let http: HTTPClient

    public init(config: IPTVProviderConfig, http: HTTPClient = HTTPClient()) {
        self.config = config
        self.http = http
    }

    func playlist() async throws -> M3UPlaylist {
        var headers: [String: String] = ["Accept": "*/*"]
        if let ua = config.userAgent { headers["User-Agent"] = ua }
        let (data, _) = try await http.data(HTTPRequest(.get, url: config.url, headers: headers, timeout: 60))
        let text = String(decoding: data, as: UTF8.self)
        return M3UParser.parse(text, providerID: config.id, defaultUserAgent: config.userAgent)
    }

    public func channels() async throws -> [Channel] { try await playlist().channels }

    public func vodEntries() async throws -> [Channel] { try await playlist().vod }

    public func epg(window: ClosedRange<Date>) async throws -> EPG {
        var url = config.epgURL
        if url == nil { url = try await playlist().epgURL }
        guard let url else { return EPG() }
        let (data, _) = try await http.data(HTTPRequest(.get, url: url, headers: ["Accept": "*/*"], timeout: 90))
        return XMLTVParser.parse(Gzip.isGzip(data) ? (try Gzip.decompress(data)) : data, window: window)
    }
}
