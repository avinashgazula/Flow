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
        screenDumped = false
    }

    private var screenDumped = false

    /// The first failure of a test prints what was really on screen, so a failed run can be read without a screenshot.
    /// Tests that run in parallel print into each clone's own log, not xcodebuild's, so the same text is attached to the
    /// issue as well, where the result bundle keeps it.
    override func record(_ issue: XCTIssue) {
        var issue = issue
        // Only a failed check counts: the runtime also reports warnings (a thread waiting on a slower one) as issues.
        if !screenDumped, app != nil, issue.type == .assertionFailure || issue.type == .thrownError {
            screenDumped = true
            let screen = app.debugDescription
            print("SCREEN at the first failure (\(issue.compactDescription)):\n" + screen)
            issue.add(XCTAttachment(string: screen))
        }
        super.record(issue)
    }

    // MARK: Launching

    /// Launches with the bundled sample data (`-FlowDemo YES`): the same catalogue, library and sources every time, no keys.
    /// A fixed language and locale keep the words on screen the ones the tests look for.
    @discardableResult
    func launchDemo(extra: [String] = []) -> XCUIApplication {
        app = XCUIApplication()
        // The player's controls stay up (debug builds only), so a press never races their four-second hide timer.
        app.launchArguments = ["-FlowDemo", "YES", "-FlowKeepPlayerControls", "YES"] + Self.commonArguments + extra
        app.launch()
        waitForHome()
        return app
    }

    /// Every launch: the words the tests look for, and animations off (debug builds only), so no step waits for one to end.
    static let commonArguments = ["-FlowUITest", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]

    /// A first run: no sample data and no network. Both demo flags are forced off, because an earlier "Explore with Sample
    /// Data" tap is remembered in the app's defaults, and the welcome screen shows only when there is no TMDB key (a build
    /// with one baked in through Secrets.xcconfig skips it; CI has none).
    @discardableResult
    func launchFresh() -> XCUIApplication {
        app = XCUIApplication()
        app.launchArguments = ["-FlowDemo", "NO", "-flow.demoMode", "NO", "-FlowOffline", "YES"] + Self.commonArguments
        app.launch()
        return app
    }

    /// Home is ready when its lead has loaded: a Details button, and Resume (the sample library has things in progress).
    func waitForHome(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(btn("Details").appears(within: patience),
                      "Home shows its lead, with a Details button", file: file, line: line)
    }

    // MARK: Finding things

    /// An element by accessibility identifier, whatever its type: SwiftUI decides what a list row or a container is.
    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// Home's lead: its primary button (Play, or Resume for a pick that was started) and its picture. The lead turns through the
    /// top picks, whatever they are, so tests find it by identifier and not by a sample title.
    var leadPrimary: XCUIElement { element("home-lead-primary") }
    var leadPicture: XCUIElement { element("home-lead-picture") }
    /// A title page's one solid button, Play or Resume ("Resume · 1 h 44 min left").
    var titlePagePlay: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@ OR label BEGINSWITH[c] %@", "Play", "Resume")).firstMatch
    }

    /// Home also says Resume. Exclude that button so a title link can stop waiting as soon as its page appears.
    var titlePageResume: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@ AND identifier != %@", "Resume", "home-lead-primary")).firstMatch
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

    // MARK: Moving things

    /// Turns the device and waits until the window has turned. What is on it is laid out again after that, so the next tap
    /// goes through `tapWhenStill`.
    func turn(to orientation: UIDeviceOrientation, file: StaticString = #filePath, line: UInt = #line) {
        XCUIDevice.shared.orientation = orientation
        let turned = waitUntil(15) {
            let window = self.app.windows.firstMatch.frame
            return orientation.isPortrait ? window.height > window.width : window.width > window.height
        }
        XCTAssertTrue(turned, "the window turns to \(orientation.isPortrait ? "portrait" : "landscape")", file: file, line: line)
    }

    /// Waits until `element` can be tapped and has stopped moving: the same frame twice, a quarter of a second apart. Right
    /// after a turn, or while a page slides in, a tap aimed at where a row was a moment ago lands on its neighbour.
    @discardableResult
    func waitUntilStill(_ element: XCUIElement, timeout: TimeInterval = 30) -> Bool {
        var last = CGRect.null
        return waitUntil(timeout) {
            guard element.exists, element.isHittable else { last = .null; return false }
            let now = element.frame
            defer { last = now }
            return now == last
        }
    }

    func tapWhenStill(_ element: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(waitUntilStill(element, timeout: patience), "\(what) can be tapped", file: file, line: line)
        element.tap()
    }

    // MARK: Navigating

    /// The tab button for `title` that a finger could press: the system's bar also exposes an empty, off-screen twin
    /// of some tabs (Search), and the bar may sit along the top (iPad) or at the foot (iPhone).
    func tabButton(_ title: String) -> XCUIElement? {
        let label = NSPredicate(format: "label ==[c] %@", title)
        for query in [app.tabBars.buttons.matching(label), app.buttons.matching(label),
                      app.descendants(matching: .any).matching(label)] {
            if let found = query.allElementsBoundByIndex.first(where: { $0.frame.width > 0 && $0.isHittable }) { return found }
        }
        return nil
    }

    /// Opens a tab by its title.
    func openTab(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        var tab: XCUIElement?
        waitUntil(patience) { tab = self.tabButton(title); return tab != nil }
        XCTAssertNotNil(tab, "the \(title) tab is in the tab bar and can be pressed", file: file, line: line)
        tab?.tap()
    }

    /// Whether `title` is the lead of Home: its title is set above the Up Next row, where the same title in that row is below.
    func leadIs(_ title: String) -> Bool {
        let upNext = text("Up Next")
        guard upNext.exists else { return false }
        let limit = upNext.frame.minY
        return app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", title)).allElementsBoundByIndex
            .contains { $0.frame.minY < limit }
    }

    /// Swipes the page up until `element` can be tapped. Lists and shelves build their rows lazily, so what is off
    /// screen does not exist yet.
    @discardableResult
    func reveal(_ element: XCUIElement, maxSwipes: Int = 12) -> Bool {
        // Every look at the element reads the whole screen again (a fifth of a second, more on a shared runner), so each
        // question is asked once per pass: this runs a few times in nearly every test.
        let window = app.windows.firstMatch.frame
        func isVisibleAndHittable() -> Bool {
            guard element.exists else { return false }
            let frame = element.frame
            return !frame.isEmpty && window.intersects(frame) && element.isHittable
        }
        var swipes = 0
        while !isVisibleAndHittable() {
            guard swipes < maxSwipes else { return false }
            app.swipeUp()
            swipes += 1
        }
        // On screen but low: nudge it up a little. A full swipe would throw it past the top.
        if !clearOfTheBottomEdge(element, in: window) {
            scrollPageUpALittle(in: window)
            return isVisibleAndHittable()
        }
        return true
    }

    private func scrollPageUpALittle(in window: CGRect) {
        let start = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -window.height * 0.3)))
    }

    /// A row in the bottom fifth of the screen can sit under the iPhone's floating tab bar, which then takes the tap.
    private func clearOfTheBottomEdge(_ element: XCUIElement, in window: CGRect) -> Bool {
        guard window.height > 0 else { return true }
        return element.frame.maxY < window.maxY - window.height * 0.2
    }

    /// Back from a pushed page: its navigation bar's leading button. Pass the page's title when something else (a sheet's
    /// own bar, the page underneath) could also have a bar on screen.
    /// `pressAgainIfDropped` is for a page the player has just closed over, and only where Back is not what the test checks.
    func goBack(from title: String? = nil, pressAgainIfDropped: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        let bar = title.map { app.navigationBars[$0] } ?? app.navigationBars.firstMatch
        let back = bar.buttons.firstMatch
        // Still, not only there: a button on a page that is still arriving (or turning) exists before it takes a tap.
        XCTAssertTrue(waitUntilStill(back, timeout: patience), "a pushed page has a back button", file: file, line: line)
        let heading = bar.staticTexts.firstMatch
        let headingText = pressAgainIfDropped && heading.exists ? heading.label : nil
        back.tap()
        // A press that lands while the player's cover is still leaving, or the iPhone is still turning back from it, is
        // dropped by the system and the page stays. Then, and only then (its title still in the bar), it is pressed again.
        guard let headingText else { return }
        let samePage = bar.staticTexts.matching(NSPredicate(format: "label == %@", headingText)).firstMatch
        if !waitUntil(3, { !samePage.exists }), back.exists, back.isHittable {
            print("BACK PRESS DROPPED on '\(headingText)'; pressing again")
            back.tap()
        }
    }

    /// Opens a `flow://` link the way another app would. The simulator may ask first before a custom scheme opens from
    /// outside. Pass what the link shows as `expecting`: the look for that question ends as soon as it is on screen, where
    /// without it the look takes its full three seconds whenever no question comes, which is nearly always. Something that
    /// was already on screen before the link (Home's lead can say Resume too) proves nothing, so then the look runs its time.
    func openLink(_ link: String, expecting expected: XCUIElement? = nil, file: StaticString = #filePath, line: UInt = #line) {
        guard let url = URL(string: link) else { return XCTFail("\(link) is not a URL", file: file, line: line) }
        let shown = expected?.exists == false ? expected : nil
        app.open(url)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let confirm = springboard.alerts.buttons["Open"]
        waitUntil(3) { confirm.exists || shown?.exists == true }
        if confirm.exists { confirm.tap() }
    }

    // MARK: Title pages and playback

    /// The Details page of the sample's Dune: Part Two, which the sample library has half watched.
    func openDune(file: StaticString = #filePath, line: UInt = #line) {
        let resume = titlePageResume
        openLink("flow://title/movie/693134", expecting: resume, file: file, line: line)
        XCTAssertTrue(resume.appears(within: patience),
                      "Dune: Part Two's page offers Resume", file: file, line: line)
    }

    func tapTitleResume(file: StaticString = #filePath, line: UInt = #line) {
        let resume = titlePageResume
        let window = app.windows.firstMatch.frame
        if !isPad, resume.exists, !clearOfTheBottomEdge(resume, in: window) {
            // The floating tab bar can receive a tap intended for the bottom of the title page.
            scrollPageUpALittle(in: window)
        }
        tapWhenStill(resume, "Resume", file: file, line: line)
    }

    /// Chooses the first sample source: one of Apple's public sample streams, which runs for many minutes, so a test can
    /// work in the middle of a film without the film ending. NETWORK-DEPENDENT, as the sample data's artwork already is.
    /// (The bundled MKV, `demo#mkv`, is only 12 seconds: a test acts a few seconds late and meets the end of the film.)
    func chooseBundledSample(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(btn("Search Again").appears(within: patience), "the source list opens", file: file, line: line)
        XCTAssertTrue(element("source-demo#0").appears(within: patience), "the first source is listed", file: file, line: line)
        let row = element("source-\(Self.longSampleID)")
        XCTAssertTrue(reveal(row), "the long sample stream is in the list", file: file, line: line)
        row.tap()
    }

    static let longSampleID = "demo#0"
    static let bundledSampleID = "demo#mkv"

    var scrubber: XCUIElement { element("player-scrubber") }

    /// "Pause" or "Play", whichever the centre button says right now.
    var transport: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ==[c] %@ OR label ==[c] %@", "Pause", "Play")).firstMatch
    }

    /// Where the player is, read from the scrubber's spoken value ("0:03 of 0:12"). Nil until the length is known.
    func playbackPosition() -> (now: Double, total: Double)? {
        // A snapshot throws when the controls hide between the look and the read, where `.value` would fail the test.
        guard let snapshot = try? scrubber.snapshot(), let value = snapshot.value as? String else { return nil }
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
    /// The bundled clips are 6 to 12 seconds long, so by default the player is paused the moment its clock has run: a test
    /// that acts a few seconds later would meet the end of the film, its suggestions screen and a closing player.
    func waitForPlayback(seconds: Double = 0.5, pauseOnArrival: Bool = true, timeout: TimeInterval = 120,
                         file: StaticString = #filePath, line: UInt = #line) {
        var prompted = false
        var lastTap = Date.distantPast
        let played = waitUntil(timeout) {
            if self.button(startingWith: "Resume from").exists { prompted = true; return true }
            // The controls (and the scrubber that tells the time) hide four seconds after playback starts: a tap on the
            // picture brings them back, at most once in a while so one tap does not hide what the last one showed.
            if !self.scrubber.exists {
                if Date().timeIntervalSince(lastTap) > 3 {
                    lastTap = Date()
                    self.app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                }
                return false
            }
            guard let position = self.playbackPosition() else { return false }
            guard position.now >= seconds else { return false }
            // The controls are up (the scrubber is there), so Pause can be pressed now, before they hide again.
            if pauseOnArrival, (try? self.btn("Pause").snapshot()) != nil { self.btn("Pause").tap() }
            return true
        }
        XCTAssertFalse(prompted, "a resume point past the end of the file is ignored, not offered", file: file, line: line)
        XCTAssertTrue(played, "the player is playing and its clock is running", file: file, line: line)
    }

    /// The controls hide themselves a few seconds after playback starts; a tap on the picture brings them back.
    func showPlayerControls(file: StaticString = #filePath, line: UInt = #line) {
        if transport.exists && transport.isHittable { return }
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(transport.appears(within: 10), "a tap on the picture shows the controls", file: file, line: line)
    }

    /// Closes the player and waits for the page underneath: the close saves the place and then tears the player down.
    func closePlayer(file: StaticString = #filePath, line: UInt = #line) {
        showPlayerControls(file: file, line: line)
        let close = btn("Close Player")
        XCTAssertTrue(close.appears(within: 10), "the player has a Close button", file: file, line: line)
        close.tap()
        XCTAssertTrue(waitUntilGone(transport, timeout: 30), "the player closes", file: file, line: line)
        // An iPhone then turns back to portrait, and a tap sent while it turns is lost: the next step waits until it has.
        if !isPad {
            waitUntil(15) { let window = self.app.windows.firstMatch.frame; return window.width < window.height }
        }
    }

    /// Plays the bundled sample for Dune and stops on its first seconds with the controls up and playback paused,
    /// so what a test does next is not racing a 12-second clip.
    func playDuneAndPause(file: StaticString = #filePath, line: UInt = #line) {
        openDune(file: file, line: line)
        tapTitleResume(file: file, line: line)
        chooseBundledSample(file: file, line: line)
        waitForPlayback(file: file, line: line)
        pausePlayback(file: file, line: line)
    }

    /// Pauses the player. The controls hide themselves while it plays, so a press can find them gone: each try brings them
    /// back first, and what is asserted is the outcome, the centre button saying Play.
    func pausePlayback(file: StaticString = #filePath, line: UInt = #line) {
        // Already paused (`waitForPlayback` pauses on arrival): looking for Pause would only run out its time.
        var paused = btn("Play").exists
        var tries = 0
        while !paused && tries < 4 {
            tries += 1
            if !(transport.exists && transport.isHittable) {
                app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
            let pause = btn("Pause")
            if pause.appears(within: 3), (try? pause.snapshot()) != nil { pause.tap() }
            paused = btn("Play").appears(within: 4)
        }
        XCTAssertTrue(paused, "Pause turns the centre button into Play", file: file, line: line)
    }
}
