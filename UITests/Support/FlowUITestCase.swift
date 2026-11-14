import XCTest

/// What every Marquee UI test class shares: a fresh launch on sample data, the tab bar, and waits written as
/// conditions with a timeout, never as fixed sleeps. Shared CI runners are slow and the sample data loads its artwork
/// over the network, so the timeouts are generous; a test that passes is not slowed by them.
class FlowUITestCase: XCTestCase {
    var app: XCUIApplication!

    /// Long enough for a cold simulator, short enough that a broken screen fails in under a minute.
    let patience: TimeInterval = 30

    var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        // A previous test may have left the device turned (the player turns an iPhone to landscape).
        XCUIDevice.shared.orientation = .portrait
    }

    // MARK: Launching

    /// Launches with the bundled sample data (`-FlowDemo YES`): the same catalogue, library and sources every time, no keys.
    /// A fixed language and locale keep the words on screen the ones the tests look for.
    @discardableResult
    func launchDemo(extra: [String] = []) -> XCUIApplication {
        app = XCUIApplication()
        app.launchArguments = ["-FlowDemo", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        app.launch()
        waitForHome()
        return app
    }

    /// A first run: no sample data and no network. Both demo flags are forced off, because an earlier "Explore with Sample
    /// Data" tap is remembered in the app's defaults, and the welcome screen shows only when there is no TMDB key (a build
    /// with one baked in through Secrets.xcconfig skips it; CI has none).
    @discardableResult
    func launchFresh() -> XCUIApplication {
        app = XCUIApplication()
        app.launchArguments = ["-FlowDemo", "NO", "-flow.demoMode", "NO", "-FlowOffline", "YES",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    /// Home is ready when its lead has loaded: a Details button, and Resume (the sample library has things in progress).
    func waitForHome(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(btn("Details").waitForExistence(timeout: patience),
                      "Home shows its lead, with a Details button", file: file, line: line)
    }

    // MARK: Finding things

    /// An element by accessibility identifier, whatever its type: SwiftUI decides what a list row or a container is.
    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// A button by its exact label, ignoring case. Button styles set their words in capitals, and the system hands that
    /// capitalised text on as the spoken label ("DETAILS", "PREVIOUS TITLE").
    func btn(_ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ==[c] %@", label)).firstMatch
    }

    /// A button whose spoken label starts with `prefix` ("Resume" matches "Resume · 1 h 44 min left").
    func button(startingWith prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", prefix)).firstMatch
    }

    func button(containing text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    /// A line of text, compared without regard to case: pages set their heads in capitals, and whether the spoken
    /// label keeps the original case is the system's business.
    func text(_ words: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", words)).firstMatch
    }

    /// Anything whose spoken label starts with `prefix`, whatever it is (a pager's "Title 1 of 10" is neither button nor text to rely on).
    func anyElement(startingWith prefix: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH[c] %@", prefix)).firstMatch
    }

    func text(startingWith prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH[c] %@", prefix)).firstMatch
    }

    // MARK: Waiting

    /// Polls `condition` until it holds or `timeout` runs out. Returns whether it held.
    @discardableResult
    func waitUntil(_ timeout: TimeInterval = 30, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    func waitUntilGone(_ element: XCUIElement, timeout: TimeInterval = 30) -> Bool {
        waitUntil(timeout) { !element.exists }
    }

    // MARK: Navigating

    /// Opens a tab by its title. The tab bar is the system's: on iPhone at the foot, on iPad along the top.
    func openTab(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        let inBar = app.tabBars.buttons[title]
        let tab = inBar.exists ? inBar : btn(title)
        XCTAssertTrue(tab.waitForExistence(timeout: patience), "the \(title) tab is in the tab bar", file: file, line: line)
        tab.tap()
    }

    /// Swipes the page up until `element` can be tapped. Lists and shelves build their rows lazily, so what is off
    /// screen does not exist yet.
    @discardableResult
    func reveal(_ element: XCUIElement, maxSwipes: Int = 12) -> Bool {
        var swipes = 0
        while !(element.exists && element.isHittable) && swipes < maxSwipes {
            app.swipeUp()
            swipes += 1
        }
        return element.exists && element.isHittable
    }

    /// Back from a pushed page: its navigation bar's leading button. Pass the page's title when something else (a sheet's
    /// own bar, the page underneath) could also have a bar on screen.
    func goBack(from title: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
        let bar = title.map { app.navigationBars[$0] } ?? app.navigationBars.firstMatch
        let back = bar.buttons.firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: patience), "a pushed page has a back button", file: file, line: line)
        back.tap()
    }

    /// Opens a `flow://` link the way another app would. The simulator asks first before a custom scheme opens from outside.
    func openLink(_ link: String, file: StaticString = #filePath, line: UInt = #line) {
        guard let url = URL(string: link) else { return XCTFail("\(link) is not a URL", file: file, line: line) }
        app.open(url)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let confirm = springboard.alerts.buttons["Open"]
        if confirm.waitForExistence(timeout: 3) { confirm.tap() }
    }

    // MARK: Title pages and playback

    /// The Details page of the sample's Dune: Part Two, which the sample library has half watched.
    func openDune(file: StaticString = #filePath, line: UInt = #line) {
        openLink("flow://title/movie/693134", file: file, line: line)
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience),
                      "Dune: Part Two's page offers Resume", file: file, line: line)
    }

    /// Chooses the bundled MKV from the source list: it plays offline, through the app's own remuxer, so no test depends
    /// on a stream somewhere on the network.
    func chooseBundledSample(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.buttons["Search Again"].waitForExistence(timeout: patience), "the source list opens", file: file, line: line)
        XCTAssertTrue(element("source-demo#0").waitForExistence(timeout: patience), "the first source is listed", file: file, line: line)
        let row = element("source-\(Self.bundledSampleID)")
        XCTAssertTrue(reveal(row), "the bundled sample is in the list", file: file, line: line)
        row.tap()
    }

    static let bundledSampleID = "demo#mkv"

    var scrubber: XCUIElement { element("player-scrubber") }

    /// "Pause" or "Play", whichever the centre button says right now.
    var transport: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ==[c] %@ OR label ==[c] %@", "Pause", "Play")).firstMatch
    }

    /// Where the player is, read from the scrubber's spoken value ("0:03 of 0:12"). Nil until the length is known.
    func playbackPosition() -> (now: Double, total: Double)? {
        guard scrubber.exists, let value = scrubber.value as? String else { return nil }
        let halves = value.components(separatedBy: " of ")
        guard halves.count == 2, let now = Self.seconds(halves[0]), let total = Self.seconds(halves[1]), total > 0 else { return nil }
        return (now, total)
    }

    /// "1:05" is 65 seconds, "1:02:03" is 3,723.
    static func seconds(_ clock: String) -> Double? {
        let parts = clock.split(separator: ":").map { Double($0) }
        guard parts.count >= 2, !parts.contains(where: { $0 == nil }) else { return nil }
        return parts.reduce(0) { $0 * 60 + ($1 ?? 0) }
    }

    /// Waits until the picture has really played for `seconds`. A resume prompt here is a failure: the sample is 12
    /// seconds long, and a saved point far past its end must be ignored.
    func waitForPlayback(seconds: Double = 1, timeout: TimeInterval = 120, file: StaticString = #filePath, line: UInt = #line) {
        var prompted = false
        let played = waitUntil(timeout) {
            if self.button(startingWith: "Resume from").exists { prompted = true; return true }
            guard let position = self.playbackPosition() else { return false }
            return position.now >= seconds
        }
        XCTAssertFalse(prompted, "a resume point past the end of the file is ignored, not offered", file: file, line: line)
        XCTAssertTrue(played, "the player is playing and its clock is running", file: file, line: line)
    }

    /// The controls hide themselves a few seconds after playback starts; a tap on the picture brings them back.
    func showPlayerControls(file: StaticString = #filePath, line: UInt = #line) {
        if transport.exists && transport.isHittable { return }
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(transport.waitForExistence(timeout: 10), "a tap on the picture shows the controls", file: file, line: line)
    }

    /// Closes the player and waits for the page underneath: the close saves the place and then tears the player down.
    func closePlayer(file: StaticString = #filePath, line: UInt = #line) {
        showPlayerControls(file: file, line: line)
        let close = btn("Close Player")
        XCTAssertTrue(close.waitForExistence(timeout: 10), "the player has a Close button", file: file, line: line)
        close.tap()
        XCTAssertTrue(waitUntilGone(transport, timeout: 30), "the player closes", file: file, line: line)
    }

    /// Plays the bundled sample for Dune and stops on its first seconds with the controls up and playback paused,
    /// so what a test does next is not racing a 12-second clip.
    func playDuneAndPause(file: StaticString = #filePath, line: UInt = #line) {
        openDune(file: file, line: line)
        button(startingWith: "Resume").tap()
        chooseBundledSample(file: file, line: line)
        waitForPlayback(file: file, line: line)
        showPlayerControls(file: file, line: line)
        btn("Pause").tap()
        XCTAssertTrue(btn("Play").waitForExistence(timeout: 10),
                      "Pause turns the centre button into Play", file: file, line: line)
    }
}
