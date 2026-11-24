import XCTest
@testable import FlowKit

final class ScrobbleReporterTests: XCTestCase {
    private typealias Call = ScrobbleReporter.Call

    private func run(_ steps: [(ScrobbleReporter.Event, title: String, position: Double)], enabled: Bool = true, duration: Double = 1000) -> [[Call]] {
        var reporter = ScrobbleReporter()
        return steps.map { reporter.handle($0.0, title: $0.title, position: $0.position, duration: duration, enabled: enabled) }
    }

    func testPlayStartsWithThePercent() {
        XCTAssertEqual(run([(.played, "a", 250)]), [[Call(.start, title: "a", percent: 25)]])
    }

    func testSettingOffSendsNothingForAnyEvent() {
        let events: [ScrobbleReporter.Event] = [.played, .paused, .backgrounded(continues: false), .foregrounded(playing: true), .stopped(completed: true)]
        let out = run(events.map { ($0, "a", 500.0) }, enabled: false)
        XCTAssertTrue(out.allSatisfy(\.isEmpty))
    }

    func testTurningTheSettingOffMidPlayDropsTheOpenPlay() {
        var reporter = ScrobbleReporter()
        _ = reporter.handle(.played, title: "a", position: 0, duration: 100, enabled: true)
        XCTAssertEqual(reporter.handle(.paused, title: "a", position: 10, duration: 100, enabled: false), [])
        XCTAssertEqual(reporter.handle(.stopped(completed: false), title: "a", position: 20, duration: 100, enabled: true), [])
    }

    func testResumeAfterPauseStartsAgainAtTheCurrentPercent() {
        XCTAssertEqual(run([(.played, "a", 0), (.paused, "a", 100), (.played, "a", 100)]), [
            [Call(.start, title: "a", percent: 0)],
            [Call(.pause, title: "a", percent: 10)],
            [Call(.start, title: "a", percent: 10)],
        ])
    }

    func testPauseWhileAlreadyPausedOrBeforePlayingSendsNothing() {
        XCTAssertEqual(run([(.paused, "a", 5), (.played, "a", 0), (.paused, "a", 100), (.paused, "a", 100)]).map(\.count), [0, 1, 1, 0])
    }

    func testPlayWhileAlreadyPlayingSendsNothing() {
        XCTAssertEqual(run([(.played, "a", 0), (.played, "a", 50)]).map(\.count), [1, 0])
    }

    func testBackgroundWhilePlayingPausesAndForegroundStartsAgain() {
        XCTAssertEqual(run([(.played, "a", 300), (.backgrounded(continues: false), "a", 400), (.foregrounded(playing: true), "a", 400)]), [
            [Call(.start, title: "a", percent: 30)],
            [Call(.pause, title: "a", percent: 40)],
            [Call(.start, title: "a", percent: 40)],
        ])
    }

    func testBackgroundThatKeepsPlayingSendsNothing() {
        XCTAssertEqual(run([(.played, "a", 0), (.backgrounded(continues: true), "a", 10), (.foregrounded(playing: true), "a", 20)]).map(\.count), [1, 0, 0])
    }

    func testBackgroundAfterThePlayerAlreadyPausedDoesNotReportTwice() {
        XCTAssertEqual(run([(.played, "a", 0), (.paused, "a", 100), (.backgrounded(continues: false), "a", 100)]).map(\.count), [1, 1, 0])
    }

    func testForegroundWhilePausedSendsNothing() {
        XCTAssertEqual(run([(.played, "a", 0), (.backgrounded(continues: false), "a", 100), (.foregrounded(playing: false), "a", 100)]).map(\.count), [1, 1, 0])
    }

    func testForegroundWithNothingOpenSendsNothing() {
        XCTAssertEqual(run([(.foregrounded(playing: true), "a", 100)]), [[]])
    }

    func testStopAtTheEndIs100EvenFromAShortPlayhead() {
        XCTAssertEqual(run([(.played, "a", 0), (.stopped(completed: true), "a", 990)])[1], [Call(.stop, title: "a", percent: 100)])
    }

    func testClosingMidwayStopsWithTheRealPercent() {
        XCTAssertEqual(run([(.played, "a", 0), (.stopped(completed: false), "a", 421)])[1], [Call(.stop, title: "a", percent: 42.1)])
    }

    func testClosingWhilePausedStillStops() {
        XCTAssertEqual(run([(.played, "a", 0), (.paused, "a", 600), (.stopped(completed: false), "a", 600)])[2], [Call(.stop, title: "a", percent: 60)])
    }

    func testStopTwiceSendsOnce() {
        XCTAssertEqual(run([(.played, "a", 0), (.stopped(completed: false), "a", 10), (.stopped(completed: false), "a", 10)]).map(\.count), [1, 1, 0])
    }

    func testSwitchingTitleStopsTheOldOneBeforeStartingTheNew() {
        XCTAssertEqual(run([(.played, "a", 900), (.played, "b", 0)])[1], [
            Call(.stop, title: "a", percent: 90),
            Call(.start, title: "b", percent: 0),
        ])
    }

    func testEpisodeAfterEpisodeViaStopThenPlay() {
        XCTAssertEqual(run([(.played, "a", 0), (.stopped(completed: true), "a", 1000), (.played, "b", 0)]).flatMap { $0 }.map(\.action), [.start, .stop, .start])
    }

    func testEventsForAnotherTitleAreIgnored() {
        XCTAssertEqual(run([(.played, "a", 0), (.paused, "b", 100), (.stopped(completed: true), "b", 100)]).map(\.count), [1, 0, 0])
    }

    func testPercentIsClampedAndZeroWithoutALength() {
        XCTAssertEqual(ScrobbleReporter.percent(position: 120, duration: 100), 100)
        XCTAssertEqual(ScrobbleReporter.percent(position: -5, duration: 100), 0)
        XCTAssertEqual(ScrobbleReporter.percent(position: 50, duration: 0), 0)
        XCTAssertEqual(ScrobbleReporter.percent(position: 1, duration: 3), 33.33)
    }
}
