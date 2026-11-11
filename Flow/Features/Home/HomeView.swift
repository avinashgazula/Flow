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
    var minutes: Int? { Reel.minutesLeft(progress: progress, runtimeMinutes: item.runtimeMinutes) }
}

/// Home, as the website's lead: the day in a red label with the date in mono, the title of what to watch in giant Archivo
/// capitals, one italic line of facts, a solid Resume (or Play) and a bordered Details, and the backdrop in its 2px frame
/// with a thin red bar for how far you are. A numbered pager (`01 / 10`) turns through what's in progress and the top
/// picks. Then Up Next and the shelves, each a ruled section under a red label. Wide screens and Apple TV put the words
/// beside the backdrop.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    /// What the lead turns through: what is in progress first, then the top picks, ten at most.
    @State private var leads: [HomeLead] = []
    @State private var leadIndex = 0
    /// The greeting follows the hour, so it is refreshed each minute.
    @State private var now = Date()

    private var general: GeneralSettings { model.settings.general }
    private var dayPart: Reel.DayPart { Reel.DayPart(date: now) }
    private var lead: HomeLead? { leads.indices.contains(leadIndex) ? leads[leadIndex] : nil }

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

    /// Continue Watching and Next Up are one section on Home, "Up Next", under the lead; the other shelves are rows below.
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
                        page(wide: Self.splits(width: proxy.size.width), width: proxy.size.width)
                    }
                    .scrollIndicators(.hidden)
                    .refreshable { await model.refreshLibrary(force: true) }
                }
            }
        }
        .background(Theme.Palette.ground.ignoresSafeArea())
        .task(id: leadKey) { await loadLeads() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                now = Date()
            }
        }
        // The page names itself in its own red label, so the bar carries no title.
        #if os(iOS)
        .navigationTitle("")
        .inlineNavigationTitle()
        #elseif os(macOS)
        .navigationTitle("Home")
        #endif
        #if os(iOS)
        .toolbar { SettingsToolbarItem { model.showSettings = true } }
        .flowMinimizingToolbar()
        #elseif os(macOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                SettingsLink { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
                    .tint(Theme.Palette.text)
            }
        }
        #elseif os(tvOS)
        .toolbar {
            // tvOS 17 has no Settings tab.
            if !model.settingsInTab {
                ToolbarItem(placement: .automatic) {
                    Button { model.showSettings = true } label: { Image(systemName: "gearshape.fill") }
                        .accessibilityLabel("Settings")
                        .tint(Theme.Palette.text)
                }
            }
        }
        #endif
    }

    // MARK: Layout

    /// The words beside the backdrop once there is room; always on Apple TV.
    private static func splits(width: CGFloat) -> Bool {
        #if os(tvOS)
        return true
        #elseif os(macOS)
        // A Mac window is wide even when it is not big: the words and the backdrop share it from here.
        return width >= 760
        #else
        return width >= 900
        #endif
    }

    /// Apple TV scrolls under the tab bar, so the page starts below it.
    private var topInset: CGFloat {
        #if os(tvOS)
        // The safe area already clears the tab bar; the first screen has to hold the lead and its buttons.
        return 0
        #else
        return Theme.Space.xxs
        #endif
    }

    /// The backdrop takes a little over half of a wide page, so its title and buttons stand beside it at about its height.
    private func backdropWidth(in width: CGFloat) -> CGFloat {
        max(320, (width - Theme.Space.gutter * 2 - Theme.Space.xl) * 0.56)
    }

    private func page(wide: Bool, width: CGFloat) -> some View {
        LazyVStack(alignment: .leading, spacing: Theme.Space.section) {
            Group {
                if let lead {
                    LeadBlock(lead: lead, index: leadIndex, count: leads.count, wide: wide, backdropWidth: backdropWidth(in: width),
                              dayTitle: dayPart.title, dateLine: Reel.dateLine(now), step: step)
                        // Each title is its own block, so what was fetched for one never shows on the next.
                        .id(lead.id)
                        .transition(.opacity)
                } else {
                    LeadHeader(dayTitle: dayPart.title, dateLine: Reel.dateLine(now))
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.top, topInset)
            if showsUpNext {
                UpNextSection(leadEntryID: leads.first?.entryID)
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

    /// The pager's arrows go round: past the last pick is the first.
    private func step(_ delta: Int) {
        guard leads.count > 1 else { return }
        withAnimation(Theme.Motion.enter) { leadIndex = (leadIndex + delta + leads.count) % leads.count }
    }

    // MARK: Loading

    private func loadLeads() async {
        var out: [HomeLead] = []
        if general.showContinueWatching, let entry = model.continueWatching.first, let item = await model.hydrate([entry.key]).first {
            out.append(HomeLead(item: item, episode: entry.episode, progress: entry.progress, kind: entry.isNextUp ? .nextUp : .resume, entryID: entry.id))
        }
        for pick in await model.heroItems() where out.count < 10 && !out.contains(where: { $0.item.id == pick.id }) {
            out.append(HomeLead(item: pick))
        }
        guard out != leads else { return }
        leads = out
        leadIndex = min(leadIndex, max(0, out.count - 1))
    }
}

// MARK: - The lead

/// The day as a red mono label, with the date beside it in muted mono.
private struct LeadHeader: View {
    let dayTitle: String
    let dateLine: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
            SectionLabel(dayTitle)
            Text(dateLine)
                .font(Theme.Typeface.caption)
                .textCase(.uppercase)
                .tracking(0.06 * 12 * Theme.scale)
                .foregroundStyle(Theme.Palette.muted)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Which title of the turn you are on: `01 / 10` in red condensed figures between two square arrows. On Apple TV the
/// arrows take focus, so the remote can turn through the picks.
private struct LeadPager: View {
    let index: Int
    let count: Int
    let step: (Int) -> Void

    var body: some View {
        HStack(spacing: -Theme.Rule.heavy) {
            Button { step(-1) } label: { Image(systemName: "chevron.left") }
                .buttonStyle(GlassButtonStyle(circle: true, compact: true))
                .accessibilityLabel("Previous Title")
            Text(String(format: "%02d / %02d", index + 1, count))
                .font(.custom(Theme.Face.condensed, size: 22 * Theme.scale).monospacedDigit())
                .foregroundStyle(Theme.Palette.red)
                .padding(.horizontal, Theme.Space.m)
                .frame(minHeight: 44 * Theme.scale)
                .background(Theme.Palette.bg)
                .ruleFrame()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Title \(index + 1) of \(count)")
            Button { step(1) } label: { Image(systemName: "chevron.right") }
                .buttonStyle(GlassButtonStyle(circle: true, compact: true))
                .accessibilityLabel("Next Title")
        }
    }
}

/// The one dominant item: the day label, its title in giant capitals, a line of facts, Resume (or Play) and Details, and
/// its backdrop framed with the time left, when it would end and the format printed under it. The words stand beside the
/// backdrop when `wide`, above it otherwise.
struct LeadBlock: View {
    let lead: HomeLead
    let index: Int
    let count: Int
    let wide: Bool
    let backdropWidth: CGFloat
    let dayTitle: String
    let dateLine: String
    let step: (Int) -> Void
    @Environment(AppModel.self) private var model
    /// A runtime fetched when the lead has none, which is the case for most picks.
    @State private var fetchedMinutes: Int?
    #if os(tvOS)
    /// Focus starts on Resume, so one press of Select carries on watching.
    @FocusState private var resumeFocused: Bool
    #endif

    private var item: MediaItem { lead.item }
    private var minutes: Int? { lead.minutes ?? fetchedMinutes }

    /// The facts printed under the backdrop.
    private var strip: EdgePrint {
        let format = model.lastEdgeFormat(for: item)
        switch lead.kind {
        case .resume:
            return EdgePrint(progress: Reel.watchedFraction(lead.progress), lead: episodeLead, key: minutes.map { Reel.compactLeft(minutes: $0) },
                             endsInMinutes: minutes, tail: format)
        case .nextUp:
            return EdgePrint(progress: 0, lead: episodeLead, key: "Up next", endsInMinutes: minutes, tail: format)
        case .pick:
            return EdgePrint(lead: [item.year.map { String($0) } ?? "", minutes.map { Reel.compactDuration(minutes: $0) } ?? ""], endsInMinutes: minutes, tail: format)
        }
    }

    private var episodeLead: [String] {
        guard let episode = lead.episode else { return item.year.map { [String($0)] } ?? [] }
        return ["S\(episode.season) E\(episode.episode)"]
    }

    /// The italic line under the title: the episode (or the year) and the genres.
    private var facts: String {
        var parts: [String] = []
        if let episode = lead.episode {
            parts.append("Season \(episode.season), Episode \(episode.episode)")
        } else if let year = item.year {
            parts.append(String(year))
        }
        let genres = item.genres.prefix(2).map(\.name).joined(separator: ", ")
        if !genres.isEmpty { parts.append(genres) }
        return parts.joined(separator: " · ")
    }

    private var spoken: String {
        Reel.spokenListing(title: item.title, episode: lead.episode, minutesLeft: lead.kind == .resume ? minutes : nil,
                                endsAt: minutes.map { Reel.endDate(from: Date(), minutesLeft: $0) }, extra: model.lastEdgeFormat(for: item))
    }

    /// Phones 52, iPad 72, Mac 64, Apple TV 91 (48 scaled): about three-quarters of a page title, so a long name still
    /// sits in two or three lines beside its backdrop.
    private var titleSize: CGFloat {
        let base: CGFloat = wide ? (Platform.isPad ? 72 : Platform.isMac ? 64 : 48) : 52
        return base * Theme.scale
    }

    var body: some View {
        Group {
            if wide {
                HStack(alignment: .top, spacing: Theme.Space.xl) {
                    VStack(alignment: .leading, spacing: Theme.Space.m) {
                        words
                        actions
                        if count > 1 { LeadPager(index: index, count: count, step: step) }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    backdrop.frame(width: backdropWidth)
                }
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    words
                    actions
                    backdrop
                    if count > 1 { LeadPager(index: index, count: count, step: step) }
                }
            }
        }
        #if os(tvOS)
        .defaultFocus($resumeFocused, true)
        #endif
        .task(id: item.id) { await fetchMinutes() }
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            LeadHeader(dayTitle: dayTitle, dateLine: dateLine)
            Text(item.title)
                .font(.custom(Theme.Face.archivo, size: titleSize, relativeTo: .largeTitle))
                .textCase(.uppercase)
                .tracking(-0.03 * titleSize)
                // The website sets it at 0.84 line height; a negative spacing pulls wrapped lines together.
                .lineSpacing(-0.14 * titleSize)
                .foregroundStyle(Theme.Palette.fg)
                .lineLimit(3)
                .minimumScaleFactor(0.5)
                .accessibilityAddTraits(.isHeader)
            if !facts.isEmpty {
                Text(facts)
                    .font(Theme.Typeface.readingItalic)
                    .foregroundStyle(Theme.Palette.fg)
                    .lineLimit(2)
            }
        }
    }

    private var primaryMinWidth: CGFloat? {
        if Platform.isTV { return 240 * Theme.scale }
        return wide ? 140 : nil
    }

    private var actions: some View {
        HStack(spacing: Theme.Space.s) {
            // The width goes on the label, so the button's own fill stretches with it.
            Button { Task { await model.play(item) } } label: {
                Label(lead.kind == .resume ? "Resume" : "Play", systemImage: "play.fill")
                    .frame(maxWidth: wide || Platform.isTV ? nil : .infinity)
                    .frame(minWidth: primaryMinWidth)
            }
            .buttonStyle(PrimaryButtonStyle())
            #if os(tvOS)
            .focused($resumeFocused)
            #endif
            Button { model.navigate(to: .detail(item)) } label: { Text("Details") }
                .buttonStyle(GlassButtonStyle())
        }
    }

    private var backdrop: some View {
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
    }

    private func fetchMinutes() async {
        guard lead.minutes == nil, let catalog = model.catalog, let id = item.ids.tmdb else { return }
        if let detail = try? await catalog.details(item.type, id: id), let runtime = detail.item.runtimeMinutes, runtime > 0 {
            fetchedMinutes = runtime
        }
    }
}

// MARK: - Up Next

/// What is in progress, and the next episodes, as framed stills with the time left under each and a red bar along the
/// foot of those you have started.
private struct UpNextSection: View {
    let leadEntryID: String?
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
                FilmScroller(ids: entries.map(\.id), itemWidth: Platform.landscapeWidth) {
                    ForEach(entries) { entry in
                        if let item = items[entry.key] { UpNextCell(entry: entry, item: item, width: Platform.landscapeWidth) }
                    }
                }
                .flowSwipeActionsContainer()
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

/// A Continue Watching or Up Next item as a framed still: a red bar for how far in, the facts line for the rest.
struct UpNextCell: View {
    let entry: ContinueWatchingBuilder.Entry
    let item: MediaItem
    let width: CGFloat?
    @Environment(AppModel.self) private var model
    /// iOS 27 asks before a removal; earlier systems remove straight away.
    @State private var removing: ContinueWatchingBuilder.Entry?

    private var minutes: Int? { Reel.minutesLeft(progress: entry.progress, runtimeMinutes: item.runtimeMinutes) }

    private func requestRemoval() {
        if ItemDialogs.available { removing = entry } else { Task { await model.removeFromContinueWatching(entry) } }
    }

    private var strip: EdgePrint {
        let lead = entry.episode.map { ["S\($0.season) E\($0.episode)"] } ?? []
        let format = model.lastEdgeFormat(for: item)
        if entry.isNextUp {
            return EdgePrint(progress: 0, lead: lead, key: "Up next", endsInMinutes: minutes, tail: format)
        }
        return EdgePrint(progress: Reel.watchedFraction(entry.progress), lead: lead, key: minutes.map { Reel.compactLeft(minutes: $0) },
                         endsInMinutes: minutes, tail: format)
    }

    private var spoken: String {
        Reel.spokenListing(title: item.title, episode: entry.episode, minutesLeft: entry.isNextUp ? nil : minutes,
                                endsAt: minutes.map { Reel.endDate(from: Date(), minutesLeft: $0) },
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
            Button(role: .destructive) { requestRemoval() } label: { Label("Remove from Continue Watching", systemImage: "xmark.circle") }
        }
        .flowConfirmationDialog("Remove from Continue Watching?", item: $removing) { entry in
            Button("Remove", role: .destructive) { Task { await model.removeFromContinueWatching(entry) } }
        }
        // iOS 27: swipe the card for the same two quick actions.
        .flowSwipeActions {
            Button { Task { await model.setWatched(item, episodes: entry.episode.map { [$0] }, watched: true) } } label: {
                Label("Watched", systemImage: "checkmark.circle")
            }
            .tint(Theme.Palette.stock)
            Button(role: .destructive) { requestRemoval() } label: { Label("Remove", systemImage: "xmark.circle") }
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

/// One shelf as a ruled section on the page: a red label over posters at one fixed size, each with its facts line.
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

/// A catalogue shelf: posters, each with the runtime and rating under it in mono (and no bar: nothing is in progress).
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
                    PosterRow(items: items, context: shelf.id)
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

/// What is coming: stills with the air day in red in the facts line.
struct UpcomingRow: View {
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
        let air = Reel.airColumn(for: entry.date)
        return EdgePrint(lead: entry.episode.map { [$0.code] } ?? ["Film"], key: "\(air.label) \(air.day)")
    }

    var body: some View {
        let air = Reel.airColumn(for: entry.date)
        NavigationLink(value: Route.detail(entry.item, zoom: zoomID)) {
            FilmCard(art: .still(entry.item), strip: strip, title: entry.item.title, meta: entry.episode?.title ?? entry.item.shortMeta,
                     width: Platform.landscapeWidth,
                     spoken: Reel.spokenListing(title: entry.item.title, episode: entry.episode?.ref, extra: ["\(air.label) \(air.day)"]),
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
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170 * Theme.scale), spacing: Theme.Space.m, alignment: .top)],
                      alignment: .leading, spacing: 0) {
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
        LazyVStack(alignment: .leading, spacing: 0) { content }
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
                SegmentedTabs(options: [(value: MediaType.movie, title: "Movies"), (value: MediaType.show, title: "TV Shows")],
                              selection: Binding(get: { type ?? query.type }, set: { type = $0 }))
                .frame(maxWidth: 360 * Theme.scale)
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Theme.Space.xs)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            ShelfGridContent(shelf: typed).id(type)
        }
        .flowPageTitle(shelf.title, inset: Theme.Space.gutter)
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
