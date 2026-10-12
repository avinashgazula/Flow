import XCTest
@testable import FlowKit

final class NetworkErrorTests: XCTestCase {
    func testConnectionErrorsReadPlainly() {
        XCTAssertEqual(FlowError.from(URLError(.notConnectedToInternet)).localizedDescription,
                       "You're offline. Check your connection and try again.")
        let host = URLError(.cannotFindHost, userInfo: [NSURLErrorFailingURLErrorKey: URL(string: "https://api.themoviedb.org/3/x")!])
        XCTAssertEqual(FlowError.from(host).localizedDescription,
                       "Couldn't reach api.themoviedb.org. Check your connection, or try again in a moment.")
        XCTAssertFalse(FlowError.from(URLError(.secureConnectionFailed)).localizedDescription.contains("NSURL"))
    }

    func testOfflineTransportFailsLikeNoConnection() async {
        let client = HTTPClient(transport: OfflineTransport())
        do {
            _ = try await client.data(HTTPRequest(.get, "https://example.com"))
            XCTFail("should fail")
        } catch {
            XCTAssertEqual(error.localizedDescription, "You're offline. Check your connection and try again.")
        }
    }
}
