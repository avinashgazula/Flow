import Foundation

/// Decides whether a title can be played at home yet.
///
/// Movies: playable once any digital, physical or TV release date has passed.
/// For list results we only know the primary release date, so recent movies (released
/// within `lookupWindowDays`) are checked against `/movie/{id}/release_dates` and cached.
/// Shows: playable once the first episode has aired.
public actor ReleaseFilter {
    public typealias ReleaseLookup = @Sendable (Int) async throws -> [MovieRelease]

    private let lookup: ReleaseLookup
    private var cache: [Int: Bool] = [:]
    private let lookupWindowDays: Double
    /// Movies older than this many days are assumed to be out on home video even without data.
    private let assumeReleasedAfterDays: Double

    public init(lookupWindowDays: Double = 150, assumeReleasedAfterDays: Double = 150, lookup: @escaping ReleaseLookup) {
        self.lookup = lookup
        self.lookupWindowDays = lookupWindowDays
        self.assumeReleasedAfterDays = assumeReleasedAfterDays
    }

    public func isReleased(_ item: MediaItem, now: Date = Date()) async -> Bool {
        if let decided = Self.quickDecision(item, now: now, assumeReleasedAfterDays: assumeReleasedAfterDays) { return decided }
        guard let id = item.ids.tmdb else { return true }
        if let cached = cache[id] { return cached }
        let releases = (try? await lookup(id)) ?? []
        let released = Self.isHomeReleased(releases, now: now) ?? (now.timeIntervalSince(item.releaseDate ?? now) > assumeReleasedAfterDays * 86400)
        cache[id] = released
        return released
    }

    /// Keeps the playable items, preserving order. Lookups run concurrently.
    public func filter(_ items: [MediaItem], now: Date = Date()) async -> [MediaItem] {
        let flags = await withTaskGroup(of: (Int, Bool).self) { group in
            for (index, item) in items.enumerated() {
                group.addTask { (index, await self.isReleased(item, now: now)) }
            }
            var result = [Bool](repeating: true, count: items.count)
            for await (index, flag) in group { result[index] = flag }
            return result
        }
        return zip(items, flags).filter(\.1).map(\.0)
    }

    /// Answers without a network call when possible; nil means "look it up".
    public static func quickDecision(_ item: MediaItem, now: Date, assumeReleasedAfterDays: Double = 150) -> Bool? {
        if let home = item.homeReleaseDate { return home <= now }
        guard let release = item.releaseDate else { return item.type == .show ? true : false }
        if release > now { return false }
        if item.type == .show { return true }
        if now.timeIntervalSince(release) > assumeReleasedAfterDays * 86400 { return true }
        return nil
    }

    /// nil when no release information is available at all.
    public static func isHomeReleased(_ releases: [MovieRelease], now: Date) -> Bool? {
        guard !releases.isEmpty else { return nil }
        return releases.contains { $0.type.isHome && $0.date <= now }
    }
}
