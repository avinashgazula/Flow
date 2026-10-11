import Foundation

/// A user-supplied set of rating icons: a JSON array of {"name", "url"}, names as in `RatingSource.rawValue`.
public struct RatingIconPack: Hashable, Sendable {
    public var icons: [RatingSource: URL]

    public init(icons: [RatingSource: URL] = [:]) { self.icons = icons }

    public subscript(source: RatingSource) -> URL? { icons[source] }

    private struct Entry: Decodable {
        var name: String
        var url: String
    }

    /// Entries with unknown names or unusable URLs are skipped, so one typo doesn't lose the whole pack.
    /// Throws only when the data isn't an array of objects at all.
    public static func decode(_ data: Data) throws -> RatingIconPack {
        let entries = try JSONDecoder().decode([Entry].self, from: data)
        var icons: [RatingSource: URL] = [:]
        for entry in entries {
            let name = entry.name.trimmingCharacters(in: .whitespaces).lowercased()
            guard let source = RatingSource(rawValue: name),
                  let url = URL(string: entry.url.trimmingCharacters(in: .whitespaces)),
                  let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { continue }
            icons[source] = url
        }
        return RatingIconPack(icons: icons)
    }
}
