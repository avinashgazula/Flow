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
            VStack(alignment: .leading, spacing: 14) {
                Picker("Type", selection: $type) {
                    Text("Movies").tag(MediaType.movie)
                    Text("TV Shows").tag(MediaType.show)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Platform.horizontalPadding)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Space.xs) {
                        #if os(tvOS)
                        ActionChip(title: "Filters", systemImage: "line.3.horizontal.decrease", active: isFiltered) { showFilters = true }
                        #endif
                        genreChip(nil, title: "All")
                        ForEach(Self.quickGenres(type), id: \.self) { id in
                            genreChip(id, title: TMDBGenres.name(for: id, type: type))
                        }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                }
                .scrollClipDisabled()

                // Styled like SectionHeader, with Reset trailing.
                HStack(alignment: .firstTextBaseline) {
                    Text(isFiltered ? "Filtered · \(query.sort.title)" : "Trending Now")
                        .font(Theme.Typeface.sectionTitle)
                        .displayTracking()
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: Theme.Space.s)
                    if isFiltered {
                        Button("Reset") { query = DiscoverQuery(type: type) }
                            .font(.subheadline)
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)

                if model.catalog == nil {
                    MissingKeyView()
                } else if let error, items.isEmpty {
                    ContentUnavailableView("Couldn't Load", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    PosterGrid(items: items) { Task { await loadMore() } }
                    if loading { ProgressView().frame(maxWidth: .infinity).padding() }
                }
            }
            .padding(.vertical)
        }
        .tabRootTitle("Explore")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showFilters = true } label: {
                    Image(systemName: isFiltered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel(isFiltered ? "Filters, On" : "Filters")
                // Yellow says "on" in the chips, so the button itself stays paper.
                .tint(Theme.Palette.text)
            }
        }
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
        return Button {
            withAnimation(Theme.Motion.snappy) {
                if let id { query.genres = [id] } else { query.genres = [] }
            }
        } label: {
            Text(title)
                .font(.system(.subheadline, weight: .semibold))
                .padding(.horizontal, Theme.Space.m).padding(.vertical, Theme.Space.xs + 1)
                .frame(minHeight: 44 * Theme.scale)
                .foregroundStyle(selected ? Theme.Palette.onStock : Theme.Palette.text)
                .background(selected ? Theme.Palette.stock : Theme.Palette.control, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(CardButtonStyle())
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
            Form {
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
                                    RemoteImage(url: TMDBImage.url(provider.logoPath, size: .posterSmall)).frame(width: 28, height: 28).clipShape(RoundedRectangle(cornerRadius: 6))
                                    Text(provider.providerName).foregroundStyle(.primary)
                                    Spacer()
                                    if query.watchProviders.contains(provider.id) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(title)
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
