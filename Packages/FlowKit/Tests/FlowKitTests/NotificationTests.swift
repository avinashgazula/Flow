import XCTest
@testable import FlowKit

final class NotificationPlannerTests: XCTestCase {
    var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    var newYork: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/New_York")!
        return c
    }

    func date(_ iso: String) -> Date { FlowDate.parse(iso)! }

    func episode(show: Int = 1, season: Int = 2, number: Int = 5, title: String = "The Door", air: String?) -> Episode {
        Episode(showTMDB: show, season: season, number: number, title: title, airDate: air.map(date))
    }

    // MARK: Tab order

    func testTabOrderAppendsMissingAndDropsRepeats() {
        XCTAssertEqual(AppTab.ordered([.search, .home, .search]), [.search, .home, .explore, .library, .liveTV])
        XCTAssertEqual(AppTab.ordered([]), AppTab.allCases)
        var general = GeneralSettings()
        general.tabOrder = [.library]
        XCTAssertEqual(general.orderedTabs.first, .library)
        XCTAssertEqual(Set(general.orderedTabs), Set(AppTab.allCases))
    }

    // MARK: Episodes

    func testEpisodeWithOnlyADayFiresAtNineLocal() {
        let fire = NotificationPlanner.episodeFireDate(airDate: date("2026-11-03"), calendar: newYork)
        var parts = newYork.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
        XCTAssertEqual(parts.day, 3)
        XCTAssertEqual(parts.hour, 9)
        XCTAssertEqual(parts.minute, 0)
        parts = utc.dateComponents([.day, .hour], from: NotificationPlanner.episodeFireDate(airDate: date("2026-11-03"), calendar: utc))
        XCTAssertEqual(parts.hour, 9)
    }

    func testEpisodeWithATimeFiresThen() {
        let air = date("2026-11-03T02:00:00Z")
        XCTAssertEqual(NotificationPlanner.episodeFireDate(airDate: air, calendar: newYork), air)
    }

    func testEpisodeNotificationContent() throws {
        let now = date("2026-11-01T12:00:00Z")
        let plan = NotificationPlanner.episodes([EpisodeAlertSource(showName: "Severance", episode: episode(air: "2026-11-03"))], now: now, calendar: utc)
        let item = try XCTUnwrap(plan.first)
        XCTAssertEqual(item.title, "New episode of Severance")
        XCTAssertEqual(item.body, "S02E05 · The Door is out now.")
        XCTAssertEqual(item.id, "flow.episode.1.S02E05")
        XCTAssertEqual(item.fireDate, date("2026-11-03T09:00:00Z"))
    }

    func testEpisodesSkipPastUndatedAndRepeated() {
        let now = date("2026-11-03T10:00:00Z")
        let sources = [
            EpisodeAlertSource(showName: "A", episode: episode(show: 1, air: "2026-11-03")),   // 9:00 has passed
            EpisodeAlertSource(showName: "B", episode: episode(show: 2, air: nil)),
            EpisodeAlertSource(showName: "C", episode: episode(show: 3, air: "2026-11-10")),
            EpisodeAlertSource(showName: "C", episode: episode(show: 3, air: "2026-11-10")),
        ]
        let plan = NotificationPlanner.episodes(sources, now: now, calendar: utc)
        XCTAssertEqual(plan.map(\.id), ["flow.episode.3.S02E05"])
    }

    // MARK: Matches

    func event(_ id: String, home: String = "Arsenal", away: String = "Chelsea", at: String?, score: (Int, Int)? = nil, league: String? = "Premier League") -> SportsEvent {
        SportsEvent(id: id, title: "\(home) vs \(away)", homeTeam: home, awayTeam: away, league: league, venue: nil, date: at.map(date), homeScore: score?.0, awayScore: score?.1, thumbnailURL: nil)
    }

    func testMatchStartIsTenMinutesBefore() throws {
        let now = date("2026-11-01T12:00:00Z")
        let plan = NotificationPlanner.matchStarts([event("9", at: "2026-11-02T15:00:00Z")], now: now)
        let item = try XCTUnwrap(plan.first)
        XCTAssertEqual(item.fireDate, date("2026-11-02T14:50:00Z"))
        XCTAssertEqual(item.id, "flow.matchStart.9")
        XCTAssertEqual(item.title, "Arsenal vs Chelsea")
        XCTAssertEqual(item.body, "Starts in 10 minutes · Premier League")
    }

    func testMatchStartSkipsStartedFinishedUndatedAndDuplicates() {
        let now = date("2026-11-02T14:55:00Z")
        let events = [
            event("1", at: "2026-11-02T15:00:00Z"),                   // alert time already passed
            event("2", at: nil),
            event("3", at: "2026-11-02T10:00:00Z", score: (1, 0)),
            event("4", at: "2026-11-03T15:00:00Z"),
            event("4", at: "2026-11-03T15:00:00Z"),
        ]
        XCTAssertEqual(NotificationPlanner.matchStarts(events, now: now).map(\.id), ["flow.matchStart.4"])
    }

    func testResultAnnouncesRecentFinishedOnceOnly() throws {
        let now = date("2026-11-02T18:00:00Z")
        let finished = event("7", at: "2026-11-02T15:00:00Z", score: (2, 1))
        let first = NotificationPlanner.results([finished], alreadyNotified: [], now: now)
        let item = try XCTUnwrap(first.notifications.first)
        XCTAssertEqual(item.title, "Arsenal 2–1 Chelsea")
        XCTAssertNil(item.fireDate)
        XCTAssertEqual(first.newIDs, ["7"])

        let second = NotificationPlanner.results([finished], alreadyNotified: Set(first.newIDs), now: now)
        XCTAssertTrue(second.notifications.isEmpty)
        XCTAssertTrue(second.newIDs.isEmpty)
    }

    func testResultIgnoresOldAndUnfinished() {
        let now = date("2026-11-05T18:00:00Z")
        let events = [
            event("1", at: "2026-11-02T15:00:00Z", score: (2, 1)),    // days ago
            event("2", at: "2026-11-05T17:00:00Z"),                   // no score yet
        ]
        XCTAssertTrue(NotificationPlanner.results(events, alreadyNotified: [], now: now).notifications.isEmpty)
    }

    // MARK: Limits

    func testCapKeepsTheSoonestAndDropsImmediate() {
        let base = date("2026-11-01T00:00:00Z")
        var items = (0..<10).map { PlannedNotification(id: "n\($0)", kind: .episode, title: "", body: "", fireDate: base.addingTimeInterval(Double(10 - $0) * 60)) }
        items.append(PlannedNotification(id: "now", kind: .matchResult, title: "", body: "", fireDate: nil))
        let capped = NotificationPlanner.capped(items, limit: 3)
        XCTAssertEqual(capped.map(\.id), ["n9", "n8", "n7"])
    }

    func testTrimmedKeepsNewest() {
        XCTAssertEqual(NotificationPlanner.trimmed(["a", "b", "c"], keeping: 2), ["b", "c"])
    }
}

final class SportsChannelMatcherTests: XCTestCase {
    func date(_ iso: String) -> Date { FlowDate.parse(iso)! }

    func channel(_ id: String, _ name: String, number: Int? = nil, group: String = "Sports") -> Channel {
        Channel(id: id, providerID: "p", name: name, number: number, group: group, streamURL: URL(string: "http://x/\(id)")!, epgID: id)
    }

    func testRanksGuideEntriesNamingBothTeamsFirst() throws {
        let kickoff = date("2026-11-02T15:00:00Z")
        let event = SportsEvent(id: "1", title: "Arsenal vs Chelsea", homeTeam: "Arsenal", awayTeam: "Chelsea", league: "English Premier League", venue: nil, date: kickoff, homeScore: nil, awayScore: nil, thumbnailURL: nil)
        let channels = [channel("a", "Sports One", number: 1), channel("b", "Sports Two", number: 2), channel("c", "News", number: 3), channel("d", "Sky English Premier League", number: 4)]
        let epg = EPG(programmes: [
            "a": [Programme(channelID: "a", title: "Arsenal v Chelsea", start: kickoff, end: kickoff.addingTimeInterval(7200))],
            "b": [Programme(channelID: "b", title: "Chelsea Weekly", start: kickoff, end: kickoff.addingTimeInterval(1800))],
            "c": [Programme(channelID: "c", title: "Evening News", start: kickoff, end: kickoff.addingTimeInterval(1800))],
        ])
        let matches = SportsChannelMatcher.matches(for: event, channels: channels, epg: epg, now: kickoff)
        XCTAssertEqual(matches.map(\.channel.id), ["a", "b", "d"])
        XCTAssertEqual(matches.first?.programme?.title, "Arsenal v Chelsea")
    }

    func testProgrammesOutsideTheGameWindowDontMatch() {
        let kickoff = date("2026-11-02T15:00:00Z")
        let event = SportsEvent(id: "1", title: "", homeTeam: "Arsenal", awayTeam: "Chelsea", league: nil, venue: nil, date: kickoff, homeScore: nil, awayScore: nil, thumbnailURL: nil)
        let epg = EPG(programmes: ["a": [Programme(channelID: "a", title: "Arsenal v Chelsea replay", start: kickoff.addingTimeInterval(86400), end: kickoff.addingTimeInterval(93600))]])
        XCTAssertTrue(SportsChannelMatcher.matches(for: event, channels: [channel("a", "Sports One")], epg: epg, now: kickoff).isEmpty)
    }

    func testClubPrefixesAndAccentsAreIgnored() {
        XCTAssertEqual(SportsChannelMatcher.normalised("FC Barcelona"), SportsChannelMatcher.normalised("Barcelona"))
        XCTAssertEqual(SportsChannelMatcher.normalised("Atlético Madrid"), "atletico madrid")
    }
}
