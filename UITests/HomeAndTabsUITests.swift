import XCTest

/// Launch, Home and the five tabs, on sample data. The sample library has Breaking Bad (season 3, episode 7) and Dune: Part
/// Two part watched, so both sit in Up Next; Home's lead turns through the top picks (trending) and never through those.
final class HomeAndTabsUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    func testLaunchLandsOnHomeWithTheTopPickAsItsLead() {
        XCTAssertTrue(leadPrimary.waitForExistence(timeout: patience), "the lead offers Play (or Resume, for a pick that was started)")
        XCTAssertTrue(leadPicture.exists, "and shows the pick's picture")
        XCTAssertTrue(anyElement(startingWith: "Title 1 of").exists, "the dots start on the first pick")
        // What is in progress is Up Next's, not the lead's: Breaking Bad has a resume point but is not a top pick here.
        XCTAssertTrue(text("Up Next").exists, "Continue Watching stays in its own row")
    }

    func testLeadTurnsWithASwipeAndItsDotsSayWhere() {
        XCTAssertTrue(anyElement(startingWith: "Title 1 of").waitForExistence(timeout: patience), "the dots start on the first pick")
        let first = leadPicture.label
        swipeLead(left: true)
        XCTAssertTrue(anyElement(startingWith: "Title 2 of").waitForExistence(timeout: 10), "a swipe left brings in the second pick")
        XCTAssertTrue(waitUntil(10) { self.leadPicture.label != first }, "its picture is a different title's")
        swipeLead(left: false)
        XCTAssertTrue(anyElement(startingWith: "Title 1 of").waitForExistence(timeout: 10), "a swipe right comes back to the first")
        XCTAssertTrue(waitUntil(10) { self.leadPicture.label == first }, "and to its title")
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
        XCTAssertTrue(titlePagePlay.waitForExistence(timeout: patience), "the pick's page offers Play or Resume")
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
        XCTAssertTrue(titlePagePlay.waitForExistence(timeout: patience))
        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience))
        openTab("Home")
        XCTAssertTrue(titlePagePlay.waitForExistence(timeout: patience), "Home still shows the page that was open")
        XCTAssertFalse(btn("Details").exists, "and not its root")
    }
}
