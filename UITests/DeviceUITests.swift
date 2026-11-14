import XCTest

/// What differs between an iPhone and an iPad. The iPhone class is left out of the iPad run and the iPad class out of the
/// iPhone run (scripts/ui-test.sh), so nothing here is skipped at run time.

/// The player turns an iPhone to landscape and hands it back. An iPad keeps whichever way it is held.
final class PhonePlayerUITests: FlowUITestCase {
    private var window: XCUIElement { app.windows.firstMatch }

    func testThePlayerTurnsThePhoneToLandscapeAndClosingTurnsItBack() {
        launchDemo()
        XCTAssertLessThan(window.frame.width, window.frame.height, "the phone starts in portrait")
        openDune()
        button(startingWith: "Resume").tap()
        chooseBundledSample()
        waitForPlayback()
        XCTAssertTrue(waitUntil(15) { self.window.frame.width > self.window.frame.height }, "the player turns the phone to landscape")
        closePlayer()
        XCTAssertTrue(waitUntil(15) { self.window.frame.width < self.window.frame.height }, "closing the player turns it back to portrait")
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "on the title page again")
    }

    func testThePlayersControlsWorkInLandscape() {
        launchDemo()
        openDune()
        button(startingWith: "Resume").tap()
        chooseBundledSample()
        waitForPlayback()
        showPlayerControls()
        app.buttons["Pause"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Play"].firstMatch.waitForExistence(timeout: 10), "Pause works in landscape")
        app.buttons["Options"].firstMatch.tap()
        let speed = button(containing: "Speed")
        XCTAssertTrue(speed.waitForExistence(timeout: 10), "the options panel opens in landscape")
        // On a short screen the list scrolls: Advanced Options is the last row, and has to be reachable.
        let advanced = button(containing: "Advanced Options")
        var swipes = 0
        while !(advanced.exists && advanced.isHittable) && swipes < 6 {
            speed.swipeUp()
            swipes += 1
        }
        XCTAssertTrue(advanced.exists && advanced.isHittable, "Advanced Options can be reached by scrolling the panel")
    }
}

/// The iPad's wide layouts: Home's lead split into words and backdrop, a tab bar along the top, and the same page and tab
/// after the iPad is turned.
final class iPadLayoutUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .landscapeLeft
        launchDemo()
    }

    func testHomesLeadSplitsIntoWordsBesideItsBackdrop() {
        let resume = app.buttons["Resume"].firstMatch
        let backdrop = button(startingWith: "Breaking Bad, season 3")
        XCTAssertTrue(resume.waitForExistence(timeout: patience), "the lead offers Resume")
        XCTAssertTrue(backdrop.waitForExistence(timeout: patience), "and shows its backdrop")
        // On a phone the backdrop sits under the buttons; on a wide screen it stands beside them.
        XCTAssertLessThanOrEqual(resume.frame.maxX, backdrop.frame.minX + 1, "the words are to the left of the backdrop")
        XCTAssertLessThan(abs(resume.frame.midY - backdrop.frame.midY), backdrop.frame.height, "and level with it, not above it")
    }

    func testEveryTabIsReachableAlongTheTop() {
        for title in ["Explore", "Library", "Live TV", "Search", "Home"] {
            openTab(title)
        }
        waitForHome()
    }

    func testTurningTheiPadKeepsTheTabAndItsPage() {
        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience))
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience), "Library is still the open tab in portrait")
        button(startingWith: "Upcoming").tap()
        XCTAssertTrue(app.buttons["Add All to Calendar"].firstMatch.waitForExistence(timeout: patience), "its Upcoming page opens")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["Add All to Calendar"].firstMatch.waitForExistence(timeout: patience), "and stays open after turning back")
        goBack(from: "Upcoming")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience), "Back still leads to the Library")
    }

    func testTurningTheiPadKeepsATitlePageOpen() {
        openDune()
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "Dune's page survives the turn")
        XCUIDevice.shared.orientation = .landscapeRight
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "and the turn back")
    }

    func testSettingsOpensAsALargeSheet() {
        app.buttons["Settings"].firstMatch.tap()
        let row = element("settings-row-general")
        XCTAssertTrue(row.waitForExistence(timeout: patience), "Settings opens")
        // A page-size sheet, not a narrow card: its rows are wide enough to read a title and a chevron.
        XCTAssertGreaterThan(row.frame.width, 500, "the iPad's Settings sheet is large")
    }
}
