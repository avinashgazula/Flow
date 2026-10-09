import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Reads a remote file with HTTP range requests, the way the remuxer needs: small reads for the
/// header and index, then one request per segment.
public actor HTTPByteSource: ByteSource {
    public let url: URL
    public let headers: [String: String]
    private let transport: HTTPTransport
    private var knownLength: Int64?
    private var head: (range: Range<Int64>, bytes: [UInt8])?

    public init(url: URL, headers: [String: String] = [:], transport: HTTPTransport = URLSessionTransport()) {
        self.url = url
        self.headers = headers
        self.transport = transport
    }

    public func length() async throws -> Int64? {
        if knownLength == nil { _ = try await read(0..<1) }
        return knownLength
    }

    public func read(_ range: Range<Int64>) async throws -> [UInt8] {
        guard !range.isEmpty else { return [] }
        if let length = knownLength, range.lowerBound >= length { return [] }
        let upper = knownLength.map { min(range.upperBound, $0) } ?? range.upperBound
        // Header parsing makes many small reads near the start; serve them from the first chunk.
        if let head, head.range.lowerBound <= range.lowerBound, upper <= head.range.upperBound {
            let from = Int(range.lowerBound - head.range.lowerBound)
            return Array(head.bytes[from..<(from + Int(upper - range.lowerBound))])
        }
        let fetchUpper = range.lowerBound == 0 ? max(upper, 256 * 1024) : upper
        let bytes = try await fetch(range.lowerBound..<fetchUpper)
        if range.lowerBound == 0 { head = (0..<Int64(bytes.count), bytes) }
        return Array(bytes.prefix(Int(upper - range.lowerBound)))
    }

    private func fetch(_ range: Range<Int64>) async throws -> [UInt8] {
        var request = URLRequest(url: url, timeoutInterval: 30)
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.setValue("bytes=\(range.lowerBound)-\(range.upperBound - 1)", forHTTPHeaderField: "Range")
        var attempt = 0
        while true {
            do {
                let (data, response) = try await transport.send(request)
                switch response.statusCode {
                case 206:
                    if let total = Self.total(from: response.value(forHTTPHeaderField: "Content-Range")) { knownLength = total }
                    return [UInt8](data)
                case 200:
                    // The server ignored Range: fine only for a read from the start.
                    knownLength = Int64(data.count)
                    guard range.lowerBound == 0 else { throw MatroskaError.unsupported("this server doesn't support seeking (no range requests)") }
                    return [UInt8](data.prefix(Int(range.count)))
                case 416:
                    return []
                default:
                    throw FlowError.http(status: response.statusCode, body: nil)
                }
            } catch let error as MatroskaError {
                throw error
            } catch {
                attempt += 1
                if attempt >= 3 { throw error }
                try await Task.sleep(nanoseconds: UInt64(attempt) * 600_000_000)
            }
        }
    }

    /// "bytes 0-1023/146515" → 146515
    static func total(from contentRange: String?) -> Int64? {
        guard let contentRange, let slash = contentRange.lastIndex(of: "/") else { return nil }
        return Int64(contentRange[contentRange.index(after: slash)...])
    }
}
