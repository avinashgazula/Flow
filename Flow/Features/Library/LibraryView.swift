import SwiftUI
import FlowKit

struct LibraryView: View {
    @Environment(AppModel.self) private var model
    private var downloadCount: Int { DownloadManager.shared.items.filter { $0.state == .finished }.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                tileArea

                ContinueWatchingShelf(title: "Continue Watching")
                LibraryKeysShelf(title: "Watchlist", keys: model.watchlistKeys, route: .library(.watchlist))
                LibraryKeysShelf(title: "Watch History", keys: uniqueHistoryKeys, route: .library(.history))
                LibraryKeysShelf(title: "Favourites", keys: model.favouriteKeys, route: .library(.favourites))

                ForEach(model.settings.shelves.filter { shelf in
                    switch shelf.source {
                    case .traktList, .mdblist, .mediaServerLibrary: return true
                    default: return false
                    }
                }) { shelf in
                    ShelfView(shelf: shelf, inLibraryTab: true)
                }

                if model.watchlistKeys.isEmpty && model.history.isEmpty && model.favouriteKeys.isEmpty && !model.isSyncing {
                    ContentUnavailableView("Your Library Is Empty", systemImage: "books.vertical",
                                           description: Text("Add titles to your watchlist, or connect Trakt, Simkl or MDBList in Settings → Account."))
                }
            }
            .padding(.vertical)
        }
        .tabRootTitle("Library")
        .refreshable { await model.refreshLibrary(force: true) }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if model.isSyncing { ProgressView() } else {
                    Button { Task { await model.refreshLibrary(force: true) } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
        }
    }

    private struct Tile: Identifiable {
        let title: String
        let subtitle: String
        let systemImage: String
        let route: Route
        let tint: Color
        var id: String { title }
    }

    private var tileItems: [Tile] {
        let teams = model.settings.sports.followedTeams.count
        var items: [Tile] = []
        if Platform.supportsDownloads {
            items.append(Tile(title: "Downloads", subtitle: downloadCount > 0 ? "\(downloadCount) saved" : "Watch offline", systemImage: "arrow.down.circle.fill", route: .downloads, tint: .blue))
        }
        items += [
            Tile(title: "Upcoming", subtitle: "New episodes", systemImage: "calendar", route: .calendar, tint: .pink),
            Tile(title: "Sports", subtitle: teams == 0 ? "Follow your teams" : teams == 1 ? "1 team followed" : "\(teams) teams followed", systemImage: "sportscourt.fill", route: .sports, tint: .green),
            Tile(title: "History", subtitle: model.history.count == 1 ? "1 play" : "\(model.history.count) plays", systemImage: "clock.fill", route: .library(.history), tint: .orange),
            Tile(title: "Stats", subtitle: "Your watching", systemImage: "chart.bar.fill", route: .stats, tint: .teal),
        ]
        return items
    }

    private func tile(_ item: Tile, stacked: Bool) -> some View {
        LibraryTile(title: item.title, subtitle: item.subtitle, systemImage: item.systemImage, route: item.route, tint: item.tint, stacked: stacked)
    }

    @ViewBuilder private var tileArea: some View {
        let items = tileItems
        #if os(tvOS)
        // A row: focus moves along it, and it scrolls to whatever is focused.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                ForEach(items) { tile($0, stacked: false) }
                ActionChip(title: model.isSyncing ? "Syncing…" : "Sync", systemImage: "arrow.clockwise") {
                    Task { await model.refreshLibrary(force: true) }
                }
                .disabled(model.isSyncing)
            }
            .padding(.horizontal, Platform.horizontalPadding)
        }
        #else
        if Platform.isPhone {
            // Two equal columns so nothing is clipped; an odd one out takes the whole last row
            // rather than leaving a hole beside it.
            let paired = items.count.isMultiple(of: 2) ? items : Array(items.dropLast())
            VStack(spacing: Theme.Space.s) {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: Theme.Space.s), GridItem(.flexible())], spacing: Theme.Space.s) {
                    ForEach(paired) { tile($0, stacked: true) }
                }
                if paired.count < items.count, let last = items.last {
                    tile(last, stacked: false)
                }
            }
            .padding(.horizontal, Platform.horizontalPadding)
        } else {
            // As many across as fit, all of them visible: a scrolling row hid the last ones off the edge.
            // Stacked (icon above the words), so five fit across a big iPad without cutting labels short.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 175), spacing: 14)], spacing: 14) {
                ForEach(items) { tile($0, stacked: true) }
            }
            .padding(.horizontal, Platform.horizontalPadding)
        }
        #endif
    }

    private var uniqueHistoryKeys: [MediaKey] {
        var seen = Set<MediaKey>()
        return model.history.map(\.key).filter { seen.insert($0).inserted }
    }
}

struct LibraryTile: View {
    let title: String
    let subtitle: String?
    let systemImage: String
    let route: Route
    var tint: Color = .white
    /// Fills its grid cell, with the chevron above the text, instead of a fixed-width row tile.
    var stacked = Platform.isPhone

    var body: some View {
        NavigationLink(value: route) {
            Group {
                if stacked {
                    VStack(alignment: .leading, spacing: Theme.Space.s) {
                        HStack(spacing: 0) {
                            icon
                            Spacer(minLength: 0)
                            chevron
                        }
                        labels
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    HStack(spacing: Theme.Space.s) {
                        icon
                        labels
                        Spacer(minLength: 0)
                        chevron
                    }
                    .frame(width: Platform.isTV ? 460 : nil, alignment: .leading)
                    .frame(maxWidth: Platform.isTV ? nil : .infinity, alignment: .leading)
                }
            }
            .padding(Theme.Space.m)
            .flowGlass(RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous))
        }
        .buttonStyle(CardButtonStyle())
    }

    private var icon: some View {
        Image(systemName: systemImage)
            .font(.system(size: 17 * Theme.scale, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: 42 * Theme.scale, height: 42 * Theme.scale)
            .background(tint.opacity(0.16), in: Circle())
    }

    private var labels: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(Theme.Typeface.headline).lineLimit(1)
            if let subtitle {
                Text(subtitle).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
            }
        }
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 12 * Theme.scale, weight: .bold))
            .foregroundStyle(Theme.Palette.textTertiary)
    }
}

/// A row of titles from tracker keys (watchlist, history, favourites).
struct LibraryKeysShelf: View {
    let title: String
    let keys: [MediaKey]
    let route: Route
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []

    var body: some View {
        // Not a bare Group: a Group with no children never appears, so its task would never run.
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            if !items.isEmpty {
                SectionHeader(title, route: route)
                PosterRow(items: items, context: "library-\(title)")
            }
        }
        .task(id: keys) {
            let loaded = await model.hydrate(Array(keys.prefix(20)))
            // Cancelled (the keys changed or the tab went away): the result is partial, and a newer task is coming.
            guard !Task.isCancelled else { return }
            withAnimation(Theme.Motion.fade) { items = loaded }
        }
    }
}

/// Full list for a library section.
struct LibraryListView: View {
    let list: LibraryList
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var loading = true
    @State private var filter: MediaType?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Type", selection: $filter) {
                    Text("All").tag(MediaType?.none)
                    Text("Movies").tag(MediaType?.some(.movie))
                    Text("Shows").tag(MediaType?.some(.show))
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Platform.horizontalPadding)
                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                } else if filtered.isEmpty {
                    ContentUnavailableView("Nothing Here Yet", systemImage: "tray")
                } else {
                    PosterGrid(items: filtered)
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(list.title)
        .task(id: model.contentVersion) {
            let loaded = await model.hydrate(keys, limit: 300)
            guard !Task.isCancelled else { return }
            items = loaded
            loading = false
        }
    }

    private var filtered: [MediaItem] { filter.map { t in items.filter { $0.type == t } } ?? items }

    private var keys: [MediaKey] {
        switch list {
        case .watchlist: return model.watchlistKeys
        case .favourites: return model.favouriteKeys
        case .continueWatching: return model.continueWatching.map(\.key)
        case .history:
            var seen = Set<MediaKey>()
            return model.history.map(\.key).filter { seen.insert($0).inserted }
        }
    }
}

struct CollectionView: View {
    let collectionID: Int
    let name: String
    @Environment(AppModel.self) private var model
    @State private var collection: MediaCollection?
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let collection {
                    RemoteImage(url: TMDBImage.url(collection.backdropPath, size: .backdropLarge))
                        .frame(height: 220).clipped()
                    PosterGrid(items: collection.parts)
                } else if failed {
                    Text("Couldn't load this collection.").font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary)
                        .frame(maxWidth: .infinity).padding(.top, 60)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
        }
        .navigationTitle(name)
        .task {
            failed = false
            collection = try? await model.catalog?.collection(collectionID)
            failed = collection == nil && !Task.isCancelled
        }
    }
}
