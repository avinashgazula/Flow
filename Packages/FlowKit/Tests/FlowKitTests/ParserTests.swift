import XCTest
@testable import FlowKit

final class StreamParserTests: XCTestCase {
    func testAIOStreamsStyleText() {
        // Mirrors a row from the source picker: emoji-formatted add-on output.
        let text = """
        AIOStreams
        🧿 1080p 🎫
        TS
        🔊 AAC
        📦 2.07 GB
        🌎 English • Hindi • Tamil
        Resident.Evil.2026.1080p.HDTS.x264.AAC.2.0-GROUP.mkv
        """
        let t = StreamParser.parse(text)
        XCTAssertEqual(t.resolution, .hd1080)
        XCTAssertEqual(t.quality, .telesync)
        XCTAssertEqual(t.videoCodec, "H264")
        XCTAssertEqual(t.audioCodec, "AAC")
        XCTAssertEqual(t.audioChannels, "2.0")
        XCTAssertEqual(t.languages, ["English", "Hindi", "Tamil"])
        XCTAssertEqual(t.sizeBytes, Int64(2.07 * 1_073_741_824))
        XCTAssertEqual(t.badges, ["1080p", "H264", "AAC", "2.0"])
        XCTAssertTrue(t.quality.isCinemaCapture)
    }

    func testFourKRemuxWithHDR() {
        let t = StreamParser.parse("Movie.2023.2160p.UHD.BluRay.REMUX.DV.HDR10+.HEVC.TrueHD.Atmos.7.1-FGT [RD+] 💾 58.3 GB")
        XCTAssertEqual(t.resolution, .uhd4k)
        XCTAssertEqual(t.quality, .remux)
        XCTAssertEqual(t.videoCodec, "HEVC")
        XCTAssertEqual(t.hdr, ["DV", "HDR10+"])
        XCTAssertEqual(t.audioCodec, "TrueHD Atmos")
        XCTAssertEqual(t.audioChannels, "7.1")
        XCTAssertEqual(t.isCached, true)
        XCTAssertNotNil(t.sizeBytes)
    }

    func testUncachedAndWebDL() {
        let t = StreamParser.parse("[RD download] Show.S01E02.720p.WEB-DL.DDP5.1.H.264")
        XCTAssertEqual(t.resolution, .hd720)
        XCTAssertEqual(t.quality, .webdl)
        XCTAssertEqual(t.audioCodec, "DD+")
        XCTAssertEqual(t.isCached, false)
    }

    func testHDRDoesNotImply720p() {
        XCTAssertEqual(StreamParser.parse("HDR movie").resolution, .unknown)
        XCTAssertEqual(StreamParser.parse("Film HD-TS").quality, .telesync)
    }

    func testEpisodeRefs() {
        XCTAssertEqual(StreamParser.episodeRef(in: "Show.Name.S02E10.1080p.mkv"), EpisodeRef(season: 2, episode: 10))
        XCTAssertEqual(StreamParser.episodeRef(in: "Show Name 3x07.mp4"), EpisodeRef(season: 3, episode: 7))
        XCTAssertEqual(StreamParser.episodeRef(in: "Season 1 Episode 4.mkv"), EpisodeRef(season: 1, episode: 4))
        XCTAssertNil(StreamParser.episodeRef(in: "Movie.2020.1080p.mkv"))
    }

    func testTitleAndYear() {
        let a = StreamParser.titleAndYear(from: "The.Matrix.1999.1080p.BluRay.x264.mkv")
        XCTAssertEqual(a.title, "the matrix")
        XCTAssertEqual(a.year, 1999)
        let b = StreamParser.titleAndYear(from: "Amélie (2001).mkv")
        XCTAssertEqual(b.title, "amelie")
        XCTAssertEqual(b.year, 2001)
        let c = StreamParser.titleAndYear(from: "Blade Runner 2049 (2017).mp4")
        XCTAssertEqual(c.title, "blade runner 2049")
        XCTAssertEqual(c.year, 2017)
    }

    func testNormalizeTitle() {
        XCTAssertEqual(StreamParser.normalizeTitle("Spider-Man: Brand New Day"), "spider man brand new day")
        XCTAssertEqual(StreamParser.normalizeTitle("Fast & Furious"), "fast and furious")
    }
}

final class SourceRankerTests: XCTestCase {
    func source(_ id: String, _ category: SourceCategory, provider: String, text: String) -> StreamSource {
        StreamSource(id: id, category: category, providerID: provider, providerName: provider, title: text,
                     location: .url(URL(string: "https://example.com/\(id)")!, headers: [:]), traits: StreamParser.parse(text))
    }

    func testCategoryAndProviderOrderApplyWithoutCustomOrdering() {
        let sources = [
            source("a1", .addons, provider: "aio", text: "1080p"),
            source("s1", .mediaServers, provider: "viren", text: "720p"),
            source("s2", .mediaServers, provider: "jelly", text: "1080p"),
            source("i1", .iptv, provider: "iptv", text: "1080p"),
        ]
        var settings = SourceSettings()
        settings.providerOrder[SourceCategory.mediaServers.rawValue] = ["jelly", "viren"]
        let ranked = SourceRanker.rank(sources, settings: settings, resolutionCap: .uhd4k)
        XCTAssertEqual(ranked.map(\.id), ["s2", "s1", "i1", "a1"])
    }

    func testResolutionCapAlwaysApplies() {
        let sources = [source("4k", .addons, provider: "aio", text: "2160p"), source("hd", .addons, provider: "aio", text: "1080p"), source("u", .addons, provider: "aio", text: "no info")]
        let ranked = SourceRanker.rank(sources, settings: SourceSettings(), resolutionCap: .hd1080)
        XCTAssertEqual(ranked.map(\.id), ["hd", "u"])
    }

    func testCustomOrderingSortsFiltersAndCaps() {
        let sources = [
            source("cam", .addons, provider: "aio", text: "1080p CAM 2 GB"),
            source("small", .addons, provider: "aio", text: "1080p WEB-DL 1 GB [RD+]"),
            source("big4k", .addons, provider: "aio", text: "2160p BluRay 30 GB [RD+]"),
            source("uncached", .addons, provider: "aio", text: "2160p WEB-DL 15 GB [RD download]"),
            source("hd", .addons, provider: "aio", text: "1080p BluRay 8 GB [RD+]"),
        ]
        var settings = SourceSettings()
        settings.useCustomOrdering = true
        settings.resultCap = 3
        let ranked = SourceRanker.rank(sources, settings: settings, resolutionCap: .uhd4k)
        // cam filtered; cached first, then resolution, quality, size.
        XCTAssertEqual(ranked.map(\.id), ["big4k", "hd", "small"])
    }

    func testFiltersKeywordsAndSize() {
        var filters = SourceFilters()
        filters.excludedKeywords = ["hindi"]
        filters.maxSizeGB = 10
        let a = source("a", .addons, provider: "x", text: "1080p Hindi 2 GB")
        let b = source("b", .addons, provider: "x", text: "1080p 20 GB")
        let c = source("c", .addons, provider: "x", text: "1080p English 4 GB")
        XCTAssertFalse(SourceRanker.passes(a, filters))
        XCTAssertFalse(SourceRanker.passes(b, filters))
        XCTAssertTrue(SourceRanker.passes(c, filters))
    }
}

final class LiveTVParserTests: XCTestCase {
    func testM3UParsing() {
        let m3u = """
        #EXTM3U x-tvg-url="https://epg.example.com/guide.xml.gz"
        #EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="https://logo/bbc1.png" group-title="UK",BBC One HD
        #EXTVLCOPT:http-user-agent=Flow/1.0
        https://stream.example.com/live/bbc1.m3u8
        #EXTINF:-1 tvg-id="" group-title="Movies VOD",The Matrix (1999)
        https://stream.example.com/movie/u/p/123.mkv
        #EXTINF:-1 tvg-chno="7" group-title='News',Sky News
        https://stream.example.com/live/sky.ts
        """
        let playlist = M3UParser.parse(m3u, providerID: "p1")
        XCTAssertEqual(playlist.epgURL?.absoluteString, "https://epg.example.com/guide.xml.gz")
        XCTAssertEqual(playlist.channels.count, 2)
        XCTAssertEqual(playlist.vod.count, 1)
        let bbc = playlist.channels[0]
        XCTAssertEqual(bbc.name, "BBC One HD")
        XCTAssertEqual(bbc.group, "UK")
        XCTAssertEqual(bbc.epgID, "bbc1.uk")
        XCTAssertEqual(bbc.userAgent, "Flow/1.0")
        XCTAssertEqual(bbc.logoURL?.absoluteString, "https://logo/bbc1.png")
        XCTAssertEqual(playlist.channels[1].number, 7)
        XCTAssertEqual(playlist.channels[1].group, "News")
        XCTAssertNil(playlist.channels[1].userAgent)
    }

    func testXMLTVAndNowNext() {
        let xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
          <programme start="20260101120000 +0000" stop="20260101130000 +0000" channel="bbc1.uk">
            <title>News at Noon</title><desc>Headlines.</desc><category>News</category>
          </programme>
          <programme start="20260101140000 +0100" stop="20260101150000 +0100" channel="bbc1.uk">
            <title>Afternoon Film</title>
          </programme>
        </tv>
        """
        let epg = XMLTVParser.parse(Data(xml.utf8))
        XCTAssertEqual(epg.displayNames["bbc1.uk"], "BBC One")
        XCTAssertEqual(epg.programmes["bbc1.uk"]?.count, 2)
        let at = FlowDate.parse("2026-01-01T12:30:00Z")!
        let (now, next) = epg.nowAndNext(for: "bbc1.uk", at: at)
        XCTAssertEqual(now?.title, "News at Noon")
        XCTAssertEqual(now?.description, "Headlines.")
        XCTAssertEqual(next?.title, "Afternoon Film")
        XCTAssertEqual(next?.start, FlowDate.parse("2026-01-01T13:00:00Z"))
        XCTAssertEqual(now?.progress(at: at) ?? 0, 0.5, accuracy: 0.001)
    }
}

final class SubtitleTests: XCTestCase {
    func testSRT() {
        let srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nLine one\r\nLine two\r\n"
        let doc = SubtitleParser.parse(srt)
        XCTAssertEqual(doc.cues.count, 2)
        XCTAssertEqual(doc.text(at: 1.5), "Hello there")
        XCTAssertNil(doc.text(at: 2.7))
        XCTAssertEqual(doc.text(at: 3.5), "Line one\nLine two")
        // Positive offset delays subtitles.
        XCTAssertEqual(doc.text(at: 2.2, offset: 1), "Hello there")
    }

    func testVTT() {
        let vtt = "WEBVTT\n\n00:01.000 --> 00:02.000 align:center\nShort form\n\n01:00:00.000 --> 01:00:01.000\nLong form"
        let doc = SubtitleParser.parse(vtt)
        XCTAssertEqual(doc.cues.count, 2)
        XCTAssertEqual(doc.text(at: 1.2), "Short form")
        XCTAssertEqual(doc.text(at: 3600.5), "Long form")
    }
}

final class CompressionTests: XCTestCase {
    func testGzipDynamicHuffman() throws {
        let data = try Gzip.decompress(Data(base64Encoded: Fixtures.dynamicGzip)!)
        XCTAssertEqual(data.count, 8658)
        let words = String(decoding: data, as: UTF8.self).split(separator: " ").map(String.init)
        XCTAssertEqual(words.count, 1500)
        XCTAssertTrue(words.allSatisfy(Fixtures.words.contains))
    }

    func testGzipFixedHuffman() throws {
        let data = try Gzip.decompress(Data(base64Encoded: Fixtures.fixedGzip)!)
        XCTAssertEqual(data.count, 3601)
        XCTAssertTrue(String(decoding: data, as: UTF8.self).hasPrefix("Hello Flow! Hello Flow!"))
    }

    func testZipSubtitleExtraction() throws {
        let entries = try ZipArchive.entries(Data(base64Encoded: Fixtures.subtitleZip)!)
        XCTAssertEqual(entries.map(\.name), ["readme.txt", "movie.en.srt"])
        XCTAssertEqual(String(decoding: entries[0].data, as: UTF8.self), "ignore me")
        let doc = SubtitleParser.parse(entries[1].data)
        XCTAssertEqual(doc.text(at: 3.2), "General Kenobi")
    }
}

final class WebDAVTests: XCTestCase {
    func testMultistatusParsing() {
        let xml = """
        <?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/dav/Movies/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
          <d:response><d:href>/dav/Movies/The%20Matrix%20(1999)/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
          <d:response><d:href>/dav/Movies/Heat.1995.1080p.mkv</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>123456</d:getcontentlength></d:prop></d:propstat></d:response>
        </d:multistatus>
        """
        let entries = WebDAVParser.parse(Data(xml.utf8))
        XCTAssertEqual(entries.count, 3)
        XCTAssertTrue(entries[1].isDirectory)
        XCTAssertEqual(entries[1].name, "The Matrix (1999)")
        XCTAssertTrue(entries[2].isVideo)
        XCTAssertEqual(entries[2].size, 123456)
        XCTAssertTrue(WebDAVMatcher.matchesMovie(entries[2], title: "Heat", originalTitle: nil, year: 1995))
        XCTAssertFalse(WebDAVMatcher.matchesMovie(entries[2], title: "Heat", originalTitle: nil, year: 2010))
    }
}
