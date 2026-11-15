import XCTest
@testable import FlowKit

final class PlayerProgressTests: XCTestCase {
    func testSaveOutcomeTable() {
        struct Row { let name: String; let position: Double; let duration: Double; let finished: Bool; let threshold: Double; let expected: PlayerProgress.SaveOutcome }
        let rows = [
            Row(name: "halfway keeps a resume point", position: 3600, duration: 7200, finished: false, threshold: 90, expected: .progress(percent: 50)),
            Row(name: "a finished viewing is watched wherever the playhead is", position: 10, duration: 7200, finished: true, threshold: 90, expected: .watched),
            Row(name: "reaching the threshold is watched", position: 6480, duration: 7200, finished: false, threshold: 90, expected: .watched),
            Row(name: "just under the threshold keeps a resume point", position: 6479, duration: 7200, finished: false, threshold: 90, expected: .progress(percent: 6479.0 / 7200 * 100)),
            Row(name: "a lower threshold counts sooner", position: 3600, duration: 7200, finished: false, threshold: 50, expected: .watched),
            Row(name: "exactly one percent is too little", position: 72, duration: 7200, finished: false, threshold: 90, expected: .ignore),
            Row(name: "just over one percent is kept", position: 73, duration: 7200, finished: false, threshold: 90, expected: .progress(percent: 73.0 / 7200 * 100)),
            Row(name: "nothing watched is ignored", position: 0, duration: 7200, finished: false, threshold: 90, expected: .ignore),
            Row(name: "an unknown length saves nothing", position: 600, duration: 0, finished: false, threshold: 90, expected: .ignore),
            Row(name: "an unknown length saves nothing even when finished", position: 600, duration: 0, finished: true, threshold: 90, expected: .ignore),
            Row(name: "a playhead past the end is capped and watched", position: 8000, duration: 7200, finished: false, threshold: 90, expected: .watched),
            Row(name: "a threshold of 100 needs the very end", position: 7200, duration: 7200, finished: false, threshold: 100, expected: .watched),
            Row(name: "a threshold of 100 keeps a place just before it", position: 7199, duration: 7200, finished: false, threshold: 100, expected: .progress(percent: 7199.0 / 7200 * 100)),
        ]
        for row in rows {
            XCTAssertEqual(PlayerProgress.saveOutcome(position: row.position, duration: row.duration, finished: row.finished, watchedThresholdPercent: row.threshold), row.expected, row.name)
        }
    }

    func testPercentsAndStopPosition() {
        XCTAssertEqual(PlayerProgress.percent(position: 30, duration: 120), 25)
        XCTAssertEqual(PlayerProgress.percent(position: 30, duration: 0), 0)
        XCTAssertEqual(PlayerProgress.percent(position: 130, duration: 100), 130, "the live percent is not capped")
        XCTAssertEqual(PlayerProgress.stopPercent(position: 130, duration: 100), 100, "the stop report is capped")
        XCTAssertEqual(PlayerProgress.stopPercent(position: 30, duration: 0), 0)
        XCTAssertEqual(PlayerProgress.stopPercent(position: 50, duration: 200), 25)
        XCTAssertEqual(PlayerProgress.stopPosition(completed: true, currentTime: 90, duration: 100), 100, "completed counts as the end")
        XCTAssertEqual(PlayerProgress.stopPosition(completed: true, currentTime: 105, duration: 100), 105)
        XCTAssertEqual(PlayerProgress.stopPosition(completed: false, currentTime: 90, duration: 100), 90)
        XCTAssertEqual(PlayerProgress.stopPosition(completed: true, currentTime: 90, duration: 0), 90)
    }

    func testIntervals() {
        XCTAssertFalse(PlayerProgress.reportIsDue(secondsSinceLastReport: 10))
        XCTAssertTrue(PlayerProgress.reportIsDue(secondsSinceLastReport: 10.01))
        XCTAssertFalse(PlayerProgress.hasPlayedLongEnough(59.9))
        XCTAssertTrue(PlayerProgress.hasPlayedLongEnough(60))
    }

    func testSeeksStayInsideTheStream() {
        XCTAssertEqual(PlayerProgress.clampedSeekTarget(-20, duration: 100), 0)
        XCTAssertEqual(PlayerProgress.clampedSeekTarget(50, duration: 100), 50)
        XCTAssertEqual(PlayerProgress.clampedSeekTarget(150, duration: 100), 100)
        XCTAssertEqual(PlayerProgress.clampedSeekTarget(150, duration: 0), 150, "no length known: no upper bound")
        XCTAssertEqual(PlayerProgress.clampedSeekTarget(-1, duration: 0), 0)
    }

    func testEndOfStreamTable() {
        func end(started: Bool = true, time: Double = 2700, sleep: Bool = false, next: Bool = false, auto: Bool = true, suggestions: Bool = false) -> PlayerProgress.EndOfStream {
            PlayerProgress.endOfStream(didStart: started, currentTime: time, sleepEndsWithItem: sleep, hasUpNext: next, autoPlayNext: auto, hasSuggestions: suggestions)
        }
        XCTAssertEqual(end(started: false), .unexpected)
        XCTAssertEqual(end(time: 5), .unexpected, "five seconds is not a viewing")
        XCTAssertEqual(end(time: 5.1), .finishAndClose)
        XCTAssertEqual(end(started: false, time: 0, sleep: true, next: true), .unexpected, "the error check comes before the sleep timer")
        XCTAssertEqual(end(sleep: true, next: true), .finishAndClose, "the sleep timer stops the chain")
        XCTAssertEqual(end(sleep: true, suggestions: true), .finishAndClose)
        XCTAssertEqual(end(next: true), .advance)
        XCTAssertEqual(end(next: true, suggestions: true), .advance, "an episode has Up Next, not suggestions")
        XCTAssertEqual(end(next: true, auto: false), .finishAndClose, "auto-play off: stop after the episode")
        XCTAssertEqual(end(next: true, auto: false, suggestions: true), .finishAndClose, "pinned: with Up Next present suggestions never show")
        XCTAssertEqual(end(suggestions: true), .showSuggestions)
        XCTAssertEqual(end(auto: false, suggestions: true), .showSuggestions, "a film ends on suggestions whatever auto-play says")
        XCTAssertEqual(end(), .finishAndClose)
    }
}
