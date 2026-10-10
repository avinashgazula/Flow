import SwiftUI
import FlowKit

struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var downloadCount = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        if Platform.supportsDownloads {
                            LibraryTile(title: "Downloads", subtitle: downloadCount > 0 ? "\(downloadCount) saved" : "Watch offline", systemImage: "arrow.down.circle.fill", route: .downloads, tint: .blue)
                        }
                        LibraryTile(title: "Upcoming", subtitle: "New episodes", systemImage: "calendar", route: .calendar, tint: .pink)
                        LibraryTile(title: "Sports", subtitle: model.settings.sports.followedTeams.isEmpty ? "Follow your teams" : "\(model.settings.sports.followedTeams.count) teams followed", systemImage: "sportscourt.fill", route: .sports, tint: .green)
                        LibraryTile(title: "History", subtitle: "\(model.history.count) plays", systemImage: "clock.fill", route: .library(.history), tint: .orange)
                        #if os(tvOS)
                        ActionChip(title: model.isSyncing ? "Syncing…" : "Sync", systemImage: "arrow.clockwise") {
                            Task { await model.refreshLibrary(force: true) }
                        }
                        .disabled(model.isSyncing)
                        #endif
                    }
                    .padding(.horizontal, Platform.horizontalPadding)
                }

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
                    ShelfView(shelf: shelf)
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
        .task { downloadCount = DownloadManager.shared.items.count }
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

    var body: some View {
        NavigationLink(value: route) {
            HStack(spacing: Theme.Space.s) {
                Image(systemName: systemImage)
                    .font(.system(size: 17 * Theme.scale, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 42 * Theme.scale, height: 42 * Theme.scale)
                    .background(tint.opacity(0.16), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Theme.Typeface.headline)
                    if let subtitle {
                        Text(subtitle).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12 * Theme.scale, weight: .bold))
                    .foregroundStyle(Theme.Palette.textTertiary)
            }
            .padding(Theme.Space.m)
            .frame(width: Platform.isTV ? 460 : 230, alignment: .leading)
            .flowGlass(RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous))
        }
        .buttonStyle(CardButtonStyle())
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
            items = await model.hydrate(keys, limit: 300)
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let collection {
                    RemoteImage(url: TMDBImage.url(collection.backdropPath, size: .backdropLarge))
                        .frame(height: 220).clipped()
                    PosterGrid(items: collection.parts)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
        }
        .navigationTitle(name)
        .task { collection = try? await model.catalog?.collection(collectionID) }
    }
}
