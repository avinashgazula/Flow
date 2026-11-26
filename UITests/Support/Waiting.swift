import XCTest

extension XCUIElement {
    /// Whether the element is there now or turns up within `timeout`. XCTest's own `waitForExistence(timeout:)` first looks
    /// only after a second has passed, so every wait costs at least that, even for an element already on screen; at several
    /// hundred waits a run that was minutes. This looks at once, then four times a second. Shared by the iPhone, iPad and
    /// Apple TV tests.
    func appears(within timeout: TimeInterval) -> Bool {
        if exists { return true }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
            if exists { return true }
        }
        return false
    }
}
