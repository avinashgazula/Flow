import XCTest

/// Search, Explore, Library and Upcoming. The sample catalogue is small and fixed, so what a filter or a query leaves
/// on screen is known exactly.
final class BrowseUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    // MARK: Search

    func testTypingASearchShowsItsResultsAndOpensOne() {
        openTab("Search")
        let field = element("search-field")
        XCTAssertTrue(field.appears(within: patience), "Search has its field")
        field.tap()
        field.typeText("Oppenheimer")
        let result = button(startingWith: "Oppenheimer")
        XCTAssertTrue(result.appears(within: patience), "Oppenheimer is among the results")
        result.tap()
        XCTAssertTrue(btn("Watched").appears(within: patience) || reveal(btn("Watched")),
                      "the title's page opens, and the sample history says it was watched")
    }

    func testASearchWithNoMatchSaysSoAndClearEmptiesTheField() {
        openTab("Search")
        let field = element("search-field")
        XCTAssertTrue(field.appears(within: patience))
        field.tap()
        field.typeText("zzqqxx")
        XCTAssertTrue(text(startingWith: "No Results").appears(within: patience), "a query that matches nothing says so")
        btn("Clear Search").tap()
        XCTAssertTrue(waitUntilGone(text(startingWith: "No Results"), timeout: 10), "Clear Search returns to the suggestions")
        XCTAssertFalse(btn("Clear Search").exists, "and the clear button goes with the text")
    }

    func testPeopleAreFoundToo() {
        openTab("Search")
        let field = element("search-field")
        XCTAssertTrue(field.appears(within: patience))
        field.tap()
        field.typeText("Zendaya")
        XCTAssertTrue(button(startingWith: "Zendaya").appears(within: patience), "a cast member is a result")
    }

    // MARK: Explore

    func testSwitchingToTVShowsChangesTheGrid() {
        openTab("Explore")
        XCTAssertTrue(button(startingWith: "Dune: Part Two").appears(within: patience), "Explore starts on trending films")
        btn("TV Shows").tap()
        XCTAssertTrue(button(startingWith: "Breaking Bad").appears(within: patience), "TV Shows lists series")
        XCTAssertTrue(waitUntilGone(button(startingWith: "Dune: Part Two"), timeout: 10), "and no films")
        btn("Movies").tap()
        XCTAssertTrue(button(startingWith: "Dune: Part Two").appears(within: patience), "Movies brings the films back")
    }

    func testAGenreChipFiltersTheGrid() {
        openTab("Explore")
        XCTAssertTrue(button(startingWith: "Dune: Part Two").appears(within: patience))
        btn("Action").tap()
        // Of the sample films, The Dark Knight is an action film and Dune: Part Two is not.
        XCTAssertTrue(button(startingWith: "The Dark Knight").appears(within: patience), "Action lists The Dark Knight")
        XCTAssertTrue(waitUntilGone(button(startingWith: "Dune: Part Two"), timeout: 10), "and leaves Dune: Part Two out")
        btn("All").tap()
        XCTAssertTrue(button(startingWith: "Dune: Part Two").appears(within: patience), "All clears the filter")
    }

    func testTheFiltersSheetOpensAndCloses() {
        openTab("Explore")
        btn("Filters").tap()
        XCTAssertTrue(btn("Reset").appears(within: patience), "the filters sheet opens with its Reset button")
        btn("Done").tap()
        XCTAssertTrue(waitUntilGone(btn("Reset"), timeout: 10), "Done closes it")
        XCTAssertTrue(btn("Filters").exists, "back on Explore")
    }

    // MARK: Library

    func testLibraryListsItsPagesAndEachOpens() {
        openTab("Library")
        let pages: [(row: String, head: String)] = [
            ("Upcoming", "Upcoming"), ("Sports", "Sports"), ("History", "Watch History"), ("Stats", "Stats"), ("Downloads", "Downloads"),
        ]
        for page in pages {
            let row = button(startingWith: page.row)
            XCTAssertTrue(row.appears(within: patience), "Library lists \(page.row)")
            XCTAssertTrue(reveal(row), "\(page.row) can be tapped")
            row.tap()
            XCTAssertTrue(text(page.head).appears(within: patience), "\(page.row) opens a page headed \(page.head)")
            goBack(from: page.head)
            XCTAssertTrue(button(startingWith: "Upcoming").appears(within: patience), "Back returns to the Library")
        }
    }

    func testLibrarySectionsShowTheSampleLists() {
        openTab("Library")
        XCTAssertTrue(text("Continue Watching").appears(within: patience), "Library has a Continue Watching section")
        XCTAssertTrue(text("Watchlist").appears(within: patience), "and a Watchlist")
        XCTAssertTrue(text("Favourites").appears(within: patience), "and Favourites")
    }

    func testHistoryListsTheWatchedTitles() {
        openTab("Library")
        let row = button(startingWith: "History")
        XCTAssertTrue(row.appears(within: patience))
        row.tap()
        XCTAssertTrue(button(startingWith: "Oppenheimer").appears(within: patience), "History lists Oppenheimer, watched two days ago in the sample")
    }

    // MARK: Upcoming

    func testUpcomingListsNewEpisodesAndCanBeExported() {
        openTab("Library")
        let row = button(startingWith: "Upcoming")
        XCTAssertTrue(row.appears(within: patience))
        row.tap()
        XCTAssertTrue(text("Upcoming").appears(within: patience), "the page is headed Upcoming")
        XCTAssertTrue(btn("Add All to Calendar").appears(within: patience),
                      "with episodes to show, the page offers Add All to Calendar")
        XCTAssertFalse(text("Nothing Coming Up").exists, "so it is not the empty state")
    }
}
