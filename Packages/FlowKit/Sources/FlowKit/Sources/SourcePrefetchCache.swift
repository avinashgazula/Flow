import Foundation

/// Sources collected ahead of Play, kept for a few minutes so the picker can open with results already there.
public struct SourcePrefetchCache: Sendable {
    public var lifetime: TimeInterval
    private var entries: [String: (storedAt: Date, sources: [StreamSource])] = [:]

    public init(lifetime: TimeInterval = 5 * 60) { self.lifetime = lifetime }

    /// nil when nothing was stored for the request or it has gone stale.
    public func sources(for request: PlaybackRequest, now: Date = Date()) -> [StreamSource]? {
        guard let entry = entries[request.id], now.timeIntervalSince(entry.storedAt) < lifetime else { return nil }
        return entry.sources
    }

    public mutating func store(_ sources: [StreamSource], for request: PlaybackRequest, now: Date = Date()) {
        entries = entries.filter { now.timeIntervalSince($0.value.storedAt) < lifetime }
        entries[request.id] = (now, sources)
    }
}
