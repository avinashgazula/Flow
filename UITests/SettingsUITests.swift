import XCTest

/// Settings opens as a sheet from Home. What the Settings tests share: a launch on sample data and the way into the list.
class SettingsUITestCase: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchDemo()
    }

    func openSettings(file: StaticString = #filePath, line: UInt = #line) {
        let settings = btn("Settings")
        XCTAssertTrue(settings.appears(within: patience), "Home has a Settings button", file: file, line: line)
        settings.tap()
        XCTAssertTrue(element("settings-row-general").appears(within: patience), "the Settings list opens", file: file, line: line)
    }

    /// Opens each page from the list and comes back with its Back button. `pages` are the rows by the identifier the app
    /// gives each (`SettingsPage.rawValue`) and the title its page carries.
    func walk(_ pages: [(id: String, title: String)], file: StaticString = #filePath, line: UInt = #line) {
        openSettings(file: file, line: line)
        for page in pages {
            let row = element("settings-row-\(page.id)")
            XCTAssertTrue(reveal(row), "the \(page.title) row can be tapped", file: file, line: line)
            row.tap()
            // A page may title itself more fully than its row does ("Live TV" opens a longer name).
            let bar = app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS[c] %@", page.title)).firstMatch
            XCTAssertTrue(bar.appears(within: patience), "\(page.title) opens a page whose title has that name in it", file: file, line: line)
            bar.buttons.firstMatch.tap()
            XCTAssertTrue(element("settings-row-\(page.id)").appears(within: patience), "Back returns to the list", file: file, line: line)
        }
    }
}

/// Every page in the Settings list opens and Back returns from it, in three parts of five pages. Each part is its own class
/// because parallel testing hands out whole classes: the walk was the suite's longest test, and in three it shares out.
/// Together they cover every row in the list, top to bottom.
final class SettingsFirstPagesUITests: SettingsUITestCase {
    func testGeneralToMediaServersOpenAndBackReturns() {
        walk([("general", "General"), ("account", "Account"), ("sync", "Sync"), ("shelves", "Shelves"), ("mediaServers", "Media Servers")])
    }
}

final class SettingsMiddlePagesUITests: SettingsUITestCase {
    func testWebDAVToShareSetupOpenAndBackReturns() {
        walk([("webDAV", "WebDAV"), ("liveTV", "Live TV"), ("sources", "Sources"), ("dataStorage", "Data & Storage"),
              ("shareSetup", "Share Setup")])
    }
}

final class SettingsLastPagesUITests: SettingsUITestCase {
    func testImportSetupToAboutOpenAndBackReturns() {
        walk([("importSetup", "Import Setup"), ("playback", "Playback"), ("subtitles", "Subtitles"), ("metadata", "Metadata"),
              ("about", "About")])
    }
}

/// The list as a whole: its sheet, its search, and a changed setting taking effect on the screens behind it.
final class SettingsUITests: SettingsUITestCase {
    func testSettingsOpensAsASheetAndDoneClosesIt() {
        openSettings()
        XCTAssertTrue(text("You're exploring sample data").exists, "the sample data is named, with a way to leave it")
        XCTAssertTrue(btn("Leave Demo").exists)
        btn("Done").tap()
        XCTAssertTrue(waitUntilGone(element("settings-row-general"), timeout: 15), "Done closes the sheet")
        waitForHome()
    }

    func testSettingsSearchFindsASettingAndLandsOnItsPage() {
        openSettings()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.appears(within: patience), "Settings has a search field")
        search.tap()
        search.typeText("dolby")
        // Only the pages whose keywords mention Dolby remain.
        XCTAssertTrue(element("settings-row-playback").appears(within: patience), "Playback mentions Dolby Vision")
        XCTAssertTrue(element("settings-row-sources").exists, "so does Sources")
        XCTAssertFalse(element("settings-row-webDAV").exists, "WebDAV does not")
        XCTAssertFalse(element("settings-row-general").exists, "and neither does General")
        element("settings-row-playback").tap()
        XCTAssertTrue(app.navigationBars["Playback"].appears(within: patience), "the result opens its page")
    }

    func testSettingsSearchWithNoMatchSaysSo() {
        openSettings()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.appears(within: patience))
        search.tap()
        search.typeText("zzqqxx")
        XCTAssertTrue(text(startingWith: "No settings match").appears(within: patience), "a search that finds nothing says so")
        XCTAssertFalse(element("settings-row-general").exists)
    }

    func testAChangedSettingTakesEffectOnHome() {
        XCTAssertTrue(leadPrimary.appears(within: patience), "Home has its lead")
        XCTAssertTrue(text(startingWith: "Up Next").appears(within: patience), "and Up Next under it")
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
        XCTAssertTrue(leadPrimary.appears(within: patience), "the lead is still there")
    }
}
