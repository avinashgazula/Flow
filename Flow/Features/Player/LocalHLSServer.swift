import Foundation
import FlowKit
#if canImport(Darwin)
import Darwin
#endif

/// A tiny HTTP server on 127.0.0.1 that hands AVPlayer the HLS a `MatroskaRemuxer` produces.
/// Each playback registers under an unguessable token; nothing is reachable from other devices.
///
/// Plain BSD sockets rather than Network.framework: on iOS and tvOS, AVPlayer fetches HLS from a
/// system media process, and those connections are dropped by an NWListener restricted to loopback.
final class LocalHLSServer: @unchecked Sendable {
    static let shared = LocalHLSServer()

    private let lock = NSLock()
    private var listenFD: Int32 = -1
    private var port: UInt16?
    private var routes: [String: MatroskaRemuxer] = [:]
    private let acceptQueue = DispatchQueue(label: "app.flow.hls.accept")
    private let workQueue = DispatchQueue(label: "app.flow.hls.work", attributes: .concurrent)

    enum ServerError: LocalizedError {
        case couldNotStart(String)
        var errorDescription: String? {
            switch self {
            case .couldNotStart(let reason): return "Flow couldn't start its playback server (\(reason))."
            }
        }
    }

    /// Serves `remuxer` and returns the master playlist URL plus a token for `unregister`.
    func register(_ remuxer: MatroskaRemuxer) throws -> (url: URL, token: String) {
        let port = try start()
        let token = UUID().uuidString.lowercased()
        lock.withLock { routes[token] = remuxer }
        return (URL(string: "http://127.0.0.1:\(port)/\(token)/master.m3u8")!, token)
    }

    func unregister(_ token: String) {
        lock.withLock { routes[token] = nil }
    }

    // MARK: Listening

    private func start() throws -> UInt16 {
        try lock.withLock {
            if let port { return port }
            let fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
            guard fd >= 0 else { throw ServerError.couldNotStart("socket \(errno)") }
            var on: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))

            var address = sockaddr_in()
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET)
            address.sin_port = 0
            address.sin_addr.s_addr = inet_addr("127.0.0.1")
            let bound = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
            }
            guard bound == 0, listen(fd, 32) == 0 else {
                let error = errno
                close(fd)
                throw ServerError.couldNotStart("bind \(error)")
            }
            var actual = sockaddr_in()
            var length = socklen_t(MemoryLayout<sockaddr_in>.size)
            _ = withUnsafeMutablePointer(to: &actual) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) }
            }
            let chosen = UInt16(bigEndian: actual.sin_port)
            listenFD = fd
            port = chosen
            acceptQueue.async { [weak self] in self?.acceptLoop(fd) }
            return chosen
        }
    }

    private func acceptLoop(_ fd: Int32) {
        while true {
            let client = accept(fd, nil, nil)
            if client < 0 {
                if errno == EINTR { continue }
                lock.withLock { if listenFD == fd { listenFD = -1; port = nil } }
                close(fd)
                return
            }
            var on: Int32 = 1
            setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
            var timeout = timeval(tv_sec: 60, tv_usec: 0)
            setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
            workQueue.async { [weak self] in self?.serve(client) }
        }
    }

    // MARK: Requests

    /// HTTP/1.1 keep-alive: AVPlayer reuses one connection for many segment fetches.
    private func serve(_ fd: Int32) {
        defer { close(fd) }
        var pending = [UInt8]()
        var chunk = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            // Read until the end of the request headers.
            var headerEnd: Int?
            while headerEnd == nil {
                if let end = Self.find(pending, [13, 10, 13, 10]) { headerEnd = end; break }
                let n = recv(fd, &chunk, chunk.count, 0)
                if n <= 0 { return }
                pending += chunk[0..<n]
                if pending.count > 64 * 1024 { return }
            }
            let head = String(decoding: pending[0..<headerEnd!], as: UTF8.self)
            pending.removeFirst(headerEnd! + 4)
            let keepAlive = respond(to: head, on: fd)
            if !keepAlive { return }
        }
    }

    /// Answers one request; returns whether the connection stays open.
    private func respond(to head: String, on fd: Int32) -> Bool {
        let lines = head.components(separatedBy: "\r\n")
        let parts = lines.first?.split(separator: " ") ?? []
        guard parts.count >= 2 else { return send(fd, status: 400, keepAlive: false) }
        let method = String(parts[0])
        var target = String(parts[1]).components(separatedBy: "?")[0]
        if let scheme = target.range(of: "://"), let slash = target[scheme.upperBound...].firstIndex(of: "/") {
            target = String(target[slash...]) // absolute-form request target
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let keepAlive = headers["connection"]?.lowercased() != "close"
        let pathParts = target.split(separator: "/", maxSplits: 1).map(String.init)
        guard pathParts.count == 2, let remuxer = lock.withLock({ routes[pathParts[0]] }) else {
            return send(fd, status: 404, keepAlive: keepAlive)
        }

        // The remuxer is async; this worker thread waits for it.
        let semaphore = DispatchSemaphore(value: 0)
        let box = ResponseBox()
        Task.detached {
            do { box.response = try await remuxer.respond(to: pathParts[1]) } catch { box.failed = true }
            semaphore.signal()
        }
        semaphore.wait()

        guard let response = box.response else {
            return send(fd, status: box.failed ? 502 : 404, keepAlive: keepAlive && !box.failed)
        }
        let body: [UInt8]
        let type: String
        switch response {
        case .playlist(let text): body = Array(text.utf8); type = "application/vnd.apple.mpegurl"
        case .text(let text): body = Array(text.utf8); type = "text/vtt; charset=utf-8"
        case .media(let bytes): body = bytes; type = "video/mp4"
        }
        return send(fd, status: 200, type: type, body: body, range: headers["range"], headOnly: method == "HEAD", keepAlive: keepAlive)
    }

    private final class ResponseBox: @unchecked Sendable {
        var response: MatroskaRemuxer.Response?
        var failed = false
    }

    private func send(_ fd: Int32, status: Int, type: String = "text/plain", body: [UInt8] = [], range: String? = nil,
                      headOnly: Bool = false, keepAlive: Bool) -> Bool {
        var status = status
        var payload = body[...]
        var extra = ""
        if status == 200, let range, let slice = Self.byteRange(range, length: body.count) {
            status = 206
            payload = body[slice]
            extra = "Content-Range: bytes \(slice.lowerBound)-\(slice.upperBound - 1)/\(body.count)\r\n"
        }
        let reason = [200: "OK", 206: "Partial Content", 400: "Bad Request", 404: "Not Found", 502: "Bad Gateway"][status] ?? "Error"
        let head = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(payload.count)\r\n"
            + "Accept-Ranges: bytes\r\nCache-Control: no-cache\r\n" + extra
            + "Connection: \(keepAlive ? "keep-alive" : "close")\r\n\r\n"
        guard writeAll(fd, Array(head.utf8)[...]) else { return false }
        if !headOnly, !payload.isEmpty, !writeAll(fd, payload) { return false }
        return keepAlive
    }

    private func writeAll(_ fd: Int32, _ bytes: ArraySlice<UInt8>) -> Bool {
        var offset = bytes.startIndex
        while offset < bytes.endIndex {
            let written = bytes[offset...].withUnsafeBytes { Darwin.send(fd, $0.baseAddress, $0.count, 0) }
            if written < 0 {
                if errno == EINTR { continue }
                return false
            }
            offset += written
        }
        return true
    }

    private static func find(_ haystack: [UInt8], _ needle: [UInt8]) -> Int? {
        guard haystack.count >= needle.count else { return nil }
        for i in 0...(haystack.count - needle.count) where haystack[i] == needle[0] && Array(haystack[i..<(i + needle.count)]) == needle {
            return i
        }
        return nil
    }

    /// "bytes=100-199", "bytes=100-" or "bytes=-500" within a body of `length` bytes.
    static func byteRange(_ header: String, length: Int) -> Range<Int>? {
        guard header.hasPrefix("bytes="), !header.contains(",") else { return nil }
        let bounds = header.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard bounds.count == 2 else { return nil }
        if bounds[0].isEmpty, let suffix = Int(bounds[1]) { return max(0, length - suffix)..<length }
        guard let lower = Int(bounds[0]), lower < length else { return nil }
        let upper = Int(bounds[1]).map { min($0 + 1, length) } ?? length
        return lower < upper ? lower..<upper : nil
    }
}
