import Foundation

/// The source a title was last played from, remembered so the picker offers it first next time.
/// It describes the release, never its link: settings sync over iCloud and travel in Share Setup,
/// and a debrid or server URL is nobody else's business. For a show it's the release the last
/// episode came from, so the next episode is found in the same one.
public struct LastSource: Codable, Hashable, Sendable {
    public var providerID: String
    public var filename: String?
    public var bingeGroup: String?
    public var releaseGroup: String?
    public var resolution: VideoResolution
    public var quality: ReleaseQuality
    public var hdr: [String]
    public var date: Date

    public init(_ source: StreamSource, date: Date = Date()) {
        providerID = source.providerID
        filename = source.filename
        bingeGroup = source.bingeGroup
        releaseGroup = source.traits.releaseGroup
        resolution = source.traits.resolution
        quality = source.traits.quality
        hdr = source.traits.hdr
        self.date = date
    }

    /// The playable source in `list` that is this one again: the same file, else (another episode)
    /// the same add-on binge group, else the same release from the same provider. Nil when nothing
    /// is close enough, so the provider's own order stands.
    public func match(in list: [StreamSource]) -> StreamSource? {
        let candidates = list.filter { $0.isPlayable && $0.providerID == providerID }
        if let filename, let same = candidates.first(where: { $0.filename == filename }) { return same }
        if let bingeGroup, let same = candidates.first(where: { $0.bingeGroup == bingeGroup }) { return same }
        guard let releaseGroup else { return nil }
        return candidates.first {
            $0.traits.releaseGroup?.caseInsensitiveCompare(releaseGroup) == .orderedSame
                && $0.traits.resolution == resolution && $0.traits.quality == quality && $0.traits.hdr == hdr
        }
    }

    /// Keeps the most recent `limit` titles, so the list never grows without end.
    public static func pruned(_ all: [String: LastSource], limit: Int = 300) -> [String: LastSource] {
        guard all.count > limit else { return all }
        return Dictionary(uniqueKeysWithValues: all.sorted { $0.value.date > $1.value.date }.prefix(limit).map { ($0.key, $0.value) })
    }
}
