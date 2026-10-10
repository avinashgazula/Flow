import Foundation

/// A streaming service tile on Home: its TMDb watch-provider id and, when the viewer's region list had it, the logo.
public struct StreamingService: Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var logoPath: String?

    public init(id: Int, name: String, logoPath: String? = nil) {
        self.id = id
        self.name = name
        self.logoPath = logoPath
    }

    /// The shelf a tile opens: what's popular on the service in the viewer's region.
    public func query(region: String, type: MediaType = .movie) -> DiscoverQuery {
        var query = DiscoverQuery(type: type)
        query.watchProviders = [id]
        query.watchRegion = region
        return query
    }
}

public enum StreamingServices {
    /// The major services, in tile order. `aliases` are TMDb's alternate ids for the same service
    /// (several list a second, regional entry).
    static let featured: [(id: Int, name: String, aliases: [Int])] = [
        (8, "Netflix", []),
        (350, "Apple TV+", []),
        (337, "Disney+", []),
        (9, "Prime Video", [119]),
        (1899, "Max", [384]),
        (15, "Hulu", []),
        (531, "Paramount+", []),
        (386, "Peacock", [387]),
    ]

    /// Names and ids only, for when the region's provider list couldn't be fetched.
    public static let fallback: [StreamingService] = featured.map { StreamingService(id: $0.id, name: $0.name) }

    /// The featured services present in a region's provider list, with TMDb's logos. A service the region
    /// doesn't carry is dropped; with no list at all every service shows by name.
    public static func resolve(available: [WatchProvider]) -> [StreamingService] {
        guard !available.isEmpty else { return fallback }
        let byID = Dictionary(available.map { ($0.providerId, $0) }, uniquingKeysWith: { first, _ in first })
        return featured.compactMap { service in
            guard let provider = ([service.id] + service.aliases).compactMap({ byID[$0] }).first else { return nil }
            return StreamingService(id: provider.providerId, name: service.name, logoPath: provider.logoPath)
        }
    }
}

/// A genre tile on Home.
public struct GenreTile: Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String

    /// The shelf a tile opens: the genre's most popular films.
    public var query: DiscoverQuery {
        var query = DiscoverQuery(type: .movie)
        query.genres = [id]
        return query
    }
}

extension GenreTile {
    /// TMDb movie genre ids, in tile order.
    public static let featured: [GenreTile] = [
        GenreTile(id: 28, name: "Action"),
        GenreTile(id: 35, name: "Comedy"),
        GenreTile(id: 18, name: "Drama"),
        GenreTile(id: 878, name: "Sci-Fi"),
        GenreTile(id: 27, name: "Horror"),
        GenreTile(id: 53, name: "Thriller"),
        GenreTile(id: 16, name: "Animation"),
        GenreTile(id: 10749, name: "Romance"),
        GenreTile(id: 99, name: "Documentary"),
        GenreTile(id: 80, name: "Crime"),
        GenreTile(id: 14, name: "Fantasy"),
        GenreTile(id: 9648, name: "Mystery"),
    ]
}
