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
    /// Where the first request ended up after redirects (debrid links bounce through a resolver);
    /// later requests go straight there.
    private var resolvedURL: URL?
    /// How much the first request reads: enough for the header and the opening clusters, in one round trip.
    private let headSize: Int64

    public init(url: URL, headers: [String: String] = [:], transport: HTTPTransport = URLSessionTransport(), headSize: Int64 = 3 * 1024 * 1024) {
        self.url = url
        self.headers = headers
        self.transport = transport
        self.headSize = headSize
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
        let isHead = head == nil && range.lowerBound < headSize
        let lower = isHead ? 0 : range.lowerBound
        let fetchUpper = isHead ? max(upper, headSize) : upper
        // Big reads (4K segments) go out as parallel range requests: CDNs often cap each connection.
        if !isHead, !parallelRefused, knownLength != nil, fetchUpper - lower >= 2 * parallelChunk {
            do {
                return try await parallelFetch(lower..<fetchUpper)
            } catch {
                // Some hosts limit connections per file: carry on one request at a time.
                parallelRefused = true
            }
        }
        var bytes = try await fetch(lower..<fetchUpper)
        // Some servers cap how much one range response carries; ask again for the rest.
        while Int64(bytes.count) < fetchUpper - lower, !bytes.isEmpty {
            let next = lower + Int64(bytes.count)
            if let length = knownLength, next >= length { break }
            let more = try await fetch(next..<fetchUpper)
            if more.isEmpty { break }
            bytes += more
        }
        if isHead {
            head = (0..<Int64(bytes.count), bytes)
            let from = Int(range.lowerBound)
            guard from < bytes.count else { return [] }
            return Array(bytes[from..<min(bytes.count, from + Int(upper - range.lowerBound))])
        }
        return Array(bytes.prefix(Int(upper - range.lowerBound)))
    }

    /// Each part of a big read (at least this size; at most `parallelism` parts at once).
    private let parallelChunk: Int64 = 4 * 1024 * 1024
    private let parallelism = 4
    private var parallelRefused = false

    private func parallelFetch(_ range: Range<Int64>) async throws -> [UInt8] {
        let total = range.upperBound - range.lowerBound
        let size = max(parallelChunk, (total + Int64(parallelism) - 1) / Int64(parallelism))
        let parts = stride(from: range.lowerBound, to: range.upperBound, by: Int(size)).map { $0..<min($0 + size, range.upperBound) }
        let pieces = try await withThrowingTaskGroup(of: (Int, [UInt8]).self) { group in
            for (index, part) in parts.enumerated() {
                group.addTask { (index, try await self.complete(part)) }
            }
            var out = [[UInt8]](repeating: [], count: parts.count)
            for try await (index, bytes) in group { out[index] = bytes }
            return out
        }
        return pieces.flatMap { $0 }
    }

    /// One range, re-requesting the remainder from servers that cap a response's size.
    private func complete(_ range: Range<Int64>) async throws -> [UInt8] {
        var bytes = try await fetch(range)
        while Int64(bytes.count) < range.upperBound - range.lowerBound, !bytes.isEmpty {
            let more = try await fetch((range.lowerBound + Int64(bytes.count))..<range.upperBound)
            if more.isEmpty { break }
            bytes += more
        }
        return bytes
    }

    private func fetch(_ range: Range<Int64>) async throws -> [UInt8] {
        var request = URLRequest(url: resolvedURL ?? url, timeoutInterval: 30)
        // CDNs in front of debrid resolvers reject requests without a real client name (Cloudflare 1010).
        request.setValue("Flow/1.0 (AppleCoreMedia compatible)", forHTTPHeaderField: "User-Agent")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.setValue("bytes=\(range.lowerBound)-\(range.upperBound - 1)", forHTTPHeaderField: "Range")
        var attempt = 0
        while true {
            do {
                let (data, response) = try await transport.send(request)
                switch response.statusCode {
                case 206:
                    if let total = Self.total(from: response.value(forHTTPHeaderField: "Content-Range")) { knownLength = total }
                    if resolvedURL == nil, let final = response.url, final != url { resolvedURL = final }
                    return [UInt8](data)
                case 200:
                    // The server ignored Range and sent the whole file. That only works for a small file
                    // read from the start; anything bigger can't be seeked.
                    guard range.lowerBound == 0, Int64(data.count) <= max(Int64(range.count), headSize) else {
                        throw MatroskaError.unsupported("this server doesn't support seeking (no range requests)")
                    }
                    knownLength = Int64(data.count)
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
                // A resolved link can expire; start again from the original.
                if resolvedURL != nil { resolvedURL = nil; request.url = url }
                // About four seconds of patience in all: enough to ride out a Wi-Fi handover.
                if attempt >= 4 { throw error }
                try await Task.sleep(nanoseconds: 500_000_000 << UInt64(attempt - 1))
            }
        }
    }

    /// "bytes 0-1023/146515" → 146515
    static func total(from contentRange: String?) -> Int64? {
        guard let contentRange, let slash = contentRange.lastIndex(of: "/") else { return nil }
        return Int64(contentRange[contentRange.index(after: slash)...])
    }
}
