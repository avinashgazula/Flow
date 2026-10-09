import Foundation

/// High-level catalogue used by the UI: shelves, hydration of tracker keys, details and ratings,
/// with caching and the "unreleased titles" / "only my server's content" filters applied.
public actor CatalogService {
    public nonisolated let tmdb: TMDBClient
    let cache: ResponseCache
    let releaseFilter: ReleaseFilter
    var mdblist: MDBListClient?
    var trakt: TraktClient?

    public init(tmdb: TMDBClient, cache: ResponseCache, mdblist: MDBListClient? = nil, trakt: TraktClient? = nil) {
        self.tmdb = tmdb
        self.cache = cache
        self.mdblist = mdblist
        self.trakt = trakt
        let client = tmdb
        releaseFilter = ReleaseFilter { id in try await client.releaseDates(movieID: id) }
    }

    public func update(mdblist: MDBListClient?, trakt: TraktClient?) {
        self.mdblist = mdblist
        self.trakt = trakt
    }

    /// Filters that depend on settings and live state.
    public struct Filters: Sendable {
        public var showUnreleased: Bool
        public var onlyServerContent: Bool
        public var serverIndex: MediaServerIndex?

        public init(showUnreleased: Bool, onlyServerContent: Bool, serverIndex: MediaServerIndex?) {
            self.showUnreleased = showUnreleased
            self.onlyServerContent = onlyServerContent
            self.serverIndex = serverIndex
        }
    }

    public func apply(_ filters: Filters, to items: [MediaItem], exemptFromRelease: Bool) async -> [MediaItem] {
        var list = items
        if filters.onlyServerContent, let index = filters.serverIndex {
            var kept: [MediaItem] = []
            for item in list where await index.contains(item) { kept.append(item) }
            list = kept
        }
        if !filters.showUnreleased && !exemptFromRelease {
            list = await releaseFilter.filter(list)
        }
        return list
    }

    // MARK: Lists

    let listMaxAge: TimeInterval = 60 * 30
    let detailMaxAge: TimeInterval = 60 * 60 * 12

    var lang: String { tmdb.language }

    public func trending(_ type: MediaType, page: Int = 1) async throws -> Page<MediaItem> {
        let client = tmdb
        let items = try await cache.cached("trending:\(type.rawValue):\(page):\(lang)", maxAge: listMaxAge) {
            let p = try await client.trending(type, page: page)
            return CachedPage(items: p.items, page: p.page, totalPages: p.totalPages)
        }
        return Page(items: items.items, page: items.page, totalPages: items.totalPages)
    }

    public func list(_ list: TMDBList, type: MediaType, page: Int = 1) async throws -> Page<MediaItem> {
        let client = tmdb
        let items = try await cache.cached("list:\(list.rawValue):\(type.rawValue):\(page):\(lang)", maxAge: listMaxAge) {
            let p = try await client.list(list, type: type, page: page)
            return CachedPage(items: p.items, page: p.page, totalPages: p.totalPages)
        }
        return Page(items: items.items, page: items.page, totalPages: items.totalPages)
    }

    public func discover(_ query: DiscoverQuery, page: Int = 1) async throws -> Page<MediaItem> {
        let client = tmdb
        let key = "discover:\((try? SettingsCodec.encode(query)).map { String(decoding: $0, as: UTF8.self) } ?? ""):\(page):\(lang)"
        let items = try await cache.cached(key, maxAge: listMaxAge) {
            let p = try await client.discover(query, page: page)
            return CachedPage(items: p.items, page: p.page, totalPages: p.totalPages)
        }
        return Page(items: items.items, page: items.page, totalPages: items.totalPages)
    }

    struct CachedPage: Codable, Sendable { var items: [MediaItem]; var page: Int; var totalPages: Int }

    // MARK: Hydration

    public func item(_ key: MediaKey) async throws -> MediaItem {
        let client = tmdb
        return try await cache.cached("item:\(key):\(lang)", maxAge: detailMaxAge) {
            try await client.item(key.type, id: key.tmdbID)
        }
    }

    /// Resolves tracker keys to displayable items, preserving order and skipping failures.
    public func items(_ keys: [MediaKey], limit: Int = 60) async -> [MediaItem] {
        let wanted = Array(keys.prefix(limit))
        let results = await withTaskGroup(of: (Int, MediaItem?).self) { group in
            for (i, key) in wanted.enumerated() {
                group.addTask { (i, try? await self.item(key)) }
            }
            var out = [MediaItem?](repeating: nil, count: wanted.count)
            for await (i, item) in group { out[i] = item }
            return out
        }
        return results.compactMap { $0 }
    }

    public func details(_ type: MediaType, id: Int) async throws -> MediaDetail {
        let client = tmdb
        return try await cache.cached("detail:\(type.rawValue):\(id):\(lang)", maxAge: detailMaxAge) {
            try await client.details(type, id: id)
        }
    }

    public func person(_ id: Int) async throws -> Person {
        let client = tmdb
        return try await cache.cached("person:\(id):\(lang)", maxAge: detailMaxAge) { try await client.person(id) }
    }

    public func collection(_ id: Int) async throws -> MediaCollection {
        let client = tmdb
        return try await cache.cached("collection:\(id):\(lang)", maxAge: detailMaxAge) { try await client.collection(id) }
    }

    public func logo(for item: MediaItem) async -> String? {
        if let logo = item.logoPath { return logo }
        guard let id = item.ids.tmdb else { return nil }
        let client = tmdb
        return try? await cache.cached("logo:\(item.type.rawValue):\(id):\(lang)", maxAge: detailMaxAge * 4) {
            try await client.logoPath(item.type, id: id) ?? ""
        }.nilIfEmpty
    }

    /// MDBList ratings, filled in with TMDb's own score and Trakt's when available.
    public func ratings(for item: MediaItem) async -> Ratings {
        var ratings = Ratings(tmdb: item.voteAverage)
        guard let id = item.ids.tmdb else { return ratings }
        if let mdblist {
            let key = "ratings:\(item.type.rawValue):\(id)"
            if let r = try? await cache.cached(key, maxAge: 60 * 60 * 24, { try await mdblist.ratings(item.type, tmdbID: id) }) {
                ratings = r.merged(with: ratings)
            }
        }
        if ratings.trakt == nil, let trakt, let slug = item.ids.imdb ?? item.ids.traktSlug {
            ratings.trakt = try? await trakt.rating(item.type, id: slug)
        }
        return ratings
    }

    public func search(_ text: String) async throws -> [SearchResult] {
        try await tmdb.search(text).results
    }

    public func clearCache() async { await cache.clear() }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
