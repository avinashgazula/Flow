import XCTest

/// Real taps (XCUITest's own touch injection) on the screens where simulator tools can't be trusted:
/// the Live TV player, which turns to landscape in a cover UIKit presents, and its overlay buttons.
/// Runs with sample data: `scripts/ui-test.sh`, and in CI on iPhone and iPad (.github/workflows/ui-tests.yml).
final class LiveTVUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        // Animations off (debug builds only), so no step waits for one to end.
        app.launchArguments = ["-FlowDemo", "YES", "-FlowUITest", "YES"]
        // The overlay stays up so a found button is still there to press, except in the test of the overlay hiding.
        // That test lets it hide once on its own, then keeps it up once a tap has brought it back (the app's debug switch
        // says why: a look that comes late must not find it hidden again).
        if name.contains("testTappingThePictureBringsTheOverlayBack") {
            app.launchArguments += ["-FlowHideControlsOnce", "YES"]
        } else {
            app.launchArguments += ["-FlowKeepPlayerControls", "YES"]
        }
        app.launch()
    }

    /// A button by its exact label, ignoring case: button styles set their words in capitals, and the spoken label follows.
    private func btn(_ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ==[c] %@", label)).firstMatch
    }

    private func openFirstChannel() {
        let liveTV = btn("Live TV")
        XCTAssertTrue(liveTV.appears(within: 15))
        liveTV.tap()
        // iPad opens on the guide; the list is a tap away. iPhone opens on the list: there the look ends with the first channel.
        let list = btn("Show List")
        let channel = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Flow News'")).firstMatch
        if UIDevice.current.userInterfaceIdiom == .pad {
            if list.appears(within: 3) { list.tap() }
        } else {
            let deadline = Date().addingTimeInterval(3)
            while !list.exists && !channel.exists && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.25)) }
            if list.exists { list.tap() }
        }
        XCTAssertTrue(channel.appears(within: 15), "the first channel is listed")
        channel.tap()
        XCTAssertTrue(btn("Close").appears(within: 15), "the live player opens with its overlay")
    }

    func testCloseLeavesThePlayer() {
        openFirstChannel()
        btn("Close").tap()
        let list = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Flow News'")).firstMatch
        XCTAssertTrue(list.appears(within: 10), "Close returns to the channel list")
        if UIDevice.current.userInterfaceIdiom == .phone {
            let window = app.windows.firstMatch
            let portrait = NSPredicate { _, _ in
                let frame = window.frame
                return frame.height > frame.width
            }
            expectation(for: portrait, evaluatedWith: nil)
            waitForExpectations(timeout: 8)
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
        XCTAssertTrue(next.appears(within: 5))
        next.tap()
        XCTAssertTrue(app.staticTexts["World 24"].appears(within: 10), "Next Channel tunes to channel 2")
        btn("Previous Channel").tap()
        XCTAssertTrue(app.staticTexts["Flow News"].appears(within: 10), "Previous Channel tunes back")
    }

    func testTappingThePictureBringsTheOverlayBack() {
        openFirstChannel()
        // The overlay hides itself after five seconds of playing.
        let close = btn("Close")
        let hidden = NSPredicate(format: "exists == false")
        expectation(for: hidden, evaluatedWith: close)
        waitForExpectations(timeout: 15)
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
        let shown = close.appears(within: 10)
        if !shown {
            // What the app showed and what it could see, for the next person to read.
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.lifetime = .keepAlways
            add(screenshot)
            let tree = XCTAttachment(string: app.debugDescription)
            tree.lifetime = .keepAlways
            add(tree)
        }
        XCTAssertTrue(shown, "a tap on the picture shows the overlay again")
    }
}
