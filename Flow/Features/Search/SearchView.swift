import SwiftUI
import FlowKit

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var results: [SearchResult] = []
    @State private var searching = false
    @State private var error: String?
    @State private var recents: [String] = []
    /// What is trending, as names to try.
    @State private var tries: [String] = []
    #if !os(tvOS)
    @FocusState private var fieldFocused: Bool
    #endif

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

    private var textBinding: Binding<String> {
        Binding(get: { model.searchText }, set: { model.searchText = $0 })
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Theme.Space.l) {
                BrowseHead("Search", note: "Films, series and people by name")
                #if !os(tvOS)
                field
                #endif
                if text.trimmingCharacters(in: .whitespaces).count < 2 {
                    idleContent
                } else if searching && results.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                } else if let error {
                    ContentUnavailableView("Search Failed", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if results.isEmpty {
                    ContentUnavailableView.search(text: text)
                } else {
                    resultSections
                }
            }
            .padding(.bottom, Theme.Space.l)
        }
        #if os(tvOS)
        // On TV the field is the system's keyboard page, parked above the content in the navigation bar,
        // which therefore stays.
        .searchable(text: textBinding, prompt: "Movies, shows, and people")
        .onSubmit(of: .search) { model.rememberSearch(text); recents = model.recentSearches }
        #else
        .browsePage("Search", root: true)
        #endif
        .task(id: text) { await runSearch() }
        .task { await loadTries() }
        .onAppear { recents = model.recentSearches; takeFocusRequest() }
        .onChange(of: model.searchFocusPending) { takeFocusRequest() }
    }

    // MARK: Field

    #if !os(tvOS)
    /// The page's biggest field: a condensed face across the width inside a 2px frame, blue while it has the cursor.
    private var field: some View {
        HStack(spacing: Theme.Space.xs) {
            TextField("Search", text: textBinding,
                      prompt: Text("Movies, shows and people").foregroundStyle(Theme.Palette.muted))
                .font(Theme.Typeface.custom(Theme.Face.condensedSemiBold, Platform.isPhone ? 28 : 40, .title))
                .textFieldStyle(.plain)
                .focused($fieldFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .onSubmit { model.rememberSearch(text); recents = model.recentSearches }
            if !text.isEmpty {
                Button { model.searchText = "" } label: { Image(systemName: "xmark") }
                    .buttonStyle(QuietButtonStyle(square: true))
                    .accessibilityLabel("Clear Search")
            }
        }
        .padding(.horizontal, Theme.Space.m)
        .padding(.vertical, Theme.Space.xs)
        .frame(minHeight: 64)
        .background(Theme.Palette.bg)
        .ruleFrame(fieldFocused ? Theme.Palette.blue : Theme.Palette.rule)
        .padding(.horizontal, Theme.Space.gutter)
    }
    #endif

    /// The "/" shortcut asked for the cursor. The field is brought up a moment after the tab settles, or it is ignored.
    private func takeFocusRequest() {
        guard model.searchFocusPending else { return }
        model.searchFocusPending = false
        #if !os(tvOS)
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(200))
            fieldFocused = true
        }
        #endif
    }

    // MARK: Results

    @ViewBuilder
    private var resultSections: some View {
        if let top = topResult {
            SectionHead("Top Result")
            TopResultCard(item: top).padding(.horizontal, Theme.Space.gutter)
        }
        if !movies.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHead("Movies", note: "\(movies.count)")
                PosterRow(items: movies)
            }
        }
        if !shows.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHead("TV Shows", note: "\(shows.count)")
                PosterRow(items: shows)
            }
        }
        if !people.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHead("People", note: "\(people.count)")
                LazyVGrid(columns: Self.listColumns, alignment: .leading, spacing: 0) {
                    ForEach(people) { person in PersonRow(person: person) }
                }
                .padding(.horizontal, Theme.Space.gutter)
            }
        }
    }

    /// Ruled lists run two across where there is room, one on a phone.
    static var listColumns: [GridItem] {
        let count = Platform.isPhone ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: Theme.Space.xxl, alignment: .top), count: count)
    }

    // MARK: Idle

    @ViewBuilder
    private var idleContent: some View {
        if !recents.isEmpty {
            suggestions("Recent", terms: recents, removable: true) {
                Button("Clear") { withAnimation(Theme.Motion.state) { model.recentSearches = []; recents = [] } }
                    .buttonStyle(QuietButtonStyle())
            }
        }
        if !tries.isEmpty {
            suggestions("Try", terms: tries, removable: false) { EmptyView() }
        }
        if model.catalog != nil {
            BrowseGrid()
            ShelfView(shelf: .builtIn(.trendingMovies))
            ShelfView(shelf: .builtIn(.trendingShows))
        } else {
            MissingKeyView()
        }
    }

    /// A red label, then terms in serif with dotted red underlines: tap one to search it.
    private func suggestions<Trailing: View>(_ title: String, terms: [String], removable: Bool,
                                             @ViewBuilder trailing: () -> Trailing) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            SectionHead(title, trailing: trailing)
            WrappingRow(spacing: Theme.Space.l, lineSpacing: Theme.Space.xxs) {
                ForEach(terms, id: \.self) { term in
                    HStack(spacing: 0) {
                        Button { model.searchText = term } label: {
                            Text(term)
                                .font(Theme.Typeface.custom(Theme.Face.serif, 18, .body))
                                .underline(true, pattern: .dot, color: Theme.Palette.red)
                        }
                        .buttonStyle(SuggestionStyle())
                        #if !os(tvOS)
                        if removable {
                            Button { forget(term) } label: { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)) }
                                .buttonStyle(QuietButtonStyle(square: true))
                                .accessibilityLabel("Remove \(term) from Recent")
                        }
                        #endif
                    }
                    #if os(tvOS)
                    .contextMenu {
                        if removable { Button(role: .destructive) { forget(term) } label: { Label("Remove", systemImage: "trash") } }
                    }
                    #endif
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
        }
    }

    private func forget(_ term: String) {
        withAnimation(Theme.Motion.state) {
            model.recentSearches.removeAll { $0 == term }
            recents = model.recentSearches
        }
    }

    private func loadTries() async {
        guard tries.isEmpty, let catalog = model.catalog else { return }
        if let page = try? await catalog.trending(.movie, page: 1) {
            tries = page.items.prefix(5).map(\.title)
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

/// A suggestion in the page's sentence voice: serif text; blue plate while hovered, pressed or focused.
private struct SuggestionStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        SuggestionBody(configuration: configuration)
    }
}

private struct SuggestionBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering || configuration.isPressed
        configuration.label
            .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.fg)
            .padding(.horizontal, Theme.Space.xxs)
            .frame(minHeight: 40 * Theme.scale)
            .background(lit ? Theme.Palette.blue : Color.clear)
            .contentShape(Rectangle())
            .animation(Theme.Motion.hover, value: lit)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// A person in the results: a small portrait, the name and what they are known for, as a ruled row.
private struct PersonRow: View {
    let person: Person

    var body: some View {
        NavigationLink(value: Route.person(id: person.id, name: person.name)) {
            HStack(spacing: Theme.Space.m) {
                RowThumb(url: TMDBImage.url(person.profilePath, size: .profile), title: person.name,
                         width: 48 * Theme.scale, height: 72 * Theme.scale)
                VStack(alignment: .leading, spacing: 2) {
                    Text(person.name)
                        .font(Theme.Typeface.heading)
                        .textCase(.uppercase)
                        .lineLimit(1)
                    if let role = person.knownFor, !role.isEmpty {
                        Text(role)
                            .font(Theme.Typeface.caption)
                            .rowInk(Theme.Palette.muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                RowChevron()
            }
        }
        .buttonStyle(BrowseRowStyle())
        .accessibilityLabel(person.knownFor.map { "\(person.name), \($0)" } ?? person.name)
    }
}

/// Genres as a numbered list that opens a Discover grid: the "browse" half of search.
struct BrowseGrid: View {
    struct Category: Identifiable {
        let title: String
        let type: MediaType
        let genre: Int
        var id: String { "\(type.rawValue)-\(genre)" }
    }

    static let categories: [Category] = [
        Category(title: "Action", type: .movie, genre: 28),
        Category(title: "Comedy", type: .movie, genre: 35),
        Category(title: "Science Fiction", type: .movie, genre: 878),
        Category(title: "Drama", type: .movie, genre: 18),
        Category(title: "Horror", type: .movie, genre: 27),
        Category(title: "Animation", type: .movie, genre: 16),
        Category(title: "Documentary", type: .movie, genre: 99),
        Category(title: "Crime Series", type: .show, genre: 80),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHead("Browse by Genre")
            LazyVGrid(columns: SearchView.listColumns, alignment: .leading, spacing: 0) {
                ForEach(Array(Self.categories.enumerated()), id: \.element.id) { index, category in
                    NavigationLink(value: Route.shelf(shelf(for: category))) {
                        HStack(spacing: Theme.Space.s) {
                            IndexNumeral(number: index + 1)
                            Text(category.title)
                                .font(Theme.Typeface.heading)
                                .textCase(.uppercase)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            RowChevron()
                        }
                        .frame(minHeight: 40 * Theme.scale)
                    }
                    .buttonStyle(BrowseRowStyle())
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
}

/// The best match, given room: poster beside the essentials and a way to play, like the Apple TV app's top hit.
struct TopResultCard: View {
    let item: MediaItem
    @Environment(AppModel.self) private var model

    private var zoomID: String { "top-\(item.id)" }

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
                RowThumb(url: item.posterURL, fallbackURL: item.tmdbPosterURL, title: item.title,
                         width: posterWidth, height: posterWidth * 1.5)
                    .zoomSource(zoomID)
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
                .font(Theme.Typeface.title)
                .textCase(.uppercase)
                .lineLimit(2).multilineTextAlignment(.leading)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(Theme.Typeface.caption)
                    .textCase(.uppercase)
                    .tracking(0.06 * 12 * Theme.scale)
                    .foregroundStyle(Theme.Palette.muted)
                    .lineLimit(1)
            }
            if let overview = item.overview, !overview.isEmpty {
                Text(overview)
                    .font(Theme.Typeface.reading)
                    .lineLimit(3).multilineTextAlignment(.leading)
                    .padding(.top, Theme.Space.xxs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var actions: some View {
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
