import XCTest
@testable import FlowKit

final class ProgrammeTests: XCTestCase {
    private let key = MediaKey(type: .movie, tmdbID: 1)
    private let gb = Locale(identifier: "en_GB")
    private let utc = TimeZone(identifier: "UTC")!

    private func date(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)!
    }

    func testMinutesLeftPrefersTheResumePoint() {
        let progress = PlaybackProgress(key: key, percent: 62, positionSeconds: 1750, durationSeconds: 2820)
        // 1070 seconds are left: 17.8 minutes rounds up to 18.
        XCTAssertEqual(Reel.minutesLeft(progress: progress, runtimeMinutes: 47), 18)
    }

    func testMinutesLeftFallsBackToPercentThenRuntime() {
        let byPercent = PlaybackProgress(key: key, percent: 50)
        XCTAssertEqual(Reel.minutesLeft(progress: byPercent, runtimeMinutes: 100), 50)
        XCTAssertEqual(Reel.minutesLeft(progress: nil, runtimeMinutes: 167), 167)
        XCTAssertNil(Reel.minutesLeft(progress: nil, runtimeMinutes: nil))
        XCTAssertNil(Reel.minutesLeft(progress: nil, runtimeMinutes: 0))
    }

    func testMinutesLeftIsNeverBelowOne() {
        let nearlyDone = PlaybackProgress(key: key, percent: 99.9, positionSeconds: 2999, durationSeconds: 3000)
        XCTAssertEqual(Reel.minutesLeft(progress: nearlyDone, runtimeMinutes: 50), 1)
    }

    func testEndDateAddsTheMinutes() {
        let now = date("2026-10-22T21:00:00Z")
        XCTAssertEqual(Reel.endDate(from: now, minutesLeft: 48), date("2026-10-22T21:48:00Z"))
    }

    func testDurationWords() {
        XCTAssertEqual(Reel.duration(minutes: 47), "47 min")
        XCTAssertEqual(Reel.duration(minutes: 120), "2 h")
        XCTAssertEqual(Reel.duration(minutes: 167), "2 h 47 min")
        XCTAssertEqual(Reel.left(minutes: 18), "18 min left")
        XCTAssertEqual(Reel.left(minutes: 104), "1 h 44 min left")
    }

    func testCompactFormsForEdgePrint() {
        XCTAssertEqual(Reel.compactDuration(minutes: 47), "47m")
        XCTAssertEqual(Reel.compactDuration(minutes: 120), "2h")
        XCTAssertEqual(Reel.compactDuration(minutes: 167), "2h47")
        XCTAssertEqual(Reel.compactDuration(minutes: 121), "2h01")
        XCTAssertEqual(Reel.compactLeft(minutes: 104), "1h44 left")
        XCTAssertEqual(Reel.compactLeft(minutes: 18), "18m left")
    }

    func testSpokenDuration() {
        XCTAssertEqual(Reel.spokenLeft(minutes: 1), "1 minute left")
        XCTAssertEqual(Reel.spokenLeft(minutes: 18), "18 minutes left")
        XCTAssertEqual(Reel.spokenLeft(minutes: 60), "1 hour left")
        XCTAssertEqual(Reel.spokenLeft(minutes: 104), "1 hour 44 minutes left")
        XCTAssertEqual(Reel.spokenLeft(minutes: 121), "2 hours 1 minute left")
    }

    func testClockFollowsTheLocale() {
        XCTAssertEqual(Reel.clock(date("2026-10-22T21:48:00Z"), locale: gb, timeZone: utc), "21:48")
        XCTAssertEqual(Reel.clock(date("2026-10-22T09:05:00Z"), locale: gb, timeZone: utc), "09:05")
    }

    func testAirColumnSaysAirsOrAired() {
        let now = date("2026-10-22T12:00:00Z")
        let upcoming = Reel.airColumn(for: date("2026-10-27T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(upcoming.label, "airs")
        XCTAssertTrue(upcoming.day.contains("27"), upcoming.day)
        let today = Reel.airColumn(for: date("2026-10-22T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(today.label, "airs")
        let past = Reel.airColumn(for: date("2026-10-20T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(past.label, "aired")
    }

    func testAirColumnWritesTheDateAndYearForFarOffDays() {
        let now = date("2026-10-22T12:00:00Z")
        let old = Reel.airColumn(for: date("2011-10-12T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(old.label, "aired 2011")
        XCTAssertTrue(old.day.contains("12"), old.day)
        XCTAssertTrue(old.day.contains("Oct"), old.day)
        let sameYear = Reel.airColumn(for: date("2026-03-01T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(sameYear.label, "aired")
        let later = Reel.airColumn(for: date("2027-01-05T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(later.label, "airs 2027")
    }

    func testAirPrintReadsAsOneLine() {
        let now = date("2026-10-22T12:00:00Z")
        XCTAssertTrue(Reel.airPrint(for: date("2026-10-27T00:00:00Z"), now: now, locale: gb).hasPrefix("airs "))
        let old = Reel.airPrint(for: date("2011-10-12T00:00:00Z"), now: now, locale: gb)
        XCTAssertTrue(old.hasPrefix("aired "), old)
        XCTAssertTrue(old.hasSuffix("2011"), old)
    }

    func testDayPartNamesTheGreeting() {
        XCTAssertEqual(Reel.DayPart(hour: 4).title, "Tonight")
        XCTAssertEqual(Reel.DayPart(hour: 5).title, "This Morning")
        XCTAssertEqual(Reel.DayPart(hour: 11).title, "This Morning")
        XCTAssertEqual(Reel.DayPart(hour: 12).title, "This Afternoon")
        XCTAssertEqual(Reel.DayPart(hour: 16).title, "This Afternoon")
        XCTAssertEqual(Reel.DayPart(hour: 17).title, "Tonight")
        XCTAssertEqual(Reel.DayPart(hour: 23).title, "Tonight")
    }

    func testDateLineHasTheDayAndMonth() {
        let line = Reel.dateLine(date("2026-10-22T12:00:00Z"), locale: gb, timeZone: utc)
        XCTAssertTrue(line.contains("22"), line)
        XCTAssertTrue(line.contains("October"), line)
        XCTAssertTrue(line.contains("Thursday"), line)
    }

    func testVersionLineIsPlainText() {
        XCTAssertEqual(Reel.versionLine(resolution: .uhd4k, hdr: ["DV"], audioCodec: "TrueHD", audioChannels: "7.1", sizeBytes: 19_541_000_000),
                       "2160p · Dolby Vision · TrueHD 7.1 · 18.20 GB")
        XCTAssertEqual(Reel.versionLine(resolution: .hd1080, hdr: ["HDR10+"]), "1080p · HDR10+")
        XCTAssertEqual(Reel.versionLine(), "")
        XCTAssertEqual(Reel.versionLine(audioCodec: "AAC"), "AAC")
    }

    func testTraitsAndLastSourceWriteTheSameLine() {
        var traits = StreamTraits()
        traits.resolution = .uhd4k
        traits.hdr = ["DV"]
        traits.audioCodec = "Atmos"
        traits.sizeBytes = 1_073_741_824
        XCTAssertEqual(traits.versionLine(), "2160p · Dolby Vision · Atmos")
        XCTAssertEqual(traits.versionLine(includeSize: true), "2160p · Dolby Vision · Atmos · 1.00 GB")
    }

    func testVersionNoteWarnsAboutAV1WithoutADecoder() {
        var traits = StreamTraits()
        traits.videoCodec = "AV1"
        let note = Reel.versionNote(for: traits, decodesAV1: false, convertsLosslessAudio: true)
        XCTAssertEqual(note?.isWarning, true)
        XCTAssertNil(Reel.versionNote(for: traits, decodesAV1: true, convertsLosslessAudio: false))
    }

    func testVersionNoteSaysWhenAudioIsConverted() {
        var traits = StreamTraits()
        traits.videoCodec = "HEVC"
        traits.audioCodec = "TrueHD Atmos"
        XCTAssertEqual(Reel.versionNote(for: traits, decodesAV1: true, convertsLosslessAudio: true)?.isWarning, false)
        XCTAssertNil(Reel.versionNote(for: traits, decodesAV1: true, convertsLosslessAudio: false))
        traits.audioCodec = "AAC"
        XCTAssertNil(Reel.versionNote(for: traits, decodesAV1: true, convertsLosslessAudio: true))
    }

    func testEdgePrintOrdersTheFactsAndKeepsTheKeyOne() {
        let print = EdgePrint(progress: 0.6, lead: ["S3 E7"], key: "18 min left", endsInMinutes: 48, tail: ["2160p", "DV"])
        let now = date("2026-10-22T20:42:00Z")
        let segments = print.segments(now: now, locale: gb, timeZone: utc)
        XCTAssertEqual(segments.map(\.text), ["S3 E7", "18 min left", "ends 21:30", "2160p", "DV"])
        XCTAssertEqual(segments.filter(\.isKey).map(\.text), ["18 min left"])
    }

    func testEdgePrintLeavesOutWhatIsMissing() {
        let print = EdgePrint(lead: ["", "2024"], key: nil, endsInMinutes: nil, tail: [""])
        XCTAssertEqual(print.segments().map(\.text), ["2024"])
    }

    func testPerforationsFillWithProgress() {
        XCTAssertEqual(EdgePrint.filledPerforations(progress: 0, of: 14), 0)
        XCTAssertEqual(EdgePrint.filledPerforations(progress: 0.01, of: 14), 1)
        XCTAssertEqual(EdgePrint.filledPerforations(progress: 0.5, of: 14), 7)
        XCTAssertEqual(EdgePrint.filledPerforations(progress: 1, of: 14), 14)
        XCTAssertEqual(EdgePrint.filledPerforations(progress: 2, of: 14), 14)
        XCTAssertEqual(EdgePrint.filledPerforations(progress: 0.5, of: 0), 0)
    }

    func testEdgeFormatKeepsBadgesShort() {
        XCTAssertEqual(Reel.edgeFormat(resolution: .uhd4k, hdr: ["DV"], audioCodec: "TrueHD", audioChannels: "7.1"), ["2160p", "DV", "TrueHD 7.1"])
        XCTAssertEqual(Reel.edgeFormat(), [])
    }

    func testSpokenDurationHasNoLeft() {
        XCTAssertEqual(Reel.spokenDuration(minutes: 104), "1 hour 44 minutes")
        XCTAssertEqual(Reel.spokenDuration(minutes: 0), "0 minutes")
    }

    func testSpokenListingReadsNaturally() {
        let ends = date("2026-10-22T21:48:00Z")
        let text = Reel.spokenListing(title: "Breaking Bad", episode: EpisodeRef(season: 3, episode: 7), minutesLeft: 18, endsAt: ends,
                                           locale: gb, timeZone: utc)
        XCTAssertEqual(text, "Breaking Bad, season 3 episode 7, 18 minutes left, ends 21:48")
        XCTAssertEqual(Reel.spokenListing(title: "Dune"), "Dune")
    }
}
