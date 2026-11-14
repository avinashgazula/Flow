import XCTest
@testable import FlowKit

/// Encode, then decode with something that isn't ours, and compare. Where no outside decoder exists,
/// a pair of our own functions must give back what went in, over seeded random inputs.
final class RoundTripTests: XCTestCase {
    // MARK: FLAC against ffmpeg

    /// The encoder's output is a real FLAC file: ffmpeg decodes it to exactly the samples that went in.
    func testFLACEncoderOutputDecodesBitExactlyInFFmpeg() throws {
        guard RemuxFFprobeTests.tool("ffmpeg") != nil else {
            if ProcessInfo.processInfo.environment["FLOWKIT_REQUIRE_FFPROBE"] == "1" { XCTFail("ffmpeg is required but isn't installed") }
            throw XCTSkip("ffmpeg isn't installed")
        }
        var rng = SeededRandom(seed: 2024)
        for (channels, rate, frames) in [(1, 44100, 4096 + 17), (2, 48000, 4096 * 2), (6, 48000, 4096 * 3 + 1000), (8, 96000, 5000)] {
            var pcm = FLACEncoderTests.testSignal(frames: frames, channels: channels)
            // Full-scale extremes and seeded noise, where a predictor or Rice parameter is most likely to overflow.
            for i in stride(from: 0, to: pcm.count, by: 97) { pcm[i] = i % 2 == 0 ? 8_388_607 : -8_388_608 }
            for i in stride(from: 5, to: min(pcm.count, 5000), by: 3) { pcm[i] = Int32.random(in: -8_388_608...8_388_607, using: &rng) }

            var encoder = FLACEncoder(sampleRate: rate, channels: channels, bitsPerSample: 24)
            var file = Array("fLaC".utf8) + encoder.dfLa
            pcm.withUnsafeBufferPointer { buffer in
                var offset = 0
                while offset < frames {
                    let count = min(FLACEncoder.blockSize, frames - offset)
                    file += encoder.encodeFrame(UnsafeBufferPointer(rebasing: buffer[(offset * channels)..<((offset + count) * channels)]), count: count)
                    offset += count
                }
            }
            let directory = try RemuxFFprobeTests.tempDirectory("flac")
            defer { try? FileManager.default.removeItem(at: directory) }
            let input = directory.appendingPathComponent("in.flac")
            try Data(file).write(to: input)
            let run = try RemuxFFprobeTests.run("ffmpeg", ["-v", "error", "-xerror", "-i", input.path, "-f", "s32le", "-acodec", "pcm_s32le", "-"])
            XCTAssertEqual(run.status, 0, "\(channels) ch \(rate) Hz: \(run.err)")
            XCTAssertEqual(run.err, "", "\(channels) ch \(rate) Hz: decoder complaints")
            var decoded = [Int32](repeating: 0, count: run.out.count / 4)
            _ = decoded.withUnsafeMutableBytes { run.out.copyBytes(to: $0) }
            XCTAssertEqual(decoded.count, pcm.count, "\(channels) ch: every sample comes back")
            // ffmpeg widens 24-bit to 32-bit by shifting left eight bits.
            XCTAssertEqual(decoded.map { $0 >> 8 }, pcm, "\(channels) ch \(rate) Hz: bit-exact")
        }
    }

    // MARK: Encodings with a decoder of our own

    func testBase64URLRoundTripsAnyBytes() {
        var rng = SeededRandom(seed: 7)
        for length in [0, 1, 2, 3, 4, 5, 31, 32, 33, 255, 1000] {
            let data = Data((0..<length).map { _ in UInt8.random(in: 0...255, using: &rng) })
            let text = SetupShare.base64URL(data)
            XCTAssertFalse(text.contains("+") || text.contains("/") || text.contains("="), "URL-safe and unpadded: \(text)")
            XCTAssertEqual(SetupShare.decodeBase64URL(text), data, "\(length) bytes")
        }
    }

    func testSyncKeyTextRoundTripsAndToleratesTyping() throws {
        var rng = SeededRandom(seed: 8)
        for _ in 0..<200 {
            let key = try XCTUnwrap(FlowSyncKey(bytes: Data((0..<16).map { _ in UInt8.random(in: 0...255, using: &rng) })))
            XCTAssertEqual(key.text.count, FlowSyncKey.textLength)
            XCTAssertEqual(try FlowSyncKey.parse(key.text), key)
            XCTAssertEqual(try FlowSyncKey.parse(key.text.lowercased()), key, "case doesn't matter")
            XCTAssertEqual(try FlowSyncKey.parse(key.grouped), key, "groups of four with dashes are read back")
        }
    }

    func testSyncLinksRoundTripAwkwardTokensAndServers() throws {
        var rng = SeededRandom(seed: 9)
        let key = FlowSyncKey(bytes: Data((0..<16).map { UInt8($0 * 7) }))!.text
        let alphabet = Array("abcXYZ019 &=?/+%#é✓-_.~")
        for _ in 0..<100 {
            let token = String((0..<Int.random(in: 1...40, using: &rng)).map { _ in alphabet[Int.random(in: 0..<alphabet.count, using: &rng)] })
            let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
            let pairing = try FlowSyncPairing(key: key, server: "https://flow-stream-proxy.example.workers.dev", token: token)
            for link in [FlowSyncLink.appLink(pairing), FlowSyncLink.webLink(pairing, site: "https://marquee.example.com/")] {
                let back = try FlowSyncLink.parse(link)
                XCTAssertEqual(back.token, trimmed, "token \(token.debugDescription) in \(link)")
                XCTAssertEqual(back.server, pairing.server)
                XCTAssertEqual(back.keyText, pairing.keyText)
            }
        }
    }

    func testAccountJSONCanonicalFormIsStable() {
        var rng = SeededRandom(seed: 10)
        func randomValue(_ depth: Int) -> JSONValue {
            switch Int.random(in: 0..<(depth > 2 ? 4 : 6), using: &rng) {
            case 0: return .null
            case 1: return .bool(Bool.random(using: &rng))
            case 2: return .number(Double(Int.random(in: -1_000_000...1_000_000, using: &rng)))
            case 3: return .string(String((0..<Int.random(in: 0...8, using: &rng)).map { _ in Array("ab\"\\\n\té✓ ")[Int.random(in: 0..<9, using: &rng)] }))
            case 4: return .array((0..<Int.random(in: 0...4, using: &rng)).map { _ in randomValue(depth + 1) })
            default:
                var o: [String: JSONValue] = [:]
                for _ in 0..<Int.random(in: 0...4, using: &rng) { o[String((0..<3).map { _ in Array("kzay")[Int.random(in: 0..<4, using: &rng)] })] = randomValue(depth + 1) }
                return .object(o)
            }
        }
        for i in 0..<300 {
            let value = randomValue(0)
            let text = AccountWire.canonical(value)
            let reparsed = AccountWire.parse(text)
            XCTAssertEqual(reparsed, value, "case \(i): \(text)")
            XCTAssertEqual(reparsed.map(AccountWire.canonical), text, "canonical text is a fixed point")
        }
    }

    func testSetupBundleSurvivesTheLinkAndTheFile() throws {
        var settings = AppSettings()
        settings.account.tracker = .simkl
        var credentials = Credentials()
        credentials.tmdbAPIKey = "abc123"
        credentials.mdblistAPIKey = "mdb"
        let link = try SetupShare.exportLink(settings: settings, credentials: credentials, includeSecrets: true)
        let viaLink = try SetupShare.importBundle(Data(link.utf8))
        let viaFile = try SetupShare.importBundle(try SetupShare.export(settings: settings, credentials: credentials, includeSecrets: true))
        for bundle in [viaLink, viaFile] {
            XCTAssertEqual(bundle.settings.account.tracker, .simkl)
            XCTAssertEqual(bundle.credentials?.tmdbAPIKey, "abc123")
            XCTAssertEqual(bundle.credentials?.mdblistAPIKey, "mdb")
        }
        let withoutSecrets = try SetupShare.importBundle(try SetupShare.export(settings: settings, credentials: credentials, includeSecrets: false))
        XCTAssertNil(withoutSecrets.credentials, "secrets stay out unless asked for")
        XCTAssertEqual(withoutSecrets.settings.account.tracker, .simkl)
    }

    func testOpusHeadRoundTrips() throws {
        for (channels, preSkip, rate) in [(1, 0, 48000), (2, 312, 44100), (2, 65535, 8000)] {
            let head = try XCTUnwrap(OpusHead.make(channels: channels, preSkip: preSkip, inputRate: rate))
            let parsed = try XCTUnwrap(OpusHead.parse(head))
            XCTAssertEqual(parsed.channels, channels)
            XCTAssertEqual(parsed.preSkip, preSkip)
            XCTAssertEqual(parsed.inputRate, rate)
        }
        XCTAssertNil(OpusHead.make(channels: 6, preSkip: 312, inputRate: 48000), "surround needs a channel table, which a made header doesn't have")
        // A pre-skip that doesn't fit the header's two bytes used to trap.
        XCTAssertEqual(OpusHead.parse(try XCTUnwrap(OpusHead.make(channels: 2, preSkip: 1 << 20, inputRate: 48000)))?.preSkip, 65535)
        XCTAssertEqual(OpusHead.parse(try XCTUnwrap(OpusHead.make(channels: 2, preSkip: -4, inputRate: 48000)))?.preSkip, 0)
    }

    func testCalendarFilesAreWellFormed() throws {
        let events = [ICalendarEvent(uid: "a", title: "Dune, Part; Two\nreal \\ slash", day: "2026-10-27", notes: String(repeating: "long ", count: 40)),
                      ICalendarEvent(uid: "b", title: "Moment", start: Date(timeIntervalSince1970: 1_800_000_000)),
                      ICalendarEvent(uid: "c", title: "No date")]
        let text = ICalendar.build(events, now: Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertTrue(text.hasPrefix("BEGIN:VCALENDAR\r\n") && text.hasSuffix("END:VCALENDAR\r\n"))
        // Unfold (RFC 5545 section 3.1) and read the lines back the way a calendar app does.
        let lines = text.replacingOccurrences(of: "\r\n ", with: "").components(separatedBy: "\r\n").filter { !$0.isEmpty }
        for raw in text.components(separatedBy: "\r\n") { XCTAssertLessThanOrEqual(raw.utf8.count, 75, "folded to 75 octets: \(raw)") }
        XCTAssertEqual(lines.filter { $0 == "BEGIN:VEVENT" }.count, 2, "an event without a date is left out")
        XCTAssertEqual(lines.filter { $0 == "END:VEVENT" }.count, 2)
        XCTAssertTrue(lines.contains(#"SUMMARY:Dune\, Part\; Two\nreal \\ slash"#), "commas, semicolons, newlines and backslashes are escaped")
        XCTAssertTrue(lines.contains("DTSTART;VALUE=DATE:20261027"))
        XCTAssertTrue(lines.contains("DTEND;VALUE=DATE:20261028"), "an all-day event ends the next day")
        XCTAssertTrue(lines.contains("DTSTART:20270115T080000Z"))
        XCTAssertTrue(lines.contains("DTEND:20270115T090000Z"), "a moment lasts an hour")
        XCTAssertTrue(lines.contains { $0.hasPrefix("DESCRIPTION:long long") && $0.hasSuffix("long ") }, "folding loses nothing")
    }
}
