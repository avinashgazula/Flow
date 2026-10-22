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
        XCTAssertEqual(Programme.minutesLeft(progress: progress, runtimeMinutes: 47), 18)
    }

    func testMinutesLeftFallsBackToPercentThenRuntime() {
        let byPercent = PlaybackProgress(key: key, percent: 50)
        XCTAssertEqual(Programme.minutesLeft(progress: byPercent, runtimeMinutes: 100), 50)
        XCTAssertEqual(Programme.minutesLeft(progress: nil, runtimeMinutes: 167), 167)
        XCTAssertNil(Programme.minutesLeft(progress: nil, runtimeMinutes: nil))
        XCTAssertNil(Programme.minutesLeft(progress: nil, runtimeMinutes: 0))
    }

    func testMinutesLeftIsNeverBelowOne() {
        let nearlyDone = PlaybackProgress(key: key, percent: 99.9, positionSeconds: 2999, durationSeconds: 3000)
        XCTAssertEqual(Programme.minutesLeft(progress: nearlyDone, runtimeMinutes: 50), 1)
    }

    func testEndDateAddsTheMinutes() {
        let now = date("2026-10-22T21:00:00Z")
        XCTAssertEqual(Programme.endDate(from: now, minutesLeft: 48), date("2026-10-22T21:48:00Z"))
    }

    func testDurationWords() {
        XCTAssertEqual(Programme.duration(minutes: 47), "47 min")
        XCTAssertEqual(Programme.duration(minutes: 120), "2 h")
        XCTAssertEqual(Programme.duration(minutes: 167), "2 h 47 min")
        XCTAssertEqual(Programme.left(minutes: 18), "18 min left")
        XCTAssertEqual(Programme.left(minutes: 104), "1 h 44 min left")
    }

    func testSpokenDuration() {
        XCTAssertEqual(Programme.spokenLeft(minutes: 1), "1 minute left")
        XCTAssertEqual(Programme.spokenLeft(minutes: 18), "18 minutes left")
        XCTAssertEqual(Programme.spokenLeft(minutes: 60), "1 hour left")
        XCTAssertEqual(Programme.spokenLeft(minutes: 104), "1 hour 44 minutes left")
        XCTAssertEqual(Programme.spokenLeft(minutes: 121), "2 hours 1 minute left")
    }

    func testClockFollowsTheLocale() {
        XCTAssertEqual(Programme.clock(date("2026-10-22T21:48:00Z"), locale: gb, timeZone: utc), "21:48")
        XCTAssertEqual(Programme.clock(date("2026-10-22T09:05:00Z"), locale: gb, timeZone: utc), "09:05")
    }

    func testAirColumnSaysAirsOrAired() {
        let now = date("2026-10-22T12:00:00Z")
        let upcoming = Programme.airColumn(for: date("2026-10-27T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(upcoming.label, "airs")
        XCTAssertTrue(upcoming.day.contains("27"), upcoming.day)
        let today = Programme.airColumn(for: date("2026-10-22T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(today.label, "airs")
        let past = Programme.airColumn(for: date("2026-10-20T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(past.label, "aired")
    }

    func testAirColumnWritesTheDateAndYearForFarOffDays() {
        let now = date("2026-10-22T12:00:00Z")
        let old = Programme.airColumn(for: date("2011-10-12T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(old.label, "aired 2011")
        XCTAssertTrue(old.day.contains("12"), old.day)
        XCTAssertTrue(old.day.contains("Oct"), old.day)
        let sameYear = Programme.airColumn(for: date("2026-03-01T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(sameYear.label, "aired")
        let later = Programme.airColumn(for: date("2027-01-05T00:00:00Z"), now: now, locale: gb)
        XCTAssertEqual(later.label, "airs 2027")
    }

    func testDayPartNamesTheGreeting() {
        XCTAssertEqual(Programme.DayPart(hour: 4).title, "Tonight")
        XCTAssertEqual(Programme.DayPart(hour: 5).title, "This Morning")
        XCTAssertEqual(Programme.DayPart(hour: 11).title, "This Morning")
        XCTAssertEqual(Programme.DayPart(hour: 12).title, "This Afternoon")
        XCTAssertEqual(Programme.DayPart(hour: 16).title, "This Afternoon")
        XCTAssertEqual(Programme.DayPart(hour: 17).title, "Tonight")
        XCTAssertEqual(Programme.DayPart(hour: 23).title, "Tonight")
    }

    func testDateLineHasTheDayAndMonth() {
        let line = Programme.dateLine(date("2026-10-22T12:00:00Z"), locale: gb, timeZone: utc)
        XCTAssertTrue(line.contains("22"), line)
        XCTAssertTrue(line.contains("October"), line)
        XCTAssertTrue(line.contains("Thursday"), line)
    }

    func testVersionLineIsPlainText() {
        XCTAssertEqual(Programme.versionLine(resolution: .uhd4k, hdr: ["DV"], audioCodec: "TrueHD", audioChannels: "7.1", sizeBytes: 19_541_000_000),
                       "2160p · Dolby Vision · TrueHD 7.1 · 18.20 GB")
        XCTAssertEqual(Programme.versionLine(resolution: .hd1080, hdr: ["HDR10+"]), "1080p · HDR10+")
        XCTAssertEqual(Programme.versionLine(), "")
        XCTAssertEqual(Programme.versionLine(audioCodec: "AAC"), "AAC")
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
        let note = Programme.versionNote(for: traits, decodesAV1: false, convertsLosslessAudio: true)
        XCTAssertEqual(note?.isWarning, true)
        XCTAssertNil(Programme.versionNote(for: traits, decodesAV1: true, convertsLosslessAudio: false))
    }

    func testVersionNoteSaysWhenAudioIsConverted() {
        var traits = StreamTraits()
        traits.videoCodec = "HEVC"
        traits.audioCodec = "TrueHD Atmos"
        XCTAssertEqual(Programme.versionNote(for: traits, decodesAV1: true, convertsLosslessAudio: true)?.isWarning, false)
        XCTAssertNil(Programme.versionNote(for: traits, decodesAV1: true, convertsLosslessAudio: false))
        traits.audioCodec = "AAC"
        XCTAssertNil(Programme.versionNote(for: traits, decodesAV1: true, convertsLosslessAudio: true))
    }

    func testSpokenDurationHasNoLeft() {
        XCTAssertEqual(Programme.spokenDuration(minutes: 104), "1 hour 44 minutes")
        XCTAssertEqual(Programme.spokenDuration(minutes: 0), "0 minutes")
    }

    func testSpokenListingReadsNaturally() {
        let ends = date("2026-10-22T21:48:00Z")
        let text = Programme.spokenListing(title: "Breaking Bad", episode: EpisodeRef(season: 3, episode: 7), minutesLeft: 18, endsAt: ends,
                                           locale: gb, timeZone: utc)
        XCTAssertEqual(text, "Breaking Bad, season 3 episode 7, 18 minutes left, ends 21:48")
        XCTAssertEqual(Programme.spokenListing(title: "Dune"), "Dune")
    }
}
