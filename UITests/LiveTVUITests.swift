import XCTest

/// Real taps (XCUITest's own touch injection) on the screens where simulator tools can't be trusted:
/// the Live TV player, which turns to landscape in a cover UIKit presents, and its overlay buttons.
/// Runs with sample data: `scripts/ui-test.sh`, and in CI on iPhone and iPad (.github/workflows/ui-tests.yml).
final class LiveTVUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-FlowDemo", "YES"]
        app.launch()
    }

    private func openFirstChannel() {
        let liveTV = btn("Live TV")
        XCTAssertTrue(liveTV.waitForExistence(timeout: 15))
        liveTV.tap()
        // iPad opens on the guide; the list is a tap away.
        let list = btn("Show List")
        if list.waitForExistence(timeout: 3) { list.tap() }
        let channel = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Flow News'")).firstMatch
        XCTAssertTrue(channel.waitForExistence(timeout: 15), "the first channel is listed")
        channel.tap()
        XCTAssertTrue(btn("Close").waitForExistence(timeout: 15), "the live player opens with its overlay")
    }

    func testCloseLeavesThePlayer() {
        openFirstChannel()
        btn("Close").tap()
        let list = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Flow News'")).firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 10), "Close returns to the channel list")
        if UIDevice.current.userInterfaceIdiom == .phone {
            let window = app.windows.firstMatch
            XCTAssertLessThan(window.frame.width, window.frame.height, "the phone is back in portrait")
        }
    }

    func testPlayerTurnsToLandscape() throws {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "iPad keeps whatever way it's held")
        openFirstChannel()
        let window = app.windows.firstMatch
        let landscape = NSPredicate { _, _ in window.frame.width > window.frame.height }
        expectation(for: landscape, evaluatedWith: nil)
        waitForExpectations(timeout: 8)
    }

    func testChannelButtonsTune() {
        openFirstChannel()
        let next = btn("Next Channel")
        XCTAssertTrue(next.waitForExistence(timeout: 5))
        next.tap()
        XCTAssertTrue(app.staticTexts["World 24"].waitForExistence(timeout: 10), "Next Channel tunes to channel 2")
        btn("Previous Channel").tap()
        XCTAssertTrue(app.staticTexts["Flow News"].waitForExistence(timeout: 10), "Previous Channel tunes back")
    }

    func testTappingThePictureBringsTheOverlayBack() {
        openFirstChannel()
        // The overlay hides itself after five seconds of playing.
        let close = btn("Close")
        let hidden = NSPredicate(format: "exists == false")
        expectation(for: hidden, evaluatedWith: close)
        waitForExpectations(timeout: 15)
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
        XCTAssertTrue(close.waitForExistence(timeout: 5), "a tap on the picture shows the overlay again")
    }
}
