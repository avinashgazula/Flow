import SwiftUI
import FlowKit

extension AppModel {
    // MARK: Sync with the tracker

    var isTrackerSyncDue: Bool {
        guard let last = settings.sync.lastTrackerSync else { return true }
        return Date().timeIntervalSince(last) >= Double(settings.account.syncInterval.rawValue)
    }

    /// Pulls history, progress and lists from the active tracker and list destinations.
    func refreshLibrary(force: Bool) async {
        guard force || isTrackerSyncDue || continueWatching.isEmpty else { return }
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        lastSyncError = nil
        let tracker = self.tracker

        async let progressResult = resultOf { try await tracker.playbackProgress() }
        async let moviesResult = resultOf { try await tracker.watchedMovies() }
        async let showsResult = resultOf { try await tracker.watchedShows() }
        async let historyResult = resultOf { try await tracker.history(limit: 100) }
        async let profileResult = resultOf { try await tracker.profile() }
        let watchlistService = listService(for: settings.account.watchlistDestination)
        let favouriteService = listService(for: settings.account.favouritesDestination)
        async let watchlistResult = resultOf { try await watchlistService.watchlist() }
        async let favouritesResult = resultOf { try await favouriteService.favourites() }

        var errors: [String] = []
        func take<T>(_ result: Result<T, Error>) -> T? {
            switch result {
            case .success(let v): return v
            case .failure(let e): errors.append(e.localizedDescription); return nil
            }
        }

        var trackerProgress = take(await progressResult) ?? []
        // Trackers without resume points still get local ones (This Device keeps them for everyone).
        if settings.account.tracker != .local {
            let localProgress = (try? await local.playbackProgress()) ?? []
            let remoteIDs = Set(trackerProgress.map(\.id))
            trackerProgress += localProgress.filter { !remoteIDs.contains($0.id) && tracker.kind != .trakt }
        }
        progress = trackerProgress.sorted { $0.updatedAt > $1.updatedAt }
        if let movies = take(await moviesResult) { watchedMovies = movies }
        if let shows = take(await showsResult) { showStates = Dictionary(shows.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a }) }
        if let h = take(await historyResult) { history = h }
        profile = (try? await profileResult.get()) ?? nil
        if settings.account.watchlistDestination == .mediaServer {
            watchlistKeys = await mediaServerFavouriteKeys()
        } else if let w = take(await watchlistResult) {
            watchlistKeys = w.map(\.key)
        }
        if settings.account.favouritesDestination == .mediaServer {
            favouriteKeys = await mediaServerFavouriteKeys()
        } else if let f = try? await favouritesResult.get() {
            favouriteKeys = f.map(\.key)
        }

        await rebuildContinueWatching()
        if errors.isEmpty { settings.sync.lastTrackerSync = Date() } else { lastSyncError = errors.first }
        contentVersion += 1
        if !isDemo { await refreshSpotlight() }
    }

    /// Continue Watching = resume points + Next Up for recently watched shows.
    func rebuildContinueWatching() async {
        let rewatches = await local.library.rewatches
        var nextUp: [(MediaKey, EpisodeRef, Date)] = []
        let recentShows = showStates.values
            .filter { ($0.lastWatchedAt ?? .distantPast) > Date().addingTimeInterval(-60 * 86400) }
            .sorted { ($0.lastWatchedAt ?? .distantPast) > ($1.lastWatchedAt ?? .distantPast) }
            .prefix(15)
        if let catalog {
            await withTaskGroup(of: (MediaKey, EpisodeRef, Date)?.self) { group in
                for state in recentShows {
                    let rewatch = rewatches.first { $0.key == state.key }
                    group.addTask {
                        guard let detail = try? await catalog.details(.show, id: state.key.tmdbID) else { return nil }
                        let aired = Self.airedEpisodes(detail)
                        let effective = rewatch.map { ShowWatchState(key: state.key, watched: $0.watched, lastWatchedAt: $0.startedAt) } ?? state
                        guard let next = effective.nextUp(aired: aired) else { return nil }
                        return (state.key, next, state.lastWatchedAt ?? Date())
                    }
                }
                for await result in group { if let result { nextUp.append(result) } }
            }
        }
        // Rewatches with no tracker history yet still deserve a Next Up.
        for rewatch in rewatches where !nextUp.contains(where: { $0.0 == rewatch.key }) {
            if let catalog, let detail = try? await catalog.details(.show, id: rewatch.key.tmdbID),
               let next = ShowWatchState(key: rewatch.key, watched: rewatch.watched).nextUp(aired: Self.airedEpisodes(detail)) {
                nextUp.append((rewatch.key, next, rewatch.startedAt))
            }
        }
        continueWatching = ContinueWatchingBuilder.build(progress: progress, nextUp: nextUp, finishedPercent: settings.playback.watchedThresholdPercent)
    }

    /// Every aired regular episode, from season episode counts bounded by the last aired episode.
    nonisolated static func airedEpisodes(_ detail: MediaDetail) -> [EpisodeRef] {
        let last = detail.lastEpisode?.ref
        var refs: [EpisodeRef] = []
        for season in detail.seasons where season.number > 0 {
            for n in 1...max(season.episodeCount, 1) where season.episodeCount > 0 {
                let ref = EpisodeRef(season: season.number, episode: n)
                if let last, ref > last { break }
                refs.append(ref)
            }
        }
        return refs
    }

    private func mediaServerFavouriteKeys() async -> [MediaKey] {
        var keys: [MediaKey] = []
        for server in mediaServers {
            for item in (try? await server.favourites()) ?? [] {
                if let tmdb = item.ids.tmdb { keys.append(MediaKey(type: item.type, tmdbID: tmdb)) }
            }
        }
        return keys
    }

    // MARK: Queries

    func isWatchlisted(_ item: MediaItem) -> Bool { item.key.map(watchlistKeys.contains) ?? false }
    func isFavourite(_ item: MediaItem) -> Bool { item.key.map(favouriteKeys.contains) ?? false }
    func isOnServer(_ item: MediaItem) -> Bool { item.key.map(serverKeys.contains) ?? false }

    func isWatched(_ item: MediaItem) -> Bool {
        guard let key = item.key else { return false }
        if item.type == .movie { return watchedMovies.contains(key.tmdbID) }
        return showStates[key] != nil && showStates[key]?.watched.isEmpty == false && isShowCompleted(key)
    }

    /// A show counts as watched (poster check) once its watched set covers the aired episode count we know of.
    private func isShowCompleted(_ key: MediaKey) -> Bool {
        guard let state = showStates[key] else { return false }
        return state.watched.count >= (completedShowThresholds[key] ?? Int.max)
    }

    func isEpisodeWatched(_ show: MediaItem, _ ref: EpisodeRef) -> Bool {
        guard let key = show.key else { return false }
        return showStates[key]?.watched.contains(ref) ?? false
    }

    func progress(for item: MediaItem, episode: EpisodeRef? = nil) -> PlaybackProgress? {
        guard let key = item.key else { return nil }
        return progress.first { $0.key == key && (episode == nil || $0.episode == episode) }
    }

    // MARK: Mutations

    func toggleWatchlist(_ item: MediaItem) async {
        guard let key = item.key else { return }
        let listed = !watchlistKeys.contains(key)
        if listed { watchlistKeys.insert(key, at: 0) } else { watchlistKeys.removeAll { $0 == key } }
        Platform.haptic()
        do {
            if settings.account.watchlistDestination == .mediaServer {
                try await setServerFavourite(item, listed)
            } else {
                try await listService(for: settings.account.watchlistDestination).setWatchlisted(item, listed)
            }
            showToast(listed ? "Added to Watchlist" : "Removed from Watchlist")
            contentVersion += 1
        } catch {
            if listed { watchlistKeys.removeAll { $0 == key } } else { watchlistKeys.insert(key, at: 0) }
            showToast(error.localizedDescription)
        }
    }

    func toggleFavourite(_ item: MediaItem) async {
        guard let key = item.key else { return }
        let favourite = !favouriteKeys.contains(key)
        if favourite { favouriteKeys.insert(key, at: 0) } else { favouriteKeys.removeAll { $0 == key } }
        Platform.haptic()
        do {
            if settings.account.favouritesDestination == .mediaServer {
                try await setServerFavourite(item, favourite)
            } else {
                try await listService(for: settings.account.favouritesDestination).setFavourite(item, favourite)
            }
            contentVersion += 1
        } catch {
            if favourite { favouriteKeys.removeAll { $0 == key } } else { favouriteKeys.insert(key, at: 0) }
            showToast(error.localizedDescription)
        }
    }

    private func setServerFavourite(_ item: MediaItem, _ value: Bool) async throws {
        let matches = await serverIndex.matches(for: item)
        guard let match = matches.first, let server = mediaServers.first(where: { $0.config.id == match.serverID }) else {
            throw FlowError.unsupported("This title isn't on your media server.")
        }
        try await server.setFavourite(itemID: match.itemID, value)
    }

    /// Marks a movie, specific episodes, or (episodes == nil) every aired episode of a show.
    func setWatched(_ item: MediaItem, episodes: [EpisodeRef]?, watched: Bool) async {
        guard let key = item.key else { return }
        var refs = episodes
        if item.type == .show, refs == nil, let catalog, let detail = try? await catalog.details(.show, id: key.tmdbID) {
            refs = Self.airedEpisodes(detail)
            completedShowThresholds[key] = refs?.count
        }
        // Optimistic update.
        if item.type == .movie {
            if watched { watchedMovies.insert(key.tmdbID) } else { watchedMovies.remove(key.tmdbID) }
        } else {
            var state = showStates[key] ?? ShowWatchState(key: key)
            for ref in refs ?? [] { if watched { state.watched.insert(ref) } else { state.watched.remove(ref) } }
            state.lastWatchedAt = Date()
            showStates[key] = state
        }
        Platform.haptic()
        do {
            if watched {
                try await tracker.markWatched(item, episodes: item.type == .show ? refs : nil, at: Date())
            } else {
                try await tracker.markUnwatched(item, episodes: item.type == .show ? refs : nil)
            }
            if tracker.kind != .local {
                // Mirror into the local history so offline views stay accurate.
                if watched { try? await local.markWatched(item, episodes: refs, at: Date()) }
            }
            progress.removeAll { $0.key == key && (refs == nil || $0.episode.map { refs!.contains($0) } ?? true) }
            await rebuildContinueWatching()
            contentVersion += 1
        } catch {
            showToast(error.localizedDescription)
            await refreshLibrary(force: true)
        }
    }

    func removeFromContinueWatching(_ entry: ContinueWatchingBuilder.Entry) async {
        if let p = entry.progress {
            try? await tracker.removePlaybackProgress(p)
            try? await local.removePlaybackProgress(p)
            progress.removeAll { $0.id == p.id }
        }
        continueWatching.removeAll { $0.id == entry.id }
    }

    // MARK: Rewatch & shuffle

    func startRewatch(_ show: MediaItem) async {
        guard let key = show.key else { return }
        await local.startRewatch(key)
        await rebuildContinueWatching()
        showToast("Rewatch started — Up Next restarts from S01E01")
    }

    func endRewatch(_ show: MediaItem) async {
        guard let key = show.key else { return }
        await local.endRewatch(key)
        await rebuildContinueWatching()
    }

    func isRewatching(_ show: MediaItem) async -> Bool {
        guard let key = show.key else { return false }
        return await local.rewatch(for: key) != nil
    }

    /// Picks a random episode not yet played in this shuffle cycle.
    func shuffleEpisode(for show: MediaItem) async -> Episode? {
        guard let key = show.key, let catalog, let detail = try? await catalog.details(.show, id: key.tmdbID) else { return nil }
        guard let ref = await local.nextShuffle(for: key, from: Self.airedEpisodes(detail)) else { return nil }
        let episodes = (try? await catalog.tmdb.season(showID: key.tmdbID, season: ref.season)) ?? []
        return episodes.first { $0.number == ref.episode } ?? Episode(showTMDB: key.tmdbID, season: ref.season, number: ref.episode, title: "Episode \(ref.episode)")
    }

    // MARK: Media server index

    func refreshServerIndex() async {
        let servers = mediaServers
        guard !servers.isEmpty else {
            await serverIndex.replace(with: [])
            serverKeys = []
            return
        }
        let items = await withTaskGroup(of: [MediaServerItem].self) { group in
            for server in servers { group.addTask { (try? await server.catalogue()) ?? [] } }
            var all: [MediaServerItem] = []
            for await chunk in group { all += chunk }
            return all
        }
        await serverIndex.replace(with: items)
        serverKeys = await serverIndex.keys
        contentVersion += 1
    }
}
