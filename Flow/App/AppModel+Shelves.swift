import SwiftUI
import FlowKit

extension AppModel {
    var catalogFilters: CatalogService.Filters {
        CatalogService.Filters(showUnreleased: settings.metadata.showUnreleasedTitles,
                               onlyServerContent: settings.mediaServers.onlyShowServerContent && !settings.mediaServers.servers.isEmpty,
                               serverIndex: serverIndex)
    }

    func requireCatalog() throws -> CatalogService {
        guard let catalog else { throw FlowError.missingCredential("TMDb API key") }
        return catalog
    }

    /// One page of a shelf. Sources without paging return everything on page 1.
    func page(for shelf: ShelfConfig, page: Int = 1) async throws -> Page<MediaItem> {
        let catalog = try requireCatalog()
        var exempt = false
        var result: Page<MediaItem>

        func single(_ items: [MediaItem]) -> Page<MediaItem> { Page(items: page == 1 ? items : [], page: page, totalPages: 1) }

        switch shelf.source {
        case .builtIn(let builtIn):
            exempt = builtIn.showsUpcomingByDesign
            switch builtIn {
            case .continueWatching, .nextUp:
                result = single(await catalog.items(continueWatching.map(\.key)))
            case .watchlist:
                result = single(await hydrate(watchlistKeys))
            case .favourites:
                result = single(await hydrate(favouriteKeys))
            case .recentlyWatched:
                var seen = Set<MediaKey>()
                result = single(await hydrate(history.map(\.key).filter { seen.insert($0).inserted }))
            case .trendingMovies: result = try await catalog.trending(.movie, page: page)
            case .trendingShows: result = try await catalog.trending(.show, page: page)
            case .popularMovies: result = try await catalog.list(.popular, type: .movie, page: page)
            case .popularShows: result = try await catalog.list(.popular, type: .show, page: page)
            case .topRatedMovies: result = try await catalog.list(.topRated, type: .movie, page: page)
            case .topRatedShows: result = try await catalog.list(.topRated, type: .show, page: page)
            case .nowPlaying: result = try await catalog.list(.nowPlaying, type: .movie, page: page)
            case .upcomingMovies: result = try await catalog.list(.upcoming, type: .movie, page: page)
            case .airingToday: result = try await catalog.list(.airingToday, type: .show, page: page)
            case .anticipatedMovies, .anticipatedShows:
                let type: MediaType = builtIn == .anticipatedMovies ? .movie : .show
                if let trakt {
                    result = single(await catalog.items(try await trakt.anticipated(type)))
                } else {
                    var q = DiscoverQuery(type: type)
                    q.releasedFromDays = 1
                    q.releasedToDays = 365
                    result = try await catalog.discover(q, page: page)
                }
            case .recommendedForYou:
                if let trakt, credentials.traktToken != nil {
                    async let movies = trakt.recommendations(.movie)
                    async let shows = trakt.recommendations(.show)
                    let keys = zip(try await movies, try await shows).flatMap { [$0, $1] }
                    result = single(await catalog.items(keys))
                } else if let recent = history.first {
                    let detail = try await catalog.details(recent.key.type, id: recent.key.tmdbID)
                    result = single(detail.recommendations)
                } else {
                    result = try await catalog.trending(.movie, page: page)
                }
            case .mediaServerRecent:
                result = single(await serverRecentlyAdded())
            }
        case .discover(let query):
            exempt = query.targetsFuture
            result = try await catalog.discover(query, page: page)
        case .traktList(let user, let slug):
            guard let trakt else { throw FlowError.missingCredential("Trakt client ID") }
            result = single(await catalog.items(try await trakt.listItems(user: user, slug: slug), limit: 100))
        case .mdblist(let id):
            guard let mdblist else { throw FlowError.missingCredential("MDBList API key") }
            result = single(await catalog.items(try await mdblist.listItems(id), limit: 100))
        case .mediaServerLibrary(let serverID, let libraryID):
            guard let server = mediaServers.first(where: { $0.config.id == serverID }) else { throw FlowError.notFound }
            let items = try await server.items(inLibrary: libraryID, limit: 60)
            result = single(await displayItems(for: items))
            exempt = true
        }
        result.items = await catalog.apply(catalogFilters, to: result.items, exemptFromRelease: exempt)
        return result
    }

    /// Hydrates keys, preferring the locally cached copy (instant, offline) and filling the rest from TMDb.
    func hydrate(_ keys: [MediaKey], limit: Int = 80) async -> [MediaItem] {
        guard let catalog else { return keys.compactMap { localLibrary.items[$0.description] } }
        let missing = keys.prefix(limit).filter { localLibrary.items[$0.description] == nil }
        let fetched = await catalog.items(Array(missing), limit: limit)
        let byKey = Dictionary(fetched.compactMap { item in item.key.map { ($0, item) } }, uniquingKeysWith: { a, _ in a })
        return keys.prefix(limit).compactMap { byKey[$0] ?? localLibrary.items[$0.description] }
    }

    func serverRecentlyAdded() async -> [MediaItem] {
        let servers = mediaServers
        let items = await withTaskGroup(of: [MediaServerItem].self) { group in
            for server in servers { group.addTask { (try? await server.recentlyAdded(limit: 30)) ?? [] } }
            var all: [MediaServerItem] = []
            for await chunk in group { all += chunk }
            return all.sorted { ($0.addedAt ?? .distantPast) > ($1.addedAt ?? .distantPast) }
        }
        return await displayItems(for: items)
    }

    /// Server items as MediaItems: TMDb metadata when we know the id, server artwork if preferred.
    func displayItems(for serverItems: [MediaServerItem]) async -> [MediaItem] {
        var seen = Set<String>()
        var out: [MediaItem] = []
        for serverItem in serverItems {
            var item = serverItem.mediaItem
            if let tmdb = serverItem.ids.tmdb, let catalog, let hydrated = try? await catalog.item(MediaKey(type: serverItem.type, tmdbID: tmdb)) {
                item = hydrated
                if settings.mediaServers.useServerArtwork {
                    item.posterPath = serverItem.posterURL?.absoluteString ?? item.posterPath
                    item.backdropPath = serverItem.backdropURL?.absoluteString ?? item.backdropPath
                }
            }
            if seen.insert(item.id).inserted { out.append(item) }
        }
        return out
    }

    /// Items for the home hero carousel.
    func heroItems() async -> [MediaItem] {
        guard let catalog else { return [] }
        var items: [MediaItem]
        switch settings.general.heroSource {
        case .trending:
            async let movies = try? catalog.trending(.movie)
            async let shows = try? catalog.trending(.show)
            let m = await movies?.items ?? [], s = await shows?.items ?? []
            items = zip(m, s).flatMap { [$0, $1] }
        case .popular:
            items = (try? await catalog.list(.popular, type: .movie))?.items ?? []
        case .watchlist:
            items = await hydrate(watchlistKeys, limit: 15)
        }
        items = await catalog.apply(catalogFilters, to: items.filter { $0.backdropPath != nil || $0.posterPath != nil }, exemptFromRelease: settings.general.heroSource == .watchlist)
        return Array(items.prefix(15))
    }

    /// Multi-search plus media-server results.
    func search(_ text: String) async throws -> (results: [SearchResult], server: [MediaItem]) {
        let catalog = try requireCatalog()
        async let tmdbResults = catalog.search(text)
        var serverItems: [MediaItem] = []
        if settings.mediaServers.searchServers {
            let servers = mediaServers
            let found = await withTaskGroup(of: [MediaServerItem].self) { group in
                for server in servers { group.addTask { (try? await server.search(text)) ?? [] } }
                var all: [MediaServerItem] = []
                for await chunk in group { all += chunk }
                return all
            }
            serverItems = await displayItems(for: found)
        }
        var results = try await tmdbResults
        if settings.mediaServers.onlyShowServerContent && !settings.mediaServers.servers.isEmpty {
            var kept: [SearchResult] = []
            for r in results {
                if case .media(let item) = r, !(await serverIndex.contains(item)) { continue }
                kept.append(r)
            }
            results = kept
        }
        return (results, serverItems)
    }

    // MARK: Recent searches

    var recentSearches: [String] {
        get { UserDefaults.standard.stringArray(forKey: "flow.recentSearches") ?? [] }
        set { UserDefaults.standard.set(Array(newValue.prefix(12)), forKey: "flow.recentSearches") }
    }

    func rememberSearch(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        var list = recentSearches.filter { $0.caseInsensitiveCompare(t) != .orderedSame }
        list.insert(t, at: 0)
        recentSearches = list
    }
}
