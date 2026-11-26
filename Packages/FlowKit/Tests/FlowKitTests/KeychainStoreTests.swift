#if os(macOS)
import Security
import XCTest
@testable import FlowKit

final class KeychainStoreTests: XCTestCase {
    func testLocalCredentialsCanBeCreatedAndUpdated() {
        let service = "FlowKitTests.\(UUID().uuidString)"
        let store = KeychainSecretStore(service: service, synchronizable: false)
        defer {
            SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service] as CFDictionary)
        }
        XCTAssertEqual(store.load(), Credentials())
        var credentials = Credentials()
        credentials.tmdbAPIKey = "first"
        store.save(credentials)
        XCTAssertEqual(store.load(), credentials)
        credentials.tmdbAPIKey = "updated"
        store.save(credentials)
        XCTAssertEqual(store.load(), credentials)
    }

    func testAccountAndPairingCanBeForgottenIndependently() {
        let service = "FlowKitTests.\(UUID().uuidString)"
        let account = KeychainAccountCredentialStore(service: service)
        let pairing = KeychainFlowSyncPairingStore(service: service)
        defer { account.save(nil); pairing.save(nil) }
        XCTAssertNil(account.load())
        XCTAssertNil(pairing.load())
        let credentials = AccountCredentials(number: "fixture", server: "https://example.invalid")
        var link = FlowSyncPairing(keyText: "fixture", server: "https://example.invalid", token: "first")
        account.save(credentials)
        pairing.save(link)
        XCTAssertEqual(account.load(), credentials)
        XCTAssertEqual(pairing.load(), link)
        link.token = "updated"
        pairing.save(link)
        account.save(nil)
        XCTAssertNil(account.load())
        XCTAssertEqual(pairing.load(), link)
        pairing.save(nil)
        XCTAssertNil(pairing.load())
    }
}
#endif
