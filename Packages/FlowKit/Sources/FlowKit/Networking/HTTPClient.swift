import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum HTTPMethod: String, Sendable {
    case get = "GET", post = "POST", put = "PUT", delete = "DELETE", patch = "PATCH"
    case propfind = "PROPFIND", head = "HEAD"
}

public enum FlowError: Error, LocalizedError, Equatable, Sendable {
    case invalidURL(String)
    case http(status: Int, body: String?)
    case decoding(String)
    case missingCredential(String)
    case unauthorized
    case notFound
    case rateLimited(retryAfter: TimeInterval?)
    case unsupported(String)
    case cancelled
    case timedOut
    case pending

    public var errorDescription: String? {
        switch self {
        case .invalidURL(let url): return "Invalid URL: \(url)"
        case .http(let status, _): return "The server responded with status \(status)."
        case .decoding(let detail): return "Unexpected response: \(detail)"
        case .missingCredential(let name): return "Add your \(name) in Settings to use this feature."
        case .unauthorized: return "Your session expired. Sign in again."
        case .notFound: return "Not found."
        case .rateLimited: return "Too many requests. Try again in a moment."
        case .unsupported(let detail): return detail
        case .cancelled: return "Cancelled."
        case .timedOut: return "The request timed out."
        case .pending: return "Waiting for authorization."
        }
    }
}

/// A request description independent of URLSession so services stay testable.
public struct HTTPRequest: Sendable {
    public var method: HTTPMethod
    public var url: URL
    public var query: [URLQueryItem]
    public var headers: [String: String]
    public var body: Data?
    public var timeout: TimeInterval

    public init(_ method: HTTPMethod = .get, url: URL, query: [URLQueryItem] = [], headers: [String: String] = [:], body: Data? = nil, timeout: TimeInterval = 20) {
        self.method = method
        self.url = url
        self.query = query
        self.headers = headers
        self.body = body
        self.timeout = timeout
    }

    public init(_ method: HTTPMethod = .get, _ string: String, query: [String: String?] = [:], headers: [String: String] = [:], body: Data? = nil, timeout: TimeInterval = 20) throws {
        guard let url = URL(string: string) else { throw FlowError.invalidURL(string) }
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }.sorted { $0.name < $1.name }
        self.init(method, url: url, query: items, headers: headers, body: body, timeout: timeout)
    }

    public mutating func setJSONBody<T: Encodable>(_ value: T, encoder: JSONEncoder = .flow) throws {
        body = try encoder.encode(value)
        headers["Content-Type"] = "application/json"
    }

    public var urlRequest: URLRequest {
        var finalURL = url
        if !query.isEmpty, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.queryItems = (components.queryItems ?? []) + query
            // `+` is legal in queries but many APIs read it as a space.
            components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
            finalURL = components.url ?? url
        }
        var request = URLRequest(url: finalURL, timeoutInterval: timeout)
        request.httpMethod = method.rawValue
        request.httpBody = body
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        if request.value(forHTTPHeaderField: "Accept") == nil {
            request.setValue("application/json", forHTTPHeaderField: "Accept")
        }
        return request
    }
}

public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    public let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw FlowError.decoding("Non-HTTP response") }
            return (data, http)
        } catch let error as URLError {
            switch error.code {
            case .cancelled: throw FlowError.cancelled
            case .timedOut: throw FlowError.timedOut
            default: throw error
            }
        }
    }
}

/// Thin JSON-over-HTTP client shared by every service.
public struct HTTPClient: Sendable {
    public var transport: HTTPTransport
    public var userAgent: String

    public init(transport: HTTPTransport = URLSessionTransport(), userAgent: String = "Flow/1.0") {
        self.transport = transport
        self.userAgent = userAgent
    }

    @discardableResult
    public func data(_ request: HTTPRequest, acceptStatus: Range<Int> = 200..<300) async throws -> (Data, HTTPURLResponse) {
        var urlRequest = request.urlRequest
        if urlRequest.value(forHTTPHeaderField: "User-Agent") == nil {
            urlRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        }
        let (data, response) = try await transport.send(urlRequest)
        guard acceptStatus.contains(response.statusCode) else {
            switch response.statusCode {
            case 401, 403: throw FlowError.unauthorized
            case 404: throw FlowError.notFound
            case 429:
                let retry = (response.value(forHTTPHeaderField: "Retry-After")).flatMap(TimeInterval.init)
                throw FlowError.rateLimited(retryAfter: retry)
            default:
                throw FlowError.http(status: response.statusCode, body: String(data: data.prefix(500), encoding: .utf8))
            }
        }
        return (data, response)
    }

    public func json<T: Decodable>(_ type: T.Type = T.self, _ request: HTTPRequest, decoder: JSONDecoder = .flow) async throws -> T {
        let (data, _) = try await data(request)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw FlowError.decoding("\(T.self): \(error)")
        }
    }

    public func send(_ request: HTTPRequest) async throws {
        _ = try await data(request)
    }
}

// MARK: - Coders

extension JSONDecoder {
    /// Accepts the date shapes used by TMDb ("2024-05-01"), Trakt (ISO-8601 with fractions) and others.
    public static var flow: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let seconds = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: seconds > 10_000_000_000 ? seconds / 1000 : seconds)
            }
            let string = try container.decode(String.self)
            if let date = FlowDate.parse(string) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognised date \(string)")
        }
        return decoder
    }
}

extension JSONEncoder {
    public static var flow: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(FlowDate.iso8601String(date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

public enum FlowDate {
    private static let lock = NSLock()
    nonisolated(unsafe) private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    nonisolated(unsafe) private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    nonisolated(unsafe) private static let spaceFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    public static func parse(_ raw: String) -> Date? {
        let string = raw.trimmingCharacters(in: .whitespaces)
        guard !string.isEmpty else { return nil }
        lock.lock(); defer { lock.unlock() }
        if let d = isoFractional.date(from: string) { return d }
        if let d = iso.date(from: string) { return d }
        // Jellyfin emits 7 fractional digits, which ISO8601DateFormatter rejects.
        if string.contains("T"), let dot = string.firstIndex(of: ".") {
            let trimmed = String(string[..<dot]) + (string.hasSuffix("Z") ? "Z" : "")
            if let d = iso.date(from: trimmed.hasSuffix("Z") ? trimmed : trimmed + "Z") { return d }
        }
        if let d = spaceFormatter.date(from: string) { return d }
        if string.count >= 10, let d = dayFormatter.date(from: String(string.prefix(10))) { return d }
        return nil
    }

    public static func day(_ date: Date) -> String {
        lock.lock(); defer { lock.unlock() }
        return dayFormatter.string(from: date)
    }

    public static func iso8601String(_ date: Date) -> String {
        lock.lock(); defer { lock.unlock() }
        return isoFractional.string(from: date)
    }
}

/// Decodes a value that may arrive as a number or a numeric string.
public struct LossyInt: Codable, Hashable, Sendable {
    public var value: Int?
    public init(_ value: Int?) { self.value = value }
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) { value = i }
        else if let d = try? c.decode(Double.self) { value = Int(d) }
        else if let s = try? c.decode(String.self) { value = Int(s) ?? Double(s).map { Int($0) } }
        else { value = nil }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}

public struct LossyDouble: Codable, Hashable, Sendable {
    public var value: Double?
    public init(_ value: Double?) { self.value = value }
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self) { value = Double(s) }
        else { value = nil }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}

/// Decodes any JSON value; handy for loosely specified APIs.
public enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var string: String? {
        switch self {
        case .string(let s): return s
        case .number(let n): return n.rounded() == n ? String(Int(n)) : String(n)
        default: return nil
        }
    }

    public var double: Double? {
        switch self {
        case .number(let n): return n
        case .string(let s): return Double(s)
        default: return nil
        }
    }

    public var int: Int? { double.map { Int($0) } }
    public var array: [JSONValue]? { if case .array(let a) = self { return a }; return nil }
    public var object: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }
    public var bool: Bool? {
        switch self {
        case .bool(let b): return b
        case .number(let n): return n != 0
        case .string(let s): return ["1", "true", "yes"].contains(s.lowercased())
        default: return nil
        }
    }
}
