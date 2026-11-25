import XCTest

/// Settings opens as a sheet from Home. Every page in its list opens, its search finds a setting, and a changed setting
/// takes effect on the screens behind it.
final class SettingsUITests: FlowUITestCase {
    /// The rows of the list, by the identifier the app gives each (`SettingsPage.rawValue`) and the title its page carries.
    private static let pages: [(id: String, title: String)] = [
        ("general", "General"), ("account", "Account"), ("sync", "Sync"), ("shelves", "Shelves"),
        ("mediaServers", "Media Servers"), ("webDAV", "WebDAV"), ("liveTV", "Live TV"), ("sources", "Sources"),
        ("dataStorage", "Data & Storage"), ("shareSetup", "Share Setup"), ("importSetup", "Import Setup"),
        ("playback", "Playback"), ("subtitles", "Subtitles"), ("metadata", "Metadata"), ("about", "About"),
    ]

    override func setUp() {
        super.setUp()
        launchDemo()
    }

    private func openSettings(file: StaticString = #filePath, line: UInt = #line) {
        let settings = btn("Settings")
        XCTAssertTrue(settings.waitForExistence(timeout: patience), "Home has a Settings button", file: file, line: line)
        settings.tap()
        XCTAssertTrue(element("settings-row-general").waitForExistence(timeout: patience), "the Settings list opens", file: file, line: line)
    }

    func testSettingsOpensAsASheetAndDoneClosesIt() {
        openSettings()
        XCTAssertTrue(text("You're exploring sample data").exists, "the sample data is named, with a way to leave it")
        XCTAssertTrue(btn("Leave Demo").exists)
        btn("Done").tap()
        XCTAssertTrue(waitUntilGone(element("settings-row-general"), timeout: 15), "Done closes the sheet")
        waitForHome()
    }

    func testEveryPageOpensFromTheListAndBackReturns() {
        openSettings()
        for page in Self.pages {
            let row = element("settings-row-\(page.id)")
            XCTAssertTrue(reveal(row), "the \(page.title) row can be tapped")
            row.tap()
            // A page may title itself more fully than its row does ("Live TV" opens a longer name).
            let bar = app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS[c] %@", page.title)).firstMatch
            XCTAssertTrue(bar.waitForExistence(timeout: patience), "\(page.title) opens a page whose title has that name in it")
            bar.buttons.firstMatch.tap()
            XCTAssertTrue(element("settings-row-\(page.id)").waitForExistence(timeout: patience), "Back returns to the list")
        }
    }

    func testSettingsSearchFindsASettingAndLandsOnItsPage() {
        openSettings()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: patience), "Settings has a search field")
        search.tap()
        search.typeText("dolby")
        // Only the pages whose keywords mention Dolby remain.
        XCTAssertTrue(element("settings-row-playback").waitForExistence(timeout: patience), "Playback mentions Dolby Vision")
        XCTAssertTrue(element("settings-row-sources").exists, "so does Sources")
        XCTAssertFalse(element("settings-row-webDAV").exists, "WebDAV does not")
        XCTAssertFalse(element("settings-row-general").exists, "and neither does General")
        element("settings-row-playback").tap()
        XCTAssertTrue(app.navigationBars["Playback"].waitForExistence(timeout: patience), "the result opens its page")
    }

    func testSettingsSearchWithNoMatchSaysSo() {
        openSettings()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: patience))
        search.tap()
        search.typeText("zzqqxx")
        XCTAssertTrue(text(startingWith: "No settings match").waitForExistence(timeout: patience), "a search that finds nothing says so")
        XCTAssertFalse(element("settings-row-general").exists)
    }

    func testAChangedSettingTakesEffectOnHome() {
        XCTAssertTrue(leadPrimary.waitForExistence(timeout: patience), "Home has its lead")
        XCTAssertTrue(text(startingWith: "Up Next").waitForExistence(timeout: patience), "and Up Next under it")
        openSettings()
        element("settings-row-general").tap()
        // The custom switch carries the toggle trait, so the system calls it a switch, not a button.
        let toggle = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", "Show Continue Watching")).firstMatch
        XCTAssertTrue(reveal(toggle), "General has Show Continue Watching")
        XCTAssertTrue(["On", "1"].contains(toggle.value as? String ?? ""), "it starts on, got \(String(describing: toggle.value))")
        toggle.tap()
        XCTAssertTrue(waitUntil(10) { ["Off", "0"].contains(toggle.value as? String ?? "") }, "a tap turns it off, and its spoken value says so")
        goBack(from: "General")
        btn("Done").tap()
        waitForHome()
        // Without Continue Watching Up Next is gone from Home, and the lead (always the top picks) is still there.
        XCTAssertTrue(waitUntilGone(text(startingWith: "Up Next"), timeout: patience), "Home no longer lists what is in progress")
        XCTAssertTrue(leadPrimary.waitForExistence(timeout: patience), "the lead is still there")
    }
}
