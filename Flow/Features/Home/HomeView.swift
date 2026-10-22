import SwiftUI
import FlowKit

/// What Home leads with, or what its side frame is showing: a title, the episode if it is one, and how far in.
struct HomeLead: Equatable, Identifiable {
    enum Kind: Equatable { case resume, nextUp, pick }

    var item: MediaItem
    var episode: EpisodeRef?
    var progress: PlaybackProgress?
    var kind: Kind = .pick
    /// The Continue Watching entry it came from, so Carry On doesn't list it twice.
    var entryID: String?

    var id: String { entryID ?? item.id }

    /// Minutes still to watch, when the app knows (a resume point, or a runtime).
    var minutes: Int? { Programme.minutesLeft(progress: progress, runtimeMinutes: item.runtimeMinutes) }
}

/// Home, "Tonight": what you were watching and exactly when it would finish, then tonight's picks as a
/// programme. Wide screens put the programme on the left and a large still of the selected listing on the
/// right; the still follows the pointer on Mac and iPad and the focused row on Apple TV.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var lead: HomeLead?
    /// The listing the side frame shows on wide screens; the lead until something else is hovered or focused.
    @State private var selected: HomeLead?
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
                    if Self.splits(width: proxy.size.width) {
                        split(width: proxy.size.width)
                    } else {
                        singleColumn
                    }
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

    // MARK: Layouts

    /// Two columns once there is room for a programme and a frame side by side; always on Apple TV.
    private static func splits(width: CGFloat) -> Bool {
        #if os(tvOS)
        return true
        #else
        return width >= 900
        #endif
    }

    /// iPhone and narrow windows: the lead first, full width, then the programme.
    private var singleColumn: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Theme.Space.section) {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    header
                    if let lead {
                        ProgrammeFrame(lead: lead, showsOverview: false)
                            .padding(.horizontal, Theme.Space.gutter)
                            .frame(maxWidth: 720, alignment: .leading)
                    }
                }
                sections(rows: 6, selectedID: nil, onFocus: nil)
            }
            .padding(.bottom, Theme.Space.xxl)
        }
        .scrollIndicators(.hidden)
        .refreshable { await model.refreshLibrary(force: true) }
    }

    /// The programme on the left, scrolling; the selected listing's frame on the right, standing still.
    private func split(width: CGFloat) -> some View {
        let shown = selected ?? lead
        let panelWidth = min(Platform.isTV ? 760 : 480, width * 0.42)
        return HStack(alignment: .top, spacing: Theme.Space.l) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.Space.section) {
                    header
                    sections(rows: 8, selectedID: shown?.id, onFocus: { choice in
                        guard selected?.id != choice.id else { return }
                        withAnimation(Theme.Motion.fade) { selected = choice }
                    })
                }
                .padding(.bottom, Theme.Space.xxl)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.refreshLibrary(force: true) }
            .frame(maxWidth: .infinity)
            if let shown {
                ScrollView {
                    ProgrammeFrame(lead: shown, showsOverview: true)
                        .id(shown.id)
                        .transition(.opacity)
                        .padding(.top, topInset)
                        .padding(.bottom, Theme.Space.l)
                }
                .scrollIndicators(.hidden)
                .frame(width: panelWidth)
                .padding(.trailing, Theme.Space.gutter)
            }
        }
        #if os(tvOS)
        .ignoresSafeArea(edges: [.top, .horizontal])
        #endif
    }

    /// Apple TV scrolls under the tab bar, so the page starts below it.
    private var topInset: CGFloat {
        #if os(tvOS)
        return 150
        #else
        return Theme.Space.s
        #endif
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

    @ViewBuilder
    private func sections(rows: Int, selectedID: String?, onFocus: ((HomeLead) -> Void)?) -> some View {
        ForEach(shelves) { shelf in
            HomeSection(shelf: shelf, rows: rows, lead: lead, selectedID: selectedID, onFocus: onFocus)
        }
        ForEach(servers) { server in
            ServerLibrariesIndex(server: server)
        }
        if shelves.isEmpty {
            ContentUnavailableView("No Shelves", systemImage: "square.grid.2x2", description: Text("Turn shelves on in Settings → Shelves."))
        }
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
        // A fresh lead replaces whatever the side frame was showing.
        selected = nil
    }
}

// MARK: - The frame

/// A framed 16:9 still with its timetable line beneath it (when it would start and end if you pressed play
/// now, the title, the episode, the minutes left, the version) and the one pink action. Full width on
/// iPhone; the side frame on wide screens.
struct ProgrammeFrame: View {
    let lead: HomeLead
    var showsOverview = false
    @Environment(AppModel.self) private var model
    /// A runtime fetched when the lead has none, which is the case for most picks.
    @State private var fetchedMinutes: Int?

    private var item: MediaItem { lead.item }
    private var minutes: Int? { lead.minutes ?? fetchedMinutes }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            still
            VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                if minutes != nil { timetable }
                Text(item.title)
                    .font(.system(.title2, weight: .bold))
                    .foregroundStyle(Theme.Palette.text)
                    .lineLimit(2)
                if !meta.isEmpty {
                    Text(meta)
                        .font(.system(.subheadline).monospacedDigit())
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(2)
                }
                if let version = model.lastVersionLine(for: item) {
                    Text(version)
                        .font(.system(.footnote).monospacedDigit())
                        .foregroundStyle(Theme.Palette.textTertiary)
                }
            }
            if showsOverview, let overview = item.overview, !overview.isEmpty {
                Text(overview)
                    .font(.system(.subheadline))
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .lineSpacing(2)
                    .lineLimit(4)
            }
            actions
        }
        .task(id: item.id) { await fetchMinutes() }
    }

    private var still: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.frame, style: .continuous)
        return Button { model.navigate(to: .detail(item)) } label: {
            Color.clear
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(RemoteImage(url: item.backdropURL, maxPixel: Platform.isTV ? 1400 : 1000, fallbackTitle: item.title))
                .overlay(alignment: .bottom) {
                    if let progress = lead.progress { ProgrammeProgressLine(value: progress.percent / 100) }
                }
                .clipShape(shape)
                .hairline(shape)
        }
        .buttonStyle(CardButtonStyle())
        #if os(tvOS)
        // The Details button is the remote's way in; a still that takes focus too would be one stop too many.
        .focusable(false)
        #endif
        .accessibilityLabel("\(item.title), details")
    }

    /// "21:14 – 21:32": now, and when it would be over. Ticks on the minute.
    private var timetable: some View {
        TimelineView(.everyMinute) { context in
            let end = Programme.endDate(from: context.date, minutesLeft: minutes ?? 0)
            Text("\(Programme.clock(context.date)) – \(Programme.clock(end))")
                .font(Theme.Typeface.time)
                .foregroundStyle(Theme.Palette.text)
                .accessibilityLabel("Starts \(Programme.clock(context.date)), ends \(Programme.clock(end))")
        }
    }

    /// "S3 E7 · 18 min left", "S4 E1 · Up Next", or the plain facts of a pick.
    private var meta: String {
        var parts: [String] = []
        switch lead.kind {
        case .resume, .nextUp:
            if let episode = lead.episode { parts.append("S\(episode.season) E\(episode.episode)") } else if let year = item.year { parts.append(String(year)) }
            if lead.kind == .nextUp {
                parts.append("Up Next")
            } else if let minutes {
                parts.append(Programme.left(minutes: minutes))
            }
            return parts.joined(separator: " · ")
        case .pick:
            return item.programmeMeta
        }
    }

    private var actions: some View {
        HStack(spacing: Theme.Space.s) {
            // The width goes on the label, so the button's own fill stretches with it.
            Button { Task { await model.play(item) } } label: { playLabel.frame(maxWidth: Platform.isTV ? nil : .infinity) }
                .buttonStyle(PrimaryButtonStyle())
            Button { model.navigate(to: .detail(item)) } label: { Text("Details") }
                .buttonStyle(GlassButtonStyle())
        }
    }

    /// "Resume · 18 min left", or "Play · ends 23:32" (which ticks).
    @ViewBuilder
    private var playLabel: some View {
        if lead.kind == .resume, let minutes {
            Label("Resume · \(Programme.left(minutes: minutes))", systemImage: "play.fill")
        } else if lead.kind == .resume {
            Label("Resume", systemImage: "play.fill")
        } else if let minutes {
            Label {
                TimelineView(.everyMinute) { context in
                    Text("Play · ends \(Programme.clock(Programme.endDate(from: context.date, minutesLeft: minutes)))")
                }
            } icon: {
                Image(systemName: "play.fill")
            }
        } else {
            Label("Play", systemImage: "play.fill")
        }
    }

    private func fetchMinutes() async {
        guard lead.minutes == nil, let catalog = model.catalog, let id = item.ids.tmdb else { return }
        if let detail = try? await catalog.details(item.type, id: id), let runtime = detail.item.runtimeMinutes, runtime > 0 {
            fetchedMinutes = runtime
        }
    }
}

// MARK: - Sections

/// One shelf as part of the programme: plain headings over listings.
private struct HomeSection: View {
    let shelf: ShelfConfig
    let rows: Int
    let lead: HomeLead?
    let selectedID: String?
    var onFocus: ((HomeLead) -> Void)?

    var body: some View {
        switch shelf.source {
        case .builtIn(.continueWatching):
            CarryOnSection(title: "Carry On", nextUpOnly: false, leadEntryID: lead?.entryID, selectedID: selectedID, onFocus: onFocus)
        case .builtIn(.nextUp):
            CarryOnSection(title: shelf.title, nextUpOnly: true, leadEntryID: lead?.entryID, selectedID: selectedID, onFocus: onFocus)
        case .builtIn(.upcomingEpisodes):
            UpcomingSection(shelf: shelf, rows: rows, selectedID: selectedID, onFocus: onFocus)
        case .builtIn(.streamingServices):
            ServicesIndex(shelf: shelf)
        case .builtIn(.genres):
            IndexSection(title: shelf.title, entries: GenreTile.featured.map { genre in
                IndexSection.Entry(id: "genre-\(genre.id)", title: genre.name, meta: nil,
                                   shelf: ShelfConfig(id: "genre-\(genre.id)", title: genre.name, source: .discover(genre.query)))
            })
        default:
            PicksSection(shelf: shelf, rows: rows, selectedID: selectedID, onFocus: onFocus)
        }
    }
}

/// The rest of what is in progress, and Up Next, as listings: when each would end if you pressed play now.
private struct CarryOnSection: View {
    let title: String
    let nextUpOnly: Bool
    let leadEntryID: String?
    let selectedID: String?
    var onFocus: ((HomeLead) -> Void)?
    @Environment(AppModel.self) private var model
    @State private var items: [MediaKey: MediaItem] = [:]

    /// Most recent first, so a limit keeps the latest; the lead is already on the page above.
    private var entries: [ContinueWatchingBuilder.Entry] {
        let all = nextUpOnly ? model.continueWatching.filter(\.isNextUp) : model.continueWatching
        let limited = model.settings.general.continueWatchingLimit.map { Array(all.prefix($0)) } ?? all
        return limited.filter { $0.id != leadEntryID }
    }

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHeader(title, route: .library(.continueWatching))
                ProgrammeList {
                    ForEach(entries) { entry in
                        if let item = items[entry.key] {
                            CarryOnRow(entry: entry, item: item, selected: selectedID == entry.id, onFocus: onFocus)
                        }
                    }
                }
            }
            .task(id: entries.map(\.id)) {
                let hydrated = await model.hydrate(entries.map(\.key))
                var map = items
                for item in hydrated { if let key = item.key { map[key] = item } }
                // Coming back to the page re-runs this; unchanged titles shouldn't redraw the list.
                guard map != items else { return }
                withAnimation(Theme.Motion.fade) { items = map }
            }
        }
    }
}

private struct CarryOnRow: View {
    let entry: ContinueWatchingBuilder.Entry
    let item: MediaItem
    var selected = false
    var onFocus: ((HomeLead) -> Void)?
    @Environment(AppModel.self) private var model

    private var minutes: Int? { Programme.minutesLeft(progress: entry.progress, runtimeMinutes: item.runtimeMinutes) }

    private var column: ProgrammeRow.Column {
        if let minutes { return .ends(minutes: minutes, resume: entry.progress != nil) }
        return .label(entry.isNextUp ? "Next" : "–", sub: nil)
    }

    /// "S3 E7 · 18 min left", "S4 E1 · Up Next", or the year of a film.
    private var meta: String {
        var parts: [String] = []
        if let episode = entry.episode {
            parts.append("S\(episode.season) E\(episode.episode)")
        } else if let year = item.year {
            parts.append(String(year))
        }
        if entry.isNextUp {
            parts.append("Up Next")
        } else if entry.progress != nil, let minutes {
            parts.append(Programme.left(minutes: minutes))
        }
        return parts.joined(separator: " · ")
    }

    private var asLead: HomeLead {
        HomeLead(item: item, episode: entry.episode, progress: entry.progress, kind: entry.isNextUp ? .nextUp : .resume, entryID: entry.id)
    }

    var body: some View {
        ProgrammeRow(
            column: column,
            art: .still(item),
            title: item.title,
            meta: meta,
            version: model.lastVersionLine(for: item),
            progress: entry.progress.map { $0.percent / 100 },
            episode: entry.episode,
            selected: selected,
            onFocus: { onFocus?(asLead) },
            action: open
        )
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

/// A catalogue shelf as a short programme: six to eight listings, each with its end time, once the runtime is known.
private struct PicksSection: View {
    let shelf: ShelfConfig
    let rows: Int
    let selectedID: String?
    var onFocus: ((HomeLead) -> Void)?
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
                    ProgrammeList {
                        ForEach(items.prefix(rows)) { item in
                            PickRow(item: item, selected: selectedID == item.id, onFocus: onFocus)
                        }
                    }
                }
                .transition(.opacity)
            } else if !loaded {
                ProgrammePlaceholder(title: shelf.title)
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
        // Unchanged contents leave the list alone, so a reload never re-renders it.
        if let loadedItems = try? await model.shelfItems(for: shelf), loadedItems != items { items = loadedItems }
        loaded = true
    }
}

private struct PickRow: View {
    let item: MediaItem
    var selected = false
    var onFocus: ((HomeLead) -> Void)?
    @Environment(AppModel.self) private var model
    /// Shelves list titles without runtimes, so each row asks for its own as it appears.
    @State private var runtime: Int?

    private var column: ProgrammeRow.Column {
        if let runtime { return .ends(minutes: runtime, resume: false) }
        return .label("–", sub: nil)
    }

    var body: some View {
        ProgrammeRow(
            column: column,
            art: .poster(item),
            title: item.title,
            meta: item.programmeMeta,
            version: model.lastVersionLine(for: item),
            selected: selected,
            onFocus: { onFocus?(HomeLead(item: item)) },
            action: { model.navigate(to: .detail(item)) }
        )
        .contextMenu { MediaContextMenu(item: item) }
        .task(id: item.id) { await loadRuntime() }
    }

    private func loadRuntime() async {
        if let known = item.runtimeMinutes, known > 0 { runtime = known; return }
        guard let catalog = model.catalog, let id = item.ids.tmdb else { return }
        if let detail = try? await catalog.details(item.type, id: id), let minutes = detail.item.runtimeMinutes, minutes > 0 {
            runtime = minutes
        }
    }
}

/// What is coming, with the air day in the time column ("Tue 12", "airs").
private struct UpcomingSection: View {
    let shelf: ShelfConfig
    let rows: Int
    let selectedID: String?
    var onFocus: ((HomeLead) -> Void)?
    @Environment(AppModel.self) private var model
    @State private var entries: [UpcomingEntry] = []

    var body: some View {
        Group {
            if !entries.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader(shelf.title, route: .shelf(shelf))
                    ProgrammeList {
                        ForEach(entries.prefix(rows)) { entry in
                            UpcomingRow(entry: entry, selected: selectedID == entry.item.id, onFocus: onFocus)
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

private struct UpcomingRow: View {
    let entry: UpcomingEntry
    var selected = false
    var onFocus: ((HomeLead) -> Void)?
    @Environment(AppModel.self) private var model

    private var meta: String {
        guard let episode = entry.episode else { return entry.item.programmeMeta }
        return "\(episode.code) · \(episode.title)"
    }

    var body: some View {
        let air = Programme.airColumn(for: entry.date)
        ProgrammeRow(
            column: .label(air.day, sub: air.label),
            art: .still(entry.item),
            title: entry.item.title,
            meta: meta,
            selected: selected,
            onFocus: { onFocus?(HomeLead(item: entry.item, episode: entry.episode?.ref)) },
            action: { model.navigate(to: .detail(entry.item)) }
        )
        .contextMenu { MediaContextMenu(item: entry.item) }
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

/// Bars where a section's listings will be while it loads.
private struct ProgrammePlaceholder: View {
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>(title).foregroundStyle(Theme.Palette.textTertiary)
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                ForEach(0..<4, id: \.self) { _ in
                    HStack(alignment: .top, spacing: Theme.Space.m) {
                        RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Theme.Palette.panel)
                            .frame(width: ProgrammeMetrics.timeColumn * 0.7, height: 18 * Theme.scale)
                            .frame(width: ProgrammeMetrics.timeColumn, alignment: .leading)
                        RoundedRectangle(cornerRadius: Theme.Radius.artwork, style: .continuous).fill(Theme.Palette.panel)
                            .frame(width: ProgrammeMetrics.poster.width, height: ProgrammeMetrics.poster.height)
                        VStack(alignment: .leading, spacing: 8 * Theme.scale) {
                            RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Theme.Palette.panel).frame(width: 160 * Theme.scale, height: 16 * Theme.scale)
                            RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Theme.Palette.panel).frame(width: 110 * Theme.scale, height: 12 * Theme.scale)
                        }
                    }
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .shimmering()
        }
        .accessibilityHidden(true)
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

    /// "2160p · Dolby Vision": what this title last played as, when Remember Last Source is on and it has played.
    func lastVersionLine(for item: MediaItem) -> String? {
        guard settings.sources.rememberLastSource, let key = item.key?.description,
              let line = settings.sources.lastSources[key]?.versionLine, !line.isEmpty else { return nil }
        return line
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
