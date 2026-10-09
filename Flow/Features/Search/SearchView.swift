import SwiftUI
import FlowKit

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var results: [SearchResult] = []
    @State private var serverResults: [MediaItem] = []
    @State private var searching = false
    @State private var error: String?
    @State private var recents: [String] = []

    private var movies: [MediaItem] { results.compactMap { if case .media(let m) = $0, m.type == .movie { return m }; return nil } }
    private var shows: [MediaItem] { results.compactMap { if case .media(let m) = $0, m.type == .show { return m }; return nil } }
    private var people: [Person] { results.compactMap { if case .person(let p) = $0 { return p }; return nil } }

    var body: some View {
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
        .searchable(text: $text, prompt: "Movies, shows, and people")
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
                            Button { text = term } label: {
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
