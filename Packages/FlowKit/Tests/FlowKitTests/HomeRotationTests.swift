import XCTest
@testable import FlowKit

final class HomeRotationTests: XCTestCase {
    func testTurnsWhenWantedWithSeveralTitles() {
        XCTAssertTrue(HomeRotation.advancesByItself(setting: true, titles: 10, reduceMotion: false))
        XCTAssertTrue(HomeRotation.advancesByItself(setting: true, titles: 2, reduceMotion: false))
    }

    func testStaysPutWhenSwitchedOff() {
        XCTAssertFalse(HomeRotation.advancesByItself(setting: false, titles: 10, reduceMotion: false))
    }

    func testStaysPutWithOneTitleOrNone() {
        XCTAssertFalse(HomeRotation.advancesByItself(setting: true, titles: 1, reduceMotion: false))
        XCTAssertFalse(HomeRotation.advancesByItself(setting: true, titles: 0, reduceMotion: false))
    }

    func testStaysPutUnderReduceMotion() {
        XCTAssertFalse(HomeRotation.advancesByItself(setting: true, titles: 10, reduceMotion: true))
    }

    func testDwellMatchesTheWebsite() {
        XCTAssertEqual(HomeRotation.dwell, 8)
    }
}
