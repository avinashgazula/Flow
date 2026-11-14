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
        let settings = app.buttons["Settings"].firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: patience), "Home has a Settings button", file: file, line: line)
        settings.tap()
        XCTAssertTrue(element("settings-row-general").waitForExistence(timeout: patience), "the Settings list opens", file: file, line: line)
    }

    func testSettingsOpensAsASheetAndDoneClosesIt() {
        openSettings()
        XCTAssertTrue(text("You're exploring sample data").exists, "the sample data is named, with a way to leave it")
        XCTAssertTrue(app.buttons["Leave Demo"].firstMatch.exists)
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(waitUntilGone(element("settings-row-general"), timeout: 15), "Done closes the sheet")
        waitForHome()
    }

    func testEveryPageOpensFromTheListAndBackReturns() {
        openSettings()
        for page in Self.pages {
            let row = element("settings-row-\(page.id)")
            XCTAssertTrue(reveal(row), "the \(page.title) row can be tapped")
            row.tap()
            XCTAssertTrue(app.navigationBars[page.title].waitForExistence(timeout: patience), "\(page.title) opens a page with that title")
            goBack(from: page.title)
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
        XCTAssertTrue(app.buttons["Resume"].firstMatch.waitForExistence(timeout: patience), "Home's lead resumes Breaking Bad")
        openSettings()
        element("settings-row-general").tap()
        let toggle = app.buttons["Show Continue Watching"].firstMatch
        XCTAssertTrue(reveal(toggle), "General has Show Continue Watching")
        XCTAssertEqual(toggle.value as? String, "On", "it starts on")
        toggle.tap()
        XCTAssertTrue(waitUntil(10) { (toggle.value as? String) == "Off" }, "a tap turns it off, and its spoken value says so")
        goBack(from: "General")
        app.buttons["Done"].firstMatch.tap()
        waitForHome()
        // Without Continue Watching the lead is the top pick: it offers Play, not Resume.
        XCTAssertTrue(waitUntilGone(app.buttons["Resume"].firstMatch, timeout: patience), "Home no longer resumes anything")
        XCTAssertTrue(app.buttons["Play"].firstMatch.waitForExistence(timeout: patience), "the lead offers Play instead")
    }
}
