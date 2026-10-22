import SwiftUI
import FlowKit

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var results: [SearchResult] = []
    @State private var searching = false
    @State private var error: String?
    @State private var recents: [String] = []

    /// The rows leave out the top result, which the card above already shows.
    private var movies: [MediaItem] { media(.movie) }
    private var shows: [MediaItem] { media(.show) }

    private func media(_ type: MediaType) -> [MediaItem] {
        let top = topResult?.id
        return results.compactMap { if case .media(let m) = $0, m.type == type, m.id != top { return m }; return nil }
    }
    private var people: [Person] { results.compactMap { if case .person(let p) = $0 { return p }; return nil } }

    private var text: String { model.searchText }

    /// The first title when it's a confident match: its name starts with what was typed.
    private var topResult: MediaItem? {
        let query = text.trimmingCharacters(in: .whitespaces).lowercased()
        let first = results.lazy.compactMap { if case .media(let m) = $0 { return m }; return nil }.first
        guard let first, query.count >= 3, first.posterPath != nil,
              first.title.lowercased().hasPrefix(query) || first.title.lowercased().contains(" \(query)") else { return nil }
        return first
    }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if text.trimmingCharacters(in: .whitespaces).count < 2 {
                    idleContent
                } else if searching && results.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                } else if let error {
                    ContentUnavailableView("Search Failed", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if results.isEmpty {
                    ContentUnavailableView.search(text: text)
                } else {
                    if let top = topResult {
                        TopResultCard(item: top).padding(.horizontal, Theme.Space.gutter)
                    }
                    if !movies.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader<Route>("Movies")
                            PosterRow(items: movies)
                        }
                    }
                    if !shows.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader<Route>("TV Shows")
                            PosterRow(items: shows)
                        }
                    }
                    if !people.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader<Route>("People")
                            ScrollView(.horizontal, showsIndicators: false) {
                                LazyHStack(spacing: 16) {
                                    ForEach(people) { p in
                                        PersonCard(id: p.id, name: p.name, role: p.knownFor ?? "", profilePath: p.profilePath)
                                    }
                                }
                                .padding(.horizontal, Platform.horizontalPadding)
                            }
                        }
                    }
                }
            }
            .padding(.vertical)
        }
        .navigationTitle("Search")
        .searchable(text: $model.searchText, prompt: "Movies, shows, and people")
        .onSubmit(of: .search) { model.rememberSearch(text); recents = model.recentSearches }
        .task(id: text) { await runSearch() }
        .onAppear { recents = model.recentSearches }
    }

    @ViewBuilder
    private var idleContent: some View {
        if !recents.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Recent").font(Theme.Typeface.sectionTitle).displayTracking()
                    Spacer()
                    Button("Clear") { withAnimation(Theme.Motion.fade) { model.recentSearches = []; recents = [] } }
                        .font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary)
                        .buttonStyle(.plain)
                }
                .padding(.horizontal, Platform.horizontalPadding)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(recents, id: \.self) { term in
                            Button { model.searchText = term } label: {
                                Label(term, systemImage: "clock.arrow.circlepath")
                                    .font(.system(.subheadline, weight: .medium))
                                    .padding(.horizontal, 14).padding(.vertical, 9)
                                    .background(Theme.Palette.surface, in: Capsule())
                                    .overlay(Capsule().strokeBorder(Theme.Palette.hairline))
                            }
                            .buttonStyle(CardButtonStyle())
                            .contextMenu {
                                Button(role: .destructive) { forget(term) } label: { Label("Remove", systemImage: "trash") }
                            }
                        }
                    }
                    .padding(.horizontal, Platform.horizontalPadding)
                }
            }
        }
        if model.catalog != nil {
            BrowseGrid()
            ShelfView(shelf: .builtIn(.trendingMovies))
            ShelfView(shelf: .builtIn(.trendingShows))
        } else {
            MissingKeyView()
        }
    }

    private func forget(_ term: String) {
        withAnimation(Theme.Motion.fade) {
            model.recentSearches.removeAll { $0 == term }
            recents = model.recentSearches
        }
    }

    private func runSearch() async {
        let query = text.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else { results = []; return }
        // Debounce typing.
        try? await Task.sleep(nanoseconds: 350_000_000)
        guard !Task.isCancelled else { return }
        searching = true
        // A superseded search must not switch off the spinner of the one that replaced it.
        defer { if !Task.isCancelled { searching = false } }
        error = nil
        do {
            let found = try await model.search(query)
            guard !Task.isCancelled else { return }
            results = found
            error = nil
            model.rememberSearch(query)
        } catch is CancellationError {
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }
}

/// Genre tiles that open a Discover grid — the "browse" half of search.
struct BrowseGrid: View {
    struct Category: Identifiable {
        let title: String
        let type: MediaType
        let genre: Int
        let hue: Double
        let symbol: String
        var id: String { "\(type.rawValue)-\(genre)" }
    }

    static let categories: [Category] = [
        Category(title: "Action", type: .movie, genre: 28, hue: 0.02, symbol: "flame.fill"),
        Category(title: "Comedy", type: .movie, genre: 35, hue: 0.13, symbol: "face.smiling.fill"),
        Category(title: "Science Fiction", type: .movie, genre: 878, hue: 0.58, symbol: "sparkles"),
        Category(title: "Drama", type: .movie, genre: 18, hue: 0.75, symbol: "theatermasks.fill"),
        Category(title: "Horror", type: .movie, genre: 27, hue: 0.98, symbol: "moon.fill"),
        Category(title: "Animation", type: .movie, genre: 16, hue: 0.33, symbol: "paintpalette.fill"),
        Category(title: "Documentary", type: .movie, genre: 99, hue: 0.45, symbol: "globe.americas.fill"),
        Category(title: "Crime Series", type: .show, genre: 80, hue: 0.66, symbol: "magnifyingglass"),
    ]

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: Platform.isTV ? 360 : (Platform.isPhone ? 150 : 200)), spacing: Theme.Space.s)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>("Browse")
            LazyVGrid(columns: columns, spacing: Theme.Space.s) {
                ForEach(Self.categories) { category in
                    NavigationLink(value: Route.shelf(shelf(for: category))) { tile(category) }
                        .buttonStyle(CardButtonStyle())
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
        }
    }

    private func shelf(for category: Category) -> ShelfConfig {
        var query = DiscoverQuery(type: category.type)
        query.genres = [category.genre]
        query.minVotes = 300
        return ShelfConfig(id: "browse-\(category.id)", title: category.title, source: .discover(query))
    }

    private func tile(_ category: Category) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
        return ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [Color(hue: category.hue, saturation: 0.7, brightness: 0.55), Color(hue: (category.hue + 0.04).truncatingRemainder(dividingBy: 1), saturation: 0.85, brightness: 0.22)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            Image(systemName: category.symbol)
                .font(.system(size: 54 * Theme.scale, weight: .bold))
                .foregroundStyle(.white.opacity(0.14))
                .rotationEffect(.degrees(-12))
                .offset(x: 18, y: 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            Text(category.title)
                .font(.system(.headline, weight: .bold))
                .padding(Theme.Space.s)
        }
        .frame(height: 84 * Theme.scale)
        .clipShape(shape)
        .hairline(shape)
    }
}

/// The best match, given room: poster beside the essentials and a way to play, like the Apple TV app's top hit.
struct TopResultCard: View {
    let item: MediaItem
    @Environment(AppModel.self) private var model

    private var zoomID: String { "top-\(item.id)" }
    /// Search results come without runtimes, so the card asks for the film's own, as a poster row does.
    @State private var runtime: Int?

    private var posterWidth: CGFloat {
        #if os(tvOS)
        260
        #elseif os(macOS)
        150
        #else
        Platform.isPhone ? 110 : 150
        #endif
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.m) {
            NavigationLink(value: Route.detail(item, zoom: zoomID, library: nil)) {
                FilmFrame(art: .poster(item), strip: model.posterPrint(for: item, runtime: runtime))
                    .zoomSource(zoomID)
                    .frame(width: posterWidth)
            }
            .buttonStyle(CardButtonStyle(lift: 1.04))
            .accessibilityLabel(item.title)
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                text
                actions
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: Platform.isTV ? 1000 : 640, alignment: .leading)
        .contextMenu { MediaContextMenu(item: item) }
        .task(id: item.id) { runtime = await model.posterRuntime(for: item) }
    }

    /// Tapping the words opens the detail page too. On tvOS the poster is the one way in: a second
    /// focus stop on the text would only slow the remote down.
    @ViewBuilder
    private var text: some View {
        #if os(tvOS)
        details
        #else
        NavigationLink(value: Route.detail(item, zoom: zoomID, library: nil)) { details }
            .buttonStyle(.plain)
        #endif
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            Text(item.title)
                .font(Theme.Typeface.title).displayTracking()
                .lineLimit(2).multilineTextAlignment(.leading)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .lineLimit(1)
            }
            if let overview = item.overview, !overview.isEmpty {
                Text(overview)
                    .font(Theme.Typeface.body)
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .lineLimit(3).multilineTextAlignment(.leading)
                    .padding(.top, Theme.Space.xxs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var actions: some View {
        GlassGroup(spacing: 8) {
            HStack(spacing: Theme.Space.xs) {
                Button { Task { await model.play(item) } } label: {
                    Label("Play", systemImage: "play.fill").labelStyle(.titleAndIcon)
                }
                .buttonStyle(PrimaryButtonStyle(compact: true))
                Button { Task { await model.toggleWatchlist(item) } } label: {
                    Image(systemName: model.isWatchlisted(item) ? "checkmark" : "plus")
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(GlassButtonStyle(circle: true, compact: true))
                .accessibilityLabel(model.isWatchlisted(item) ? "Remove from Watchlist" : "Add to Watchlist")
            }
        }
    }

    /// "2024 · Science Fiction · 2h 46m", or "Series" in place of a runtime for shows.
    private var subtitle: String {
        var parts: [String] = []
        if let year = item.year { parts.append(String(year)) }
        if let genre = item.genres.first?.name { parts.append(genre) }
        if item.type == .show { parts.append("Series") }
        else if let runtime = item.runtimeMinutes, runtime > 0 { parts.append(TimeFormat.runtime(runtime)) }
        return parts.joined(separator: " · ")
    }
}
