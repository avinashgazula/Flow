import XCTest
@testable import FlowKit

final class ResumeDecisionTests: XCTestCase {
    private struct Row {
        let name: String
        let saved: Double
        let duration: Double
        let ask: Bool
        let expected: ResumeDecision
    }

    func testDecisionTable() {
        let rows = [
            Row(name: "a place in the middle resumes by seeking", saved: 600, duration: 7200, ask: false, expected: .seek(600)),
            Row(name: "a place in the middle asks when asking is on", saved: 600, duration: 7200, ask: true, expected: .ask(600)),
            Row(name: "nothing saved at zero plays from the start", saved: 0, duration: 7200, ask: false, expected: .playFromStart),
            Row(name: "nothing saved at zero does not ask", saved: 0, duration: 7200, ask: true, expected: .playFromStart),
            Row(name: "a negative place is ignored", saved: -5, duration: 7200, ask: true, expected: .playFromStart),
            Row(name: "a saved place past the end is ignored", saved: 9000, duration: 7200, ask: false, expected: .playFromStart),
            Row(name: "a saved place past the end does not prompt", saved: 9000, duration: 7200, ask: true, expected: .playFromStart),
            Row(name: "exactly the end is ignored", saved: 7200, duration: 7200, ask: true, expected: .playFromStart),
            Row(name: "inside the last 30 seconds is ignored", saved: 7185, duration: 7200, ask: true, expected: .playFromStart),
            Row(name: "exactly 30 seconds before the end is ignored", saved: 7170, duration: 7200, ask: true, expected: .playFromStart),
            Row(name: "just over 30 seconds before the end resumes", saved: 7169.9, duration: 7200, ask: false, expected: .seek(7169.9)),
            Row(name: "an unknown length of zero resumes", saved: 600, duration: 0, ask: false, expected: .seek(600)),
            Row(name: "an unknown length of zero asks when asking is on", saved: 600, duration: 0, ask: true, expected: .ask(600)),
            Row(name: "a negative length counts as unknown", saved: 600, duration: -1, ask: false, expected: .seek(600)),
            Row(name: "a NaN length (AVPlayer's indefinite) counts as unknown", saved: 600, duration: .nan, ask: false, expected: .seek(600)),
            Row(name: "an infinite length counts as unknown", saved: 600, duration: .infinity, ask: true, expected: .ask(600)),
            Row(name: "an unknown length still ignores a zero place", saved: 0, duration: 0, ask: true, expected: .playFromStart),
            Row(name: "a short stream with a place near its start resumes", saved: 5, duration: 120, ask: false, expected: .seek(5)),
            Row(name: "a stream shorter than the margin never resumes", saved: 10, duration: 25, ask: false, expected: .playFromStart),
        ]
        for row in rows {
            XCTAssertEqual(ResumeDecision.decide(saved: row.saved, duration: row.duration, askToResume: row.ask), row.expected, row.name)
        }
    }

    func testShouldResumeBoundaries() {
        XCTAssertFalse(ResumeDecision.shouldResume(at: 0, duration: 100))
        XCTAssertTrue(ResumeDecision.shouldResume(at: 0.001, duration: 100))
        XCTAssertTrue(ResumeDecision.shouldResume(at: 69.999, duration: 100))
        XCTAssertFalse(ResumeDecision.shouldResume(at: 70, duration: 100))
        XCTAssertFalse(ResumeDecision.shouldResume(at: .nan, duration: 100), "a NaN place is not a place")
    }

    func testAPlaceKnownBeforeTheLengthArrivesIsJudgedAgainOnceItDoes() {
        // The built-in player can report "file loaded" before it knows how long the file is. With no length
        // the place can't be contradicted, so it resumes (and asks); the same place judged with the real
        // length is ignored. The session must therefore decide with the length it has at that moment.
        XCTAssertEqual(ResumeDecision.decide(saved: 9000, duration: 0, askToResume: true), .ask(9000))
        XCTAssertEqual(ResumeDecision.decide(saved: 9000, duration: 7200, askToResume: true), .playFromStart)
    }

    func testApplesPlayerHoldsForAnAnswerWheneverAPlaceIsSavedAndAskingIsOn() {
        XCTAssertTrue(ResumeDecision.holdsPlaybackForAnswer(saved: 600, askToResume: true))
        XCTAssertTrue(ResumeDecision.holdsPlaybackForAnswer(saved: 0, askToResume: true), "held even for a place that will be ignored")
        XCTAssertFalse(ResumeDecision.holdsPlaybackForAnswer(saved: 600, askToResume: false))
        XCTAssertFalse(ResumeDecision.holdsPlaybackForAnswer(saved: nil, askToResume: true))
        XCTAssertFalse(ResumeDecision.holdsPlaybackForAnswer(saved: nil, askToResume: false))
    }

    func testExternalPlayerStartsAtThePlayheadAfterHalfAMinute() {
        XCTAssertEqual(ResumeDecision.externalStart(currentTime: 31, saved: 600), 31)
        XCTAssertEqual(ResumeDecision.externalStart(currentTime: 30, saved: 600), 600, "exactly 30 seconds still uses the saved place")
        XCTAssertEqual(ResumeDecision.externalStart(currentTime: 0, saved: 600), 600)
        XCTAssertNil(ResumeDecision.externalStart(currentTime: 5, saved: nil))
        XCTAssertEqual(ResumeDecision.externalStart(currentTime: 400, saved: nil), 400)
    }
}
