import XCTest

/// From a title's page to the picture and back: the page's actions, the source list, and the player with real taps on
/// its controls. The player runs the bundled MKV, which Marquee remuxes on the device, so nothing here needs the network.
final class TitleAndPlayerUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    // MARK: The title page

    func testAMoviePageShowsItsListActionsAndTheyToggle() {
        openDune()
        let add = btn("Add to Watchlist")
        XCTAssertTrue(reveal(add), "Dune is not on the watchlist yet, so the action offers to add it")
        add.tap()
        XCTAssertTrue(btn("Remove from Watchlist").waitForExistence(timeout: 10), "the action turns into its opposite")
        btn("Remove from Watchlist").tap()
        XCTAssertTrue(btn("Add to Watchlist").waitForExistence(timeout: 10), "and back")
        XCTAssertTrue(btn("Mark Watched").exists, "an unwatched film can be marked watched")
    }

    func testAShowPageHasASeasonMenuAndItsResumeEpisode() {
        openLink("flow://title/show/1396")
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "Breaking Bad offers Resume")
        XCTAssertTrue(reveal(btn("Season")), "a show's page has a Season menu")
    }

    func testAWatchedFilmSaysSo() {
        openLink("flow://title/movie/872585")
        let watched = btn("Watched")
        XCTAssertTrue(watched.waitForExistence(timeout: patience) || reveal(watched),
                      "Oppenheimer is in the sample history, so its page shows Watched")
    }

    // MARK: The source list

    func testPlayOpensTheSourceListAndCloseLeavesIt() {
        openDune()
        button(startingWith: "Resume").tap()
        XCTAssertTrue(btn("Search Again").waitForExistence(timeout: patience), "the source list opens")
        XCTAssertTrue(element("source-demo#0").waitForExistence(timeout: patience), "the demo add-on lists its first source")
        XCTAssertTrue(element("source-demo#1").exists, "and its second")
        btn("Close").tap()
        XCTAssertTrue(waitUntilGone(btn("Search Again"), timeout: 15), "Close dismisses the list")
        XCTAssertTrue(button(startingWith: "Resume").exists, "back on the title page")
    }

    func testResolutionChipFiltersTheSourceList() {
        openDune()
        button(startingWith: "Resume").tap()
        XCTAssertTrue(element("source-demo#0").waitForExistence(timeout: patience), "sources are listed")
        // demo#0 is 1080p WEB-DL, demo#3 is 720p WEBRip.
        let chip = btn("720p")
        XCTAssertTrue(chip.waitForExistence(timeout: patience), "a 720p chip is offered")
        chip.tap()
        XCTAssertTrue(waitUntilGone(element("source-demo#0"), timeout: 10), "the 1080p source is filtered out")
        XCTAssertTrue(element("source-demo#3").exists, "the 720p source stays")
        btn("All").tap()
        XCTAssertTrue(element("source-demo#0").waitForExistence(timeout: 10), "All brings the rest back")
    }

    // MARK: The player

    func testChoosingASourceStartsThePlayerWithItsControls() {
        openDune()
        button(startingWith: "Resume").tap()
        chooseBundledSample()
        waitForPlayback()
        showPlayerControls()
        for label in ["Close Player", "Options", "X-Ray", "Playback Info"] {
            XCTAssertTrue(btn(label).exists, "the player has \(label)")
        }
        XCTAssertTrue(button(startingWith: "Back").exists, "and a skip back button")
        XCTAssertTrue(button(startingWith: "Forward").exists, "and a skip forward button")
        XCTAssertTrue(transport.exists, "and a play or pause button")
        XCTAssertFalse(btn("Search Again").exists, "the source list is gone")
    }

    func testPauseAndPlayChangeThePlayersState() {
        playDuneAndPause()
        guard let paused = playbackPosition()?.now else { return XCTFail("the paused player reports its position") }
        // Paused means the clock holds still.
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        let later = playbackPosition()?.now ?? -1
        XCTAssertEqual(later, paused, accuracy: 0.6, "a paused player's clock does not run")
        btn("Play").tap()
        XCTAssertTrue(btn("Pause").waitForExistence(timeout: 10), "Play turns the button back into Pause")
        XCTAssertTrue(waitUntil(30) { (self.playbackPosition()?.now ?? 0) > paused + 0.9 }, "playback carries on from where it stopped")
        showPlayerControls()
        btn("Pause").tap()
    }

    func testTappingTheScrubberMovesThePlayhead() {
        playDuneAndPause()
        scrubber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        let moved = waitUntil(15) {
            guard let position = self.playbackPosition() else { return false }
            return position.now > position.total * 0.35 && position.now < position.total * 0.65
        }
        XCTAssertTrue(moved, "a tap in the middle of the scrubber seeks to about the middle of the 12-second clip, got \(String(describing: playbackPosition()))")
    }

    func testOptionsPanelOpensAndChangesTheSpeed() {
        playDuneAndPause()
        btn("Options").tap()
        let speed = button(containing: "Speed")
        XCTAssertTrue(speed.waitForExistence(timeout: 10), "the options panel lists Speed")
        XCTAssertTrue(speed.label.contains("Normal"), "at normal speed to begin with, got \(speed.label)")
        speed.tap()
        let faster = button(startingWith: "1.5x")
        XCTAssertTrue(faster.waitForExistence(timeout: 10), "the speed list offers 1.5x")
        faster.tap()
        XCTAssertTrue(waitUntil(10) { self.button(containing: "Speed").label.contains("1.5x") }, "the options panel now reads Speed 1.5x")
        btn("Options").tap()
        XCTAssertTrue(waitUntilGone(button(containing: "Speed"), timeout: 10), "tapping Options again closes the panel")
    }

    func testClosingThePlayerReturnsToTheTitlePage() {
        playDuneAndPause()
        closePlayer()
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience), "back on Dune's page, which still offers Resume")
        XCTAssertFalse(btn("Options").exists, "with the player gone")
    }

    func testAPlaceSavedInThePlayerShowsOnHome() {
        XCTAssertTrue(text("Breaking Bad").waitForExistence(timeout: patience), "Home's lead starts as Breaking Bad")
        playDuneAndPause()
        scrubber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(waitUntil(15) { (self.playbackPosition()?.now ?? 0) > 3 }, "the playhead moved into the clip")
        closePlayer()
        goBack()
        waitForHome()
        XCTAssertTrue(text("Dune: Part Two").waitForExistence(timeout: patience), "Dune, played last, is Home's lead now")
        XCTAssertTrue(btn("Resume").exists, "and it offers Resume")
        XCTAssertTrue(waitUntilGone(text("Breaking Bad"), timeout: 10), "in place of Breaking Bad")
    }
}
