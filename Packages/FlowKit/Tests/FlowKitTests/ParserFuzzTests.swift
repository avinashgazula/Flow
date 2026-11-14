import XCTest
@testable import FlowKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Every parser that reads bytes or text from outside the app, fed seeded mutations of a realistic
/// input: cut short, bits flipped, length fields at extremes, chunks repeated and moved. The promise is
/// no crash and no hang; the result is whatever the parser can salvage (nil, an error, or part of the input).
/// Fixed seeds, so a failure reproduces from the seed and case number in its message.
final class ParserFuzzTests: XCTestCase {
    /// Answers every request with one fixed body, so client parsers see mutated server replies.
    final class FixedTransport: HTTPTransport, @unchecked Sendable {
        var body = Data()
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
    }

    private func mutate(_ seed: [UInt8], _ label: String, seedValue: UInt64, count: Int = 400, _ body: ([UInt8]) -> Void) {
        // Every truncation of a small input first, then the random mutations.
        if seed.count <= 1500 { for cut in 0...seed.count { body(Mutation.truncated(seed, at: cut)) } }
        Fuzz.cases(label, seed: seedValue, count: count) { _, rng in body(Mutation.random(seed, using: &rng)) }
    }

    private func mutate(_ text: String, _ label: String, seedValue: UInt64, count: Int = 400, _ body: (String) -> Void) {
        mutate(Array(text.utf8), label, seedValue: seedValue, count: count) { body(String(decoding: $0, as: UTF8.self)) }
    }

    // MARK: Text formats

    static let m3u = """
    #EXTM3U x-tvg-url="https://epg.example.com/guide.xml.gz,https://b.example.com/x.xml"
    #EXTINF:-1 tvg-id="news.one" tvg-name="News One" tvg-logo="https://img.example.com/n1.png" group-title="News",News One HD
    #EXTVLCOPT:http-user-agent=Custom/1.0
    http://tv.example.com:8080/live/user/pass/101.ts
    #EXTINF:-1 tvg-id="" group-title="Movies" tvg-chno="12",Some Movie (2019)
    http://tv.example.com:8080/movie/user/pass/555.mp4
    #EXTGRP:Sports
    #EXTINF:3600 tvg-id="sp.1" group-title="",Sports 1
    https://tv.example.com/hls/sp1.m3u8|User-Agent=Foo
    """

    func testM3UNeverCrashesAndKeepsWhatItCanRead() {
        let clean = M3UParser.parse(Self.m3u, providerID: "p")
        XCTAssertEqual(clean.channels.count + clean.vod.count, 3, "the unmutated playlist yields its three entries")
        mutate(Self.m3u, "m3u", seedValue: 1) { text in
            let list = M3UParser.parse(text, providerID: "p", defaultUserAgent: "UA")
            for c in list.channels + list.vod { XCTAssertFalse(c.id.isEmpty) }
        }
    }

    static let xmltv = """
    <?xml version="1.0" encoding="UTF-8"?>
    <tv generator-info-name="test">
      <channel id="news.one"><display-name>News One</display-name></channel>
      <programme start="20261114180000 +0000" stop="20261114190000 +0000" channel="news.one">
        <title lang="en">Evening News</title><desc>Headlines.</desc><category>News</category>
        <episode-num system="onscreen">S01E02</episode-num>
      </programme>
      <programme start="20261114190000" stop="20261114200000" channel="news.one"><title>Weather</title></programme>
    </tv>
    """

    func testXMLTVNeverCrashes() {
        let clean = XMLTVParser.parse(Data(Self.xmltv.utf8))
        XCTAssertEqual(clean.programmes["news.one"]?.count, 2)
        let window = Date(timeIntervalSince1970: 0)...Date(timeIntervalSince1970: 4_000_000_000)
        mutate(Self.xmltv, "xmltv", seedValue: 2) { text in
            let epg = XMLTVParser.parse(Data(text.utf8), window: window)
            for list in epg.programmes.values { XCTAssertEqual(list.map(\.start), list.map(\.start).sorted(), "programmes come back in order") }
        }
    }

    static let srt = "1\n00:00:01,000 --> 00:00:03,500\nHello <i>there</i>.\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line\nwith two rows\n\n3\n01:02:03,004 --> 01:02:05,000\n{\\an8}Top\n"
    static let vtt = "WEBVTT\n\nNOTE a comment\n\n00:00.500 --> 00:02.000 line:90% align:center\nHello <b>there</b>\n\ncue2\n00:03.000 --> 00:04.000\nSecond &amp; third\n"
    static let ass = "[Script Info]\nTitle: t\nPlayResX: 1920\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV\nStyle: Default,Arial,48,&H00FFFFFF,0,0,2,10,10,20\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\i1}Hello{\\i0} \\Nthere\nDialogue: 0,0:00:04.00,0:00:05.50,Default,,0,0,0,,{\\pos(10,20)\\c&H0000FF&}Red\n"

    func testSubtitleFilesNeverCrash() {
        for (i, seed) in [Self.srt, Self.vtt, Self.ass].enumerated() {
            let clean = SubtitleParser.parse(seed)
            XCTAssertGreaterThanOrEqual(clean.cues.count, 2, "format \(i) parses unmutated")
            mutate(seed, "subtitles \(i)", seedValue: 3 + UInt64(i)) { text in
                let doc = SubtitleParser.parse(text)
                for t in [0.0, 1.5, 3.2, 1e9, -5] { _ = doc.cues(at: t) }
            }
        }
        // Bytes in other encodings (a UTF-16 byte-order mark, Windows-1252, binary) decode without trapping.
        mutate(Array(Self.srt.utf8), "subtitle bytes", seedValue: 7) { _ = SubtitleParser.parse(Data($0)) }
        for prefix in [[0xFF, 0xFE], [0xFE, 0xFF], [0xEF, 0xBB, 0xBF]] as [[UInt8]] {
            mutate(prefix + Array(Self.srt.utf8), "subtitle bom", seedValue: 8, count: 100) { _ = SubtitleParser.parse(Data($0)) }
        }
    }

    // MARK: JSON clients and documents

    func testXtreamRepliesNeverCrash() async throws {
        let live = #"[{"num":1,"name":"News One","stream_id":101,"stream_icon":"http://x/y.png","epg_channel_id":"news.one","category_id":"5","tv_archive":1},{"stream_id":"102","name":null,"category_id":null}]"#
        let transport = FixedTransport()
        let config = IPTVProviderConfig(name: "X", kind: .xtream, url: URL(string: "http://tv.example.com:8080")!, username: "u", password: "p")
        let client = XtreamClient(config: config, http: HTTPClient(transport: transport))
        transport.body = Data(live.utf8)
        let channels = try await client.channels()
        XCTAssertEqual(channels.count, 2, "the unmutated reply yields its two channels")
        await Fuzz.casesAsync("xtream", seed: 9, count: 300) { _, rng in
            transport.body = Data(Mutation.random(Array(live.utf8), using: &rng))
            _ = try? await client.channels()
            _ = try? await client.vodMovies()
            _ = try? await client.vodSeries()
            _ = try? await client.accountInfo()
        }
    }

    func testSettingsCodecNeverCrashes() throws {
        let defaults = AppSettings()
        let seed = [UInt8](try SettingsCodec.encode(defaults, pretty: true))
        XCTAssertEqual(try SettingsCodec.decode(AppSettings.self, from: Data(seed), defaults: defaults), defaults)
        Fuzz.cases("settings", seed: 10, count: 500) { _, rng in
            _ = try? SettingsCodec.decode(AppSettings.self, from: Data(Mutation.random(seed, using: &rng)), defaults: defaults)
        }
    }

    func testSetupLinksAndBundlesNeverCrash() throws {
        let link = try SetupShare.exportLink(settings: AppSettings(), credentials: Credentials(), includeSecrets: true)
        XCTAssertNoThrow(try SetupShare.importBundle(Data(link.utf8)))
        mutate(link, "setup link", seedValue: 11, count: 500) { text in _ = try? SetupShare.importBundle(Data(text.utf8)) }
        let file = try SetupShare.export(settings: AppSettings(), credentials: Credentials(), includeSecrets: true)
        mutate([UInt8](file), "setup file", seedValue: 12, count: 300) { _ = try? SetupShare.importBundle(Data($0)) }
    }

    func testBackupsNeverCrash() throws {
        var library = LocalLibrary()
        let key = MediaKey(type: .movie, tmdbID: 5)
        library.history = [HistoryEntry(key: key, watchedAt: Date(timeIntervalSince1970: 100))]
        library.watchlist = [ListEntry(key: key, addedAt: Date(timeIntervalSince1970: 50))]
        library.progress = [PlaybackProgress(key: key, percent: 40, updatedAt: Date(timeIntervalSince1970: 60))]
        let tracking = [UInt8](try TrackingExport(library: library).json())
        XCTAssertNoThrow(try LibraryBackup.parse(Data(tracking)))
        mutate(tracking, "tracking backup", seedValue: 13, count: 500) { _ = try? LibraryBackup.parse(Data($0)) }
        let web = #"{"format":"flow-web-backup","version":1,"exportedAt":"2026-10-01T10:00:00.000Z","settings":{"tmdbKey":"x"},"library":{"history":[{"key":"movie:5","item":{"type":"movie","id":5,"title":"Dune"},"watchedAt":1700000000000}],"watchedEpisodes":{"show:6:s1e2":1700000500000},"watchlist":[{"key":"show:6","item":{"type":"show","id":6,"title":"S"},"addedAt":1700000000000}],"progress":{"movie:7":{"key":"movie:7","item":{"type":"movie","id":7,"title":"O"},"position":1800,"duration":7200,"updatedAt":1700000000000}},"ratings":{"movie:5":8},"rewatches":{"show:6":{"startedAt":1700000000000,"watched":["s1e1"]}}}}"#
        XCTAssertNoThrow(try LibraryBackup.parse(Data(web.utf8)))
        mutate(web, "web backup", seedValue: 14, count: 500) { _ = try? LibraryBackup.parse(Data($0.utf8)) }
    }

    func testSyncLinksAndKeysNeverCrash() throws {
        let key = FlowSyncKey(bytes: Data((0..<16).map { UInt8($0 * 17 & 0xFF) }))!.text
        let pairing = try FlowSyncPairing(key: key, server: "https://flow-stream-proxy.example.workers.dev", token: "to ken&=/+é")
        for link in [FlowSyncLink.appLink(pairing), FlowSyncLink.webLink(pairing, site: "https://marquee.example.com")] {
            XCTAssertNoThrow(try FlowSyncLink.parse(link))
            mutate(link, "sync link", seedValue: 15, count: 400) { _ = try? FlowSyncLink.parse($0) }
        }
        mutate(key, "sync key", seedValue: 16, count: 300) { _ = try? FlowSyncKey.parse($0) }
    }

    func testFlowLinksNeverCrash() {
        for link in ["flow://title/movie/693134", "flow://play/tv/1399", "flow://search?q=dune%20part%20two", "flow://continue", "flow://upcoming", "flow://setup?d=abc", "flow://sync?k=a&s=b&t=c"] {
            XCTAssertNotNil(URL(string: link).flatMap(FlowLink.init(url:)), link)
            mutate(link, "flow link", seedValue: 17, count: 200) { text in
                if let url = URL(string: text) { _ = FlowLink(url: url) }
            }
        }
    }

    func testAccountDocumentsNeverCrash() {
        let doc = #"{"key":"movie:5","title":"Dune","at":1700000000000,"episodes":[{"season":1,"episode":2},{"season":"x"}],"n":1.5e300,"neg":-9223372036854775808}"#
        mutate(doc, "account json", seedValue: 18, count: 500) { text in
            if let value = AccountWire.parse(text) { _ = AccountWire.canonical(value) }
            _ = AccountWire.canonicalText(text)
        }
        let plain = ["history:2026-10": #"[{"key":"movie:5","at":1700000000000}]"#, "settings": doc, "progress": "[", "order": "{}"]
        Fuzz.cases("account read", seed: 19, count: 300) { _, rng in
            var mutated = plain
            for k in plain.keys.sorted() { mutated[k] = String(decoding: Mutation.random(Array(plain[k]!.utf8), using: &rng), as: UTF8.self) }
            _ = AccountWire.read(mutated)
        }
    }

    func testRatingIconPacksSkipChaffNeverCrash() {
        let pack = #"[{"name":"imdb","url":"https://x.example.com/i.png"},{"name":"nonsense","url":"::"},{"name":"tmdb"}]"#
        mutate(pack, "icon pack", seedValue: 20) { _ = try? RatingIconPack.decode(Data($0.utf8)) }
    }

    func testWebDAVListingsNeverCrash() {
        let xml = """
        <?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/movies/</d:href><d:propstat><d:prop><d:displayname>movies</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/movies/Dune%20(2021).mkv</d:href><d:propstat><d:prop><d:getcontentlength>1234567890123</d:getcontentlength><d:getlastmodified>Sat, 06 Nov 2021 10:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response></d:multistatus>
        """
        XCTAssertEqual(WebDAVParser.parse(Data(xml.utf8)).count, 2)
        mutate(xml, "webdav", seedValue: 21) { _ = WebDAVParser.parse(Data($0.utf8)) }
    }

    func testStreamNameParserNeverCrashes() {
        let names = "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR10Plus.DV.HEVC.TrueHD.7.1.Atmos-GRP\n💾 14.2 GB 👤 150 ⚙️ Torrentio\nS01E02 1080p WEB-DL DDP5.1 x264"
        mutate(names, "stream names", seedValue: 22, count: 500) { _ = StreamParser.parse($0) }
    }

    // MARK: Binary formats

    func testCompressionNeverCrashes() throws {
        let gzip = [UInt8](Data(base64Encoded: Fixtures.fixedGzip)!)
        XCTAssertGreaterThan(try Gzip.decompress(Data(gzip)).count, 100)
        mutate(gzip, "gzip", seedValue: 23, count: 600) { _ = try? Gzip.decompress(Data($0)) }
        let zip = [UInt8](Data(base64Encoded: Fixtures.subtitleZip)!)
        XCTAssertEqual(try ZipArchive.entries(Data(zip)).count, 2)
        mutate(zip, "zip", seedValue: 24, count: 600) { _ = try? ZipArchive.entries(Data($0)) }
        // A deflate stream that claims to expand enormously must stop, not fill memory.
        let bomb = [UInt8](repeating: 0, count: 2000)
        _ = try? Gzip.decompress(Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff] + bomb))
    }

    func testContainerSniffingNeverCrashes() {
        for head in [[0x1A, 0x45, 0xDF, 0xA3], Array("RIFF....AVI LIST".utf8), [0, 0, 0, 0x18] + Array("ftypisom".utf8), Array("#EXTM3U\n".utf8), [0x47] + [UInt8](repeating: 0, count: 187) + [0x47]] as [[UInt8]] {
            mutate(head, "sniff", seedValue: 25) { _ = ContainerDetector.sniff($0) }
        }
        _ = ContainerDetector.sniff([])
    }

    func testBitmapSubtitlesNeverCrash() {
        let idx = Array("size: 720x480\npalette: 000000, ffffff, ff0000, 00ff00, 0000ff, 111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888, 999999, aaaaaa, bbbbbb".utf8)
        mutate(idx, "vobsub idx", seedValue: 26, count: 200) { bytes in
            let decoder = VobSubDecoder(codecPrivate: bytes, videoWidth: 720, videoHeight: 480)
            XCTAssertEqual(decoder.palette.count, 16)
            if let cue = decoder.decode(VobSubTests.packet(), at: 1) { for o in cue.objects { _ = cue.rgba(for: o) } }
        }
        let decoder = VobSubDecoder(codecPrivate: idx, videoWidth: 720, videoHeight: 480)
        mutate(VobSubTests.packet(), "vobsub", seedValue: 27, count: 600) { bytes in
            if let cue = decoder.decode(bytes, at: 1) { for o in cue.objects { _ = cue.rgba(for: o) } }
        }
        mutate(PGSTests.showSet, "pgs", seedValue: 28, count: 800) { bytes in
            var pgs = PGSDecoder()
            if let cue = pgs.decode(bytes, at: 1) { for o in cue.objects { _ = cue.rgba(for: o) } }
            // A second, unrelated display set after a corrupt one must still decode: no state is poisoned.
            if let cue = pgs.decode(PGSTests.showSet, at: 2) { XCTAssertEqual(cue.objects.count, 1) }
        }
    }

    func testDolbyVisionRPUNeverCrashes() {
        let rpu = DolbyVisionRPUTests.profile7RPU
        XCTAssertNotNil(DolbyVisionRPU.parse(nal: rpu))
        mutate(rpu, "rpu", seedValue: 29, count: 1500) { bytes in
            if let parsed = DolbyVisionRPU.parse(nal: bytes) { _ = parsed.write() }
            if let converted = DolbyVisionRPU.convertToProfile81(nal: bytes) { XCTAssertNotNil(DolbyVisionRPU.parse(nal: converted), "what conversion returns parses") }
        }
        // Whole samples: length-prefixed NAL units with hostile lengths.
        func prefixed(_ nal: [UInt8]) -> [UInt8] { withUnsafeBytes(of: UInt32(nal.count).bigEndian, Array.init) + nal }
        let sample = prefixed([0x02, 0x01, 0xAA, 0xBB]) + prefixed(rpu)
        for lengthSize in [1, 2, 3, 4] {
            mutate(sample, "rpu sample \(lengthSize)", seedValue: 30 + UInt64(lengthSize), count: 300) { _ = DolbyVisionRPU.profile81Sample($0, lengthSize: lengthSize) }
        }
        for lengthSize in [0, 5, -1, 9] { _ = DolbyVisionRPU.profile81Sample(sample, lengthSize: lengthSize) }
    }

    func testAudioConfigurationNeverCrashes() {
        let opusHead = OpusHead.make(channels: 2, preSkip: 312, inputRate: 48000)!
        mutate(opusHead, "opus head", seedValue: 40) { bytes in
            _ = OpusHead.parse(bytes)
            _ = AudioDecoderSetup.resolve(codecID: "A_OPUS", codecPrivate: bytes, sampleRate: 48000, channels: 2, codecDelay: 6_500_000, seekPreRoll: 80_000_000)
        }
        let vorbis: [UInt8] = [2, 30, 40] + [1] + Array("vorbis".utf8) + [0, 0, 0, 0, 2, 0x80, 0xBB, 0, 0] + [UInt8](repeating: 0, count: 80)
        mutate(vorbis, "vorbis id", seedValue: 41) { bytes in _ = AudioDecoderSetup.resolve(codecID: "A_VORBIS", codecPrivate: bytes, sampleRate: 48000, channels: 2) }
        let wave: [UInt8] = [1, 0, 2, 0, 0x80, 0xBB, 0, 0, 0, 0xEE, 2, 0, 4, 0, 16, 0, 0, 0]
        mutate(wave, "wave format", seedValue: 42) { bytes in
            _ = WaveFormat.parse(bytes)
            _ = AudioDecoderSetup.resolve(codecID: "A_MS/ACM", codecPrivate: bytes, sampleRate: 48000, channels: 2)
        }
        let alac = [UInt8](repeating: 0, count: 9) + [2] + [UInt8](repeating: 0, count: 10) + [0, 0, 0xBB, 0x80]
        mutate(alac, "alac cookie", seedValue: 43) { bytes in _ = AudioDecoderSetup.resolve(codecID: "A_ALAC", codecPrivate: bytes, sampleRate: 48000, channels: 2) }
        // Every supported codec with junk configuration and absurd numbers.
        for id in AudioDecoderSetup.codecIDs {
            for (rate, channels, depth) in [(0, 0, 0), (-1, -1, -1), (Int.max, Int.max, Int.max), (48000, 2, 16), (48000, 200, 64)] {
                for priv in [[], [0xFF], [UInt8](repeating: 0xFF, count: 64)] as [[UInt8]] {
                    _ = AudioDecoderSetup.resolve(codecID: id, codecPrivate: priv, sampleRate: rate, channels: channels, bitDepth: depth, codecDelay: Int64.max, seekPreRoll: Int64.min)
                }
            }
        }
    }
}
