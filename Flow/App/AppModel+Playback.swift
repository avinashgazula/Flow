import SwiftUI
import FlowKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

extension AppModel {
    // MARK: Providers

    /// Every enabled source provider, in no particular order (the ranker orders results).
    func sourceProviders() -> [SourceProvider] {
        var providers: [SourceProvider] = mediaServers.map { $0 as SourceProvider }
        providers += settings.webDAV.filter(\.enabled).map { WebDAVClient(config: $0, http: http) as SourceProvider }
        for config in settings.liveTV.providers where config.enabled && config.useForVOD {
            if let cached = vodProviderCache[config.id] {
                providers.append(cached)
            } else {
                let provider = IPTVVODProvider(config: config, http: http)
                vodProviderCache[config.id] = provider
                providers.append(provider)
            }
        }
        providers += settings.sources.addons.filter(\.enabled).map { AddonClient(config: $0, http: http, timeout: settings.sources.timeoutSeconds) as SourceProvider }
        return providers
    }

    /// Providers grouped for Settings → Sources, keyed by category.
    func providerEntries(for category: SourceCategory) -> [(id: String, name: String)] {
        let all: [(String, String)]
        switch category {
        case .mediaServers: all = settings.mediaServers.servers.map { ($0.id, $0.name) }
        case .webDAV: all = settings.webDAV.map { ($0.id, $0.name) }
        case .iptv: all = settings.liveTV.providers.map { ($0.id, $0.name) }
        case .addons: all = settings.sources.addons.map { ($0.id, $0.name) }
        }
        let order = settings.sources.providerOrder[category.rawValue] ?? []
        return all.sorted { (order.firstIndex(of: $0.0) ?? Int.max) < (order.firstIndex(of: $1.0) ?? Int.max) }.map { (id: $0.0, name: $0.1) }
    }

    func subtitleProviders() -> [SubtitleProvider] {
        let enabled = Set(settings.subtitles.enabledProviders)
        var providers: [SubtitleProvider] = []
        if enabled.contains("opensubtitles"), let key = credentials.openSubtitlesAPIKey?.nonEmpty {
            providers.append(OpenSubtitlesProvider(apiKey: key, username: credentials.openSubtitlesUsername, password: credentials.openSubtitlesPassword, http: http))
        }
        if enabled.contains("subdl"), let key = credentials.subdlAPIKey?.nonEmpty { providers.append(SubDLProvider(apiKey: key, http: http)) }
        if enabled.contains("subsource"), let key = credentials.subSourceAPIKey?.nonEmpty { providers.append(SubSourceProvider(apiKey: key, http: http)) }
        if enabled.contains("wyzie") { providers.append(WyzieProvider(http: http)) }
        return providers
    }

    func skipProviders() -> [SkipSegmentProvider] {
        var providers: [SkipSegmentProvider] = []
        if let key = credentials.introDBAPIKey?.nonEmpty { providers.append(KeyedSegmentsClient.introDB(baseURL: settings.account.introDBBaseURL, apiKey: key)) }
        if let key = credentials.publicMetaDBAPIKey?.nonEmpty { providers.append(KeyedSegmentsClient.publicMetaDB(baseURL: settings.account.publicMetaDBBaseURL, apiKey: key)) }
        return providers
    }

    var episodeProvider: EpisodeProvider? {
        guard let catalog else { return nil }
        return EpisodeProvider(source: settings.metadata.episodeSource, tmdb: catalog.tmdb, tvdb: tvdbKey.map { TVDBClient(apiKey: $0, http: http) }, trakt: trakt)
    }

    // MARK: Starting playback

    /// Opens the source picker for a movie or episode. Shows resolve to their Next Up episode.
    func play(_ item: MediaItem, episode: Episode? = nil) async {
        var resolved = item
        if resolved.ids.imdb == nil || (item.type == .show && resolved.ids.tvdb == nil), let catalog, let id = item.ids.tmdb {
            if let ids = try? await catalog.tmdb.externalIDs(item.type, id: id) { resolved.ids = resolved.ids.merged(with: ids) }
        }
        var target = episode
        if item.type == .show, target == nil {
            target = await nextEpisodeToPlay(for: resolved)
        }
        guard item.type == .movie || target != nil else {
            showToast("No episodes available yet.")
            return
        }
        sourcePickerRequest = PlaybackRequest(item: resolved, episode: target)
    }

    func shufflePlay(_ show: MediaItem) async {
        guard let episode = await shuffleEpisode(for: show) else { showToast("Nothing to shuffle yet."); return }
        await play(show, episode: episode)
    }

    /// Resume point if one exists, otherwise Next Up, otherwise S01E01.
    func nextEpisodeToPlay(for show: MediaItem) async -> Episode? {
        guard let key = show.key, let catalog else { return nil }
        var ref: EpisodeRef?
        if let entry = continueWatching.first(where: { $0.key == key }) { ref = entry.episode }
        if ref == nil, let detail = try? await catalog.details(.show, id: key.tmdbID) {
            let aired = Self.airedEpisodes(detail)
            let rewatch = await local.rewatch(for: key)
            let state = rewatch.map { ShowWatchState(key: key, watched: $0.watched) } ?? showStates[key] ?? ShowWatchState(key: key)
            ref = state.nextUp(aired: aired) ?? aired.first
        }
        guard let ref else { return nil }
        let season = (try? await catalog.tmdb.season(showID: key.tmdbID, season: ref.season)) ?? []
        return season.first { $0.number == ref.episode } ?? Episode(showTMDB: key.tmdbID, season: ref.season, number: ref.episode, title: "Episode \(ref.episode)")
    }

    /// Starts the player with a chosen source (or hands it to an external player).
    func startPlayback(_ source: StreamSource, request: PlaybackRequest) {
        sourcePickerRequest = nil
        if case .external(let url) = source.location {
            openExternally(url)
            return
        }
        guard let url = source.location.playableURL else {
            showToast("This source needs a debrid-enabled add-on to play.")
            return
        }
        if settings.playback.externalPlayer != .none, let launch = settings.playback.externalPlayer.launchURL(for: url) {
            openExternally(launch)
            Task { try? await tracker.scrobble(.start, request: request, percent: 0) }
            return
        }
        let saved = progress(for: request.item, episode: request.episodeRef)
        let runtime = Double((request.episode?.runtimeMinutes ?? request.item.runtimeMinutes) ?? 0) * 60
        var resume = source.serverResumeSeconds ?? saved?.resumePosition(runtimeSeconds: runtime > 0 ? runtime : nil)
        if let r = resume, r < 30 { resume = nil }
        let session = PlaybackSession(model: self, request: request, source: source, resumeAt: resume)
        // Let the source sheet finish dismissing before presenting the full-screen player.
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            activePlayback = session
        }
    }

    func openExternally(_ url: URL) {
        #if os(iOS) || os(tvOS)
        UIApplication.shared.open(url)
        #elseif os(macOS)
        NSWorkspace.shared.open(url)
        #endif
    }

    /// The episode after `request`, if the show has one aired.
    func nextRequest(after request: PlaybackRequest) async -> PlaybackRequest? {
        guard let episode = request.episode, let key = request.item.key, let catalog else { return nil }
        let currentSeason = (try? await catalog.tmdb.season(showID: key.tmdbID, season: episode.season)) ?? []
        if let next = currentSeason.first(where: { $0.number == episode.number + 1 }), (next.airDate ?? .distantFuture) <= Date() {
            return PlaybackRequest(item: request.item, episode: next)
        }
        let nextSeason = (try? await catalog.tmdb.season(showID: key.tmdbID, season: episode.season + 1)) ?? []
        if let first = nextSeason.first(where: { $0.number == 1 }), (first.airDate ?? .distantFuture) <= Date() {
            return PlaybackRequest(item: request.item, episode: first)
        }
        return nil
    }

    /// Finds a source for the next episode that matches the current one (same binge group or provider/quality).
    func matchingSource(for request: PlaybackRequest, like previous: StreamSource) async -> StreamSource? {
        let providers = sourceProviders().filter { $0.providerID == previous.providerID }
        let found = await SourceAggregator.collect(providers.isEmpty ? sourceProviders() : providers, request: request, timeout: settings.sources.timeoutSeconds)
        let ranked = SourceRanker.rank(found, settings: settings.sources, resolutionCap: settings.playback.preferredResolutionCap).filter(\.isPlayable)
        if let group = previous.bingeGroup, let match = ranked.first(where: { $0.bingeGroup == group }) { return match }
        return ranked.first { $0.providerID == previous.providerID && $0.traits.resolution == previous.traits.resolution } ?? ranked.first
    }

    /// Called by the player as playback progresses or stops.
    func recordPlayback(request: PlaybackRequest, position: Double, duration: Double, finished: Bool) async {
        guard let key = request.item.key, duration > 0 else { return }
        let percent = min(100, position / duration * 100)
        if finished || percent >= settings.playback.watchedThresholdPercent {
            await setWatched(request.item, episodes: request.episodeRef.map { [$0] }, watched: true)
            if let ref = request.episodeRef { await local.advanceRewatch(key, episode: ref) }
            progress.removeAll { $0.key == key && $0.episode == request.episodeRef }
        } else if percent > 1 {
            let entry = PlaybackProgress(key: key, episode: request.episodeRef, percent: percent, positionSeconds: position, durationSeconds: duration)
            await local.recordProgress(entry, item: request.item)
            progress.removeAll { $0.key == key }
            progress.insert(entry, at: 0)
        }
        await rebuildContinueWatching()
        contentVersion += 1
    }
}
