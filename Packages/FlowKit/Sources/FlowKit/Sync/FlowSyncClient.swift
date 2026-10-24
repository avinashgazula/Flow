import Foundation

/// What the Worker stores and answers with: `{"rev", "blob", "updatedAt"}`.
public struct FlowSyncRecord: Equatable, Sendable {
    public var rev: Int
    public var blob: String
    public var updatedAt: String?
    public init(rev: Int, blob: String, updatedAt: String? = nil) {
        self.rev = rev
        self.blob = blob
        self.updatedAt = updatedAt
    }
}

/// Talks to `/sync/<id>` on the owner's Worker (docs/SYNC.md, "Worker API"). Everything it sends is already
/// encrypted; the Worker never sees what is inside.
public struct FlowSyncClient: Sendable {
    public enum WriteResult: Equatable, Sendable {
        case written(rev: Int)
        /// The stored revision wasn't the one this write was based on: merge with this and write again.
        case conflict(FlowSyncRecord)
    }

    public let server: URL
    public let token: String
    public let derived: FlowSyncDerived
    let http: HTTPClient
    let sealer: FlowSyncSealer

    public init(pairing: FlowSyncPairing, http: HTTPClient = HTTPClient(), sealer: FlowSyncSealer = FlowSyncCrypto.platform) throws {
        guard let key = pairing.key else { throw FlowSyncError.incompleteKey }
        guard let server = pairing.serverURL else { throw FlowSyncError.invalidServer }
        self.server = server
        self.token = pairing.token
        self.derived = key.derived
        self.http = http
        self.sealer = sealer
    }

    private var recordURL: URL {
        URL(string: server.absoluteString + "/sync/" + derived.id) ?? server
    }

    private func request(_ method: HTTPMethod, body: (rev: Int, blob: String)? = nil) throws -> HTTPRequest {
        var headers = ["Authorization": "Bearer " + derived.auth]
        if !token.isEmpty { headers["X-Flow-Token"] = token }
        var request = HTTPRequest(method, url: recordURL, headers: headers)
        if let body {
            struct Body: Encodable { var rev: Int; var blob: String }
            try request.setJSONBody(Body(rev: body.rev, blob: body.blob))
        }
        return request
    }

    /// Sends the request and hands every status back, so each route can say what its statuses mean.
    private func send(_ request: HTTPRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await http.data(request, acceptStatus: 200..<600)
            return (data, response.statusCode)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as FlowError {
            switch error {
            case .offline, .timedOut, .cancelled: throw error
            default: throw FlowSyncError.unreachable
            }
        } catch {
            throw FlowSyncError.unreachable
        }
    }

    static func failure(status: Int) -> FlowSyncError {
        switch status {
        case 401: return .unreachable
        case 403: return .keyMismatch
        case 413: return .tooLarge
        case 501: return .needsKV
        default: return .server(status: status)
        }
    }

    private struct RecordBody: Decodable {
        var rev: Int
        var blob: String
        var updatedAt: String?
        var record: FlowSyncRecord { FlowSyncRecord(rev: rev, blob: blob, updatedAt: updatedAt) }
    }

    /// The stored record, or nil when there isn't one yet.
    public func get() async throws -> FlowSyncRecord? {
        let (data, status) = try await send(request(.get))
        switch status {
        case 200:
            guard let body = try? JSONDecoder().decode(RecordBody.self, from: data) else { throw FlowSyncError.unexpectedResponse }
            return body.record
        case 404: return nil
        default: throw Self.failure(status: status)
        }
    }

    /// `rev` is the revision this write is based on, 0 for a new record.
    public func put(rev: Int, blob: String) async throws -> WriteResult {
        let (data, status) = try await send(request(.put, body: (rev, blob)))
        switch status {
        case 200:
            struct Written: Decodable { var rev: Int }
            guard let written = try? JSONDecoder().decode(Written.self, from: data) else { throw FlowSyncError.unexpectedResponse }
            return .written(rev: written.rev)
        case 409:
            guard let body = try? JSONDecoder().decode(RecordBody.self, from: data) else { throw FlowSyncError.unexpectedResponse }
            return .conflict(body.record)
        case 404: throw FlowSyncError.unexpectedResponse
        default: throw Self.failure(status: status)
        }
    }

    /// Removes the record, so no other device can sync until someone turns sync on again.
    public func delete() async throws {
        let (_, status) = try await send(request(.delete))
        switch status {
        case 200..<300, 404: return
        default: throw Self.failure(status: status)
        }
    }

    public func open(_ record: FlowSyncRecord) throws -> FlowSyncPayload {
        try FlowSyncPayload(plaintext: FlowSyncCrypto.open(record.blob, derived: derived, sealer: sealer))
    }

    public func seal(_ plaintext: Data) throws -> String {
        try FlowSyncCrypto.seal(plaintext, derived: derived, sealer: sealer)
    }
}

/// One round of syncing: read what the server has, merge, and write back if anything is different.
public struct FlowSyncOutcome: Sendable {
    public var state: FlowSyncState
    /// Known sections the server's copy won, with that data, for the app to put into its own settings.
    public var apply: [String: JSONValue]
    public var pushed: Bool
}

public struct FlowSyncEngine: Sendable {
    /// Writes tried before giving up on other devices' changes arriving in between.
    public static let maxAttempts = 3

    public let client: FlowSyncClient
    /// What this device is called in the sections it writes.
    public let device: String

    public init(client: FlowSyncClient, device: String) {
        self.client = client
        self.device = device
    }

    /// `local` is every known section's data on this device (see `FlowSyncMapping.sections`).
    public func sync(local: [String: JSONValue], state: FlowSyncState, now: Date = Date()) async throws -> FlowSyncOutcome {
        var record = try await client.get()
        // A record that was there before and is gone was erased on another device: writing it back would undo that.
        if record == nil && state.rev > 0 { throw FlowSyncError.erased }

        if let record, record.rev == state.rev, state.lastPushedHash != nil, Self.unchanged(local: local, state: state) {
            var next = state
            next.lastSyncedAt = now
            return FlowSyncOutcome(state: next, apply: [:], pushed: false)
        }

        var attempt = 0
        while true {
            attempt += 1
            let remote = try record.map { try client.open($0) }
            let result = FlowSyncMerge.merge(local: local, state: state, remote: remote, device: device, now: now)
            let plaintext = try result.payload.plaintext()
            let hash = FlowSyncKDF.sha256Hex(plaintext)

            var next = state
            next.sections = result.stamps
            next.lastPushedHash = hash
            next.lastSyncedAt = now

            // The merge came out the same as the server's copy (read back the same way), so there's nothing to send.
            if let record, let remote, try remote.plaintext() == plaintext {
                next.rev = record.rev
                return FlowSyncOutcome(state: next, apply: result.apply, pushed: false)
            }

            switch try await client.put(rev: record?.rev ?? 0, blob: client.seal(plaintext)) {
            case .written(let rev):
                next.rev = rev
                return FlowSyncOutcome(state: next, apply: result.apply, pushed: true)
            case .conflict(let latest):
                if attempt >= Self.maxAttempts { throw FlowSyncError.tooManyConflicts }
                record = latest
            }
        }
    }

    /// Nothing on this device differs from what it last synced.
    static func unchanged(local: [String: JSONValue], state: FlowSyncState) -> Bool {
        FlowSyncSectionName.all.allSatisfy { name in
            guard let data = local[name] else { return true }
            if let stamp = state.sections[name] { return stamp.dataHash == FlowSyncJSON.hash(data) }
            return FlowSyncMapping.isBlank(data, section: name)
        }
    }
}
