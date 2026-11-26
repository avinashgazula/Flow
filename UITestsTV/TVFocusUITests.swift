import XCTest

/// Apple TV has no touch: everything is the focus engine and the Siri Remote's presses. These tests drive the remote
/// (`XCUIRemote`) through a short path on every tab, and after each press require that exactly one element has focus: a
/// screen where focus is lost, or two things claim it, cannot be used with a remote. Menu is pressed only on pages
/// pushed from a tab, never on a tab itself, where it would leave the app.
///
/// The tests come in three classes, by where they start, because parallel testing hands out whole classes to its clones.
class TVFocusUITestCase: XCTestCase {
    var app: XCUIApplication!
    let remote = XCUIRemote.shared
    let patience: TimeInterval = 60

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-FlowDemo", "YES", "-FlowNoRotation", "YES", "-FlowUITest", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let lead = element("home-lead-primary")
        XCTAssertTrue(lead.appears(within: patience), "Home shows its lead, with Play or Resume")
        // Focus lands a moment after the page does; the tests start from where it settles. That is usually the tab bar,
        // which takes focus at launch (see `enterHome`), so waiting for the lead alone ran out its whole time in every test.
        XCTAssertTrue(waitUntil(20) { lead.hasFocus || self.focusIsOnTheTabBar }, "Focus lands on Home or its tab")
    }

    // MARK: Helpers

    @discardableResult
    func waitUntil(_ timeout: TimeInterval = 15, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// An element by accessibility identifier, whatever its type. Home's lead is found by its identifiers: it turns through the
    /// top picks, whatever they are.
    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// A button by its exact label, ignoring case: button styles set their words in capitals, and the spoken label follows.
    func btn(_ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ==[c] %@", label)).firstMatch
    }

    /// A wait for an element that, when it fails, prints the whole screen to the log: a remote test cannot be looked at.
    func expectExists(_ element: XCUIElement, _ message: String, timeout: TimeInterval = 60, file: StaticString = #filePath, line: UInt = #line) {
        guard !element.appears(within: timeout) else { return }
        XCTFail("\(message)\n\(app.debugDescription)", file: file, line: line)
    }

    /// Focus lands on a table cell around a row's button, so a row has focus when it, or what holds it, does.
    func hasFocusWithin(_ identifier: String) -> Bool {
        let target = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        if target.exists && target.hasFocus { return true }
        return focusedElements.firstMatch.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists
    }

    var focusedElements: XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true"))
    }

    func describeFocus() -> String {
        let all = focusedElements.allElementsBoundByIndex
        return all.isEmpty ? "nothing" : all.map { $0.debugDescription.replacingOccurrences(of: "\n", with: " ") }.joined(separator: " AND ")
    }

    /// Focus settles with an animation, so this waits for it to land on one element, then fails if it never did.
    func assertOneFocus(_ context: String, file: StaticString = #filePath, line: UInt = #line) {
        let settled = waitUntil(10) { self.focusedElements.count == 1 }
        XCTAssertTrue(settled, "\(context): exactly one element has focus, but focus is on \(describeFocus())", file: file, line: line)
    }

    /// Returns once the focused element has stayed the same for half a second (at most ten seconds).
    func waitForFocusToSettle() {
        func focused() -> String {
            let element = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).firstMatch
            return element.exists ? "\(element.elementType.rawValue) \(element.label) \(element.frame)" : ""
        }
        var last = focused()
        _ = waitUntil(10) {
            Thread.sleep(forTimeInterval: 0.5)
            let now = focused()
            defer { last = now }
            return !now.isEmpty && now == last
        }
    }

    func press(_ button: XCUIRemote.Button, _ context: String, file: StaticString = #filePath, line: UInt = #line) {
        remote.press(button)
        assertOneFocus("after \(context)", file: file, line: line)
    }

    func tabItem(_ title: String) -> XCUIElement {
        let inBar = app.tabBars.buttons[title]
        return inBar.exists ? inBar : btn(title)
    }

    /// Whether the focused element is one of the tab bar's.
    var focusIsOnTheTabBar: Bool {
        app.tabBars.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).count > 0
    }

    /// Up until the tab bar has focus, then sideways to `title`, then down into its page.
    func openTab(_ title: String, page: XCUIElement? = nil, file: StaticString = #filePath, line: UInt = #line) {
        var presses = 0
        while !focusIsOnTheTabBar && presses < 10 {
            press(.up, "Up toward the tab bar", file: file, line: line)
            presses += 1
        }
        XCTAssertTrue(focusIsOnTheTabBar, "Up reaches the tab bar from anywhere on a page, focus is on \(describeFocus())", file: file, line: line)
        let target = tabItem(title)
        XCTAssertTrue(target.appears(within: patience), "the \(title) tab exists", file: file, line: line)
        var moves = 0
        while !target.hasFocus && moves < 10 {
            let focused = focusedElements.firstMatch
            press(focused.frame.midX < target.frame.midX ? .right : .left, "moving toward the \(title) tab", file: file, line: line)
            moves += 1
        }
        XCTAssertTrue(target.hasFocus, "the remote's left and right reach the \(title) tab", file: file, line: line)
        assertOneFocus("on the \(title) tab", file: file, line: line)
        if let page { expectExists(page, "\(title) shows its page", file: file, line: line) }
        press(.down, "Down from the \(title) tab into its page", file: file, line: line)
        guard page != nil else { return }
        let entered = waitUntil(10) { !self.focusIsOnTheTabBar }
        XCTAssertTrue(entered, "Down leaves the tab bar for the \(title) page, focus is on \(describeFocus())", file: file, line: line)
    }
}

/// Home: where focus lands at launch, the lead's buttons and dots, and a title page opened from it.
final class TVHomeFocusUITests: TVFocusUITestCase {
    // MARK: Home

    /// The Apple TV tab bar takes focus when the app opens (the page's default focus does not outrank it), so these
    /// tests start with one Down, which has to land on Resume.
    private func enterHome() {
        assertOneFocus("on arrival at Home")
        if focusIsOnTheTabBar { press(.down, "Down from the Home tab") }
        XCTAssertTrue(waitUntil(20) { self.element("home-lead-primary").hasFocus }, "Down from the tab bar reaches Resume, focus is on \(describeFocus())")
    }

    func testSiriRemoteOperatesNativePlaybackAndReturnsToHome() {
        enterHome()
        remote.press(.select)
        let source = element("source-demo#0")
        expectExists(source, "Resume opens the source picker")
        var moves = 0
        while !hasFocusWithin("source-demo#0"), moves < 8 {
            press(.down, "Down toward the sample stream")
            moves += 1
        }
        XCTAssertTrue(hasFocusWithin("source-demo#0"), "The Siri Remote reaches the sample stream")
        remote.press(.select)
        let home = element("home-lead-primary")
        XCTAssertTrue(waitUntil(15) { !source.exists }, "The source picker closes when playback begins")
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        XCTAssertFalse(home.hasFocus || focusIsOnTheTabBar, "The player keeps focus away from Home")

        remote.press(.playPause)
        XCTAssertFalse(btn("Search Subtitles").exists)

        for _ in 0..<3 {
            remote.press(.menu)
            if waitUntil(5, { home.hasFocus || self.focusIsOnTheTabBar }) { break }
        }
        XCTAssertTrue(home.hasFocus || focusIsOnTheTabBar, "Back returns focus to Home")
        assertOneFocus("returning from playback")
    }

    func testLaunchFocusesOneThingAndDownReachesResumeThenAcrossHome() {
        enterHome()
        press(.right, "Right from Resume")
        XCTAssertTrue(btn("Details").hasFocus, "Right from Resume reaches Details, focus is on \(describeFocus())")
        press(.down, "Down from Details onto the dots")
        let dots = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Title 1 of")).firstMatch
        XCTAssertTrue(waitUntil(10) { dots.hasFocus }, "Down from the buttons reaches the dots row, focus is on \(describeFocus())")
        // The dots row is the carousel's own control: Right and Left turn it, with focus staying on the row.
        press(.right, "Right on the dots")
        let second = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Title 2 of")).firstMatch
        XCTAssertTrue(second.appears(within: 10), "Right on the dots turns to the second pick")
        XCTAssertTrue(waitUntil(10) { second.hasFocus }, "and focus stays on the dots, focus is on \(describeFocus())")
        press(.left, "Left on the dots")
        XCTAssertTrue(dots.appears(within: 10), "Left turns back to the first pick")
        press(.down, "Down from the dots")
        press(.down, "Down again")
        press(.up, "Up")
    }

    func testDetailsOpensAPageAndMenuReturnsToHome() {
        enterHome()
        remote.press(.right)
        assertOneFocus("after Right to Details")
        XCTAssertTrue(btn("Details").hasFocus, "Details has focus, focus is on \(describeFocus())")
        remote.press(.select)
        XCTAssertTrue(waitUntil(30) { !self.btn("Details").exists }, "Select on Details opens the title's page over Home")
        assertOneFocus("on the title page")
        press(.down, "Down on the title page")
        press(.right, "Right on the title page")
        remote.press(.menu)
        XCTAssertTrue(btn("Details").appears(within: 30), "Menu goes back to Home")
        assertOneFocus("back on Home")
        XCTAssertFalse(focusIsOnTheTabBar, "focus returns to Home's content, not the tab bar, focus is on \(describeFocus())")
    }
}

/// Explore and Library: a page opened from each, and Menu back.
final class TVBrowseFocusUITests: TVFocusUITestCase {
    func testExploreTakesFocusAndOpensATitle() {
        openTab("Explore", page: btn("Filters"))
        press(.right, "Right on Explore")
        press(.down, "Down on Explore")
        press(.down, "Down again on Explore")
        remote.press(.select)
        XCTAssertTrue(waitUntil(30) { !self.btn("Filters").exists }, "Select on a poster opens its page")
        assertOneFocus("on the title page from Explore")
        remote.press(.menu)
        XCTAssertTrue(btn("Filters").appears(within: 30), "Menu returns to Explore")
        assertOneFocus("back on Explore")
    }

    func testLibraryOpensAPageAndMenuReturns() {
        let upcoming = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Upcoming")).firstMatch
        openTab("Library", page: upcoming)
        remote.press(.select)
        XCTAssertTrue(waitUntil(30) { !upcoming.exists },
                      "Select on the first row opens its page")
        assertOneFocus("on the page opened from Library")
        // A Menu press while the page is still sliding in is dropped by the system: wait until focus has settled.
        waitForFocusToSettle()
        XCTAssertFalse(focusIsOnTheTabBar, "Focus is inside the opened page, not the tab bar, focus is on \(describeFocus())")
        remote.press(.menu)
        XCTAssertTrue(upcoming.appears(within: 30), "Menu returns to the Library")
        assertOneFocus("back on the Library")
    }
}

/// Live TV, Search and Settings.
final class TVOtherTabsFocusUITests: TVFocusUITestCase {
    func testLiveTVTakesFocus() {
        openTab("Live TV", page: btn("Guide"))
        press(.right, "Right on Live TV")
        press(.down, "Down on Live TV")
        press(.down, "Down again on Live TV")
        press(.up, "Up on Live TV")
    }

    func testSearchTakesFocus() {
        // Search's field lives in the tab bar itself on Apple TV, so Down need not leave it: one thing must hold focus.
        openTab("Search")
        press(.right, "Right on Search")
    }

    func testSettingsOpensAPageAndMenuReturns() {
        let general = app.descendants(matching: .any).matching(identifier: "settings-row-general").firstMatch
        openTab("Settings", page: general)
        // Focus enters the list below its first rows: go up to General, which is the top of the list of pages.
        var presses = 0
        while !hasFocusWithin("settings-row-general") && presses < 10 {
            press(.up, "Up through Settings")
            presses += 1
        }
        XCTAssertTrue(hasFocusWithin("settings-row-general"), "Up reaches the General row, focus is on \(describeFocus())")
        remote.press(.select)
        XCTAssertTrue(waitUntil(30) { !general.exists }, "Select opens the General page")
        assertOneFocus("on the General page")
        press(.down, "Down on the General page")
        remote.press(.menu)
        XCTAssertTrue(general.appears(within: 30), "Menu returns to the Settings list")
        assertOneFocus("back on the Settings list")
    }
}
