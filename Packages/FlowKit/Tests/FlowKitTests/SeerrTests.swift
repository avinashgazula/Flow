import XCTest
@testable import FlowKit

final class SeerrTests: XCTestCase {
    private func client(_ mock: MockTransport) -> SeerrClient {
        SeerrClient(config: SeerrConfig(baseURL: URL(string: "https://seerr.example.com/")!, apiKey: "KEY"), http: HTTPClient(transport: mock))
    }

    func testStatusSendsAPIKey() async throws {
        let mock = MockTransport()
        mock.routes["/api/v1/status"] = (200, #"{"version":"2.1.0","commitTag":"abc"}"#)
        let status = try await client(mock).status()
        XCTAssertEqual(status.version, "2.1.0")
        XCTAssertEqual(mock.requests[0].url?.absoluteString, "https://seerr.example.com/api/v1/status")
        XCTAssertEqual(mock.requests[0].value(forHTTPHeaderField: "X-Api-Key"), "KEY")
    }

    func testMediaStatusDecoding() async throws {
        let mock = MockTransport()
        let seerr = client(mock)
        let cases: [(String, SeerrMediaStatus)] = [
            (#"{"id":1}"#, .notRequested),
            (#"{"id":1,"mediaInfo":{"status":1,"requests":[]}}"#, .notRequested),
            (#"{"id":1,"mediaInfo":{"status":1,"requests":[{"status":3}]}}"#, .notRequested),
            (#"{"id":1,"mediaInfo":{"status":1,"requests":[{"status":1}]}}"#, .pending),
            (#"{"id":1,"mediaInfo":{"status":2,"requests":[{"status":1}]}}"#, .pending),
            (#"{"id":1,"mediaInfo":{"status":3,"requests":[{"status":2}]}}"#, .processing),
            (#"{"id":1,"mediaInfo":{"status":1,"requests":[{"status":2}]}}"#, .processing),
            (#"{"id":1,"mediaInfo":{"status":4}}"#, .partiallyAvailable),
            (#"{"id":1,"mediaInfo":{"status":5}}"#, .available),
        ]
        for (body, expected) in cases {
            mock.routes["/api/v1/tv/1399"] = (200, body)
            let status = try await seerr.mediaStatus(type: .show, tmdbID: 1399)
            XCTAssertEqual(status, expected, body)
        }
        mock.routes["/api/v1/movie/603"] = (200, #"{"id":603,"mediaInfo":{"status":5}}"#)
        let movie = try await seerr.mediaStatus(type: .movie, tmdbID: 603)
        XCTAssertEqual(movie, .available)
        let missing = try await seerr.mediaStatus(type: .movie, tmdbID: 999)
        XCTAssertEqual(missing, .notRequested)
        XCTAssertTrue(SeerrMediaStatus.partiallyAvailable.canRequest)
        XCTAssertFalse(SeerrMediaStatus.pending.canRequest)
    }

    func testRequestBodies() async throws {
        let mock = MockTransport()
        mock.routes["/api/v1/request"] = (201, "{}")
        let seerr = client(mock)
        try await seerr.request(type: .movie, tmdbID: 603)
        try await seerr.request(type: .show, tmdbID: 1399)
        try await seerr.request(type: .show, tmdbID: 1399, seasons: .only([1, 2]))
        let bodies = mock.requests.map { String(data: $0.httpBody ?? Data(), encoding: .utf8) }
        XCTAssertEqual(bodies[0], #"{"mediaId":603,"mediaType":"movie"}"#)
        XCTAssertEqual(bodies[1], #"{"mediaId":1399,"mediaType":"tv","seasons":"all"}"#)
        XCTAssertEqual(bodies[2], #"{"mediaId":1399,"mediaType":"tv","seasons":[1,2]}"#)
        XCTAssertEqual(mock.requests[0].httpMethod, "POST")
        XCTAssertEqual(mock.requests[0].value(forHTTPHeaderField: "X-Api-Key"), "KEY")
        XCTAssertEqual(mock.requests[0].value(forHTTPHeaderField: "Content-Type"), "application/json")
    }
}
