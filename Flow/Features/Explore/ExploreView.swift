import SwiftUI
import FlowKit

/// Movies / TV Shows browser: trending by default, TMDb Discover when filters are set.
struct ExploreView: View {
    @Environment(AppModel.self) private var model
    @State private var type: MediaType = .movie
    @State private var query = DiscoverQuery(type: .movie)
    @State private var items: [MediaItem] = []
    @State private var page = 0
    @State private var hasMore = true
    @State private var loading = false
    /// Bumped by every reload, so a page still in flight for the previous filters is dropped when it lands.
    @State private var generation = 0
    @State private var error: String?
    @State private var showFilters = false

    private var isFiltered: Bool { !query.isDefault }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                BrowseHead("Explore", note: type == .movie ? "Films" : "Series")

                BrowseToolbar {
                    HStack(spacing: Theme.Space.s) {
                        SegmentedTabs(options: [(value: MediaType.movie, title: "Movies"), (value: MediaType.show, title: "TV Shows")],
                                      selection: $type)
                        Spacer(minLength: 0)
                        Button(isFiltered ? "Filters · On" : "Filters") { showFilters = true }
                            .buttonStyle(FilterChipStyle(current: isFiltered))
                    }
                }

                ChipRow {
                    genreChip(nil, title: "All")
                    ForEach(Self.quickGenres(type), id: \.self) { id in
                        genreChip(id, title: TMDBGenres.name(for: id, type: type))
                    }
                }

                SectionHead(isFiltered ? "Filtered · \(query.sort.title)" : "Trending Now") {
                    if isFiltered {
                        Button("Reset") { query = DiscoverQuery(type: type) }
                            .buttonStyle(QuietButtonStyle())
                    }
                }

                if model.catalog == nil {
                    MissingKeyView()
                } else if let error, items.isEmpty {
                    ContentUnavailableView("Couldn't Load", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    PosterGrid(items: items) { Task { await loadMore() } }
                    if loading { ProgressView().frame(maxWidth: .infinity).padding() }
                }
            }
            .padding(.bottom, Theme.Space.l)
        }
        .browsePage("Explore", root: true)
        .sheet(isPresented: $showFilters) {
            DiscoverFilterView(query: $query)
                .environment(model)
        }
        .onChange(of: type) { _, newType in query = DiscoverQuery(type: newType) }
        .task(id: "\(query.hashValue)-\(filtersFollowLibrary ? model.contentVersion : 0)") { await reload() }
    }

    /// Only filtering to your servers' titles depends on the library; otherwise a watch-state change
    /// mustn't send the grid back to the top.
    private var filtersFollowLibrary: Bool {
        model.settings.mediaServers.onlyShowServerContent && !model.settings.mediaServers.servers.isEmpty
    }

    static func quickGenres(_ type: MediaType) -> [Int] {
        type == .movie ? [28, 35, 18, 878, 27, 53, 16, 10749, 99, 14, 80, 12] : [18, 35, 80, 10765, 10759, 16, 9648, 99, 10764, 10751]
    }

    private func genreChip(_ id: Int?, title: String) -> some View {
        let selected = id.map { query.genres == [$0] } ?? query.genres.isEmpty
        return Button(title) {
            withAnimation(Theme.Motion.state) {
                if let id { query.genres = [id] } else { query.genres = [] }
            }
        }
        .buttonStyle(FilterChipStyle(current: selected))
    }

    private func reload() async {
        generation += 1
        items = []
        page = 0
        hasMore = true
        error = nil
        // A page still loading for the old filters is abandoned, not waited for.
        loading = false
        let started = generation
        await loadMore()
        // Filters can leave a page empty, and an empty grid never reaches its end to ask for the next one.
        var extra = 0
        while items.isEmpty, hasMore, error == nil, extra < 4, started == generation {
            extra += 1
            await loadMore()
        }
    }

    private func loadMore() async {
        guard hasMore, !loading, let catalog = model.catalog else { return }
        let started = generation
        loading = true
        defer { if started == generation { loading = false } }
        do {
            let next = isFiltered ? try await catalog.discover(query, page: page + 1) : try await catalog.trending(type, page: page + 1)
            let filtered = await catalog.apply(model.catalogFilters, to: next.items, exemptFromRelease: query.targetsFuture)
            guard started == generation else { return }
            var seen = Set(items.map(\.id))
            items += filtered.filter { seen.insert($0.id).inserted }
            page = next.page
            hasMore = next.hasMore && page < 50
        } catch {
            guard started == generation else { return }
            self.error = error.localizedDescription
            hasMore = false
        }
    }
}

// MARK: - Browse pieces
//
// What Explore, Search, Library, Upcoming, Sports, Stats, Downloads and Live TV share: the website's page head,
// ruled toolbar, red section label and ruled rows, so every browse page is the same sheet of paper.

/// A browse page's head: the giant title, its rule and a mono note.
struct BrowseHead: View {
    let title: String
    var note: String?

    init(_ title: String, note: String? = nil) {
        self.title = title
        self.note = note
    }

    var body: some View {
        PageTitle(title, note: note)
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.top, Theme.Space.m)
    }
}

extension View {
    /// A browse page draws its own head (`BrowseHead`), so the system's title goes. A tab's root page also loses
    /// the bar (its actions sit in the page's toolbar); a pushed page keeps it for Back, with a blank title.
    /// The Mac keeps the window title, which is not a second heading.
    @ViewBuilder
    func browsePage(_ title: String, root: Bool = false) -> some View {
        #if os(tvOS)
        toolbar(.hidden, for: .navigationBar)
        #elseif os(iOS)
        if root {
            navigationTitle(title).toolbar(.hidden, for: .navigationBar)
        } else {
            navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) } }
        }
        #else
        navigationTitle(title)
        #endif
    }
}

/// The row of controls under a page head: a 2px rule closes it, as on the website.
struct BrowseToolbar<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            content
            RuleLine()
        }
        .padding(.horizontal, Theme.Space.gutter)
    }
}

/// A sideways row of filter chips. It scrolls clear of the page's edge, and room above and below is left for the
/// tvOS lift.
struct ChipRow<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.xs) { content }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Platform.isTV ? Theme.Space.xs : 0)
        }
        .scrollClipDisabled()
    }
}

/// A section's opening: a 2px rule, then its name in red mono, an optional note and an action at the end.
struct SectionHead<Trailing: View>: View {
    let title: String
    var note: String?
    let trailing: Trailing

    init(_ title: String, note: String? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.note = note
        self.trailing = trailing()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            RuleLine()
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                SectionLabel(title)
                if let note {
                    Text(note).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.muted)
                }
                Spacer(minLength: Theme.Space.s)
                trailing
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
        .accessibilityElement(children: .contain)
    }
}

extension SectionHead where Trailing == EmptyView {
    init(_ title: String, note: String? = nil) {
        self.init(title, note: note) { EmptyView() }
    }
}

private struct RowLitKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// The row around this content is lit (blue under the pointer, while pressed, or focused), so its marks switch to
    /// on-blue ink. `BrowseRowStyle` and `ProgrammeRowButtonStyle` both set it.
    var rowLit: Bool {
        get { self[RowLitKey.self] }
        set { self[RowLitKey.self] = newValue }
    }
}

/// A ruled list row: a 1px line under it, and the whole row turns blue while hovered, focused or pressed. Marks
/// inside that are not ink (red numerals, muted facts) take `.rowInk(_:)` so they read on the blue.
struct BrowseRowStyle: ButtonStyle {
    /// False when the caller draws the line itself, under a row that holds more than this one button.
    var ruled = true

    func makeBody(configuration: Configuration) -> some View {
        BrowseRowBody(configuration: configuration, ruled: ruled)
    }
}

private struct BrowseRowBody: View {
    let configuration: ButtonStyleConfiguration
    let ruled: Bool
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering || configuration.isPressed
        configuration.label
            .environment(\.rowLit, lit)
            .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.fg)
            .padding(.vertical, Theme.Space.s)
            .padding(.horizontal, Theme.Space.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(lit ? Theme.Palette.blue : Color.clear)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) {
                if ruled { Rectangle().fill(Theme.Palette.rule).frame(height: Theme.Rule.thin) }
            }
            .animation(Theme.Motion.hover, value: lit)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

private struct RowInk: ViewModifier {
    let normal: Color
    @Environment(\.rowLit) private var lit

    func body(content: Content) -> some View {
        content.foregroundStyle(lit ? Theme.Palette.onBlue : normal)
    }
}

extension View {
    /// This colour on paper, on-blue ink when the row it sits in is lit.
    func rowInk(_ normal: Color) -> some View { modifier(RowInk(normal: normal)) }

    /// A static ruled row (not a button): the same padding and 1px line.
    func ruledRowFrame() -> some View {
        padding(.vertical, Theme.Space.s)
            .padding(.horizontal, Theme.Space.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .ruledRow()
    }
}

/// The red condensed numeral that opens an index row: 01, 02, ...
struct IndexNumeral: View {
    let number: Int

    var body: some View {
        Text(String(format: "%02d", number))
            .font(Theme.Typeface.figure)
            .rowInk(Theme.Palette.red)
            .frame(width: 40 * Theme.scale, alignment: .leading)
            .accessibilityHidden(true)
    }
}

/// A small framed picture inside a row: square, ruled, nothing round.
struct RowThumb: View {
    let url: URL?
    var fallbackURL: URL?
    var title: String?
    var width: CGFloat
    var height: CGFloat

    var body: some View {
        RemoteImage(url: url, maxPixel: 480, fallbackTitle: title, fallbackURL: fallbackURL)
            .frame(width: width, height: height)
            .clipped()
            .overlay(Rectangle().strokeBorder(Theme.Palette.rule, lineWidth: Theme.Rule.thin))
            .accessibilityHidden(true)
    }
}

/// The arrow at a row's end.
struct RowChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13 * Theme.scale, weight: .bold))
            .rowInk(Theme.Palette.fg)
            .accessibilityHidden(true)
    }
}

/// A thin red bar for how far through something is; the track is a quiet tint.
struct RedBar: View {
    let value: Double
    var height: CGFloat = 3 * Theme.scale

    var body: some View {
        Rectangle().fill(Theme.Palette.tint3)
            .frame(height: height)
            .overlay(alignment: .leading) {
                GeometryReader { proxy in
                    Rectangle().fill(Theme.Palette.red).frame(width: proxy.size.width * min(1, max(0, value)))
                }
            }
            .accessibilityHidden(true)
    }
}

/// A short line saying nothing is here, in the page's own voice, with an optional action.
struct BrowseEmpty<Actions: View>: View {
    let title: String
    let message: String
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            Text(title).font(Theme.Typeface.heading).textCase(.uppercase)
            Text(message).font(Theme.Typeface.reading).foregroundStyle(Theme.Palette.muted)
            actions
        }
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.vertical, Theme.Space.l)
        .frame(maxWidth: 640, alignment: .leading)
    }
}

extension BrowseEmpty where Actions == EmptyView {
    init(title: String, message: String) {
        self.init(title: title, message: message) { EmptyView() }
    }
}

/// Editor for a DiscoverQuery, reused by Explore filters and custom Discover shelves.
struct DiscoverFilterView: View {
    @Binding var query: DiscoverQuery
    var title = "Filters"
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var providers: [WatchProvider] = []

    private let currentYear = Calendar.current.component(.year, from: Date())

    var body: some View {
        NavigationStack {
            FilmForm {
                #if os(tvOS)
                // The toolbar's Reset doesn't read on tvOS (white on Flow's white accent), so it lives in the form.
                Section {
                    Button("Reset Filters") { query = DiscoverQuery(type: query.type) }
                }
                #endif
                Section("Sort By") {
                    Picker("Sort", selection: $query.sort) {
                        ForEach(DiscoverSort.allCases) { Text($0.title).tag($0) }
                    }
                }
                Section("Genres") {
                    ForEach(TMDBGenres.all(query.type)) { genre in
                        Button {
                            if let i = query.genres.firstIndex(of: genre.id) { query.genres.remove(at: i) } else { query.genres.append(genre.id) }
                        } label: {
                            HStack {
                                Text(genre.name).foregroundStyle(.primary)
                                Spacer()
                                if query.genres.contains(genre.id) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                        }
                    }
                }
                Section("Release") {
                    Picker("From", selection: optionalYear(\.yearFrom)) {
                        Text("Any").tag(0)
                        ForEach((1920...(currentYear + 2)).reversed(), id: \.self) { Text(String($0)).tag($0) }
                    }
                    Picker("To", selection: optionalYear(\.yearTo)) {
                        Text("Any").tag(0)
                        ForEach((1920...(currentYear + 2)).reversed(), id: \.self) { Text(String($0)).tag($0) }
                    }
                    Picker("Window", selection: windowBinding) {
                        Text("Any Time").tag(0)
                        Text("Last 30 Days").tag(1)
                        Text("Last 90 Days").tag(2)
                        Text("Next 30 Days").tag(3)
                        Text("Next 6 Months").tag(4)
                    }
                }
                Section("Rating") {
                    Picker("Minimum Rating", selection: Binding(get: { Int(query.minRating ?? 0) }, set: { query.minRating = $0 == 0 ? nil : Double($0) })) {
                        Text("Any").tag(0)
                        ForEach(5...9, id: \.self) { Text("\($0)+").tag($0) }
                    }
                }
                Section("Language") {
                    Picker("Original Language", selection: Binding(get: { query.originalLanguage ?? "" }, set: { query.originalLanguage = $0.isEmpty ? nil : $0 })) {
                        Text("Any").tag("")
                        ForEach(Self.languages, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }
                if !providers.isEmpty {
                    Section("Streaming On (\(model.settings.metadata.region))") {
                        ForEach(providers.prefix(25)) { provider in
                            Button {
                                if let i = query.watchProviders.firstIndex(of: provider.id) { query.watchProviders.remove(at: i) } else { query.watchProviders.append(provider.id) }
                            } label: {
                                HStack {
                                    RemoteImage(url: TMDBImage.url(provider.logoPath, size: .posterSmall)).frame(width: 28, height: 28).clipped()
                                    Text(provider.providerName).foregroundStyle(.primary)
                                    Spacer()
                                    if query.watchProviders.contains(provider.id) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                        }
                    }
                }
            }
            .flowPageTitle(title)
            .inlineNavigationTitle()
            #if !os(tvOS)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Reset") { query = DiscoverQuery(type: query.type) } }
            }
            #endif
            .sheetDoneButton { dismiss() }
            .task { providers = (try? await model.catalog?.tmdb.watchProviders(query.type)) ?? [] }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 600)
        #endif
    }

    private func optionalYear(_ keyPath: WritableKeyPath<DiscoverQuery, Int?>) -> Binding<Int> {
        Binding(get: { query[keyPath: keyPath] ?? 0 }, set: { query[keyPath: keyPath] = $0 == 0 ? nil : $0 })
    }

    private var windowBinding: Binding<Int> {
        Binding(get: {
            switch (query.releasedFromDays, query.releasedToDays) {
            case (.some(-30), .some(0)): return 1
            case (.some(-90), .some(0)): return 2
            case (.some(0), .some(30)): return 3
            case (.some(0), .some(180)): return 4
            default: return 0
            }
        }, set: { value in
            let windows: [Int: (Int?, Int?)] = [0: (nil, nil), 1: (-30, 0), 2: (-90, 0), 3: (0, 30), 4: (0, 180)]
            let w = windows[value] ?? (nil, nil)
            query.releasedFromDays = w.0
            query.releasedToDays = w.1
        })
    }

    static let languages: [(String, String)] = [
        ("en", "English"), ("es", "Spanish"), ("fr", "French"), ("de", "German"), ("it", "Italian"), ("ja", "Japanese"),
        ("ko", "Korean"), ("zh", "Chinese"), ("hi", "Hindi"), ("ta", "Tamil"), ("te", "Telugu"), ("ml", "Malayalam"),
        ("pt", "Portuguese"), ("ru", "Russian"), ("tr", "Turkish"), ("sv", "Swedish"), ("da", "Danish"), ("no", "Norwegian"),
    ]
}
