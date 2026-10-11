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
            case .upcomingEpisodes:
                result = single(await upcoming().map(\.item))
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
                    let (movieKeys, showKeys) = (try await movies, try await shows)
                    let keys = movieKeys.interleaved(with: showKeys)
                    result = single(await catalog.items(keys))
                } else if let recent = history.first {
                    let detail = try await catalog.details(recent.key.type, id: recent.key.tmdbID)
                    result = single(detail.recommendations)
                } else {
                    result = try await catalog.trending(.movie, page: page)
                }
            case .mediaServerRecent:
                result = single(await serverRecentlyAdded())
            case .becauseYouWatched:
                guard let seed = becauseYouWatchedSeed else { result = single([]); break }
                let detail = try await catalog.details(seed.type, id: seed.tmdbID)
                let recommendations = detail.recommendations.isEmpty ? detail.similar : detail.recommendations
                result = single(recommendations.filter { !isWatched($0) })
            case .streamingServices, .genres:
                // Tiles that open other shelves; they hold no titles of their own.
                result = single([])
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

    /// A shelf's row on Home. Catalogue rows hold at most the shelf-length setting, fetching a second page
    /// when the length is more than one page; your own lists always show in full.
    func shelfItems(for shelf: ShelfConfig) async throws -> [MediaItem] {
        let first = try await page(for: shelf)
        let isContent: Bool
        switch shelf.source {
        case .builtIn(let builtIn): isContent = builtIn.isContentShelf
        case .discover: isContent = true
        default: isContent = false
        }
        guard isContent else { return first.items }
        let length = settings.general.contentShelfLength
        var items = first.items
        if items.count < length, first.hasMore, let next = try? await page(for: shelf, page: 2) {
            var seen = Set(items.map(\.id))
            items += next.items.filter { seen.insert($0.id).inserted }
        }
        return Array(items.prefix(length))
    }

    /// The most recent title in your history, which seeds "Because You Watched".
    var becauseYouWatchedSeed: MediaKey? { history.first?.key }

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

    /// Items for the home hero carousel: the primary source, with the secondary one interleaved when set.
    func heroItems() async -> [MediaItem] {
        let primary = settings.general.heroSource
        var items = await heroItems(from: primary)
        if let secondary = settings.general.heroSecondarySource, secondary != primary {
            let extra = await heroItems(from: secondary)
            items = items.interleaved(with: extra)
        }
        var seen = Set<String>()
        return Array(items.filter { seen.insert($0.id).inserted }.prefix(15))
    }

    private func heroItems(from source: HeroSource) async -> [MediaItem] {
        guard let catalog else { return [] }
        var items: [MediaItem]
        switch source {
        case .trending:
            async let movies = try? catalog.trending(.movie)
            async let shows = try? catalog.trending(.show)
            let m = await movies?.items ?? [], s = await shows?.items ?? []
            items = m.interleaved(with: s)
        case .popular:
            items = (try? await catalog.list(.popular, type: .movie))?.items ?? []
        case .watchlist:
            items = await hydrate(watchlistKeys, limit: 15)
        }
        return await catalog.apply(catalogFilters, to: items.filter { $0.backdropPath != nil || $0.posterPath != nil }, exemptFromRelease: source == .watchlist)
    }

    // MARK: Upcoming

    /// What's coming within the configured window: the next episodes of shows you're caught up on and, when
    /// asked, season premieres and films from your watchlist.
    func upcoming() async -> [UpcomingEntry] {
        guard let catalog else { return [] }
        let general = settings.general
        let states = showStates
        let watchlist = Set(watchlistKeys)

        // Shows you've watched lately, plus the watchlist when premieres are wanted.
        var keys = states.values
            .filter { !$0.watched.isEmpty }
            .sorted { ($0.lastWatchedAt ?? .distantPast) > ($1.lastWatchedAt ?? .distantPast) }
            .prefix(40).map(\.key)
        if general.includeWatchlistPremieres {
            let known = Set(keys)
            keys += watchlistKeys.filter { $0.type == .show && !known.contains($0) }.prefix(30)
        }
        let shows = await withTaskGroup(of: UpcomingBuilder.ShowInput?.self) { group in
            for key in keys {
                group.addTask {
                    guard let detail = try? await catalog.details(.show, id: key.tmdbID) else { return nil }
                    let state = states[key] ?? ShowWatchState(key: key)
                    let caughtUp = !state.watched.isEmpty && state.nextUp(aired: Self.airedEpisodes(detail)) == nil
                    return UpcomingBuilder.ShowInput(item: detail.item, nextEpisode: detail.nextEpisode, caughtUp: caughtUp, onWatchlist: watchlist.contains(key))
                }
            }
            var all: [UpcomingBuilder.ShowInput] = []
            for await input in group { if let input { all.append(input) } }
            return all
        }

        var films: [UpcomingBuilder.FilmInput] = []
        if general.includeWatchlistPremieres {
            // A film that came out long ago can't still be on its way to digital.
            let cutoff = Date().addingTimeInterval(-200 * 86400)
            let candidates = await hydrate(watchlistKeys.filter { $0.type == .movie }, limit: 60)
                .filter { !isWatched($0) && ($0.releaseDate.map { $0 > cutoff } ?? true) }
            films = await withTaskGroup(of: UpcomingBuilder.FilmInput?.self) { group in
                for item in candidates.prefix(30) {
                    guard let id = item.ids.tmdb else { continue }
                    group.addTask { UpcomingBuilder.FilmInput(item: item, releases: await catalog.releaseDates(movieID: id)) }
                }
                var all: [UpcomingBuilder.FilmInput] = []
                for await input in group { if let input { all.append(input) } }
                return all
            }
        }

        return UpcomingBuilder.build(shows: shows, films: films, withinDays: general.upcomingWithinDays,
                                     includeWatchlistPremieres: general.includeWatchlistPremieres,
                                     filmDates: general.filmDates, region: catalog.tmdb.region)
    }

    /// Turning Upcoming on needs a shelf to show it in: add one, or switch the existing one back on.
    func ensureUpcomingShelf() {
        if let index = settings.shelves.firstIndex(where: { $0.source == .builtIn(.upcomingEpisodes) }) {
            settings.shelves[index].enabled = true
        } else {
            let after = settings.shelves.firstIndex { $0.source == .builtIn(.continueWatching) }.map { $0 + 1 } ?? 0
            settings.shelves.insert(.builtIn(.upcomingEpisodes), at: after)
        }
    }

    // MARK: Server home rows

    /// One library of one connected server, for Home's server row.
    struct ServerLibrary: Identifiable, Hashable {
        let server: MediaServerConfig
        let library: MediaLibrary
        var id: String { "\(server.id):\(library.id)" }

        /// What opening the card shows: the library's titles, newest first.
        var shelf: ShelfConfig {
            ShelfConfig(id: id, title: library.name, source: .mediaServerLibrary(serverID: server.id, libraryID: library.id))
        }
    }

    /// One connected server's libraries, in the order the server lists them.
    func serverLibraries(for serverID: String) async -> [ServerLibrary] {
        guard let server = mediaServers.first(where: { $0.config.id == serverID }) else { return [] }
        return ((try? await server.libraries()) ?? []).map { ServerLibrary(server: server.config, library: $0) }
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
        // Searches run as you type, so "the dark" followed by "the dark knight" is one search, not two:
        // the newest replaces the one it grew out of (or was trimmed back from).
        if let head = list.first {
            let a = head.lowercased(), b = t.lowercased()
            if a.hasPrefix(b) || b.hasPrefix(a) { list.removeFirst() }
        }
        list.insert(t, at: 0)
        recentSearches = Array(list.prefix(20))
    }
}
