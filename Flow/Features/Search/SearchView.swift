import SwiftUI
import FlowKit

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var results: [SearchResult] = []
    @State private var serverResults: [MediaItem] = []
    @State private var searching = false
    @State private var error: String?
    @State private var recents: [String] = []

    private var movies: [MediaItem] { results.compactMap { if case .media(let m) = $0, m.type == .movie { return m }; return nil } }
    private var shows: [MediaItem] { results.compactMap { if case .media(let m) = $0, m.type == .show { return m }; return nil } }
    private var people: [Person] { results.compactMap { if case .person(let p) = $0 { return p }; return nil } }

    private var text: String { model.searchText }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if text.trimmingCharacters(in: .whitespaces).isEmpty {
                    idleContent
                } else if searching && results.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                } else if let error {
                    ContentUnavailableView("Search Failed", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if results.isEmpty && serverResults.isEmpty {
                    ContentUnavailableView.search(text: text)
                } else {
                    if !serverResults.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader<Route>("Media Servers")
                            PosterRow(items: serverResults)
                        }
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
                HStack {
                    Text("Recent").font(.title3.weight(.bold))
                    Spacer()
                    Button("Clear") { model.recentSearches = []; recents = [] }
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                .padding(.horizontal, Platform.horizontalPadding)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(recents, id: \.self) { term in
                            Button { model.searchText = term } label: {
                                Label(term, systemImage: "clock.arrow.circlepath")
                                    .padding(.horizontal, 14).padding(.vertical, 9)
                                    .background(.white.opacity(0.1), in: Capsule())
                            }
                            .buttonStyle(.plain)
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

    private func runSearch() async {
        let query = text.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else { results = []; serverResults = []; return }
        // Debounce typing.
        try? await Task.sleep(nanoseconds: 350_000_000)
        guard !Task.isCancelled else { return }
        searching = true
        defer { searching = false }
        do {
            let found = try await model.search(query)
            guard !Task.isCancelled else { return }
            results = found.results
            serverResults = found.server
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
                .font(.system(size: 16 * Theme.scale, weight: .bold))
                .padding(Theme.Space.s)
        }
        .frame(height: 84 * Theme.scale)
        .clipShape(shape)
        .hairline(shape)
    }
}
