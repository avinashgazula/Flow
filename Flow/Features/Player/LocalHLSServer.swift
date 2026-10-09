import Foundation
import Network
import FlowKit

/// A tiny HTTP server on the loopback interface that hands AVPlayer the HLS a
/// `MatroskaRemuxer` produces. Each playback registers under an unguessable token;
/// nothing is reachable from other devices.
final class LocalHLSServer: @unchecked Sendable {
    static let shared = LocalHLSServer()

    private let queue = DispatchQueue(label: "app.flow.hls-server")
    private let lock = NSLock()
    private var listener: NWListener?
    private var port: UInt16?
    private var readyWaiters: [CheckedContinuation<UInt16, Error>] = []
    private var routes: [String: MatroskaRemuxer] = [:]

    enum ServerError: LocalizedError {
        case couldNotStart(String)
        var errorDescription: String? {
            switch self {
            case .couldNotStart(let reason): return "Flow couldn't start its playback server (\(reason))."
            }
        }
    }

    /// Serves `remuxer` and returns the master playlist URL plus a token for `unregister`.
    func register(_ remuxer: MatroskaRemuxer) async throws -> (url: URL, token: String) {
        let port = try await start()
        let token = UUID().uuidString.lowercased()
        lock.withLock { routes[token] = remuxer }
        return (URL(string: "http://127.0.0.1:\(port)/\(token)/master.m3u8")!, token)
    }

    func unregister(_ token: String) {
        lock.withLock { routes[token] = nil }
    }

    // MARK: Listening

    private func start() async throws -> UInt16 {
        if let port = lock.withLock({ self.port }) { return port }
        return try await withCheckedThrowingContinuation { continuation in
            lock.withLock {
                if let port {
                    continuation.resume(returning: port)
                    return
                }
                readyWaiters.append(continuation)
                guard listener == nil else { return }
                do {
                    let parameters = NWParameters.tcp
                    parameters.requiredInterfaceType = .loopback
                    parameters.acceptLocalOnly = true
                    parameters.allowLocalEndpointReuse = true
                    let listener = try NWListener(using: parameters)
                    listener.stateUpdateHandler = { [weak self] state in self?.listenerChanged(state) }
                    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                    self.listener = listener
                    listener.start(queue: queue)
                } catch {
                    let waiters = readyWaiters
                    readyWaiters = []
                    waiters.forEach { $0.resume(throwing: ServerError.couldNotStart(error.localizedDescription)) }
                }
            }
        }
    }

    private func listenerChanged(_ state: NWListener.State) {
        switch state {
        case .ready:
            let port = listener?.port?.rawValue ?? 0
            let waiters: [CheckedContinuation<UInt16, Error>] = lock.withLock {
                self.port = port
                defer { readyWaiters = [] }
                return readyWaiters
            }
            waiters.forEach { $0.resume(returning: port) }
        case .failed(let error):
            let waiters: [CheckedContinuation<UInt16, Error>] = lock.withLock {
                listener?.cancel()
                listener = nil
                port = nil
                defer { readyWaiters = [] }
                return readyWaiters
            }
            waiters.forEach { $0.resume(throwing: ServerError.couldNotStart(error.localizedDescription)) }
        case .cancelled:
            lock.withLock { listener = nil; port = nil }
        default:
            break
        }
    }

    // MARK: Connections

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    /// Reads one request (headers only; HLS clients send no bodies), answers it, then waits for the next.
    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
                let rest = Data(buffer[end.upperBound...])
                Task { await self.handle(head, on: connection, leftover: rest) }
            } else if error != nil || isComplete || buffer.count > 64 * 1024 {
                connection.cancel()
            } else {
                self.receive(on: connection, buffer: buffer)
            }
        }
    }

    private func handle(_ head: String, on connection: NWConnection, leftover: Data) async {
        let lines = head.components(separatedBy: "\r\n")
        let parts = lines.first?.split(separator: " ") ?? []
        guard parts.count >= 2 else { return send(status: 400, on: connection, keepAlive: false) }
        let method = String(parts[0])
        let target = String(parts[1]).components(separatedBy: "?")[0]
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let keepAlive = headers["connection"]?.lowercased() != "close"

        let pathParts = target.split(separator: "/", maxSplits: 1).map(String.init)
        guard pathParts.count == 2, let remuxer = lock.withLock({ routes[pathParts[0]] }) else {
            return send(status: 404, on: connection, keepAlive: keepAlive, next: leftover)
        }
        do {
            guard let response = try await remuxer.respond(to: pathParts[1]) else {
                return send(status: 404, on: connection, keepAlive: keepAlive, next: leftover)
            }
            let body: Data
            let type: String
            switch response {
            case .playlist(let text): body = Data(text.utf8); type = "application/vnd.apple.mpegurl"
            case .text(let text): body = Data(text.utf8); type = "text/vtt; charset=utf-8"
            case .media(let bytes): body = Data(bytes); type = "video/mp4"
            }
            send(status: 200, type: type, body: body, range: headers["range"], headOnly: method == "HEAD", on: connection, keepAlive: keepAlive, next: leftover)
        } catch {
            send(status: 502, on: connection, keepAlive: false)
        }
    }

    private func send(status: Int, type: String = "text/plain", body: Data = Data(), range: String? = nil, headOnly: Bool = false,
                      on connection: NWConnection, keepAlive: Bool, next: Data = Data()) {
        var status = status
        var payload = body
        var extra: [String] = []
        if status == 200, let range, let slice = Self.byteRange(range, length: body.count) {
            status = 206
            payload = body.subdata(in: slice)
            extra.append("Content-Range: bytes \(slice.lowerBound)-\(slice.upperBound - 1)/\(body.count)")
        }
        let reason = [200: "OK", 206: "Partial Content", 400: "Bad Request", 404: "Not Found", 502: "Bad Gateway"][status] ?? "Error"
        var head = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(payload.count)\r\nAccept-Ranges: bytes\r\nCache-Control: no-cache\r\n"
        head += extra.map { $0 + "\r\n" }.joined()
        head += "Connection: \(keepAlive ? "keep-alive" : "close")\r\n\r\n"
        var data = Data(head.utf8)
        if !headOnly { data.append(payload) }
        connection.send(content: data, completion: .contentProcessed { [weak self] error in
            if keepAlive, error == nil {
                self?.receive(on: connection, buffer: next)
            } else {
                connection.cancel()
            }
        })
    }

    /// "bytes=100-199" or "bytes=100-" within a body of `length` bytes.
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
