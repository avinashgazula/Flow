import XCTest
@testable import FlowKit

/// The link that logs an app in to a Marquee Account. The shared vectors (testdata/contracts/account-link.json) run in
/// ContractTests; these are the rest: the shape of the value, the words of each refusal, and what the apps do with it.
final class AccountLinkTests: XCTestCase {
    private let number = "1234567890123456"
    private let server = "https://example.workers.dev"

    func testRoundTrip() throws {
        let link = try AccountLink(number: "1234 5678 9012 3456", server: "Example.workers.dev/path")
        XCTAssertEqual(link.url, "flow://account?n=1234567890123456&s=https%3A%2F%2Fexample.workers.dev")
        XCTAssertEqual(try AccountLink.parse(link.url), link)
        XCTAssertEqual(link.number, number)
        XCTAssertEqual(link.server, server)
    }

    func testWhatAConfirmationSays() throws {
        let link = try AccountLink(number: number, server: "http://localhost:8787")
        XCTAssertEqual(link.lastFour, "3456")
        XCTAssertEqual(link.serverHost, "localhost")
        XCTAssertEqual(try AccountLink(number: number, server: server).serverHost, "example.workers.dev")
    }

    func testAnyOrderAndExtraParametersAreFine() throws {
        let link = try AccountLink.parse("flow://account?utm=x&s=https%3A%2F%2Fexample.workers.dev&n=1234567890123456&t=ignored#top")
        XCTAssertEqual(link, try AccountLink(number: number, server: server))
    }

    func testPercentEncodedNumberAndServerAreDecoded() throws {
        XCTAssertEqual(try AccountLink.parse("flow://account?n=1234%205678%209012%203456&s=https%3A%2F%2Fexample.workers.dev%2Fa%2Fb").number, number)
        XCTAssertEqual(try AccountLink.parse("flow://account?n=1234567890123456&s=https%3A%2F%2Fexample.workers.dev%2Fa%2Fb").server, server)
        XCTAssertEqual(try AccountLink.parse("flow://account?n=1234567890123456&s=http%3A%2F%2Flocalhost%3A8787").server, "http://localhost:8787")
    }

    func testTheFirstOfARepeatedParameterCounts() throws {
        let link = try AccountLink.parse("flow://account?n=1234567890123456&n=6543210987654321&s=https%3A%2F%2Ffirst.dev&s=https%3A%2F%2Fsecond.dev")
        XCTAssertEqual(link.number, number)
        XCTAssertEqual(link.server, "https://first.dev")
    }

    func testABadNumberSaysSo() {
        for text in ["", "123456789012345", "12345678901234567", "123456789012345a"] {
            XCTAssertThrowsError(try AccountLink.parse("flow://account?n=\(text)&s=https%3A%2F%2Fexample.workers.dev"), text) {
                XCTAssertEqual($0 as? AccountLinkError, .incompleteNumber)
            }
        }
        XCTAssertThrowsError(try AccountLink.parse("flow://account?s=https%3A%2F%2Fexample.workers.dev")) { XCTAssertEqual($0 as? AccountLinkError, .incompleteNumber) }
    }

    func testABadOrMissingServerSaysSo() {
        for text in ["flow://account?n=1234567890123456", "flow://account?n=1234567890123456&s=", "flow://account?n=1234567890123456&s=ftp%3A%2F%2Fa.dev", "flow://account?n=1234567890123456&s=https%3A%2F%2F"] {
            XCTAssertThrowsError(try AccountLink.parse(text), text) { XCTAssertEqual($0 as? AccountLinkError, .invalidServer) }
        }
    }

    func testOtherTextIsNotAnAccountLink() {
        for text in ["", "hello", "flow://account", "flow://sync?n=1234567890123456&s=https%3A%2F%2Fa.dev", "https://account?n=1234567890123456&s=https%3A%2F%2Fa.dev"] {
            XCTAssertThrowsError(try AccountLink.parse(text), text) { XCTAssertEqual($0 as? AccountLinkError, .invalidLink) }
        }
    }

    func testEveryRefusalSaysWhatToDoNext() {
        for error in [AccountLinkError.invalidLink, .incompleteNumber, .invalidServer] {
            XCTAssertTrue(error.errorDescription?.contains("Open it again") == true)
        }
    }

    func testTheAppRoutesAnAccountLink() {
        let text = "flow://account?n=1234567890123456&s=https%3A%2F%2Fexample.workers.dev"
        XCTAssertEqual(URL(string: text).flatMap(FlowLink.init(url:)), .account(text))
        XCTAssertNil(URL(string: "flow://accounts?n=1").flatMap(FlowLink.init(url:)))
    }

    func testGarbageNeverCrashes() {
        for text in ["flow://account?", "flow://account?&&&", "flow://account?n", "flow://account?n=%", "flow://account?n=%zz&s=%", "flow://account?=&=", "flow://account?n=1234567890123456&s=%E0%A4%A"] {
            _ = try? AccountLink.parse(text)
        }
    }
}

final class AccountLinkPlanTests: XCTestCase {
    private let link = try! AccountLink(number: "1234567890123456", server: "https://example.workers.dev")
    private let builtIn = "https://built-in.workers.dev"

    func testLoggedOutOnABuildWithNoServerSavesTheLinksServer() {
        let plan = AccountLinkPlan(link: link, current: nil, builtInServer: nil)
        XCTAssertEqual(plan.relation, .loggedOut)
        XCTAssertFalse(plan.serverConflict)
        XCTAssertEqual(plan.serverToSave, "https://example.workers.dev")
    }

    func testABuildWithTheSameServerNeedsNoQuestionAndSavesNothing() {
        let plan = AccountLinkPlan(link: link, current: nil, builtInServer: "https://example.workers.dev")
        XCTAssertEqual(plan.relation, .loggedOut)
        XCTAssertFalse(plan.serverConflict)
        XCTAssertNil(plan.serverToSave)
    }

    func testABuildWithAnotherServerAsksWhichAndSavesNothing() {
        let plan = AccountLinkPlan(link: link, current: nil, builtInServer: builtIn)
        XCTAssertTrue(plan.serverConflict)
        XCTAssertNil(plan.serverToSave)
    }

    func testTheSameAccountIsJustSaid() {
        let current = AccountCredentials(number: "1234567890123456", server: "https://example.workers.dev")
        XCTAssertEqual(AccountLinkPlan(link: link, current: current, builtInServer: nil).relation, .sameAccount)
    }

    func testAnotherNumberAsksBeforeSwitching() {
        let current = AccountCredentials(number: "6543210987654321", server: "https://example.workers.dev")
        XCTAssertEqual(AccountLinkPlan(link: link, current: current, builtInServer: nil).relation, .otherAccount)
    }

    func testTheSameNumberOnAnotherServerIsAnotherAccount() {
        let current = AccountCredentials(number: "1234567890123456", server: "https://elsewhere.workers.dev")
        XCTAssertEqual(AccountLinkPlan(link: link, current: current, builtInServer: nil).relation, .otherAccount)
    }
}
