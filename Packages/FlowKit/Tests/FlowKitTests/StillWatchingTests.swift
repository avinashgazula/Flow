import XCTest
@testable import FlowKit

final class StillWatchingTests: XCTestCase {
    func testAsksAfterTheLimitOfUntouchedEpisodes() {
        var watch = StillWatching()
        XCTAssertFalse(watch.shouldAsk(limit: 2))
        watch.noteAutomaticAdvance()
        XCTAssertFalse(watch.shouldAsk(limit: 2))
        watch.noteAutomaticAdvance()
        XCTAssertTrue(watch.shouldAsk(limit: 2))
    }

    func testZeroNeverAsks() {
        var watch = StillWatching()
        for _ in 0..<10 { watch.noteAutomaticAdvance() }
        XCTAssertFalse(watch.shouldAsk(limit: 0))
    }

    func testInteractionStartsAgain() {
        var watch = StillWatching()
        watch.noteAutomaticAdvance(); watch.noteAutomaticAdvance()
        watch.noteInteraction()
        XCTAssertFalse(watch.shouldAsk(limit: 2))
    }

    func testAPauseMidEpisodeMeansSomeoneIsThere() {
        var watch = StillWatching()
        watch.noteAutomaticAdvance(); watch.noteAutomaticAdvance()
        watch.notePause(at: 600, duration: 2700)
        XCTAssertEqual(watch.unattendedEpisodes, 0)
    }

    func testTheEpisodeEndingOnItsOwnDoesNotCount() {
        // AVPlayer reports a pause as an item plays to its end, just before the end notice.
        var watch = StillWatching()
        watch.noteAutomaticAdvance(); watch.noteAutomaticAdvance()
        watch.notePause(at: 2699.2, duration: 2700)
        XCTAssertTrue(watch.shouldAsk(limit: 2))
    }

    func testAPauseBeforeTheDurationIsKnownCounts() {
        var watch = StillWatching()
        watch.noteAutomaticAdvance()
        watch.notePause(at: 0, duration: 0)
        XCTAssertEqual(watch.unattendedEpisodes, 0)
    }
}
