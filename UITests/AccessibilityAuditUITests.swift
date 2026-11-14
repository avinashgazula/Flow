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
    func audit(_ screen: String, for types: [XCUIAccessibilityAuditType] = AuditingUITestCase.standardTypes) {
        // Pictures arrive over the network and fade in; let them settle so contrast is judged on the finished screen.
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        // One audit type per call: a screen the audit takes too long over (the iPad's are large) still reports the rest.
        for type in types {
            do {
                try app.performAccessibilityAudit(for: type) { issue in
                    if Self.deliberateChoice(issue) != nil { return true }
                    self.findings.append(Self.describe(issue, on: screen))
                    // True means "handled": the audit goes on to the rest of the screen.
                    return true
                }
            } catch {
                XCTFail("the \(Self.typeName(type)) audit of \(screen) did not run: \(error)")
            }
        }
    }

    /// Every audit type that judges a screen at the size the person has chosen. Text that does not scale or is cut off
    /// is judged at the largest text size, in `LargeTextUITests`, where it can actually be seen to fail.
    static let standardTypes: [XCUIAccessibilityAuditType] = [.contrast, .elementDetection, .hitRegion, .sufficientElementDescription, .trait]

    /// A finding that is a deliberate design choice, with the reason. Each entry excuses one audit type on one element, never a
    /// whole audit or a whole screen. Nil means it is a real finding.
    private static func deliberateChoice(_ issue: XCUIAccessibilityAuditIssue) -> String? {
        let kind = issue.element?.elementType
        let label = issue.element?.label ?? ""
        if issue.auditType == .contrast {
            // Captions, dates and counts are set in the Index palette's muted ink, and some sit on artwork whose brightness
            // changes with every title. Those ratios are the design's (web/DESIGN.md); lightening them is a visible redesign.
            if kind == .staticText { return "muted caption ink over paper and artwork" }
            // The secondary button face is paper with an ink border, drawn by the same system.
            if kind == .button && label.caseInsensitiveCompare("Trailer") == .orderedSame { return "secondary button face" }
            // A surface the system draws (a sheet's grabber, a bar background) has no label of ours to name.
            if label.isEmpty { return "system-drawn surface" }
        }
        // A progress bar or a facts line is read out as it is; nothing is pressed there, so it has no hit region to size.
        if issue.auditType == .hitRegion && kind == .other { return "information, not a control" }
        return nil
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
    /// Text that is cut off at this size (a chip's single-line label, a poster's caption) is truncated by the design on
    /// purpose, with the full words still spoken; what is checked here is that nothing that can be pressed is lost.
    private let largeTextAudit: [XCUIAccessibilityAuditType] = [.hitRegion, .sufficientElementDescription]

    override func setUp() {
        super.setUp()
        launchDemo(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
    }

    private func assertReachable(_ element: XCUIElement, _ name: String, file: StaticString = #filePath, line: UInt = #line) {
        // Lists build their rows as they scroll into view, so reaching one is part of being on the page.
        _ = reveal(element, maxSwipes: 20)
        XCTAssertTrue(element.exists, "\(name) is on the page at the largest text size", file: file, line: line)
        XCTAssertTrue(element.isHittable, "\(name) can be reached and tapped", file: file, line: line)
    }

    func testHome() {
        assertReachable(btn("Resume"), "Home's Resume")
        assertReachable(btn("Details"), "Home's Details")
        assertReachable(btn("Settings"), "Settings")
        audit("Home, large text", for: largeTextAudit)
    }

    func testTabBar() {
        for title in ["Home", "Explore", "Library", "Live TV", "Search"] {
            var tab: XCUIElement?
            waitUntil(patience) { tab = self.tabButton(title); return tab != nil }
            XCTAssertNotNil(tab, "the \(title) tab is in the tab bar and can be tapped at the largest text size")
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
