import XCTest

/// `flow://` links, opened the way another app (a widget, Siri, a message) would. Each lands on the right screen.
final class DeepLinkUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    func testATitleLinkOpensThatTitlesPage() {
        openLink("flow://title/movie/693134", expecting: button(startingWith: "Resume"))
        XCTAssertTrue(button(startingWith: "Resume").appears(within: patience), "Dune: Part Two's page offers Resume")
        XCTAssertFalse(btn("Details").exists, "on top of Home")
    }

    func testATitleLinkForAShowAcceptsTvAsWellAsShow() {
        openLink("flow://title/tv/1396", expecting: button(startingWith: "Resume"))
        XCTAssertTrue(button(startingWith: "Resume").appears(within: patience), "a show's page, offering to resume Breaking Bad")
        XCTAssertTrue(reveal(btn("Season")), "with its Season menu")
    }

    func testATitleLinkFromAnotherTabComesToHome() {
        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").appears(within: patience))
        openLink("flow://title/movie/693134", expecting: button(startingWith: "Resume"))
        XCTAssertTrue(button(startingWith: "Resume").appears(within: patience), "the page opens whichever tab was showing")
        XCTAssertFalse(button(startingWith: "Upcoming").exists, "and the Library is no longer on screen")
    }

    func testAPlayLinkOpensTheSourceList() {
        openLink("flow://play/movie/603", expecting: btn("Search Again"))
        XCTAssertTrue(btn("Search Again").appears(within: patience), "the source list for The Matrix opens")
        XCTAssertTrue(element("source-demo#0").appears(within: patience), "with its sources")
    }

    func testAContinueLinkOpensTheSourceListForTheLatestResume() {
        openLink("flow://continue")
        // A toast says why when nothing opens ("Nothing to continue", "No episodes available yet."), and it is gone in
        // seconds: so what is on screen is read while the wait goes on, and named in the failure.
        var seen: [String] = []
        let opened = waitUntil(patience) {
            if self.btn("Search Again").exists { return true }
            for toast in ["Nothing to continue", "No episodes", "Couldn't open"] where self.text(startingWith: toast).exists { seen.append(toast) }
            return false
        }
        XCTAssertTrue(opened, "the source list for Breaking Bad's episode opens; messages seen: \(Set(seen))")
        XCTAssertTrue(text(startingWith: "S03E").appears(within: patience), "and it is for season 3, where the sample library left off")
    }

    func testAnUpcomingLinkOpensTheCalendar() {
        openLink("flow://upcoming", expecting: btn("Add All to Calendar"))
        XCTAssertTrue(btn("Add All to Calendar").appears(within: patience), "the Upcoming page opens")
    }

    func testASearchLinkFillsTheSearchField() {
        openLink("flow://search?q=oppenheimer", expecting: element("search-field"))
        XCTAssertTrue(element("search-field").appears(within: patience), "the Search tab opens")
        XCTAssertEqual(element("search-field").value as? String, "oppenheimer", "with the query typed in")
        XCTAssertTrue(button(startingWith: "Oppenheimer").appears(within: patience), "and its results")
    }

    func testASetupLinkOpensTheImportSheet() {
        openLink("flow://setup?d=bm90LWEtcmVhbC1zZXR1cA", expecting: btn("Read Setup"))
        XCTAssertTrue(btn("Read Setup").appears(within: patience), "the import sheet opens for the shared setup")
    }

    func testAnUnknownLinkIsIgnored() {
        openLink("flow://nonsense/here")
        // Nothing to wait for: the proof is that Home is still what is on screen a moment later.
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        XCTAssertTrue(btn("Details").exists, "Home stays as it was")
        XCTAssertFalse(btn("Read Setup").exists || btn("Search Again").exists, "and nothing opens over it")
    }
}
