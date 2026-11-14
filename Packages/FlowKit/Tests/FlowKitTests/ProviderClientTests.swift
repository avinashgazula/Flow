import XCTest
@testable import FlowKit

/// WebDAV shares, Xtream panels and TheSportsDB through a scripted transport.
final class WebDAVClientTests: XCTestCase {
    private func multistatus(_ responses: String) -> String {
        #"<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">\#(responses)</D:multistatus>"#
    }

    private func dir(_ href: String) -> String {
        #"<D:response><D:href>\#(href)</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>"#
    }

    private func file(_ href: String, size: Int) -> String {
        #"<D:response><D:href>\#(href)</D:href><D:propstat><D:prop><D:getcontentlength>\#(size)</D:getcontentlength><D:getcontenttype>video/x-matroska</D:getcontenttype><D:getlastmodified>Sat, 06 Nov 2021 10:00:00 GMT</D:getlastmodified></D:prop></D:propstat></D:response>"#
    }

    private func client(_ stub: StubTransport, user: String? = "me", password: String? = "p w") -> WebDAVClient {
        WebDAVClient(config: WebDAVConfig(id: "dav", name: "NAS", baseURL: URL(string: "https://nas.example.com/dav/")!, username: user, password: password,
                                          moviesPath: "/Movies", showsPath: "/TV Shows"), http: HTTPClient(transport: stub))
    }

    func testListSendsPropfindWithDepthOneBasicAuthAndSkipsTheFolderItself() async throws {
        let stub = StubTransport().on("PROPFIND", "/dav/Movies", json: multistatus(dir("/dav/Movies/") + dir("/dav/Movies/Dune%20(2021)/") + file("/dav/Movies/Heat.1995.mkv", size: 1234)))
        let entries = try await client(stub).list("/Movies")
        XCTAssertEqual(entries.map(\.name), ["Dune (2021)", "Heat.1995.mkv"], "the listed folder isn't one of its own entries")
        XCTAssertEqual(entries.map(\.isDirectory), [true, false])
        XCTAssertEqual(entries[1].size, 1234)
        XCTAssertEqual(entries[1].contentType, "video/x-matroska")
        XCTAssertEqual(entries[1].modified, Date(timeIntervalSince1970: 1_636_192_800))
        XCTAssertTrue(entries[1].isVideo)
        let sent = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(sent.httpMethod, "PROPFIND")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Depth"), "1")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Basic " + Data("me:p w".utf8).base64EncodedString())
        XCTAssertTrue(String(decoding: sent.httpBody ?? Data(), as: UTF8.self).contains("getcontentlength"))
    }

    func testPathsAreEscapedSegmentByEscapedSegment() async throws {
        let stub = StubTransport().on("PROPFIND", "", json: multistatus(""))
        _ = try await client(stub).list("/TV Shows/Mr. Robot")
        XCTAssertEqual(stub.requests[0].url?.absoluteString, "https://nas.example.com/dav/TV%20Shows/Mr.%20Robot")
    }

    func testBadCredentialsAndMissingFoldersMapToErrors() async {
        for (status, expected) in [(401, FlowError.unauthorized), (404, .notFound)] {
            let stub = StubTransport().on("PROPFIND", "", status: status, json: "")
            do { _ = try await client(stub).testConnection(); XCTFail("expected an error") } catch { XCTAssertEqual(error as? FlowError, expected) }
        }
    }

    func testVideosAreCollectedRecursivelyAndStopAtTheDepthLimit() async throws {
        let stub = StubTransport()
        stub.on("PROPFIND", "/dav/Movies", json: multistatus(dir("/dav/Movies/") + dir("/dav/Movies/A/") + file("/dav/Movies/top.mkv", size: 1) + file("/dav/Movies/notes.txt", size: 2)))
        stub.on("PROPFIND", "/dav/Movies/A", json: multistatus(dir("/dav/Movies/A/") + dir("/dav/Movies/A/B/") + file("/dav/Movies/A/mid.mp4", size: 3)))
        stub.on("PROPFIND", "/dav/Movies/A/B", json: multistatus(dir("/dav/Movies/A/B/") + file("/dav/Movies/A/B/deep.mkv", size: 4)))
        let two = try await client(stub).videos(under: "/Movies", depth: 1)
        XCTAssertEqual(Set(two.map(\.name)), ["top.mkv", "mid.mp4"])
        let all = try await client(stub).videos(under: "/Movies", depth: 2)
        XCTAssertEqual(Set(all.map(\.name)), ["top.mkv", "mid.mp4", "deep.mkv"])
    }

    func testMovieSourceMatchesByTitleAndYearAndCarriesCredentials() async throws {
        let stub = StubTransport().on("PROPFIND", "/dav/Movies", json: multistatus(
            dir("/dav/Movies/") + file("/dav/Movies/Dune.Part.Two.2024.2160p.mkv", size: 9_000_000_000) + file("/dav/Movies/Dune.1984.mkv", size: 5) + file("/dav/Movies/Other.Movie.2024.mkv", size: 6)))
        let item = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 693134), title: "Dune: Part Two", releaseDate: FlowDate.parse("2024-02-27"))
        let sources = try await client(stub).sources(for: PlaybackRequest(item: item))
        XCTAssertEqual(sources.map(\.filename), ["Dune.Part.Two.2024.2160p.mkv"])
        let source = try XCTUnwrap(sources.first)
        XCTAssertEqual(source.traits.sizeBytes, 9_000_000_000)
        XCTAssertEqual(source.category, .webDAV)
        guard case .url(let url, let headers) = source.location else { return XCTFail("expected a URL") }
        XCTAssertEqual(url.user, "me")
        XCTAssertEqual(url.password, "p w".addingPercentEncoding(withAllowedCharacters: .urlPasswordAllowed))
        XCTAssertNotNil(headers["Authorization"])
    }

    func testEpisodeSourceFindsTheShowFolderThenTheEpisode() async throws {
        let stub = StubTransport()
        stub.on("PROPFIND", "/dav/TV Shows", json: multistatus(dir("/dav/TV%20Shows/") + dir("/dav/TV%20Shows/Severance/") + dir("/dav/TV%20Shows/Other/")))
        stub.on("PROPFIND", "/dav/TV Shows/Severance", json: multistatus(dir("/dav/TV%20Shows/Severance/") + file("/dav/TV%20Shows/Severance/Severance.S02E02.1080p.mkv", size: 7) + file("/dav/TV%20Shows/Severance/Severance.S02E03.1080p.mkv", size: 8)))
        let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 95396), title: "Severance")
        let sources = try await client(stub).sources(for: PlaybackRequest(item: show, episode: Episode(showTMDB: 95396, season: 2, number: 2, title: "x")))
        XCTAssertEqual(sources.map(\.filename), ["Severance.S02E02.1080p.mkv"])
        let none = try await client(stub).sources(for: PlaybackRequest(item: MediaItem(type: .show, ids: ExternalIDs(), title: "Not Here"), episode: Episode(showTMDB: 1, season: 1, number: 1, title: "x")))
        XCTAssertTrue(none.isEmpty)
    }

    func testMatcherLooksAtTheParentFolderAndToleratesOneYear() {
        func entry(_ href: String) -> WebDAVEntry { WebDAVEntry(href: href, name: (href as NSString).lastPathComponent, isDirectory: false) }
        XCTAssertTrue(WebDAVMatcher.matchesMovie(entry("/m/Heat%20(1995)/movie.mkv"), title: "Heat", originalTitle: nil, year: 1995))
        XCTAssertTrue(WebDAVMatcher.matchesMovie(entry("/m/Heat.1996.mkv"), title: "Heat", originalTitle: nil, year: 1995), "a year off by one is allowed")
        XCTAssertFalse(WebDAVMatcher.matchesMovie(entry("/m/Heat.1999.mkv"), title: "Heat", originalTitle: nil, year: 1995))
        XCTAssertTrue(WebDAVMatcher.matchesMovie(entry("/m/Le.Samourai.1967.mkv"), title: "The Samurai", originalTitle: "Le Samouraï", year: 1967), "the original title counts too")
        XCTAssertFalse(WebDAVMatcher.matchesMovie(entry("/m/Heat.Wave.1995.mkv"), title: "Heat", originalTitle: nil, year: 1995))
    }
}

final class XtreamClientTests: XCTestCase {
    private func client(_ stub: StubTransport, ua: String? = nil) -> XtreamClient {
        XtreamClient(config: IPTVProviderConfig(id: "x1", name: "Panel", kind: .xtream, url: URL(string: "http://panel.example.com:8080/player_api.php")!, username: "me", password: "pw", userAgent: ua),
                     http: HTTPClient(transport: stub))
    }

    func testEveryCallCarriesCredentialsAndTheActionAndTrimsTheEndpoint() async throws {
        let stub = StubTransport().on("GET", "/player_api.php", json: #"{"user_info":{"auth":1,"status":"Active","exp_date":1893456000,"max_connections":"2","active_cons":"1"}}"#)
        let info = try await client(stub, ua: "TiviMate/5").accountInfo()
        XCTAssertEqual(info.status, "Active")
        XCTAssertEqual(info.expiresAt, Date(timeIntervalSince1970: 1_893_456_000))
        XCTAssertEqual(info.maxConnections, 2)
        XCTAssertEqual(info.activeConnections, 1)
        let r = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(r.url?.absoluteString.hasPrefix("http://panel.example.com:8080/player_api.php?"), true)
        XCTAssertEqual(StubTransport.query(r)["username"], "me")
        XCTAssertEqual(StubTransport.query(r)["password"], "pw")
        XCTAssertEqual(r.value(forHTTPHeaderField: "User-Agent"), "TiviMate/5")
    }

    func testAuthZeroMeansWrongLogin() async {
        let stub = StubTransport().on("GET", "/player_api.php", json: #"{"user_info":{"auth":0}}"#)
        do { _ = try await client(stub).accountInfo(); XCTFail("expected an error") } catch { XCTAssertEqual(error as? FlowError, .unauthorized) }
    }

    func testChannelsGetTheirGroupFromCategoriesAndSurviveMissingCategories() async throws {
        let stub = StubTransport()
        stub.on("GET", "/player_api.php", query: ["action=get_live_categories"], json: #"[{"category_id":"5","category_name":"News"}]"#)
        stub.on("GET", "/player_api.php", query: ["action=get_live_streams"], json: #"[{"num":1,"name":"BBC One","stream_id":101,"stream_icon":"http://i/x.png","epg_channel_id":"bbc1","category_id":"5","tv_archive":1},{"stream_id":102,"category_id":"9","stream_icon":"","epg_channel_id":""}]"#)
        let channels = try await client(stub).channels()
        XCTAssertEqual(channels.map(\.name), ["BBC One", "Channel 102"])
        XCTAssertEqual(channels.map(\.group), ["News", "Uncategorised"])
        XCTAssertEqual(channels[0].id, "x1:101")
        XCTAssertEqual(channels[0].epgID, "bbc1")
        XCTAssertTrue(channels[0].hasCatchup)
        XCTAssertFalse(channels[1].hasCatchup)
        XCTAssertNil(channels[1].logoURL)
        XCTAssertNil(channels[1].epgID)
        XCTAssertEqual(channels[0].streamURL.absoluteString, "http://panel.example.com:8080/live/me/pw/101.m3u8")

        stub.on("GET", "/player_api.php", query: ["action=get_live_categories"], status: 500, json: "")
        let again = try await client(stub).channels()
        XCTAssertEqual(again.count, 2, "channels still play when the category list fails")
    }

    func testVODMoviesAndSeriesDecode() async throws {
        let stub = StubTransport()
        stub.on("GET", "/player_api.php", query: ["action=get_vod_streams"], json: #"[{"stream_id":7,"name":"Dune (2021)","tmdb":"438631","container_extension":"mkv","stream_icon":"http://i/d.jpg"},{"stream_id":8,"name":"No Year","year":"1999"},{"name":"no id"}]"#)
        stub.on("GET", "/player_api.php", query: ["action=get_series"], json: #"[{"series_id":3,"name":"Severance","tmdb":95396,"releaseDate":"2022-02-18"},{"series_id":4,"name":"Old Show (2001)"}]"#)
        let xtream = client(stub)
        let movies = try await xtream.vodMovies()
        XCTAssertEqual(movies.map(\.streamID), ["7", "8"])
        XCTAssertEqual(movies[0].tmdbID, 438631)
        XCTAssertEqual(movies[0].year, 2021, "the year comes from the name when the panel has none")
        XCTAssertEqual(movies[0].container, "mkv")
        XCTAssertEqual(movies[1].container, "mp4")
        XCTAssertEqual(movies[1].year, 1999)
        XCTAssertEqual(xtream.movieURL(movies[0])?.absoluteString, "http://panel.example.com:8080/movie/me/pw/7.mkv")
        let series = try await xtream.vodSeries()
        XCTAssertEqual(series.map(\.year), [2022, 2001])
        XCTAssertEqual(series[0].tmdbID, 95396)
    }

    func testEpisodeURLUnderBothSeasonLayouts() async throws {
        let keyed = #"{"episodes":{"1":[{"id":"900","episode_num":1,"title":"Pilot","season":1,"container_extension":"mkv"}],"2":[{"id":"910","episode_num":2,"title":"Two","season":2}]}}"#
        let stub = StubTransport().on("GET", "/player_api.php", query: ["action=get_series_info", "series_id=3"], json: keyed)
        let found = try await client(stub).episodeURL(seriesID: "3", episode: EpisodeRef(season: 2, episode: 2))
        XCTAssertEqual(found?.0.absoluteString, "http://panel.example.com:8080/series/me/pw/910.mp4")
        XCTAssertEqual(found?.1, "Two")
        let missing = try await client(stub).episodeURL(seriesID: "3", episode: EpisodeRef(season: 9, episode: 9))
        XCTAssertNil(missing)
        let array = StubTransport().on("GET", "/player_api.php", json: #"{"episodes":[[{"id":"5","episode_num":1,"season":0,"title":"Special"}]]}"#)
        let zero = try await client(array).episodeURL(seriesID: "3", episode: EpisodeRef(season: 0, episode: 1))
        XCTAssertEqual(zero?.1, "Special")
    }

    func testEPGDownloadsXMLTVAndHandlesGzip() async throws {
        let xml = #"<tv><channel id="bbc1"/><programme start="20300101180000 +0000" stop="20300101190000 +0000" channel="bbc1"><title>News</title></programme></tv>"#
        let stub = StubTransport().on("GET", "/xmltv.php", json: xml)
        let window = Date(timeIntervalSince1970: 1_800_000_000)...Date(timeIntervalSince1970: 2_000_000_000)
        let epg = try await client(stub).epg(window: window)
        XCTAssertEqual(epg.programmes["bbc1"]?.map(\.title), ["News"])
        XCTAssertEqual(StubTransport.query(stub.requests[0])["username"], "me")
        let outside = try await client(stub).epg(window: Date(timeIntervalSince1970: 0)...Date(timeIntervalSince1970: 100))
        XCTAssertTrue(outside.programmes["bbc1"]?.isEmpty ?? true, "programmes outside the window are dropped")
    }

    func testVODProviderMatchesByTMDbThenTitleAndBuildsSources() async throws {
        let stub = StubTransport()
        stub.on("GET", "/player_api.php", query: ["action=get_vod_streams"], json: #"[{"stream_id":7,"name":"EN - Dune (2021)","container_extension":"mkv"},{"stream_id":8,"name":"Other","tmdb":1},{"stream_id":9,"name":"Whatever","tmdb":438631},{"stream_id":10,"name":"Dune (2021)","tmdb":1}]"#)
        let provider = IPTVVODProvider(config: IPTVProviderConfig(id: "x1", name: "Panel", kind: .xtream, url: URL(string: "http://panel.example.com:8080")!, username: "me", password: "pw"), http: HTTPClient(transport: stub))
        let byTMDb = try await provider.sources(for: PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 438631), title: "Dune", releaseDate: FlowDate.parse("2021-10-22"))))
        XCTAssertEqual(byTMDb.map(\.id), ["x1#7", "x1#9"], "an entry tagged with another TMDb id is out even when its title matches; an untagged one is judged by title")
        let byTitle = try await provider.sources(for: PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(), title: "Dune", releaseDate: FlowDate.parse("2021-10-22"))))
        XCTAssertEqual(byTitle.map(\.id), ["x1#7", "x1#10"], "a provider's language prefix is ignored; without a TMDb id on the title only names are compared")
        XCTAssertEqual(stub.requests("GET", path: "/player_api.php").count, 1, "the catalogue is fetched once and kept")
        let wrongYear = try await provider.sources(for: PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(), title: "Dune", releaseDate: FlowDate.parse("1984-12-14"))))
        XCTAssertTrue(wrongYear.isEmpty)
    }
}

final class SportsClientTests: XCTestCase {
    func testTeamSearchDecodesBadgesUnderEitherKey() async throws {
        let stub = StubTransport().on("GET", "/searchteams.php", json: #"{"teams":[{"idTeam":"133604","strTeam":"Arsenal","strLeague":"English Premier League","strSport":"Soccer","strTeamBadge":"https://b/a.png","strCountry":"England"},{"idTeam":"2","strTeam":"Other","strBadge":"https://b/o.png"},{"strTeam":"No id"}]}"#)
        let teams = try await SportsClient(apiKey: "KEY", http: HTTPClient(transport: stub)).searchTeams("Ars")
        XCTAssertEqual(teams.map(\.name), ["Arsenal", "Other"])
        XCTAssertEqual(teams[0].badgeURL?.absoluteString, "https://b/a.png")
        XCTAssertEqual(teams[1].badgeURL?.absoluteString, "https://b/o.png")
        XCTAssertEqual(stub.requests[0].url?.absoluteString.hasPrefix("https://www.thesportsdb.com/api/v1/json/KEY/searchteams.php"), true)
        XCTAssertEqual(StubTransport.query(stub.requests[0])["t"], "Ars")
    }

    func testNullTeamsMeansNoTeams() async throws {
        let stub = StubTransport().on("GET", "/searchteams.php", json: #"{"teams":null}"#)
        let teams = try await SportsClient(http: HTTPClient(transport: stub)).searchTeams("zzz")
        XCTAssertTrue(teams.isEmpty)
    }

    func testEventsReadScoresDatesAndKeysOfBothEndpoints() async throws {
        let stub = StubTransport()
        stub.on("GET", "/eventsnext.php", json: #"{"events":[{"idEvent":"1","strEvent":"Arsenal vs Chelsea","strHomeTeam":"Arsenal","strAwayTeam":"Chelsea","strTimestamp":"2030-05-01T14:00:00","intHomeScore":null,"intAwayScore":null,"strVenue":"Emirates"}]}"#)
        stub.on("GET", "/eventslast.php", json: #"{"results":[{"idEvent":"2","strEvent":"A v B","dateEvent":"2026-01-02","strTime":"20:00:00","intHomeScore":"3","intAwayScore":"1","strThumb":"https://t/x.jpg"}]}"#)
        let sports = SportsClient(http: HTTPClient(transport: stub))
        let next = try await sports.nextEvents(teamID: "133604")
        XCTAssertEqual(StubTransport.query(stub.requests[0])["id"], "133604")
        XCTAssertEqual(next[0].date, FlowDate.parse("2030-05-01T14:00:00Z"), "a timestamp without a zone is UTC")
        XCTAssertFalse(next[0].isFinished)
        XCTAssertEqual(next[0].venue, "Emirates")
        let last = try await sports.lastEvents(teamID: "133604")
        XCTAssertEqual(last[0].homeScore, 3)
        XCTAssertEqual(last[0].awayScore, 1)
        XCTAssertTrue(last[0].isFinished)
        XCTAssertEqual(last[0].date, FlowDate.parse("2026-01-02T20:00:00Z"))
        XCTAssertEqual(last[0].thumbnailURL?.absoluteString, "https://t/x.jpg")
    }
}
