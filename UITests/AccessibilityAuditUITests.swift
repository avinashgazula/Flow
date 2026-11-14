import XCTest

/// Runs Apple's accessibility audit (`performAccessibilityAudit`: missing labels, hit regions too small, contrast, text
/// that does not scale or is clipped) and collects every finding, so one run lists them all instead of stopping at the first.
/// A test fails at its end if anything was found that is not on the list of deliberate choices below.
class AuditingUITestCase: FlowUITestCase {
    private var findings: [String] = []

    override func setUp() {
        super.setUp()
        findings = []
    }

    override func tearDown() {
        XCTAssertTrue(findings.isEmpty, "\(findings.count) accessibility findings:\n" + findings.joined(separator: "\n"))
        super.tearDown()
    }

    /// Audits what is on screen now. `screen` names it in the findings.
    func audit(_ screen: String, for types: XCUIAccessibilityAuditType = .all) {
        // Pictures arrive over the network and fade in; let them settle so contrast is judged on the finished screen.
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        do {
            try app.performAccessibilityAudit(for: types) { issue in
                if Self.deliberateChoice(issue) != nil { return true }
                self.findings.append(Self.describe(issue, on: screen))
                // True means "handled": the audit goes on to the rest of the screen.
                return true
            }
        } catch {
            XCTFail("the accessibility audit of \(screen) did not run: \(error)")
        }
    }

    /// A finding that is a deliberate design choice, with the reason. Each entry excuses one audit type on one element, never a
    /// whole audit or a whole screen. Nil means it is a real finding.
    private static func deliberateChoice(_ issue: XCUIAccessibilityAuditIssue) -> String? {
        nil
    }

    private static func describe(_ issue: XCUIAccessibilityAuditIssue, on screen: String) -> String {
        let element = issue.element?.debugDescription.replacingOccurrences(of: "\n", with: " ") ?? "no element"
        return "[\(screen)] \(typeName(issue.auditType)): \(issue.compactDescription) | \(issue.detailedDescription) | \(element)"
    }

    private static func typeName(_ type: XCUIAccessibilityAuditType) -> String {
        if type == .contrast { return "contrast" }
        if type == .elementDetection { return "element detection" }
        if type == .hitRegion { return "hit region" }
        if type == .sufficientElementDescription { return "element description" }
        if type == .dynamicType { return "dynamic type" }
        if type == .textClipped { return "text clipped" }
        if type == .trait { return "trait" }
        return "audit type \(type.rawValue)"
    }
}

/// Every main screen on iPhone and iPad, at the normal text size, with the full audit.
final class AccessibilityAuditUITests: AuditingUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    func testHome() {
        XCTAssertTrue(btn("Resume").waitForExistence(timeout: patience))
        audit("Home")
    }

    func testExplore() {
        openTab("Explore")
        XCTAssertTrue(button(startingWith: "Dune: Part Two").waitForExistence(timeout: patience))
        audit("Explore")
    }

    func testLibrary() {
        openTab("Library")
        XCTAssertTrue(button(startingWith: "Upcoming").waitForExistence(timeout: patience))
        audit("Library")
    }

    func testLiveTV() {
        openTab("Live TV")
        let list = btn("Show List")
        if list.waitForExistence(timeout: 3) { list.tap() }
        XCTAssertTrue(button(containing: "Flow News").waitForExistence(timeout: patience))
        audit("Live TV")
    }

    func testSearch() {
        openTab("Search")
        XCTAssertTrue(element("search-field").waitForExistence(timeout: patience))
        audit("Search")
    }

    func testSearchResults() {
        openLink("flow://search?q=oppenheimer")
        XCTAssertTrue(button(startingWith: "Oppenheimer").waitForExistence(timeout: patience))
        audit("Search results")
    }

    func testCalendar() {
        openLink("flow://upcoming")
        XCTAssertTrue(btn("Add All to Calendar").waitForExistence(timeout: patience))
        audit("Upcoming")
    }

    func testMoviePage() {
        openDune()
        audit("Movie page")
    }

    func testShowPage() {
        openLink("flow://title/show/1396")
        XCTAssertTrue(button(startingWith: "Resume").waitForExistence(timeout: patience))
        audit("Show page")
    }

    func testSourceList() {
        openDune()
        button(startingWith: "Resume").tap()
        XCTAssertTrue(element("source-demo#3").waitForExistence(timeout: patience))
        audit("Source list")
    }

    func testSettingsList() {
        btn("Settings").tap()
        XCTAssertTrue(element("settings-row-general").waitForExistence(timeout: patience))
        audit("Settings")
    }

    func testSettingsGeneralPage() {
        btn("Settings").tap()
        let row = element("settings-row-general")
        XCTAssertTrue(row.waitForExistence(timeout: patience))
        row.tap()
        XCTAssertTrue(app.navigationBars["General"].waitForExistence(timeout: patience))
        audit("Settings, General")
    }

    func testPlayerControls() {
        playDuneAndPause()
        audit("Player controls")
    }

    func testPlayerOptionsPanel() {
        playDuneAndPause()
        btn("Options").tap()
        XCTAssertTrue(button(containing: "Speed").waitForExistence(timeout: 10))
        audit("Player options")
    }
}

/// The welcome screen, which only a launch without sample data shows.
final class OnboardingAuditUITests: AuditingUITestCase {
    func testWelcome() {
        launchFresh()
        XCTAssertTrue(element("onboarding-key").waitForExistence(timeout: patience))
        audit("Welcome")
    }
}

/// The same screens at the largest accessibility text size. Everything a person needs must still be on the page and
/// reachable by scrolling, and nothing may be cut off.
final class LargeTextUITests: AuditingUITestCase {
    private let largeTextAudit: XCUIAccessibilityAuditType = [.textClipped, .hitRegion, .sufficientElementDescription]

    override func setUp() {
        super.setUp()
        launchDemo(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
    }

    private func assertReachable(_ element: XCUIElement, _ name: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: patience), "\(name) is on the page at the largest text size", file: file, line: line)
        XCTAssertTrue(reveal(element), "\(name) can be reached and tapped", file: file, line: line)
    }

    func testHome() {
        assertReachable(btn("Resume"), "Home's Resume")
        assertReachable(btn("Details"), "Home's Details")
        assertReachable(btn("Settings"), "Settings")
        audit("Home, large text", for: largeTextAudit)
    }

    func testTabBar() {
        for title in ["Home", "Explore", "Library", "Live TV", "Search"] {
            let inBar = app.tabBars.buttons[title]
            let tab = inBar.exists ? inBar : btn(title)
            XCTAssertTrue(tab.waitForExistence(timeout: patience), "the \(title) tab is in the tab bar")
            XCTAssertTrue(tab.isHittable, "and can be tapped")
        }
    }

    func testExplore() {
        openTab("Explore")
        assertReachable(btn("Filters"), "Filters")
        assertReachable(btn("TV Shows"), "TV Shows")
        audit("Explore, large text", for: largeTextAudit)
    }

    func testLibrary() {
        openTab("Library")
        assertReachable(button(startingWith: "Upcoming"), "the Upcoming row")
        assertReachable(button(startingWith: "Stats"), "the Stats row")
        audit("Library, large text", for: largeTextAudit)
    }

    func testSearch() {
        openTab("Search")
        assertReachable(element("search-field"), "the search field")
        audit("Search, large text", for: largeTextAudit)
    }

    func testMoviePage() {
        openDune()
        assertReachable(button(startingWith: "Resume"), "the Resume button")
        assertReachable(btn("Add to Watchlist"), "the Watchlist action")
        audit("Movie page, large text", for: largeTextAudit)
    }

    func testSourceList() {
        openDune()
        button(startingWith: "Resume").tap()
        assertReachable(element("source-demo#0"), "the first source")
        assertReachable(btn("Close"), "Close")
        audit("Source list, large text", for: largeTextAudit)
    }

    func testSettings() {
        assertReachable(btn("Settings"), "Settings")
        btn("Settings").tap()
        assertReachable(element("settings-row-general"), "the General row")
        assertReachable(btn("Done"), "Done")
        audit("Settings, large text", for: largeTextAudit)
    }
}
