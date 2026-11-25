import XCTest

/// Launch, Home and the five tabs, on sample data. The sample library has Breaking Bad (season 3, episode 7) and Dune: Part
/// Two part watched, so Home's lead is Breaking Bad and Dune sits in Up Next.
final class HomeAndTabsUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    func testLaunchLandsOnHomeWithTheLatestResumeAsItsLead() {
        XCTAssertTrue(btn("Resume").waitForExistence(timeout: patience), "the lead offers Resume, since Breaking Bad is in progress")
        XCTAssertTrue(waitUntil(patience) { self.leadIs("Breaking Bad") }, "the lead is the title watched most recently")
        XCTAssertFalse(leadIs("Dune: Part Two"), "Dune, watched earlier, is only in Up Next")
    }

    func testLeadTurnsWithASwipeAndItsDotsSayWhere() {
        XCTAssertTrue(anyElement(startingWith: "Title 1 of").waitForExistence(timeout: patience), "the dots start on the first pick")
        swipeLead(left: true)
        XCTAssertTrue(anyElement(startingWith: "Title 2 of").waitForExistence(timeout: 10), "a swipe left brings in the second pick")
        XCTAssertTrue(waitUntil(10) { !self.leadIs("Breaking Bad") }, "the first pick's title is replaced")
        swipeLead(left: false)
        XCTAssertTrue(anyElement(startingWith: "Title 1 of").waitForExistence(timeout: 10), "a swipe right comes back to the first")
        XCTAssertTrue(waitUntil(10) { self.leadIs("Breaking Bad") }, "and to its title")
    }

    /// A swipe across the upper part of the window, where the lead's picture is.
    private func swipeLead(left: Bool) {
        let window = app.windows.firstMatch
        let right = window.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.25))
        let leftEdge = window.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.25))
        (left ? right : leftEdge).press(forDuration: 0.05, thenDragTo: left ? leftEdge : right)
    }

    func testUpNextListsWhatIsInProgress() {
        let dune = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Dune: Part Two", "left")).firstMatch
        XCTAssertTrue(reveal(dune), "Up Next has Dune: Part Two, with the time left in its spoken label")
        let lastOfUs = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "The Last of Us", "left")).firstMatch
        XCTAssertTrue(lastOfUs.exists, "Up Next has The Last of Us too")
    }

    func testDetailsOpensTheLeadsPageAndBackReturnsHome() {
        btn("Details").tap()
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "Breaking Bad's page offers Resume")
        XCTAssertFalse(btn("Details").exists, "Home is covered by the page")
        goBack()
        waitForHome()
    }

    func testEachTabOpensItsScreen() {
        openTab("Explore")
        XCTAssertTrue(btn("Filters").waitForExistence(timeout: patience), "Explore has its Filters button")
        XCTAssertTrue(btn("TV Shows").exists, "Explore switches between Movies and TV Shows")

        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience), "Library lists its pages, Upcoming first")

        openTab("Live TV")
        XCTAssertTrue(btn("Guide").waitForExistence(timeout: patience), "Live TV has its List and Guide switch")

        openTab("Search")
        XCTAssertTrue(element("search-field").waitForExistence(timeout: patience), "Search has its field")

        openTab("Home")
        waitForHome()
    }

    func testTabsKeepTheirOwnPages() {
        // A page pushed on one tab stays there while another tab is used.
        btn("Details").tap()
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience))
        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience))
        openTab("Home")
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "Home still shows the page that was open")
        XCTAssertFalse(btn("Details").exists, "and not its root")
    }
}
