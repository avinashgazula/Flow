import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Answers TMDb, MDBList and demo IPTV requests from `DemoCatalog`, so the whole app can run
/// without accounts or keys. Anything it doesn't recognise goes to `fallback`.
public struct DemoTransport: HTTPTransport {
    public static let iptvPlaylistURL = URL(string: "https://demo.flow.invalid/live.m3u")!
    public static let iptvGuideURL = URL(string: "https://demo.flow.invalid/guide.xml")!
    /// Apple's public HLS sample streams — reachable everywhere and always playable.
    public static let sampleStreams = [
        "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
        "https://devstreaming-cdn.apple.com/videos/streaming/examples/adv_dv_atmos/main.m3u8",
        "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8",
    ]

    let fallback: HTTPTransport

    public init(fallback: HTTPTransport = URLSessionTransport()) { self.fallback = fallback }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url, let host = url.host else { return try await fallback.send(request) }
        let body: Any?
        switch host {
        case "api.themoviedb.org": body = Self.tmdb(path: url.path, query: Self.query(url))
        case "api.mdblist.com": body = Self.mdblist(path: url.path)
        case "demo.flow.invalid":
            let text = url.path.hasSuffix(".m3u") ? Self.playlist() : Self.guide(now: Date())
            return (Data(text.utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        default: return try await fallback.send(request)
        }
        // A short delay keeps loading states honest in screenshots and previews.
        try await Task.sleep(nanoseconds: 120_000_000)
        guard let body else {
            return (Data(#"{"status_message":"not found"}"#.utf8), HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!)
        }
        let data = try JSONSerialization.data(withJSONObject: body)
        return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }

    static func query(_ url: URL) -> [String: String] {
        var out: [String: String] = [:]
        for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] { out[item.name] = item.value ?? "" }
        return out
    }

    // MARK: TMDb

    static func listJSON(_ t: DemoCatalog.Title) -> [String: Any] {
        var o: [String: Any] = [
            "id": t.id, "overview": t.overview, "poster_path": t.poster, "backdrop_path": t.backdrop,
            "vote_average": t.rating, "vote_count": 12000, "popularity": 500 - Double(t.id % 400), "genre_ids": t.genres,
            "original_language": t.id == 496243 ? "ko" : "en", "media_type": t.type.tmdbPath,
        ]
        if t.type == .movie {
            o["title"] = t.title
            o["release_date"] = "\(t.year)-06-15"
        } else {
            o["name"] = t.title
            o["first_air_date"] = "\(t.year)-03-10"
        }
        return o
    }

    static func page(_ titles: [DemoCatalog.Title], page: Int = 1) -> [String: Any] {
        let size = 20
        let slice = titles.dropFirst((page - 1) * size).prefix(size)
        return ["page": page, "total_pages": max(1, Int(ceil(Double(titles.count) / Double(size)))), "results": slice.map(listJSON)]
    }

    static func ofType(_ path: String) -> [DemoCatalog.Title] {
        if path.contains("/movie") { return DemoCatalog.titles.filter { $0.type == .movie } }
        if path.contains("/tv") { return DemoCatalog.titles.filter { $0.type == .show } }
        return DemoCatalog.titles
    }

    /// Deterministic shuffle so different lists look different but stay stable.
    static func shuffled(_ titles: [DemoCatalog.Title], seed: Int) -> [DemoCatalog.Title] {
        titles.sorted { ($0.id &* 2654435761 &+ seed) % 1000 < ($1.id &* 2654435761 &+ seed) % 1000 }
    }

    static func tmdb(path rawPath: String, query: [String: String]) -> Any? {
        let path = rawPath.replacingOccurrences(of: "/3", with: "", options: .anchored)
        let parts = path.split(separator: "/").map(String.init)
        let pageNumber = Int(query["page"] ?? "1") ?? 1

        switch parts.first {
        case "trending":
            return page(ofType(path), page: pageNumber)
        case "discover":
            var list = ofType(path)
            if let genres = query["with_genres"], !genres.isEmpty {
                let wanted = Set(genres.split(separator: ",").compactMap { Int($0) })
                list = list.filter { !wanted.isDisjoint(with: $0.genres) }
            }
            if query["sort_by"]?.hasPrefix("vote_average") == true { list.sort { $0.rating > $1.rating } }
            if query["sort_by"]?.contains("date.desc") == true { list.sort { $0.year > $1.year } }
            return page(list, page: pageNumber)
        case "search":
            let q = (query["query"] ?? "").lowercased()
            var results: [[String: Any]] = DemoCatalog.titles.filter { $0.title.lowercased().contains(q) }.map(listJSON)
            for (id, name, _) in DemoCatalog.cast where name.lowercased().contains(q) {
                results.append(["id": id, "name": name, "media_type": "person", "known_for_department": "Acting"])
            }
            return ["page": 1, "total_pages": 1, "results": results]
        case "genre":
            let table = path.contains("/movie") ? TMDBGenres.movie : TMDBGenres.tv
            return ["genres": table.map { ["id": $0.key, "name": $0.value] }]
        case "watch":
            return ["results": []]
        case "person":
            guard parts.count >= 2, let id = Int(parts[1]), let person = DemoCatalog.cast.first(where: { $0.0 == id }) else { return nil }
            return ["id": id, "name": person.1, "known_for_department": "Acting", "birthday": "1985-04-12", "place_of_birth": "Los Angeles, California",
                    "biography": "\(person.1) is an acclaimed performer known for work across film and television.",
                    "combined_credits": ["cast": shuffled(DemoCatalog.titles, seed: id).prefix(10).map(listJSON)]]
        case "movie", "tv":
            let type: MediaType = parts[0] == "movie" ? .movie : .show
            guard parts.count >= 2 else { return nil }
            if let list = ["popular", "top_rated", "now_playing", "upcoming", "airing_today", "on_the_air"].firstIndex(of: parts[1]) {
                return page(shuffled(ofType(path), seed: list * 97), page: pageNumber)
            }
            guard let id = Int(parts[1]), let t = DemoCatalog.title(id) else { return nil }
            if parts.count == 2 { return detail(t, type: type) }
            switch parts[2] {
            case "season": return season(t, number: Int(parts.count > 3 ? parts[3] : "1") ?? 1)
            case "release_dates": return releaseDates(t)
            case "external_ids": return ["imdb_id": t.imdb, "tvdb_id": t.id + 70000]
            case "images": return ["logos": [], "backdrops": [], "posters": []]
            default: return nil
            }
        case "find":
            return ["movie_results": [], "tv_results": []]
        default:
            return nil
        }
    }

    static func releaseDates(_ t: DemoCatalog.Title) -> [String: Any] {
        ["results": [["iso_3166_1": "US", "release_dates": [
            ["certification": t.certification, "release_date": "\(t.year)-06-15T00:00:00.000Z", "type": 3],
            ["certification": t.certification, "release_date": "\(t.year)-09-15T00:00:00.000Z", "type": 4],
        ]]]]
    }

    static func detail(_ t: DemoCatalog.Title, type: MediaType) -> [String: Any] {
        var o = listJSON(t)
        o["genres"] = t.genres.map { ["id": $0, "name": TMDBGenres.name(for: $0, type: type)] }
        o["tagline"] = ""
        let returning = type == .show && t.year >= 2016
        o["status"] = type == .movie ? "Released" : (returning ? "Returning Series" : "Ended")
        o["imdb_id"] = t.imdb
        o["external_ids"] = ["imdb_id": t.imdb, "tvdb_id": t.id + 70000]
        let castList: [[String: Any]] = shuffled(DemoCatalog.cast.map { DemoCatalog.Title($0.0, .movie, $0.1, 2000, [], "", "", 0, 0, "", "", "") }, seed: t.id)
            .enumerated().map { index, person in ["id": person.id, "name": person.title, "character": ["Paul", "Chani", "Jessica", "Duncan", "Stilgar", "Irulan"][index % 6], "order": index] }
        o["credits"] = ["cast": castList, "crew": [["id": 137427, "name": "Denis Villeneuve", "job": type == .movie ? "Director" : "Creator"]]]
        o["videos"] = ["results": [["id": "v\(t.id)", "name": "Official Trailer", "key": "Way9Dexny3w", "site": "YouTube", "type": "Trailer", "official": true]]]
        o["watch/providers"] = watchProviders(t)
        let similar = shuffled(DemoCatalog.titles.filter { $0.type == type && $0.id != t.id }, seed: t.id)
        o["recommendations"] = page(Array(similar.prefix(10)))
        o["similar"] = page(Array(similar.suffix(6)))
        o["images"] = ["logos": []]
        if type == .movie {
            o["runtime"] = t.runtime
            o["release_dates"] = releaseDates(t)
        } else {
            o["episode_run_time"] = [t.runtime]
            o["number_of_seasons"] = t.seasons
            o["content_ratings"] = ["results": [["iso_3166_1": "US", "rating": t.certification]]]
            o["networks"] = [["name": ["HBO", "Netflix", "AMC", "Disney+", "Apple TV+"][t.id % 5]]]
            o["seasons"] = (1...max(1, t.seasons)).map { n in
                ["season_number": n, "name": "Season \(n)", "episode_count": 8 + (n + t.id) % 5, "air_date": "\(t.year + n - 1)-03-10", "poster_path": t.poster] as [String: Any]
            }
            let lastSeason = max(1, t.seasons)
            if returning {
                // A season in progress, so the calendar has something to show: one aired days ago, the next due soon.
                let next = DemoTransport.nextEpisode(t)
                o["last_episode_to_air"] = demoEpisode(t, season: lastSeason, number: next - 1, daysFromNow: -(1 + t.id % 6))
                o["next_episode_to_air"] = demoEpisode(t, season: lastSeason, number: next, daysFromNow: 1 + t.id % 12)
            } else {
                o["last_episode_to_air"] = ["season_number": lastSeason, "episode_number": 8 + (lastSeason + t.id) % 5, "name": "Finale", "air_date": "\(t.year + lastSeason - 1)-05-01"]
            }
        }
        return o
    }

    /// Logo paths from TMDb's provider list; if one ever moves, the tile falls back to the service's name.
    static let streamingServices: [[String: Any]] = [
        ["provider_id": 8, "provider_name": "Netflix", "logo_path": "/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg", "display_priority": 1],
        ["provider_id": 350, "provider_name": "Apple TV+", "logo_path": "/6uhKBfmtzFqOcLousHwZuzcrScK.jpg", "display_priority": 2],
        ["provider_id": 337, "provider_name": "Disney Plus", "logo_path": "/7rwgEs15tFwyR9NPQ5vpzxTj19Q.jpg", "display_priority": 3],
        ["provider_id": 9, "provider_name": "Amazon Prime Video", "logo_path": "/emthp39XA2YScoYL1p0sdbAH2WA.jpg", "display_priority": 4],
    ]
    static let stores: [[String: Any]] = [
        ["provider_id": 2, "provider_name": "Apple TV", "logo_path": "/peURlLlr8jggOwK53fJ5wdQl05y.jpg", "display_priority": 5],
        ["provider_id": 3, "provider_name": "Google Play Movies", "logo_path": "/tbEdFQDwx5LEVr8WpSeXQSIirVq.jpg", "display_priority": 6],
    ]

    static func watchProviders(_ t: DemoCatalog.Title) -> [String: Any] {
        let stream = [streamingServices[t.id % streamingServices.count]]
        var region: [String: Any] = ["link": "https://www.themoviedb.org/\(t.type == .movie ? "movie" : "tv")/\(t.id)/watch?locale=US", "flatrate": stream]
        if t.type == .movie { region["rent"] = stores; region["buy"] = stores }
        return ["results": ["US": region]]
    }

    static func demoEpisode(_ t: DemoCatalog.Title, season: Int, number: Int, daysFromNow: Int) -> [String: Any] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        let date = Date().addingTimeInterval(Double(daysFromNow) * 86400)
        return [
            "id": t.id * 1000 + season * 100 + number,
            "season_number": season,
            "episode_number": number,
            "name": episodeNames[(number + season) % episodeNames.count],
            "overview": "The stakes rise as the season builds toward its turning point.",
            "still_path": t.backdrop,
            "air_date": formatter.string(from: date),
            "runtime": t.runtime,
        ]
    }

    static let episodeNames = ["Pilot", "The Long Night", "Crossing Over", "Echoes", "Signal", "Undertow", "Glass House", "Daybreak", "Fault Lines", "Homecoming", "The Reckoning", "Afterglow"]

    static func nextEpisode(_ t: DemoCatalog.Title) -> Int { 4 + t.id % 4 }

    static func season(_ t: DemoCatalog.Title, number: Int) -> [String: Any] {
        let count = 8 + (number + t.id) % 5
        var episodes: [[String: Any]] = []
        if t.type == .show, t.year >= 2016, number == max(1, t.seasons) {
            // The season currently airing: weekly, around today.
            let next = nextEpisode(t)
            for e in 1...count {
                let days = e < next ? -(1 + t.id % 6) - (next - 1 - e) * 7 : (1 + t.id % 12) + (e - next) * 7
                episodes.append(demoEpisode(t, season: number, number: e, daysFromNow: days))
            }
            return ["episodes": episodes]
        }
        for e in 1...count {
            let month = String(format: "%02d", min(12, 2 + e / 2))
            let day = String(format: "%02d", 1 + (e * 7) % 27)
            var ep: [String: Any] = [:]
            ep["id"] = t.id * 1000 + number * 100 + e
            ep["episode_number"] = e
            ep["season_number"] = number
            ep["name"] = episodeNames[(e + number) % episodeNames.count]
            ep["overview"] = "A turning point arrives as old alliances are tested and new ones form."
            ep["still_path"] = t.backdrop
            ep["air_date"] = "\(t.year + number - 1)-\(month)-\(day)"
            ep["runtime"] = t.runtime
            ep["vote_average"] = 7.5 + Double(e % 5) / 5
            episodes.append(ep)
        }
        return ["episodes": episodes]
    }

    // MARK: MDBList ratings

    static func mdblist(path: String) -> Any? {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count >= 3, let id = Int(parts[2]), let t = DemoCatalog.title(id) else { return ["movies": [], "shows": []] }
        let base = t.rating
        return ["ratings": [
            ["source": "imdb", "value": min(9.6, base + 0.2), "votes": 1_200_000],
            ["source": "tomatoes", "value": Int(min(99, base * 11))],
            ["source": "popcorn", "value": Int(min(98, base * 10.8))],
            ["source": "metacritic", "value": Int(min(96, base * 9.6))],
            ["source": "tmdb", "value": Int(base * 10)],
            ["source": "letterboxd", "value": (base / 2 * 10).rounded() / 10],
            ["source": "trakt", "value": Int(base * 10)],
        ]]
    }

    // MARK: IPTV

    static let channels: [(id: String, name: String, group: String)] = [
        ("flow.news", "Flow News", "News"), ("world.24", "World 24", "News"), ("city.live", "City Live", "News"),
        ("cinema.one", "Cinema One", "Movies"), ("classics", "Classics", "Movies"), ("indie.screen", "Indie Screen", "Movies"),
        ("sport.hd", "Sport HD", "Sports"), ("arena", "Arena", "Sports"),
        ("discover.earth", "Discover Earth", "Documentary"), ("deep.space", "Deep Space", "Documentary"),
        ("kids.club", "Kids Club", "Kids"), ("music.wave", "Music Wave", "Music"),
    ]

    static func playlist() -> String {
        var lines = [#"#EXTM3U x-tvg-url="\#(iptvGuideURL.absoluteString)""#]
        for (index, ch) in channels.enumerated() {
            lines.append(#"#EXTINF:-1 tvg-id="\#(ch.id)" tvg-chno="\#(index + 1)" group-title="\#(ch.group)",\#(ch.name)"#)
            lines.append(sampleStreams[index % sampleStreams.count])
        }
        return lines.joined(separator: "\n")
    }

    static let programmeTitles = [
        "News": ["Morning Briefing", "World Report", "Market Watch", "The Evening Edition", "Late Desk"],
        "Movies": ["Feature Presentation", "Double Bill", "Director's Cut", "Midnight Movie"],
        "Sports": ["Match Day Live", "Highlights", "The Locker Room", "Championship Replay"],
        "Documentary": ["Planet Unseen", "Life in the Deep", "Origins", "The Frontier"],
        "Kids": ["Cartoon Hour", "Science Squad", "Story Time"],
        "Music": ["Top 40 Countdown", "Live Sessions", "Unplugged"],
    ]

    static func guide(now: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMddHHmmss Z"
        let hour = Date(timeIntervalSince1970: (now.timeIntervalSince1970 / 1800).rounded(.down) * 1800)
        var xml = #"<?xml version="1.0" encoding="UTF-8"?><tv>"#
        for (index, ch) in channels.enumerated() {
            xml += #"<channel id="\#(ch.id)"><display-name>\#(ch.name)</display-name></channel>"#
            let titles = programmeTitles[ch.group] ?? ["Programme"]
            var start = hour.addingTimeInterval(-Double(index % 3) * 600 - 1800)
            for slot in 0..<16 {
                let end = start.addingTimeInterval(Double(30 + (slot + index) % 3 * 30) * 60)
                xml += #"<programme start="\#(formatter.string(from: start))" stop="\#(formatter.string(from: end))" channel="\#(ch.id)"><title>\#(titles[(slot + index) % titles.count])</title><desc>Live on \#(ch.name).</desc></programme>"#
                start = end
            }
        }
        return xml + "</tv>"
    }
}

/// Sources for demo playback: AIOStreams-style rows that play Apple's sample streams.
public struct DemoSourceProvider: SourceProvider {
    public let providerID = "demo.aiostreams"
    public let providerName = "AIOStreams"
    public let category = SourceCategory.addons

    public init() {}

    public func sources(for request: PlaybackRequest) async throws -> [StreamSource] {
        try await Task.sleep(nanoseconds: 450_000_000)
        let name = request.displayTitle.replacingOccurrences(of: " ", with: ".")
        let rows: [(String, String)] = [
            ("🧿 1080p 🎫\nWEB-DL\n🔊 AAC\n📦 3.98 GB\n🌎 English", "\(name).1080p.WEB-DL.AAC.H264.mkv"),
            ("✨ 4K 🎫\nWEB-DL\nDV HDR10\n🔊 DD+ Atmos 5.1\n📦 18.2 GB\n🌎 English", "\(name).2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.HEVC.mkv"),
            ("🧿 1080p 🎫\nBluRay\n🔊 DTS-HD MA 7.1\n📦 12.4 GB\n🌎 English • Spanish", "\(name).1080p.BluRay.DTS-HD.MA.7.1.x264.mkv"),
            ("🧿 720p\nWEBRip\n🔊 AAC 2.0\n📦 1.18 GB\n🌎 English • Hindi • Tamil", "\(name).720p.WEBRip.AAC.2.0.x264.mkv"),
        ]
        var sources = rows.enumerated().map { index, row in
            var traits = StreamParser.parse(row.0, row.1)
            traits.isCached = true
            return StreamSource(id: "demo#\(index)", category: .addons, providerID: providerID, providerName: providerName,
                                title: "AIOStreams\n" + row.0, detail: row.0, filename: row.1,
                                location: .url(URL(string: DemoTransport.sampleStreams[index % DemoTransport.sampleStreams.count])!, headers: [:]),
                                traits: traits, segments: [SkipSegment(kind: .intro, start: 5, end: 25)], bingeGroup: "demo-\(index)")
        }
        if let sample = Self.matroskaSample {
            let text = "🧿 720p\nMKV · remuxed on device\n🔊 DTS • AAC • AC-3\n🌎 English • Spanish"
            sources.append(StreamSource(id: Self.matroskaSampleID, category: .addons, providerID: providerID, providerName: providerName,
                                        title: "AIOStreams\n" + text, detail: text, filename: "Flow.Sample.720p.DTS.AAC.AC3.mkv",
                                        location: .url(sample, headers: [:]), traits: StreamParser.parse(text, "Flow.Sample.720p.mkv")))
        }
        return sources
    }

    public static let matroskaSampleID = "demo#mkv"

    /// A short MKV bundled with the app (H.264, DTS + AAC + AC-3, ASS and forced PGS subtitles, chapters) to show the remuxer at work.
    public static var matroskaSample: URL? { Bundle.main.url(forResource: "FlowSample", withExtension: "mkv") }
}
