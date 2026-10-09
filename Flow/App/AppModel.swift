import SwiftUI
import Observation
import FlowKit

/// Navigation targets shared by every NavigationStack in the app.
enum Route: Hashable {
    /// `zoom` identifies the card the detail page zooms out of (iOS 18+).
    case detail(MediaItem, zoom: String? = nil)
    case person(id: Int, name: String)
    case shelf(ShelfConfig)
    case library(LibraryList)
    case collection(id: Int, name: String)
    case settings(SettingsPage)
    case sports
    case downloads
    case calendar
    case channelGroup(String)
}

enum LibraryList: String, Hashable, CaseIterable, Identifiable {
    case watchlist, history, favourites, continueWatching
    var id: String { rawValue }
    var title: String {
        switch self {
        case .watchlist: return "Watchlist"
        case .history: return "Watch History"
        case .favourites: return "Favourites"
        case .continueWatching: return "Continue Watching"
        }
    }
}

/// The app's single source of truth: settings, credentials, services and library state.
@MainActor
@Observable
final class AppModel {
    // MARK: Persistence

    @ObservationIgnored let store: JSONFileStore
    @ObservationIgnored let secretStore: SecretStore
    @ObservationIgnored let cache: ResponseCache
    @ObservationIgnored let cloud: CloudSync
    @ObservationIgnored let http: HTTPClient
    /// Demo mode runs on bundled sample data in a separate sandbox; nothing touches the real setup.
    @ObservationIgnored let isDemo: Bool
    @ObservationIgnored let deviceID = Platform.deviceID
    @ObservationIgnored let serverIndex = MediaServerIndex()
    @ObservationIgnored private var cloudObserver: NSObjectProtocol?
    @ObservationIgnored private var cloudPushTask: Task<Void, Never>?

    var settings: AppSettings {
        didSet {
            guard settings != oldValue else { return }
            saveSettings()
            settingsDidChange(from: oldValue)
        }
    }

    var credentials: Credentials {
        didSet {
            guard credentials != oldValue else { return }
            secretStore.save(credentials)
            rebuildServices()
        }
    }

    // MARK: Services (rebuilt when settings/credentials change)

    @ObservationIgnored private(set) var catalog: CatalogService?
    @ObservationIgnored private(set) var local: LocalTracker!
    @ObservationIgnored private(set) var trakt: TraktClient?
    @ObservationIgnored private(set) var simkl: SimklClient?
    @ObservationIgnored private(set) var mdblist: MDBListClient?
    @ObservationIgnored private(set) var mediaServers: [MediaServerClient] = []
    /// IPTV VOD providers keep their downloaded catalogues between lookups.
    @ObservationIgnored var vodProviderCache: [String: IPTVVODProvider] = [:]

    // MARK: Library state

    var localLibrary = LocalLibrary()
    var watchlistKeys: [MediaKey] = []
    var favouriteKeys: [MediaKey] = []
    var watchedMovies: Set<Int> = []
    var showStates: [MediaKey: ShowWatchState] = [:]
    var progress: [PlaybackProgress] = []
    var continueWatching: [ContinueWatchingBuilder.Entry] = []
    var history: [HistoryEntry] = []
    var serverKeys: Set<MediaKey> = []
    /// Aired-episode counts per show, learned from detail pages, for the poster "watched" check.
    var completedShowThresholds: [MediaKey: Int] = [:]
    var profile: UserProfile?
    var isSyncing = false
    var lastSyncError: String?
    /// Bumped whenever something shelves depend on changes, so they reload.
    var contentVersion = 0
    var toast: String?

    // MARK: Presentation

    var selectedTab: AppTab
    var sourcePickerRequest: PlaybackRequest?
    var activePlayback: PlaybackSession?
    var showSettings = false
    /// A flow://setup link waiting for the user to confirm the import.
    var pendingImport: String?
    /// Navigation stacks per tab, so the app (and the screenshot tour) can drive navigation.
    var paths: [AppTab: [Route]] = [:]
    var settingsPath: [Route] = []
    var searchText = ""
    /// Lets the screenshot tour show the welcome screen inside demo mode.
    var previewOnboarding = false

    nonisolated static var demoRequested: Bool {
        UserDefaults.standard.bool(forKey: "FlowDemo") || UserDefaults.standard.bool(forKey: "flow.demoMode")
    }

    init(demo: Bool = AppModel.demoRequested) {
        isDemo = demo
        if demo {
            let sandbox = JSONFileStore.applicationSupport("FlowDemo")
            store = sandbox
            secretStore = FileSecretStore(store: sandbox)
            cache = ResponseCache(store: .caches("FlowDemoResponses"))
            cloud = CloudSync(store: InMemoryKeyValueStore())
            http = HTTPClient(transport: DemoTransport(), userAgent: "Flow/1.0")
            settings = Self.demoSettings()
            selectedTab = .home
            var creds = Credentials()
            creds.tmdbAPIKey = "demo"
            creds.mdblistAPIKey = "demo"
            credentials = creds
            localLibrary = DemoCatalog.seededLibrary()
        } else {
            store = JSONFileStore.applicationSupport()
            #if canImport(Security)
            secretStore = KeychainSecretStore()
            #else
            secretStore = FileSecretStore(store: .applicationSupport())
            #endif
            #if os(iOS) || os(macOS) || os(tvOS)
            cloud = CloudSync(store: UbiquitousKeyValueStore())
            #else
            cloud = CloudSync(store: InMemoryKeyValueStore())
            #endif
            cache = ResponseCache(store: .caches("FlowResponses"))
            http = HTTPClient(userAgent: "Flow/1.0")
            let loaded: AppSettings
            if let data = store.loadData("settings"), let decoded = try? SettingsCodec.decode(AppSettings.self, from: data, defaults: AppSettings()) {
                loaded = decoded
            } else {
                loaded = AppSettings()
            }
            settings = loaded
            selectedTab = loaded.general.startTab
            credentials = secretStore.load()
            localLibrary = store.load(LocalLibrary.self, "library") ?? LocalLibrary()
        }
        rebuildServices()
        configureImageCache()
    }

    static func demoSettings() -> AppSettings {
        var s = AppSettings()
        s.sync.iCloudEnabled = false
        s.metadata.episodeSource = .tmdb
        s.shelves = [
            .builtIn(.continueWatching, style: .landscape),
            .builtIn(.watchlist),
            .builtIn(.trendingMovies),
            .builtIn(.trendingShows),
            ShelfConfig(id: "demo-scifi", title: "Science Fiction Essentials", source: .discover({ var q = DiscoverQuery(type: .movie); q.genres = [878]; q.sort = .rating; return q }())),
            .builtIn(.topRatedShows),
            .builtIn(.popularMovies),
        ]
        s.liveTV.providers = [IPTVProviderConfig(id: "demo-iptv", name: "Flow Live", kind: .m3u, url: DemoTransport.iptvPlaylistURL, epgURL: DemoTransport.iptvGuideURL, useForVOD: false)]
        s.liveTV.favouriteChannelIDs = []
        return s
    }

    /// Enters or leaves demo mode; the app swaps in a fresh model.
    func setDemoMode(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: "flow.demoMode")
        NotificationCenter.default.post(name: .flowModeChanged, object: nil)
    }

    /// Pushes onto the visible tab's navigation stack.
    func navigate(to route: Route) {
        paths[selectedTab, default: []].append(route)
    }

    func path(for tab: AppTab) -> Binding<[Route]> {
        Binding(get: { self.paths[tab] ?? [] }, set: { self.paths[tab] = $0 })
    }

    // MARK: Lifecycle

    func start() async {
        observeCloud()
        if settings.sync.iCloudEnabled { pullFromCloud(silent: true) }
        await refreshLibrary(force: false)
        await refreshServerIndex()
    }

    private func configureImageCache() {
        URLCache.shared = URLCache(memoryCapacity: 128 * 1024 * 1024, diskCapacity: 1024 * 1024 * 1024)
    }

    private func saveSettings() {
        guard !isDemo else { return }
        if let data = try? SettingsCodec.encode(settings) {
            try? data.write(to: store.directory.appendingPathComponent("settings.json"), options: .atomic)
        }
    }

    private func settingsDidChange(from old: AppSettings) {
        let servicesChanged = old.metadata != settings.metadata
            || old.account != settings.account
            || old.mediaServers.servers != settings.mediaServers.servers
            || old.liveTV.providers != settings.liveTV.providers
        if servicesChanged { rebuildServices() }
        if old.account.tracker != settings.account.tracker {
            Task { await refreshLibrary(force: true) }
        }
        if old.mediaServers.servers != settings.mediaServers.servers {
            Task { await refreshServerIndex() }
        }
        if old.shelves != settings.shelves || old.metadata.showUnreleasedTitles != settings.metadata.showUnreleasedTitles
            || old.mediaServers.onlyShowServerContent != settings.mediaServers.onlyShowServerContent || old.metadata.language != settings.metadata.language {
            contentVersion += 1
        }
        if settings.sync.iCloudEnabled, old.shelves != settings.shelves || old.mediaServers.servers != settings.mediaServers.servers || old.general != settings.general {
            scheduleCloudPush()
        }
    }

    // MARK: Keys

    var tmdbKey: String? { credentials.tmdbAPIKey?.nonEmpty ?? BundleKeys.tmdb }
    var tvdbKey: String? { credentials.tvdbAPIKey?.nonEmpty ?? BundleKeys.tvdb }
    var traktClientID: String? { credentials.traktClientID?.nonEmpty ?? BundleKeys.traktClientID }
    var traktClientSecret: String? { credentials.traktClientSecret?.nonEmpty ?? BundleKeys.traktClientSecret }
    var simklClientID: String? { credentials.simklClientID?.nonEmpty ?? BundleKeys.simklClientID }
    var needsOnboarding: Bool { tmdbKey == nil }

    // MARK: Service construction

    func rebuildServices() {
        let saveLibrary: @Sendable (LocalLibrary) -> Void = { [weak self] library in
            Task { @MainActor in self?.localLibraryDidChange(library) }
        }
        if local == nil {
            local = LocalTracker(library: localLibrary, save: saveLibrary)
        }

        if let key = tmdbKey {
            let tmdb = TMDBClient(credential: key, language: settings.metadata.language, region: settings.metadata.region, includeAdult: settings.metadata.includeAdult, http: http)
            if catalog == nil || catalog?.tmdb.credential != key || catalog?.tmdb.language != tmdb.language || catalog?.tmdb.region != tmdb.region {
                catalog = CatalogService(tmdb: tmdb, cache: cache)
            }
        } else {
            catalog = nil
        }

        if let id = traktClientID {
            trakt = TraktClient(clientID: id, clientSecret: traktClientSecret ?? "", token: credentials.traktToken, http: http) { [weak self] token in
                Task { @MainActor in self?.credentials.traktToken = token }
            }
        } else {
            trakt = nil
        }
        if let id = simklClientID {
            simkl = SimklClient(clientID: id, token: credentials.simklToken, http: http) { [weak self] token in
                Task { @MainActor in self?.credentials.simklToken = token }
            }
        } else {
            simkl = nil
        }
        mdblist = credentials.mdblistAPIKey?.nonEmpty.map { MDBListClient(apiKey: $0, http: http) }
        mediaServers = settings.mediaServers.servers.filter(\.enabled).map(makeServerClient)
        vodProviderCache = [:]

        let catalog = self.catalog, mdblist = self.mdblist, trakt = self.trakt
        Task { await catalog?.update(mdblist: mdblist, trakt: trakt) }
    }

    func makeServerClient(_ config: MediaServerConfig) -> MediaServerClient {
        switch config.kind {
        case .jellyfin, .emby: return JellyfinClient(config: config, deviceID: deviceID, deviceName: Platform.deviceName, http: http)
        case .plex: return PlexClient(config: config, clientIdentifier: deviceID, http: http)
        }
    }

    var tracker: TrackingService {
        switch settings.account.tracker {
        case .trakt:
            if let trakt, credentials.traktToken != nil { return trakt }
        case .simkl:
            if let simkl, credentials.simklToken != nil { return simkl }
        case .mdblist:
            if let key = credentials.mdblistAPIKey?.nonEmpty { return KeyedSyncClient.mdblist(apiKey: key, http: http) }
        case .publicMetaDB:
            if let key = credentials.publicMetaDBAPIKey?.nonEmpty { return KeyedSyncClient.publicMetaDB(baseURL: settings.account.publicMetaDBBaseURL, apiKey: key, http: http) }
        case .local:
            break
        }
        return local
    }

    func listService(for destination: ListDestination) -> ListService {
        switch destination {
        case .trakt:
            if let trakt, credentials.traktToken != nil { return trakt }
        case .simkl:
            if let simkl, credentials.simklToken != nil { return simkl }
        case .mdblist:
            if let key = credentials.mdblistAPIKey?.nonEmpty { return KeyedSyncClient.mdblist(apiKey: key, http: http) }
        case .publicMetaDB:
            if let key = credentials.publicMetaDBAPIKey?.nonEmpty { return KeyedSyncClient.publicMetaDB(baseURL: settings.account.publicMetaDBBaseURL, apiKey: key, http: http) }
        case .mediaServer, .local:
            break
        }
        return local
    }

    /// Destinations offered in the pickers, based on what's configured.
    var availableListDestinations: [ListDestination] {
        var out: [ListDestination] = [.local]
        if credentials.traktToken != nil { out.append(.trakt) }
        if credentials.simklToken != nil { out.append(.simkl) }
        if credentials.mdblistAPIKey?.nonEmpty != nil { out.append(.mdblist) }
        if credentials.publicMetaDBAPIKey?.nonEmpty != nil { out.append(.publicMetaDB) }
        return out
    }

    func showToast(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            if toast == message { toast = nil }
        }
    }

    // MARK: Local library persistence

    private func localLibraryDidChange(_ library: LocalLibrary) {
        localLibrary = library
        store.save(library, "library")
        if settings.account.tracker == .local || settings.account.watchlistDestination == .local || settings.account.favouritesDestination == .local {
            applyLocalLists()
        }
        scheduleCloudPush()
    }

    func applyLocalLists() {
        if settings.account.watchlistDestination == .local { watchlistKeys = localLibrary.watchlist.map(\.key) }
        if settings.account.favouritesDestination == .local { favouriteKeys = localLibrary.favourites.map(\.key) }
    }

    // MARK: iCloud

    private func observeCloud() {
        #if os(iOS) || os(macOS) || os(tvOS)
        guard cloudObserver == nil else { return }
        cloudObserver = NotificationCenter.default.addObserver(forName: UbiquitousKeyValueStore.didChangeExternally, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.settings.sync.iCloudEnabled else { return }
                self.pullFromCloud(silent: true)
            }
        }
        #endif
    }

    func scheduleCloudPush() {
        guard settings.sync.iCloudEnabled else { return }
        cloudPushTask?.cancel()
        cloudPushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled, let self else { return }
            try? self.cloud.push(settings: self.settings, library: self.localLibrary, includeLibrary: false)
            self.settings.sync.lastCloudSync = Date()
        }
    }

    func pushToCloud() {
        do {
            try cloud.push(settings: settings, library: localLibrary, includeLibrary: true)
            settings.sync.lastCloudSync = Date()
            showToast("Pushed to iCloud")
        } catch {
            showToast("iCloud push failed: \(error.localizedDescription)")
        }
    }

    func pullFromCloud(silent: Bool = false) {
        let snapshot = cloud.pull()
        let (newSettings, newLibrary) = CloudSync.apply(snapshot, settings: settings, library: localLibrary)
        if newSettings != settings { settings = newSettings }
        if newLibrary != localLibrary {
            Task { await local.replace(newLibrary) }
        }
        settings.sync.lastCloudSync = Date()
        if !silent { showToast("Pulled from iCloud") }
    }
}

/// `Result(catching:)` for async work, so `async let` can collect failures without throwing.
func resultOf<T>(_ operation: () async throws -> T) async -> Result<T, Error> {
    do { return .success(try await operation()) } catch { return .failure(error) }
}

extension String {
    var nonEmpty: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}
