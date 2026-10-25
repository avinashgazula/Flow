import Foundation

/// What this device remembers between syncs: for each section when it last changed (the time it carries in the
/// payload) and a hash of the data as this device had it then. A section whose data no longer matches its
/// hash has changed here since, and only then does its time move forward.
public struct FlowSyncState: Codable, Equatable, Sendable {
    public struct Stamp: Codable, Equatable, Sendable {
        public var updatedAt: Date
        public var dataHash: String
        public var device: String?
        public init(updatedAt: Date, dataHash: String, device: String?) {
            self.updatedAt = updatedAt
            self.dataHash = dataHash
            self.device = device
        }
    }

    public var sections: [String: Stamp] = [:]
    /// The server's revision this device last saw, which the next write builds on.
    public var rev = 0
    /// Hash of the payload as last sent (or found already in place), so nothing goes up unless it differs.
    public var lastPushedHash: String?
    public var lastSyncedAt: Date?

    public init() {}
}

/// The merge of this device's sections with the server's. Pure, so every rule has a test.
public enum FlowSyncMerge {
    public struct Result: Sendable {
        public var payload: FlowSyncPayload
        /// Known sections the server's copy won, with that data, for the app to apply.
        public var apply: [String: JSONValue]
        public var stamps: [String: FlowSyncState.Stamp]
    }

    /// `local` is every known section's data on this device. A section is a change here when its data no
    /// longer matches the hash in `state`; a section never seen before counts as a change only if the server has nothing
    /// real for it, so a new device joining a sync never wipes it with its own empty settings.
    public static func merge(local: [String: JSONValue], state: FlowSyncState, remote: FlowSyncPayload?, device: String, now rawNow: Date) -> Result {
        // Times travel in whole seconds, so a change is stamped with the second it happened in.
        let now = Date(timeIntervalSince1970: rawNow.timeIntervalSince1970.rounded(.down))
        var merged = remote ?? FlowSyncPayload()
        var apply: [String: JSONValue] = [:]
        var stamps: [String: FlowSyncState.Stamp] = [:]

        for name in FlowSyncSectionName.all {
            guard let data = local[name] else { continue }
            let hash = FlowSyncJSON.hash(data)
            let remoteSection = remote?.sections[name]

            // This device's side: when it last changed, as far as the payload is concerned.
            let localTime: Date
            var localDevice = device
            if let stamp = state.sections[name] {
                if stamp.dataHash == hash {
                    localTime = stamp.updatedAt
                    localDevice = stamp.device ?? device
                } else {
                    // Times are to the second, so a change right after the last one would tie with it and lose.
                    localTime = max(now, stamp.updatedAt.addingTimeInterval(1))
                }
            } else if let remoteSection, !FlowSyncMapping.isBlank(remoteSection.data, section: name) {
                localTime = .distantPast
            } else if FlowSyncMapping.isBlank(data, section: name) && remoteSection == nil {
                // Nothing here and nothing there: no section yet.
                continue
            } else {
                localTime = now
            }

            guard let remoteSection else {
                merged.sections[name] = FlowSyncSection(updatedAt: localTime, device: localDevice, data: data)
                stamps[name] = .init(updatedAt: localTime, dataHash: hash, device: localDevice)
                continue
            }

            let carried = overlay(data, onto: remoteSection.data)
            let normalized = FlowSyncMapping.normalized(remoteSection.data, section: name, over: data)
            let remoteTime = remoteSection.updatedAt
            let remoteWins: Bool
            if remoteTime > localTime {
                remoteWins = true
            } else if remoteTime < localTime {
                remoteWins = false
            } else if normalized == data || carried == remoteSection.data {
                remoteWins = true
            } else {
                // Same moment, different data: both devices pick the same one, so they settle.
                remoteWins = canonical(remoteSection.data) >= canonical(carried)
            }

            if remoteWins {
                if normalized != data { apply[name] = remoteSection.data }
                stamps[name] = .init(updatedAt: remoteTime, dataHash: FlowSyncJSON.hash(normalized), device: remoteSection.device)
            } else {
                var section = remoteSection
                section.fields["updatedAt"] = .string(FlowSyncTime.string(localTime))
                section.fields["device"] = .string(localDevice)
                section.fields["data"] = carried
                merged.sections[name] = section
                stamps[name] = .init(updatedAt: localTime, dataHash: hash, device: localDevice)
            }
        }
        return Result(payload: merged, apply: apply, stamps: stamps)
    }

    /// `local` laid over `remote`: everything local says wins, and whatever only the server's copy has
    /// (fields a newer app added) stays. List items are matched by `id`, or by `url` where there is none.
    static func overlay(_ local: JSONValue, onto remote: JSONValue) -> JSONValue {
        switch (local, remote) {
        case (.object(let l), .object(let r)):
            var out = r
            for (key, value) in l { out[key] = r[key].map { overlay(value, onto: $0) } ?? value }
            return .object(out)
        case (.array(let l), .array(let r)):
            return .array(l.map { item in
                guard let identity = identity(item), let match = r.first(where: { self.identity($0) == identity }) else { return item }
                return overlay(item, onto: match)
            })
        default:
            return local
        }
    }

    private static func identity(_ value: JSONValue) -> String? {
        guard case .object(let object) = value else { return nil }
        if let id = object["id"]?.string { return "id:" + id }
        if let url = object["url"]?.string { return "url:" + url }
        return nil
    }

    private static func canonical(_ value: JSONValue) -> String {
        (try? FlowSyncJSON.canonical(value)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }
}
