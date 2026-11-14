import XCTest
@testable import FlowKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A scripted server for client tests: rules answer by method, path and query, every request is recorded,
/// and anything unscripted is a 404 so a client reaching for the wrong URL fails loudly. Later rules win.
/// (MockTransport matches a path suffix only and can't tell a GET from a POST.)
final class StubTransport: HTTPTransport, @unchecked Sendable {
    struct Rule {
        var method: String?
        var path: String
        var query: [String]
        var respond: @Sendable (URLRequest) -> (Int, Data, [String: String])
    }

    private let lock = NSLock()
    private var rules: [Rule] = []
    private var log: [URLRequest] = []
    private var failures: [String: Error] = [:]

    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return log }

    /// Answers requests whose path ends with `path`, whose method is `method` (any when nil) and whose
    /// query string contains every `query` fragment.
    @discardableResult
    func on(_ method: String? = nil, _ path: String, query: [String] = [], status: Int = 200, json: String = "{}", headers: [String: String] = [:]) -> StubTransport {
        let data = Data(json.utf8)
        return on(method, path, query: query) { _ in (status, data, headers) }
    }

    @discardableResult
    func on(_ method: String? = nil, _ path: String, query: [String] = [], _ respond: @escaping @Sendable (URLRequest) -> (Int, Data, [String: String])) -> StubTransport {
        lock.lock(); defer { lock.unlock() }
        rules.append(Rule(method: method, path: path, query: query, respond: respond))
        return self
    }

    /// Fails every request whose path ends with `path` as a dropped connection would.
    func fail(_ path: String, with error: Error = URLError(.notConnectedToInternet)) {
        lock.lock(); defer { lock.unlock() }
        failures[path] = error
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.lock()
        log.append(request)
        let path = request.url?.path ?? ""
        let query = request.url?.query ?? ""
        let failure = failures.first { path.hasSuffix($0.key) }?.value
        let rule = rules.last { rule in
            path.hasSuffix(rule.path) && (rule.method == nil || rule.method == request.httpMethod) && rule.query.allSatisfy { query.contains($0) }
        }
        lock.unlock()
        if let failure { throw failure }
        let (status, data, headers) = rule?.respond(request) ?? (404, Data("{}".utf8), [:])
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!)
    }

    // MARK: Inspecting what was sent

    func requests(_ method: String? = nil, path: String) -> [URLRequest] {
        requests.filter { $0.url?.path.hasSuffix(path) == true && (method == nil || $0.httpMethod == method) }
    }

    /// Query items of a request as a dictionary (the last of a repeated name wins).
    static func query(_ request: URLRequest) -> [String: String] {
        var out: [String: String] = [:]
        for item in URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? [] { out[item.name] = item.value ?? "" }
        return out
    }

    static func body(_ request: URLRequest) -> [String: Any] {
        (request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }
}
