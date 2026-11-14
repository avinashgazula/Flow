import XCTest

/// `flow://` links, opened the way another app (a widget, Siri, a message) would. Each lands on the right screen.
final class DeepLinkUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    func testATitleLinkOpensThatTitlesPage() {
        openLink("flow://title/movie/693134")
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "Dune: Part Two's page offers Resume")
        XCTAssertFalse(btn("Details").exists, "on top of Home")
    }

    func testATitleLinkForAShowAcceptsTvAsWellAsShow() {
        openLink("flow://title/tv/1396")
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "a show's page, offering to resume Breaking Bad")
        XCTAssertTrue(reveal(btn("Season")), "with its Season menu")
    }

    func testATitleLinkFromAnotherTabComesToHome() {
        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience))
        openLink("flow://title/movie/693134")
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "the page opens whichever tab was showing")
        XCTAssertFalse(button(startingWith: "Upcoming").exists, "and the Library is no longer on screen")
    }

    func testAPlayLinkOpensTheSourceList() {
        openLink("flow://play/movie/603")
        XCTAssertTrue(btn("Search Again").waitForExistence(timeout: patience), "the source list for The Matrix opens")
        XCTAssertTrue(element("source-demo#0").waitForExistence(timeout: patience), "with its sources")
    }

    func testAContinueLinkOpensTheSourceListForTheLatestResume() {
        openLink("flow://continue")
        XCTAssertTrue(btn("Search Again").waitForExistence(timeout: patience), "the source list for Breaking Bad's episode opens")
        XCTAssertTrue(text(startingWith: "S03E").waitForExistence(timeout: patience), "and it is for season 3, where the sample library left off")
    }

    func testAnUpcomingLinkOpensTheCalendar() {
        openLink("flow://upcoming")
        XCTAssertTrue(btn("Add All to Calendar").waitForExistence(timeout: patience), "the Upcoming page opens")
    }

    func testASearchLinkFillsTheSearchField() {
        openLink("flow://search?q=oppenheimer")
        XCTAssertTrue(element("search-field").waitForExistence(timeout: patience), "the Search tab opens")
        XCTAssertEqual(element("search-field").value as? String, "oppenheimer", "with the query typed in")
        XCTAssertTrue(button(startingWith: "Oppenheimer").waitForExistence(timeout: patience), "and its results")
    }

    func testASetupLinkOpensTheImportSheet() {
        openLink("flow://setup?d=bm90LWEtcmVhbC1zZXR1cA")
        XCTAssertTrue(btn("Read Setup").waitForExistence(timeout: patience), "the import sheet opens for the shared setup")
    }

    func testAnUnknownLinkIsIgnored() {
        openLink("flow://nonsense/here")
        // Nothing to wait for: the proof is that Home is still what is on screen a moment later.
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        XCTAssertTrue(btn("Details").exists, "Home stays as it was")
        XCTAssertFalse(btn("Read Setup").exists || btn("Search Again").exists, "and nothing opens over it")
    }
}
