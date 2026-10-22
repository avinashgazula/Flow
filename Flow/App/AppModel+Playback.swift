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
        if isDemo { providers.append(DemoSourceProvider()) }
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

    /// The resolution cap in force: Resolution on Cellular on metered connections, Preferred Resolution otherwise.
    var resolutionCap: VideoResolution {
        NetworkConditions.isExpensive ? settings.playback.cellularResolutionCap : settings.playback.preferredResolutionCap
    }

    // MARK: Starting playback

    /// Opens the source picker for a movie or episode. Shows resolve to their Next Up episode.
    func play(_ item: MediaItem, episode: Episode? = nil, library: String? = nil) async {
        guard let request = await playbackRequest(for: item, episode: episode, library: library) else {
            showToast("No episodes available yet.")
            return
        }
        sourcePickerRequest = request
    }

    /// The request Play would open the picker with, nil for a show with nothing aired to play.
    /// `library` limits the picker to that provider (Play From This Library Only).
    private func playbackRequest(for item: MediaItem, episode: Episode?, library: String? = nil) async -> PlaybackRequest? {
        var resolved = item
        if resolved.ids.imdb == nil || (item.type == .show && resolved.ids.tvdb == nil), let catalog, let id = item.ids.tmdb {
            if let ids = try? await catalog.tmdb.externalIDs(item.type, id: id) { resolved.ids = resolved.ids.merged(with: ids) }
        }
        var target = episode
        if item.type == .show, target == nil {
            target = await nextEpisodeToPlay(for: resolved)
        }
        guard item.type == .movie || target != nil else { return nil }
        return PlaybackRequest(item: resolved, episode: target, libraryProviderID: library)
    }

    // MARK: Prefetch

    /// With Prefetch on Detail View on, starts collecting sources for what Play would open (the film, or the show's
    /// next episode) when a detail page opens, so the picker starts with results. Returns once the search is under way.
    func prefetchSources(for item: MediaItem) async {
        guard settings.metadata.prefetchOnDetail, !sourceProviders().isEmpty,
              let request = await playbackRequest(for: item, episode: nil),
              prefetchedSources.sources(for: request) == nil, prefetchTasks[request.id] == nil else { return }
        let providers = sourceProviders()
        let timeout = settings.sources.timeoutSeconds
        let task = Task { [weak self] in
            let found = await SourceAggregator.collect(providers, request: request, timeout: timeout)
            guard let self else { return }
            // An empty result isn't worth showing as "ready"; the picker searches itself.
            if !found.isEmpty { self.prefetchedSources.store(found, for: request) }
            self.prefetchTasks[request.id] = nil
        }
        prefetchTasks[request.id] = task
    }

    /// What Play would start for a title, as the page words it under its buttons.
    struct BestVersion: Equatable {
        /// "2160p · Dolby Vision · TrueHD 7.1 · 18.20 GB"
        var line: String
        /// Every source found, which the picker lists.
        var count: Int
        /// Who they came from, best first.
        var providers: [String]
        var note: VersionNote?
    }

    /// The request Play would open the picker with: the film, or a show's next episode.
    func playRequest(for item: MediaItem) async -> PlaybackRequest? {
        await playbackRequest(for: item, episode: nil)
    }

    /// The best of the sources the detail page already found for `request` (Prefetch on Detail View), ranked as the
    /// picker ranks them. Nil until the search has answered, or when nothing playable came back.
    func bestVersion(for request: PlaybackRequest) -> BestVersion? {
        guard let found = prefetchedSources.sources(for: request), !found.isEmpty else { return nil }
        let ranked = SourceRanker.rank(found, settings: settings.sources, resolutionCap: resolutionCap, decodesAV1: Platform.decodesAV1,
                                       decodesLosslessAudio: MatroskaRemuxer.audioDecoders != nil, prefersHDR: settings.playback.preferHDR,
                                       preferredAudioLanguage: settings.playback.preferredAudioLanguage)
        guard let best = lastSource(for: request, in: ranked) ?? ranked.first(where: \.isPlayable) else { return nil }
        let line = best.traits.versionLine(includeSize: true)
        let note = Reel.versionNote(for: best.traits, decodesAV1: Platform.decodesAV1, convertsLosslessAudio: MatroskaRemuxer.audioDecoders != nil)
        var seen = Set<String>()
        let providers = ranked.map(\.providerName).filter { seen.insert($0).inserted }
        return BestVersion(line: line, count: ranked.count, providers: providers, note: note)
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
    func startPlayback(_ source: StreamSource, request: PlaybackRequest, alternatives: [StreamSource] = []) {
        ScreenshotTour.log("startPlayback \(source.id) url=\(source.location.playableURL?.absoluteString ?? "nil")")
        sourcePickerRequest = nil
        if case .external(let url) = source.location {
            openExternally(url)
            return
        }
        guard let url = source.location.playableURL else {
            showToast("This source needs a debrid-enabled add-on to play.")
            return
        }
        let saved = progress(for: request.item, episode: request.episodeRef)
        let runtime = Double((request.episode?.runtimeMinutes ?? request.item.runtimeMinutes) ?? 0) * 60
        // The server's own resume point is ignored when progress comes only from the tracking service.
        let serverResume = settings.mediaServers.trackOnlyWithTracker ? nil : source.serverResumeSeconds
        var resume = serverResume ?? saved?.resumePosition(runtimeSeconds: runtime > 0 ? runtime : nil)
        if let r = resume, r < 30 { resume = nil }
        if Platform.externalPlayers.contains(settings.playback.externalPlayer),
           let launch = settings.playback.externalPlayer.launchURL(for: url, position: resume, filename: source.filename) {
            openExternally(launch)
            Task { try? await tracker.scrobble(.start, request: request, percent: 0) }
            return
        }
        // A new title (from Siri, a link, or Handoff) replaces one already playing: save its place and let it go.
        activePlayback?.stop()
        activePlayback = PlaybackSession(model: self, request: request, source: source, resumeAt: resume, alternatives: alternatives)
        ScreenshotTour.log("activePlayback set: \(activePlayback != nil)")
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
    /// The source this title was last played from, as it appears in `list` now; nil with nothing to go on.
    func lastSource(for request: PlaybackRequest, in list: [StreamSource]) -> StreamSource? {
        guard settings.sources.rememberLastSource, let key = request.item.key?.description else { return nil }
        return settings.sources.lastSources[key]?.match(in: list)
    }

    /// Remembers the source a title started playing from (for a show, the release its episodes come
    /// from). A downloaded file isn't a choice of stream, so it leaves the memory alone.
    func rememberSource(_ source: StreamSource, for request: PlaybackRequest) {
        guard settings.sources.rememberLastSource, source.providerID != "downloads", let key = request.item.key?.description else { return }
        var all = settings.sources.lastSources
        all[key] = LastSource(source)
        settings.sources.lastSources = LastSource.pruned(all)
    }

    func matchingSource(for request: PlaybackRequest, like previous: StreamSource) async -> StreamSource? {
        let providers = sourceProviders().filter { $0.providerID == previous.providerID }
        let found = await SourceAggregator.collect(providers.isEmpty ? sourceProviders() : providers, request: request, timeout: settings.sources.timeoutSeconds)
        let ranked = SourceRanker.rank(found, settings: settings.sources, resolutionCap: resolutionCap, decodesAV1: Platform.decodesAV1,
                                       decodesLosslessAudio: MatroskaRemuxer.audioDecoders != nil, prefersHDR: settings.playback.preferHDR,
                                       preferredAudioLanguage: settings.playback.preferredAudioLanguage).filter(\.isPlayable)
        if let group = previous.bingeGroup, let match = ranked.first(where: { $0.bingeGroup == group }) { return match }
        return ranked.first { $0.providerID == previous.providerID && $0.traits.resolution == previous.traits.resolution } ?? ranked.first
    }

    /// With Download Automatically on, saves the first source within the download limits.
    /// Returns false when nothing fits so the caller opens the source list instead.
    func downloadAutomatically(_ request: PlaybackRequest) async -> Bool {
        showToast("Finding a source to download…")
        let found = await SourceAggregator.collect(sourceProviders(), request: request, timeout: settings.sources.timeoutSeconds)
        // The download resolution limit decides here, not the playback one: playing still offers every source.
        let ranked = SourceRanker.rank(found, settings: settings.sources, resolutionCap: .uhd4k, decodesAV1: Platform.decodesAV1, decodesLosslessAudio: MatroskaRemuxer.audioDecoders != nil).filter(\.isPlayable)
        guard let source = DownloadPicker.pick(from: ranked, isMovie: request.episode == nil, settings: settings.downloads),
              DownloadManager.shared.start(source: source, request: request, location: settings.downloads.location) == nil else {
            toast = nil
            return false
        }
        showToast("Downloading \(request.displayTitle)")
        return true
    }

    /// Smart Downloads: runs once an episode has been watched to the end. It acts only for episodes with a saved download
    /// (whether the viewing played the file or a stream), so shows that aren't being downloaded are left alone, and the
    /// chain continues because each downloaded next episode qualifies in turn. The player is on screen, so it only toasts.
    /// Delete Watched Episodes removes that download; Download Next Episode saves the next aired one, unless it's
    /// already downloaded or on its way.
    func downloadedEpisodeFinished(_ request: PlaybackRequest) async {
        let downloads = settings.downloads
        guard Platform.supportsDownloads, downloads.deleteWatchedDownloads || downloads.downloadNextEpisode,
              request.episode != nil, let watched = DownloadManager.shared.finished(for: request) else { return }
        var summary: [String] = []
        if downloads.deleteWatchedDownloads {
            DownloadManager.shared.remove(watched)
            summary.append("Downloaded episode removed")
        }
        if downloads.downloadNextEpisode, let next = await nextRequest(after: request) {
            // Already saved or on its way is left alone; a failed attempt is replaced, not duplicated.
            let existing = DownloadManager.shared.items.filter { $0.request.id == next.id }
            if !existing.contains(where: { $0.state != .failed }) {
                existing.forEach(DownloadManager.shared.remove)
                let code = next.episode?.code ?? next.displayTitle
                summary.append(await downloadAutomatically(next) ? "Downloading \(code)" : "No source fits to download \(code)")
            }
        }
        if !summary.isEmpty { showToast(summary.joined(separator: " · ")) }
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
        await publishSnapshot()
    }
}
