import XCTest

/// Apple TV has no touch: everything is the focus engine and the Siri Remote's presses. These tests drive the remote
/// (`XCUIRemote`) through a short path on every tab, and after each press require that exactly one element has focus: a
/// screen where focus is lost, or two things claim it, cannot be used with a remote. Menu is pressed only on pages
/// pushed from a tab, never on a tab itself, where it would leave the app.
final class TVFocusUITests: XCTestCase {
    private var app: XCUIApplication!
    private let remote = XCUIRemote.shared
    private let patience: TimeInterval = 60

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-FlowDemo", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(btn("Resume").waitForExistence(timeout: patience), "Home shows its lead, with Resume")
        // Focus lands a moment after the page does; the tests start from where it settles.
        waitUntil(20) { self.btn("Resume").hasFocus }
    }

    // MARK: Helpers

    @discardableResult
    private func waitUntil(_ timeout: TimeInterval = 15, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// A button by its exact label, ignoring case: button styles set their words in capitals, and the spoken label follows.
    private func btn(_ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ==[c] %@", label)).firstMatch
    }

    /// A wait for an element that, when it fails, prints the whole screen to the log: a remote test cannot be looked at.
    private func expectExists(_ element: XCUIElement, _ message: String, timeout: TimeInterval = 60, file: StaticString = #filePath, line: UInt = #line) {
        if !element.waitForExistence(timeout: timeout) { print("SCREEN at failure of '\(message)':\n" + app.debugDescription) }
        XCTAssertTrue(element.exists, message, file: file, line: line)
    }

    /// Focus lands on a table cell around a row's button, so a row has focus when it, or what holds it, does.
    private func hasFocusWithin(_ identifier: String) -> Bool {
        let target = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        if target.exists && target.hasFocus { return true }
        return focusedElements.firstMatch.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists
    }

    private var focusedElements: XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true"))
    }

    private func describeFocus() -> String {
        let all = focusedElements.allElementsBoundByIndex
        return all.isEmpty ? "nothing" : all.map { $0.debugDescription.replacingOccurrences(of: "\n", with: " ") }.joined(separator: " AND ")
    }

    /// Focus settles with an animation, so this waits for it to land on one element, then fails if it never did.
    private func assertOneFocus(_ context: String, file: StaticString = #filePath, line: UInt = #line) {
        let settled = waitUntil(10) { self.focusedElements.count == 1 }
        XCTAssertTrue(settled, "\(context): exactly one element has focus, but focus is on \(describeFocus())", file: file, line: line)
    }

    private func press(_ button: XCUIRemote.Button, _ context: String, file: StaticString = #filePath, line: UInt = #line) {
        remote.press(button)
        assertOneFocus("after \(context)", file: file, line: line)
    }

    private func tabItem(_ title: String) -> XCUIElement {
        let inBar = app.tabBars.buttons[title]
        return inBar.exists ? inBar : btn(title)
    }

    /// Whether the focused element is one of the tab bar's.
    private var focusIsOnTheTabBar: Bool {
        app.tabBars.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).count > 0
    }

    /// Up until the tab bar has focus, then sideways to `title`, then down into its page.
    private func openTab(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        var presses = 0
        while !focusIsOnTheTabBar && presses < 10 {
            remote.press(.up)
            presses += 1
            RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        }
        XCTAssertTrue(focusIsOnTheTabBar, "Up reaches the tab bar from anywhere on a page, focus is on \(describeFocus())", file: file, line: line)
        let target = tabItem(title)
        XCTAssertTrue(target.waitForExistence(timeout: patience), "the \(title) tab exists", file: file, line: line)
        var moves = 0
        while !target.hasFocus && moves < 10 {
            let focused = focusedElements.firstMatch
            remote.press(focused.frame.midX < target.frame.midX ? .right : .left)
            moves += 1
            RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        }
        XCTAssertTrue(target.hasFocus, "the remote's left and right reach the \(title) tab", file: file, line: line)
        assertOneFocus("on the \(title) tab", file: file, line: line)
        press(.down, "Down from the \(title) tab into its page", file: file, line: line)
        let entered = waitUntil(10) { !self.focusIsOnTheTabBar }
        XCTAssertTrue(entered, "Down leaves the tab bar for the \(title) page, focus is on \(describeFocus())", file: file, line: line)
    }

    // MARK: Home

    func testLaunchFocusesResumeAndTheRemoteMovesAcrossHome() {
        assertOneFocus("on arrival at Home")
        XCTAssertTrue(waitUntil(20) { self.btn("Resume").hasFocus }, "Resume has focus on arrival, so one press of Select carries on watching, focus is on \(describeFocus())")
        press(.right, "Right from Resume")
        XCTAssertTrue(btn("Details").hasFocus, "Right from Resume reaches Details, focus is on \(describeFocus())")
        press(.down, "Down from Details")
        press(.down, "Down again")
        press(.up, "Up")
    }

    func testDetailsOpensAPageAndMenuReturnsToHome() {
        remote.press(.right)
        assertOneFocus("after Right to Details")
        XCTAssertTrue(btn("Details").hasFocus, "Details has focus, focus is on \(describeFocus())")
        remote.press(.select)
        XCTAssertTrue(waitUntil(30) { !self.btn("Details").exists }, "Select on Details opens the title's page over Home")
        assertOneFocus("on the title page")
        press(.down, "Down on the title page")
        press(.right, "Right on the title page")
        remote.press(.menu)
        XCTAssertTrue(btn("Details").waitForExistence(timeout: 30), "Menu goes back to Home")
        assertOneFocus("back on Home")
        XCTAssertFalse(focusIsOnTheTabBar, "focus returns to Home's content, not the tab bar, focus is on \(describeFocus())")
    }

    // MARK: The other tabs

    func testExploreTakesFocusAndOpensATitle() {
        openTab("Explore")
        expectExists(btn("Filters"), "Explore shows its Filters button")
        press(.right, "Right on Explore")
        press(.down, "Down on Explore")
        press(.down, "Down again on Explore")
        remote.press(.select)
        XCTAssertTrue(waitUntil(30) { !self.btn("Filters").exists }, "Select on a poster opens its page")
        assertOneFocus("on the title page from Explore")
        remote.press(.menu)
        XCTAssertTrue(btn("Filters").waitForExistence(timeout: 30), "Menu returns to Explore")
        assertOneFocus("back on Explore")
    }

    func testLibraryOpensAPageAndMenuReturns() {
        openTab("Library")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Upcoming")).firstMatch.waitForExistence(timeout: patience),
                      "Library lists its pages")
        remote.press(.select)
        XCTAssertTrue(waitUntil(30) { !self.app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Upcoming")).firstMatch.exists },
                      "Select on the first row opens its page")
        assertOneFocus("on the page opened from Library")
        remote.press(.menu)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Upcoming")).firstMatch.waitForExistence(timeout: 30), "Menu returns to the Library")
        assertOneFocus("back on the Library")
    }

    func testLiveTVTakesFocus() {
        openTab("Live TV")
        XCTAssertTrue(btn("Guide").waitForExistence(timeout: patience), "Live TV shows its List and Guide switch")
        press(.right, "Right on Live TV")
        press(.down, "Down on Live TV")
        press(.down, "Down again on Live TV")
        press(.up, "Up on Live TV")
    }

    func testSearchTakesFocus() {
        openTab("Search")
        press(.down, "Down on Search")
        press(.right, "Right on Search")
    }

    func testSettingsOpensAPageAndMenuReturns() {
        openTab("Settings")
        let general = app.descendants(matching: .any).matching(identifier: "settings-row-general").firstMatch
        expectExists(general, "Settings lists its pages")
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
        XCTAssertTrue(general.waitForExistence(timeout: 30), "Menu returns to the Settings list")
        assertOneFocus("back on the Settings list")
    }
}
