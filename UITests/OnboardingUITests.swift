import XCTest

/// First run: no TMDB key and no sample data, so the welcome screen is all there is. Launched offline, so the key check
/// can only fail, and what it says is what is tested.
final class OnboardingUITests: FlowUITestCase {
    override func setUp() {
        super.setUp()
        launchFresh()
    }

    func testAFreshLaunchShowsTheWelcomeScreenWithItsWaysIn() {
        XCTAssertTrue(element("onboarding-key").waitForExistence(timeout: patience), "the welcome screen has the TMDB key field")
        XCTAssertTrue(text("Marquee").exists, "and the app's name")
        XCTAssertTrue(btn("Continue").exists, "a Continue button")
        XCTAssertTrue(btn("Explore with Sample Data").exists, "a way into the sample data")
        for way in ["Log In to Your Account", "Create an Account", "I Have a Setup From Another Device", "Join Marquee Sync"] {
            XCTAssertTrue(button(startingWith: way).exists, "and \(way)")
        }
        XCTAssertFalse(btn("Details").exists, "no Home behind it")
    }

    func testTheKeyFieldAcceptsTextAndContinueFollowsIt() {
        let field = element("onboarding-key")
        XCTAssertTrue(field.waitForExistence(timeout: patience))
        let continueButton = btn("Continue")
        XCTAssertFalse(continueButton.isEnabled, "Continue waits for a key")
        field.tap()
        field.typeText("not-a-real-key")
        XCTAssertTrue(waitUntil(10) { continueButton.isEnabled }, "typing a key enables Continue")
        XCTAssertNotEqual(field.value as? String, "API key or read-access token", "the field holds what was typed, not its prompt")
    }

    func testAKeyThatCannotBeCheckedSaysWhatToDoNext() {
        let field = element("onboarding-key")
        XCTAssertTrue(field.waitForExistence(timeout: patience))
        field.tap()
        field.typeText("not-a-real-key")
        btn("Continue").tap()
        XCTAssertTrue(text(startingWith: "That key didn't work").waitForExistence(timeout: patience), "a key that fails the check is refused in words")
        XCTAssertTrue(element("onboarding-key").exists, "and the welcome screen stays")
    }

    func testTheSetupFromAnotherDeviceOpensItsSheet() {
        let row = button(startingWith: "I Have a Setup From Another Device")
        XCTAssertTrue(row.waitForExistence(timeout: patience), "the row is there")
        row.tap()
        XCTAssertTrue(btn("Read Setup").waitForExistence(timeout: patience), "the import sheet opens with its Read Setup button")
        XCTAssertFalse(btn("Read Setup").isEnabled, "which waits for a link or a file")
    }
}
