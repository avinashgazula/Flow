import Foundation

/// Sources collected ahead of Play, kept for a few minutes so the picker can open with results already there.
public struct SourcePrefetchCache: Sendable {
    public var lifetime: TimeInterval
    private var entries: [String: (storedAt: Date, sources: [StreamSource], complete: Bool)] = [:]

    public init(lifetime: TimeInterval = 5 * 60) { self.lifetime = lifetime }

    /// nil when nothing was stored for the request or it has gone stale.
    public func sources(for request: PlaybackRequest, now: Date = Date()) -> [StreamSource]? {
        guard let entry = entries[request.id], now.timeIntervalSince(entry.storedAt) < lifetime else { return nil }
        return entry.sources
    }

    /// Reuse a complete lookup briefly. Older or partial results still let the picker show rows during a refresh.
    public func recentCompleteSources(for request: PlaybackRequest, now: Date = Date()) -> [StreamSource]? {
        guard let entry = entries[request.id], entry.complete,
              now.timeIntervalSince(entry.storedAt) < min(lifetime, 30) else { return nil }
        return entry.sources
    }

    public mutating func store(_ sources: [StreamSource], for request: PlaybackRequest, complete: Bool = false, now: Date = Date()) {
        entries = entries.filter { now.timeIntervalSince($0.value.storedAt) < lifetime }
        entries[request.id] = (now, sources, complete)
    }

    public mutating func remove(for request: PlaybackRequest) {
        entries.removeValue(forKey: request.id)
    }
}
