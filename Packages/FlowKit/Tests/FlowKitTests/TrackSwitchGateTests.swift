import XCTest
@testable import FlowKit

final class TrackSwitchGateTests: XCTestCase {
    func testHoldsBeforeTheFirstRestart() {
        XCTAssertFalse(TrackSwitchGate.canApplyStartingChoice(restarted: false, paused: false, coreIdle: false, playhead: 5))
        XCTAssertFalse(TrackSwitchGate.canApplyStartingChoice(restarted: false, paused: true, coreIdle: true, playhead: 0))
    }

    func testHoldsWhileTheFirstFrameIsUpButPlaybackHasNotMoved() {
        XCTAssertFalse(TrackSwitchGate.canApplyStartingChoice(restarted: true, paused: false, coreIdle: true, playhead: 0))
        XCTAssertFalse(TrackSwitchGate.canApplyStartingChoice(restarted: true, paused: false, coreIdle: false, playhead: 0))
        XCTAssertFalse(TrackSwitchGate.canApplyStartingChoice(restarted: true, paused: false, coreIdle: false, playhead: .nan))
    }

    func testAppliesOncePlaying() {
        XCTAssertTrue(TrackSwitchGate.canApplyStartingChoice(restarted: true, paused: false, coreIdle: false, playhead: 0.6))
    }

    func testAPausedFileTakesItAfterTheRestart() {
        XCTAssertTrue(TrackSwitchGate.canApplyStartingChoice(restarted: true, paused: true, coreIdle: true, playhead: 0))
    }
}
