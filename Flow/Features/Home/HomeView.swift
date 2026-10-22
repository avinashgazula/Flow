import SwiftUI
import FlowKit

/// What Home leads with: a title, the episode if it is one, and how far in.
struct HomeLead: Equatable, Identifiable {
    enum Kind: Equatable { case resume, nextUp, pick }

    var item: MediaItem
    var episode: EpisodeRef?
    var progress: PlaybackProgress?
    var kind: Kind = .pick
    /// The Continue Watching entry it came from, so Up Next doesn't list it twice.
    var entryID: String?

    var id: String { entryID ?? item.id }

    /// Minutes still to watch, when the app knows (a resume point, or a runtime).
    var minutes: Int? { Programme.minutesLeft(progress: progress, runtimeMinutes: item.runtimeMinutes) }
}

/// Home: a large title by the hour, the one thing to carry on with as a big frame with its edge strip and a
/// yellow Resume, then Up Next as framed stills, then rows of posters to pick from. On wide screens (and
/// Apple TV) the lead stands left and Up Next right.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var lead: HomeLead?
    /// The greeting follows the hour, so it is refreshed each minute.
    @State private var now = Date()

    private var general: GeneralSettings { model.settings.general }
    private var dayPart: Programme.DayPart { Programme.DayPart(date: now) }

    /// The enabled shelves, minus the ones their General switches turn off.
    private var shelves: [ShelfConfig] {
        model.settings.shelves.filter { shelf in
            guard shelf.enabled else { return false }
            switch shelf.source {
            case .builtIn(.continueWatching): return general.showContinueWatching
            case .builtIn(.upcomingEpisodes): return general.showUpcoming
            default: return true
            }
        }
    }

    /// Continue Watching and Next Up are one section on Home, "Up Next", beside the lead; the other shelves are rows below.
    private var rowShelves: [ShelfConfig] {
        shelves.filter { shelf in
            if case .builtIn(let builtIn) = shelf.source, builtIn == .continueWatching || builtIn == .nextUp { return false }
            return true
        }
    }

    private var showsUpNext: Bool {
        shelves.contains { shelf in
            if case .builtIn(let builtIn) = shelf.source { return builtIn == .continueWatching || builtIn == .nextUp }
            return false
        }
    }

    private var servers: [MediaServerConfig] {
        model.mediaServers.map(\.config).filter { model.settings.mediaServers.showsHomeRow(for: $0.id) }
    }

    /// What decides the lead: the top Continue Watching entry, or the top pick when nothing is in progress.
    private var leadKey: String {
        "\(model.contentVersion)-\(general.showContinueWatching)-\(model.continueWatching.first?.id ?? "none")-\(general.heroSource.rawValue)-\(general.heroSecondarySource?.rawValue ?? "")"
    }

    var body: some View {
        Group {
            if model.catalog == nil {
                MissingKeyView()
            } else {
                GeometryReader { proxy in
                    ScrollView {
                        page(wide: Self.splits(width: proxy.size.width))
                    }
                    .scrollIndicators(.hidden)
                    .refreshable { await model.refreshLibrary(force: true) }
                }
            }
        }
        .background(Theme.Palette.ground.ignoresSafeArea())
        .task(id: leadKey) { await loadLead() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                now = Date()
            }
        }
        #if !os(tvOS)
        .tabRootTitle(dayPart.title)
        .largeNavigationTitle()
        #endif
        #if os(iOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { model.showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
            }
        }
        #elseif os(macOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                SettingsLink { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
            }
        }
        #elseif os(tvOS)
        .toolbar {
            // tvOS 17 has no Settings tab.
            if !model.settingsInTab {
                ToolbarItem(placement: .automatic) {
                    Button { model.showSettings = true } label: { Image(systemName: "gearshape.fill") }
                        .accessibilityLabel("Settings")
                }
            }
        }
        #endif
    }

    // MARK: Layout

    /// Lead and Up Next side by side once there is room; always on Apple TV.
    private static func splits(width: CGFloat) -> Bool {
        #if os(tvOS)
        return true
        #else
        return width >= 900
        #endif
    }

    /// Apple TV scrolls under the tab bar, so the page starts below it.
    private var topInset: CGFloat {
        #if os(tvOS)
        return 120
        #else
        return Theme.Space.xxs
        #endif
    }

    private func page(wide: Bool) -> some View {
        LazyVStack(alignment: .leading, spacing: Theme.Space.section) {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                header
                if wide {
                    HStack(alignment: .top, spacing: Theme.Space.xl) {
                        if let lead {
                            LeadBlock(lead: lead)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                        }
                        if showsUpNext {
                            UpNextSection(leadEntryID: lead?.entryID, grid: true)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                        }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                } else if let lead {
                    LeadBlock(lead: lead)
                        .padding(.horizontal, Theme.Space.gutter)
                        .frame(maxWidth: 720, alignment: .leading)
                }
            }
            if !wide && showsUpNext {
                UpNextSection(leadEntryID: lead?.entryID, grid: false)
            }
            ForEach(rowShelves) { shelf in
                HomeRow(shelf: shelf)
            }
            ForEach(servers) { server in
                ServerLibrariesIndex(server: server)
            }
            if shelves.isEmpty {
                ContentUnavailableView("No Shelves", systemImage: "square.grid.2x2", description: Text("Turn shelves on in Settings → Shelves."))
            }
        }
        .padding(.bottom, Theme.Space.xxl)
    }

    /// The date, and on Apple TV the greeting too: its tab bar names the page, so the title is drawn here.
    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            #if os(tvOS)
            Text(dayPart.title)
                .font(.system(.largeTitle, weight: .bold))
                .foregroundStyle(Theme.Palette.text)
            #endif
            Text(Programme.dateLine(now))
                .font(.system(.subheadline))
                .foregroundStyle(Theme.Palette.textSecondary)
        }
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.top, topInset)
        .accessibilityElement(children: .combine)
    }

    // MARK: Loading

    private func loadLead() async {
        if general.showContinueWatching, let entry = model.continueWatching.first, let item = await model.hydrate([entry.key]).first {
            lead = HomeLead(item: item, episode: entry.episode, progress: entry.progress, kind: entry.isNextUp ? .nextUp : .resume, entryID: entry.id)
        } else if let top = await model.heroItems().first {
            lead = HomeLead(item: top)
        } else {
            lead = nil
        }
    }
}

// MARK: - The lead

/// The one dominant item: a large 16:9 frame with its edge strip, the title, a line of meta, a yellow Resume
/// (or Play) and a quiet Details.
struct LeadBlock: View {
    let lead: HomeLead
    @Environment(AppModel.self) private var model
    /// A runtime fetched when the lead has none, which is the case for most picks.
    @State private var fetchedMinutes: Int?

    private var item: MediaItem { lead.item }
    private var minutes: Int? { lead.minutes ?? fetchedMinutes }

    private var strip: EdgePrint {
        let format = model.lastEdgeFormat(for: item)
        switch lead.kind {
        case .resume:
            return EdgePrint(progress: (lead.progress?.percent ?? 0) / 100, lead: episodeLead, key: minutes.map { Programme.left(minutes: $0) },
                             endsInMinutes: minutes, tail: format)
        case .nextUp:
            return EdgePrint(progress: 0, lead: episodeLead, key: "Up next", endsInMinutes: minutes, tail: format)
        case .pick:
            return EdgePrint(lead: [item.year.map { String($0) } ?? "", minutes.map { Programme.duration(minutes: $0) } ?? ""], endsInMinutes: minutes, tail: format)
        }
    }

    private var episodeLead: [String] {
        guard let episode = lead.episode else { return item.year.map { [String($0)] } ?? [] }
        return ["S\(episode.season) E\(episode.episode)"]
    }

    private var meta: String {
        if let episode = lead.episode { return "Season \(episode.season), Episode \(episode.episode)" }
        return item.shortMeta
    }

    private var spoken: String {
        Programme.spokenListing(title: item.title, episode: lead.episode, minutesLeft: lead.kind == .resume ? minutes : nil,
                                endsAt: minutes.map { Programme.endDate(from: Date(), minutesLeft: $0) }, extra: model.lastEdgeFormat(for: item))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            Button { model.navigate(to: .detail(item)) } label: {
                FilmFrame(art: .still(item), strip: strip)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(spoken)
            }
            .buttonStyle(CardButtonStyle(lift: 1.04))
            #if os(tvOS)
            // The Details button is the remote's way in; a frame that takes focus too would be one stop too many.
            .focusable(false)
            #endif
            VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                Text(item.title)
                    .font(.system(.title, weight: .bold))
                    .foregroundStyle(Theme.Palette.text)
                    .lineLimit(2)
                if !meta.isEmpty {
                    Text(meta)
                        .font(.system(.subheadline).monospacedDigit())
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(2)
                }
            }
            HStack(spacing: Theme.Space.s) {
                // The width goes on the label, so the button's own fill stretches with it.
                Button { Task { await model.play(item) } } label: {
                    Label(lead.kind == .resume ? "Resume" : "Play", systemImage: "play.fill")
                        .frame(maxWidth: Platform.isTV ? nil : .infinity)
                        .frame(minWidth: Platform.isTV ? 240 * Theme.scale : nil)
                }
                .buttonStyle(PrimaryButtonStyle())
                Button { model.navigate(to: .detail(item)) } label: { Text("Details") }
                    .buttonStyle(GlassButtonStyle())
            }
        }
        .task(id: item.id) { await fetchMinutes() }
    }

    private func fetchMinutes() async {
        guard lead.minutes == nil, let catalog = model.catalog, let id = item.ids.tmdb else { return }
        if let detail = try? await catalog.details(item.type, id: id), let runtime = detail.item.runtimeMinutes, runtime > 0 {
            fetchedMinutes = runtime
        }
    }
}

// MARK: - Up Next

/// What is in progress, and the next episodes, as framed stills whose strips fill as you watch.
private struct UpNextSection: View {
    let leadEntryID: String?
    /// A two-column grid beside the lead; otherwise one row that scrolls sideways.
    let grid: Bool
    @Environment(AppModel.self) private var model
    @State private var items: [MediaKey: MediaItem] = [:]

    /// Most recent first, so a limit keeps the latest; the lead is already on the page.
    private var entries: [ContinueWatchingBuilder.Entry] {
        let all = model.continueWatching
        let limited = model.settings.general.continueWatchingLimit.map { Array(all.prefix($0)) } ?? all
        return limited.filter { $0.id != leadEntryID }
    }

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHeader("Up Next", route: .library(.continueWatching))
                    .padding(.horizontal, grid ? -Theme.Space.gutter : 0)
                if grid {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: Theme.Space.m, alignment: .top), GridItem(.flexible(), spacing: Theme.Space.m, alignment: .top)],
                              alignment: .leading, spacing: Theme.Space.m) {
                        ForEach(entries.prefix(6)) { entry in
                            if let item = items[entry.key] { UpNextCell(entry: entry, item: item, width: nil) }
                        }
                    }
                } else {
                    FilmScroller(ids: entries.map(\.id), itemWidth: Platform.landscapeWidth) {
                        ForEach(entries) { entry in
                            if let item = items[entry.key] { UpNextCell(entry: entry, item: item, width: Platform.landscapeWidth) }
                        }
                    }
                }
            }
            .task(id: entries.map(\.id)) {
                let hydrated = await model.hydrate(entries.map(\.key))
                var map = items
                for item in hydrated { if let key = item.key { map[key] = item } }
                // Coming back to the page re-runs this; unchanged titles shouldn't redraw the row.
                guard map != items else { return }
                withAnimation(Theme.Motion.fade) { items = map }
            }
        }
    }
}

private struct UpNextCell: View {
    let entry: ContinueWatchingBuilder.Entry
    let item: MediaItem
    let width: CGFloat?
    @Environment(AppModel.self) private var model

    private var minutes: Int? { Programme.minutesLeft(progress: entry.progress, runtimeMinutes: item.runtimeMinutes) }

    private var strip: EdgePrint {
        let lead = entry.episode.map { ["S\($0.season) E\($0.episode)"] } ?? []
        let format = model.lastEdgeFormat(for: item)
        if entry.isNextUp {
            return EdgePrint(progress: 0, lead: lead, key: "Up next", endsInMinutes: minutes, tail: format)
        }
        return EdgePrint(progress: (entry.progress?.percent ?? 0) / 100, lead: lead, key: minutes.map { Programme.left(minutes: $0) },
                         endsInMinutes: minutes, tail: format)
    }

    private var spoken: String {
        Programme.spokenListing(title: item.title, episode: entry.episode, minutesLeft: entry.isNextUp ? nil : minutes,
                                endsAt: minutes.map { Programme.endDate(from: Date(), minutesLeft: $0) },
                                extra: (entry.isNextUp ? ["up next"] : []) + model.lastEdgeFormat(for: item))
    }

    var body: some View {
        Button(action: open) {
            FilmCard(art: .still(item), strip: strip, title: item.title, meta: item.shortMeta, width: width, spoken: spoken)
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu {
            Button { model.navigate(to: .detail(item)) } label: { Label("Go to Details", systemImage: "info.circle") }
            Button { Task { await model.setWatched(item, episodes: entry.episode.map { [$0] }, watched: true) } } label: {
                Label("Mark as Watched", systemImage: "checkmark.circle")
            }
            Button(role: .destructive) {
                Task { await model.removeFromContinueWatching(entry) }
            } label: { Label("Remove from Continue Watching", systemImage: "xmark.circle") }
        }
    }

    private func open() {
        if model.settings.playback.skipDetailsOnContinueWatching {
            Task { await model.play(item, episode: nil) }
        } else {
            model.navigate(to: .detail(item))
        }
    }
}

// MARK: - Rows

/// One shelf as a row on the page: a plain heading over posters at one fixed size, each with a print-only strip.
private struct HomeRow: View {
    let shelf: ShelfConfig

    var body: some View {
        switch shelf.source {
        case .builtIn(.upcomingEpisodes):
            UpcomingRow(shelf: shelf)
        case .builtIn(.streamingServices):
            ServicesIndex(shelf: shelf)
        case .builtIn(.genres):
            IndexSection(title: shelf.title, entries: GenreTile.featured.map { genre in
                IndexSection.Entry(id: "genre-\(genre.id)", title: genre.name, meta: nil,
                                   shelf: ShelfConfig(id: "genre-\(genre.id)", title: genre.name, source: .discover(genre.query)))
            })
        default:
            PicksRow(shelf: shelf)
        }
    }
}

/// A catalogue shelf: posters, each with the runtime and rating in edge print, no perforations (nothing watched).
private struct PicksRow: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var loaded = false
    /// Replaces the configured title when the row names its seed ("Because You Watched Dune").
    @State private var title: String?

    var body: some View {
        Group {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader(title ?? shelf.title, route: .shelf(shelf))
                    FilmScroller(ids: items.map(\.id), itemWidth: Platform.posterWidth) {
                        ForEach(items) { item in
                            PickCard(item: item, context: shelf.id)
                        }
                    }
                }
                .transition(.opacity)
            } else if !loaded {
                ShelfPlaceholder(title: shelf.title)
            }
        }
        .animation(Theme.Motion.fade, value: items.isEmpty)
        .task(id: "\(shelf.id)-\(model.shelfReloadKey(for: shelf))") { await load() }
    }

    private func load() async {
        if case .builtIn(.becauseYouWatched) = shelf.source, let seed = model.becauseYouWatchedSeed,
           let source = await model.hydrate([seed]).first {
            title = "Because You Watched \(source.title)"
        }
        // Unchanged contents leave the row alone, so a reload never re-renders it.
        if let loadedItems = try? await model.shelfItems(for: shelf), loadedItems != items { items = loadedItems }
        loaded = true
    }
}

private struct PickCard: View {
    let item: MediaItem
    let context: String
    @Environment(AppModel.self) private var model
    /// Shelves list titles without runtimes, so each card asks for its own as it appears.
    @State private var runtime: Int?

    private var zoomID: String { "\(context)-\(item.id)" }

    private var strip: EdgePrint {
        var lead: [String] = []
        if let runtime { lead.append(Programme.duration(minutes: runtime)) } else if item.type == .show { lead.append("Series") }
        let tail = item.voteAverage.flatMap { $0 > 0 ? [String(format: "%.1f", $0)] : nil } ?? []
        return EdgePrint(lead: lead, tail: tail)
    }

    private var spoken: String {
        var extra: [String] = []
        if let year = item.year { extra.append(String(year)) }
        if let runtime { extra.append(Programme.spokenDuration(minutes: runtime)) }
        if let vote = item.voteAverage, vote > 0 { extra.append("rated " + String(format: "%.1f", vote)) }
        if model.isWatched(item) { extra.append("watched") }
        return Programme.spokenListing(title: item.title, extra: extra)
    }

    var body: some View {
        NavigationLink(value: Route.detail(item, zoom: zoomID)) {
            FilmCard(art: .poster(item), strip: strip, title: item.title, meta: item.year.map { String($0) }, width: Platform.posterWidth, spoken: spoken, zoomID: zoomID)
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu { MediaContextMenu(item: item) } preview: { PosterPreview(item: item) }
        .task(id: item.id) { await loadRuntime() }
    }

    private func loadRuntime() async {
        if let known = item.runtimeMinutes, known > 0 { runtime = known; return }
        guard item.type == .movie, let catalog = model.catalog, let id = item.ids.tmdb else { return }
        if let detail = try? await catalog.details(item.type, id: id), let minutes = detail.item.runtimeMinutes, minutes > 0 {
            runtime = minutes
        }
    }
}

/// What is coming: stills with the air day in the key position of the strip.
private struct UpcomingRow: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var entries: [UpcomingEntry] = []

    var body: some View {
        Group {
            if !entries.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader(shelf.title, route: .shelf(shelf))
                    FilmScroller(ids: entries.map(\.id), itemWidth: Platform.landscapeWidth) {
                        ForEach(entries) { entry in
                            UpcomingCell(entry: entry, context: shelf.id)
                        }
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(Theme.Motion.fade, value: entries.isEmpty)
        .task(id: "\(model.contentVersion)-\(model.settings.general.upcomingWithinDays)-\(model.settings.general.includeWatchlistPremieres)-\(model.settings.general.filmDates.rawValue)") {
            entries = await model.upcoming()
        }
    }
}

private struct UpcomingCell: View {
    let entry: UpcomingEntry
    let context: String

    private var zoomID: String { "\(context)-\(entry.id)" }

    private var strip: EdgePrint {
        let air = Programme.airColumn(for: entry.date)
        return EdgePrint(lead: entry.episode.map { [$0.code] } ?? ["Film"], key: "\(air.label) \(air.day)")
    }

    var body: some View {
        let air = Programme.airColumn(for: entry.date)
        NavigationLink(value: Route.detail(entry.item, zoom: zoomID)) {
            FilmCard(art: .still(entry.item), strip: strip, title: entry.item.title, meta: entry.episode?.title ?? entry.item.shortMeta,
                     width: Platform.landscapeWidth,
                     spoken: Programme.spokenListing(title: entry.item.title, episode: entry.episode?.ref, extra: ["\(air.label) \(air.day)"]),
                     zoomID: zoomID)
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu { MediaContextMenu(item: entry.item) } preview: { PosterPreview(item: entry.item) }
    }
}

/// A row that scrolls sideways, snapping to cards, with the Mac's paging arrows.
struct FilmScroller<ID: Hashable, Content: View>: View {
    let ids: [ID]
    let itemWidth: CGFloat
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                content
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Platform.isTV ? 36 : 6)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollClipDisabled()
        .pagingArrows(ids: ids, itemWidth: itemWidth + 14)
    }
}

/// Streaming services as a plain index: tapping one opens what is popular on it.
private struct ServicesIndex: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var services: [StreamingService] = []

    var body: some View {
        Group {
            if !services.isEmpty {
                let region = model.settings.metadata.region
                IndexSection(title: shelf.title, entries: services.map { service in
                    IndexSection.Entry(id: "service-\(service.id)", title: service.name, meta: nil,
                                       shelf: ShelfConfig(id: "service-\(service.id)-\(region)", title: service.name, source: .discover(service.query(region: region))))
                })
            }
        }
        .task(id: "\(model.settings.metadata.region)-\(model.contentVersion)") {
            services = await model.catalog?.streamingServices() ?? []
        }
    }
}

/// One media server's libraries, named in a plain index.
private struct ServerLibrariesIndex: View {
    let server: MediaServerConfig
    @Environment(AppModel.self) private var model
    @State private var libraries: [AppModel.ServerLibrary] = []

    var body: some View {
        Group {
            if !libraries.isEmpty {
                IndexSection(title: server.name, entries: libraries.map { entry in
                    IndexSection.Entry(id: entry.id, title: entry.library.name, meta: nil, shelf: entry.shelf)
                })
            }
        }
        .task(id: "\(server.id)-\(model.contentVersion)") {
            libraries = await model.serverLibraries(for: server.id)
        }
    }
}

/// Names that open a shelf (genres, services, a server's libraries), set as text in a grid of plain rows.
private struct IndexSection: View {
    struct Entry: Identifiable {
        let id: String
        let title: String
        var meta: String?
        let shelf: ShelfConfig
    }

    let title: String
    let entries: [Entry]
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>(title)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170 * Theme.scale), spacing: Theme.Space.xxs, alignment: .top)],
                      alignment: .leading, spacing: Theme.Space.xxs) {
                ForEach(entries) { entry in
                    ProgrammeRow(title: entry.title, meta: entry.meta, action: { model.navigate(to: .shelf(entry.shelf)) })
                }
            }
            .padding(.horizontal, Theme.Space.gutter - ProgrammeMetrics.inset)
        }
    }
}

/// Listings, one after another, inset so their text lines up with the page's headings.
struct ProgrammeList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        LazyVStack(alignment: .leading, spacing: Theme.Space.xxs) { content }
            .padding(.horizontal, Theme.Space.gutter - ProgrammeMetrics.inset)
    }
}

extension AppModel {
    /// What a shelf's contents depend on. Catalogue rows (trending, popular, Discover) don't change
    /// when you mark something watched, so they don't reload with every library change.
    func shelfReloadKey(for shelf: ShelfConfig) -> String {
        // Language and region change what TMDb returns, so they reload catalogue rows too.
        var filters = "\(settings.general.contentShelfLength)-\(settings.metadata.showUnreleasedTitles)-\(settings.metadata.language)-\(settings.metadata.region)"
        // Filtering to your servers depends on their index, which refreshes with the library.
        if settings.mediaServers.onlyShowServerContent { filters += "-\(contentVersion)" }
        switch shelf.source {
        case .builtIn(let builtIn) where builtIn.isContentShelf && builtIn != .recommendedForYou && builtIn != .becauseYouWatched:
            return filters
        case .discover:
            return filters
        default:
            return "\(filters)-\(contentVersion)"
        }
    }

    /// ["2160p", "DV"]: what this title last played as, when Remember Last Source is on and it has played.
    func lastEdgeFormat(for item: MediaItem) -> [String] {
        guard settings.sources.rememberLastSource, let key = item.key?.description,
              let last = settings.sources.lastSources[key] else { return [] }
        return last.edgeFormat
    }
}

/// "Show All" for any shelf. A streaming service's page offers Movies or TV Shows.
struct ShelfGridView: View {
    let shelf: ShelfConfig
    @State private var type: MediaType?

    private var providerQuery: DiscoverQuery? {
        if case .discover(let query) = shelf.source, !query.watchProviders.isEmpty { return query }
        return nil
    }

    /// The shelf with the picked type applied.
    private var typed: ShelfConfig {
        guard let type, var query = providerQuery else { return shelf }
        query.type = type
        var copy = shelf
        copy.source = .discover(query)
        return copy
    }

    var body: some View {
        VStack(spacing: 0) {
            if let query = providerQuery {
                Picker("Type", selection: Binding(get: { type ?? query.type }, set: { type = $0 })) {
                    Text("Movies").tag(MediaType.movie)
                    Text("TV Shows").tag(MediaType.show)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Theme.Space.xs)
            }
            ShelfGridContent(shelf: typed).id(type)
        }
        .navigationTitle(shelf.title)
    }
}

/// One type's worth of a shelf, with paging where the source supports it.
private struct ShelfGridContent: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var page = 0
    @State private var hasMore = true
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            PosterGrid(items: items) { Task { await loadMore() } }
                .padding(.vertical)
            if loading { ProgressView().padding() }
            if let error, items.isEmpty {
                ContentUnavailableView("Couldn't Load", systemImage: "exclamationmark.triangle", description: Text(error))
            }
        }
        .task {
            guard items.isEmpty else { return }
            await loadMore()
            // Filters can leave a page empty, and an empty grid never reaches its end to ask for the next one.
            var extra = 0
            while items.isEmpty, hasMore, error == nil, extra < 4 {
                extra += 1
                await loadMore()
            }
        }
    }

    private func loadMore() async {
        guard hasMore, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let next = try await model.page(for: shelf, page: page + 1)
            var seen = Set(items.map(\.id))
            items += next.items.filter { seen.insert($0.id).inserted }
            page = next.page
            hasMore = next.hasMore
        } catch {
            self.error = error.localizedDescription
            hasMore = false
        }
    }
}
