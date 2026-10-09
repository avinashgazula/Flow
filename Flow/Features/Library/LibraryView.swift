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
                            LibraryTile(title: "Downloads", subtitle: downloadCount > 0 ? "\(downloadCount) saved" : nil, systemImage: "arrow.down.circle.fill", route: .downloads)
                        }
                        LibraryTile(title: "Sports", subtitle: "\(model.settings.sports.followedTeams.count) teams followed", systemImage: "sportscourt.fill", route: .sports)
                        LibraryTile(title: "History", subtitle: nil, systemImage: "clock.fill", route: .library(.history))
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
        .navigationTitle("Library")
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

    var body: some View {
        NavigationLink(value: route) {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.title3)
                    .frame(width: 46, height: 46)
                    .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(width: Platform.isTV ? 420 : 240, alignment: .leading)
            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.08)))
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
        Group {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title, route: route)
                    PosterRow(items: items)
                }
            }
        }
        .task(id: keys) { items = await model.hydrate(Array(keys.prefix(20))) }
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
