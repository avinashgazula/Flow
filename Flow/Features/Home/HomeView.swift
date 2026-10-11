import SwiftUI
import FlowKit

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var heroItem: MediaItem?

    /// The enabled shelves, minus the ones their General switches turn off.
    private var shelves: [ShelfConfig] {
        let general = model.settings.general
        return model.settings.shelves.filter { shelf in
            guard shelf.enabled else { return false }
            switch shelf.source {
            case .builtIn(.continueWatching): return general.showContinueWatching
            case .builtIn(.upcomingEpisodes): return general.showUpcoming
            default: return true
            }
        }
    }

    var body: some View {
        Group {
            if model.catalog == nil {
                MissingKeyView()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Theme.Space.section) {
                        HeroCarousel(current: $heroItem)
                        ForEach(shelves) { shelf in
                            ShelfView(shelf: shelf)
                        }
                        ForEach(model.mediaServers.map(\.config).filter { model.settings.mediaServers.showsHomeRow(for: $0.id) }) { server in
                            ServerLibrariesShelf(server: server)
                        }
                        if shelves.isEmpty {
                            ContentUnavailableView("No Shelves", systemImage: "square.grid.2x2", description: Text("Turn shelves on in Settings → Shelves."))
                        }
                    }
                    .padding(.bottom, Theme.Space.xxl)
                }
                .scrollIndicators(.hidden)
                #if os(iOS)
                .ignoresSafeArea(edges: .top)
                #elseif os(tvOS)
                .ignoresSafeArea(edges: [.top, .horizontal])
                #endif
                .refreshable { await model.refreshLibrary(force: true) }
                .background(alignment: .top) {
                    // The page takes on the colour of whichever title the hero is showing.
                    AmbientBackground(url: heroItem?.smallBackdropURL ?? heroItem?.posterURL, intensity: 0.9)
                        .mask(LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
                        .frame(height: 1400)
                        .animation(Theme.Motion.gentle, value: heroItem?.id)
                }
                .background(Theme.Palette.canvas)
            }
        }
        .overlay(alignment: .topTrailing) {
            #if !os(tvOS)
            settingsButton.padding(.trailing, Theme.Space.gutter).padding(.top, Theme.Space.xs)
            #endif
        }
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #elseif os(tvOS)
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button { model.showSettings = true } label: { Image(systemName: "gearshape.fill") }
            }
        }
        #else
        .navigationTitle("Home")
        #endif
    }

    @ViewBuilder
    private var settingsButton: some View {
        #if os(macOS)
        SettingsLink {
            Image(systemName: "gearshape.fill")
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 40, height: 40)
                .flowGlass(Circle(), interactive: true)
        }
        .buttonStyle(.plain)
        #else
        Button { model.showSettings = true } label: {
            Image(systemName: "gearshape.fill")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 42, height: 42)
                .flowGlass(Circle(), interactive: true)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
        #endif
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
        .task { if items.isEmpty { await loadMore() } }
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
