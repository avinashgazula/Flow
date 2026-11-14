import XCTest

/// Launch, Home and the five tabs, on sample data. The sample library has Breaking Bad (season 3, episode 7) and Dune: Part
/// Two part watched, so Home's lead is Breaking Bad and Dune sits in Up Next.
final class HomeAndTabsUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    func testLaunchLandsOnHomeWithTheLatestResumeAsItsLead() {
        XCTAssertTrue(app.buttons["Resume"].firstMatch.waitForExistence(timeout: patience), "the lead offers Resume, since Breaking Bad is in progress")
        XCTAssertTrue(text("Breaking Bad").waitForExistence(timeout: patience), "the lead is the title watched most recently")
        XCTAssertFalse(text("Dune: Part Two").exists, "Dune, watched earlier, is not the lead")
    }

    func testLeadPagerTurnsThroughThePicksAndBack() {
        XCTAssertTrue(anyElement(startingWith: "Title 1 of").waitForExistence(timeout: patience), "the pager starts on the first pick")
        app.buttons["Next Title"].firstMatch.tap()
        XCTAssertTrue(anyElement(startingWith: "Title 2 of").waitForExistence(timeout: 10), "Next Title moves to the second pick")
        XCTAssertTrue(waitUntilGone(text("Breaking Bad"), timeout: 10), "the first pick's title is replaced")
        app.buttons["Previous Title"].firstMatch.tap()
        XCTAssertTrue(text("Breaking Bad").waitForExistence(timeout: 10), "Previous Title comes back to the first pick")
    }

    func testUpNextListsWhatIsInProgress() {
        let dune = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Dune: Part Two", "left")).firstMatch
        XCTAssertTrue(reveal(dune), "Up Next has Dune: Part Two, with the time left in its spoken label")
        let lastOfUs = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "The Last of Us", "left")).firstMatch
        XCTAssertTrue(lastOfUs.exists, "Up Next has The Last of Us too")
    }

    func testDetailsOpensTheLeadsPageAndBackReturnsHome() {
        app.buttons["Details"].firstMatch.tap()
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "Breaking Bad's page offers Resume")
        XCTAssertFalse(app.buttons["Details"].firstMatch.exists, "Home is covered by the page")
        goBack()
        waitForHome()
    }

    func testEachTabOpensItsScreen() {
        openTab("Explore")
        XCTAssertTrue(app.buttons["Filters"].firstMatch.waitForExistence(timeout: patience), "Explore has its Filters button")
        XCTAssertTrue(app.buttons["TV Shows"].firstMatch.exists, "Explore switches between Movies and TV Shows")

        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience), "Library lists its pages, Upcoming first")

        openTab("Live TV")
        XCTAssertTrue(app.buttons["Guide"].firstMatch.waitForExistence(timeout: patience), "Live TV has its List and Guide switch")

        openTab("Search")
        XCTAssertTrue(element("search-field").waitForExistence(timeout: patience), "Search has its field")

        openTab("Home")
        waitForHome()
    }

    func testTabsKeepTheirOwnPages() {
        // A page pushed on one tab stays there while another tab is used.
        app.buttons["Details"].firstMatch.tap()
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience))
        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience))
        openTab("Home")
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "Home still shows the page that was open")
        XCTAssertFalse(app.buttons["Details"].firstMatch.exists, "and not its root")
    }
}
