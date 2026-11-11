import SwiftUI
import FlowKit

struct LibraryView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                BrowseHead("Library", note: "\(model.watchedKeys.count.formatted()) watched")
                BrowseToolbar {
                    HStack(spacing: Theme.Space.s) {
                        Spacer(minLength: 0)
                        Button(model.isSyncing ? "Syncing…" : "Refresh") { Task { await model.refreshLibrary(force: true) } }
                            .buttonStyle(FilterChipStyle())
                            .disabled(model.isSyncing)
                    }
                }
                index
                // Reads the downloads and the lists itself, so this page doesn't redraw with every download tick.
                LibraryEmptyState()

                ContinueWatchingShelf(title: "Continue Watching")
                LibraryKeysShelf(title: "Watchlist", keys: model.watchlistKeys, route: .library(.watchlist))
                LibraryKeysShelf(title: "Watch History", keys: model.watchedKeys, route: .library(.history))
                LibraryKeysShelf(title: "Favourites", keys: model.favouriteKeys, route: .library(.favourites))

                ForEach(model.settings.shelves.filter { shelf in
                    switch shelf.source {
                    case .traktList, .mdblist, .mediaServerLibrary: return true
                    default: return false
                    }
                }) { shelf in
                    ShelfView(shelf: shelf, inLibraryTab: true)
                }
            }
            .padding(.bottom, Theme.Space.l)
        }
        .browsePage("Library", root: true)
        .refreshable { await model.refreshLibrary(force: true) }
    }

    private struct Entry: Identifiable {
        let title: String
        let subtitle: String
        let route: Route
        var id: String { title }
    }

    private var entries: [Entry] {
        let teams = model.settings.sports.followedTeams.count
        var items: [Entry] = [
            Entry(title: "Upcoming", subtitle: "New episodes and releases", route: .calendar),
            Entry(title: "Sports", subtitle: teams == 0 ? "Follow your teams" : teams == 1 ? "1 team followed" : "\(teams) teams followed", route: .sports),
            Entry(title: "History", subtitle: Self.historySubtitle(model.watchedKeys.count), route: .library(.history)),
            Entry(title: "Stats", subtitle: "Your watching", route: .stats),
        ]
        // The subtitle (how many are saved) is filled in by `DownloadsRow`.
        if Platform.supportsDownloads { items.append(Entry(title: "Downloads", subtitle: "Watch offline", route: .downloads)) }
        return items
    }

    /// Counts titles, which is what the History list holds; before anything is known it says what the page is.
    private static func historySubtitle(_ count: Int) -> String {
        count == 0 ? "Watched titles" : count == 1 ? "1 title" : "\(count.formatted()) titles"
    }

    /// The pages behind the Library, as the website lists them: a red numeral, a name and what is in it.
    private var index: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHead("Index")
            LazyVGrid(columns: SearchView.listColumns, alignment: .leading, spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { offset, entry in
                    if entry.route == .downloads {
                        DownloadsRow(number: offset + 1)
                    } else {
                        IndexLink(number: offset + 1, title: entry.title, subtitle: entry.subtitle, route: entry.route)
                    }
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
        }
    }
}

/// A numbered row that opens one of the Library's pages.
private struct IndexLink: View {
    let number: Int
    let title: String
    let subtitle: String
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            HStack(spacing: Theme.Space.s) {
                IndexNumeral(number: number)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Theme.Typeface.heading).textCase(.uppercase).lineLimit(1)
                    Text(subtitle).font(Theme.Typeface.caption).rowInk(Theme.Palette.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                RowChevron()
            }
            .frame(minHeight: 44 * Theme.scale)
        }
        .buttonStyle(BrowseRowStyle())
        .accessibilityLabel("\(title), \(subtitle)")
    }
}

/// The Downloads row. The manager reports progress many times a second while something downloads,
/// so only this small view watches it, not the whole Library page.
private struct DownloadsRow: View {
    let number: Int

    var body: some View {
        let saved = DownloadManager.shared.items.filter { $0.state == .finished }.count
        IndexLink(number: number, title: "Downloads", subtitle: saved > 0 ? "\(saved) saved" : "Watch offline", route: .downloads)
    }
}

/// Shown only when there is genuinely nothing to show: no resume points, lists, history or saved downloads.
private struct LibraryEmptyState: View {
    @Environment(AppModel.self) private var model

    private var isEmpty: Bool {
        guard model.continueWatching.isEmpty, model.watchlistKeys.isEmpty, model.favouriteKeys.isEmpty,
              model.watchedKeys.isEmpty, !model.isSyncing else { return false }
        return !Platform.supportsDownloads || DownloadManager.shared.items.isEmpty
    }

    var body: some View {
        if isEmpty {
            BrowseEmpty(title: "Your Library Is Empty",
                        message: "Add titles to your watchlist, or connect Trakt, Simkl or MDBList in Settings → Account.")
        }
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
                SectionHead(title, note: keys.count.formatted()) {
                    NavigationLink(value: route) { Text("See All") }
                        .buttonStyle(QuietButtonStyle())
                }
                PosterRow(items: items, context: "library-\(title)")
            }
        }
        .task(id: keys) {
            let loaded = await model.hydrate(Array(keys.prefix(20)))
            // Cancelled (the keys changed or the tab went away): the result is partial, and a newer task is coming.
            guard !Task.isCancelled, loaded != items else { return }
            withAnimation(Theme.Motion.state) { items = loaded }
        }
    }
}

/// Full list for a library section. History is dated rows, as on the website; the others are poster grids.
struct LibraryListView: View {
    let list: LibraryList
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var loading = true
    @State private var filter: MediaType?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                BrowseHead(list.title, note: loading ? nil : "\(filtered.count.formatted()) \(filtered.count == 1 ? "title" : "titles")")
                BrowseToolbar {
                    HStack {
                        SegmentedTabs(options: [(value: MediaType?.none, title: "All"),
                                                (value: MediaType?.some(.movie), title: "Movies"),
                                                (value: MediaType?.some(.show), title: "Shows")],
                                      selection: $filter)
                        Spacer(minLength: 0)
                    }
                }
                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                } else if filtered.isEmpty {
                    BrowseEmpty(title: "Nothing Here Yet", message: "Titles you add to \(list.title) appear in this list.")
                } else if list == .history, !model.history.isEmpty {
                    HistoryRows(entries: model.history, items: filtered)
                } else {
                    grid
                }
            }
            .padding(.bottom, Theme.Space.l)
        }
        .browsePage(list.title)
        .task(id: model.contentVersion) {
            let keys = self.keys
            // The first screenful appears as soon as it's ready; the rest fills in behind it. Waiting for
            // all 300 meant one slow lookup held up the whole page.
            if items.isEmpty {
                let first = await model.hydrate(Array(keys.prefix(Self.firstBatch)), limit: Self.firstBatch)
                guard !Task.isCancelled else { return }
                items = first
                loading = false
            }
            let loaded = await model.hydrate(keys, limit: 300)
            guard !Task.isCancelled else { return }
            if loaded != items { items = loaded }
            loading = false
        }
    }

    private static let firstBatch = 24

    /// The watchlist can be rearranged on iOS 27 (drag a poster); every other list, and earlier systems, are a plain grid.
    @ViewBuilder
    private var grid: some View {
        #if os(iOS) && compiler(>=6.4)
        if #available(iOS 27.0, *), list == .watchlist, filter == nil {
            ReorderableWatchlistGrid(items: $items) { moving, target in
                let current = items.compactMap(\.key)
                let arranged = WatchlistOrder.moving(moving, before: target, in: current)
                model.watchlistOrder = arranged
                let byKey = Dictionary(items.compactMap { item in item.key.map { ($0, item) } }, uniquingKeysWith: { first, _ in first })
                withAnimation(Theme.Motion.state) { items = arranged.compactMap { byKey[$0] } }
            }
        } else {
            PosterGrid(items: filtered)
        }
        #else
        PosterGrid(items: filtered)
        #endif
    }

    private var filtered: [MediaItem] { filter.map { t in items.filter { $0.type == t } } ?? items }

    private var keys: [MediaKey] {
        switch list {
        case .watchlist: return WatchlistOrder.applying(model.watchlistOrder, to: model.watchlistKeys)
        case .favourites: return model.favouriteKeys
        case .continueWatching: return model.continueWatching.map(\.key)
        case .history: return model.watchedKeys
        }
    }
}

/// Everything watched, newest first, under day headings: when (mono), a small still, what it was and its line.
private struct HistoryRows: View {
    let entries: [HistoryEntry]
    let items: [MediaItem]
    /// Enough to scroll for a long while without laying out a whole Trakt account.
    private static let limit = 400

    var body: some View {
        let byKey = Dictionary(items.compactMap { item in item.key.map { ($0, item) } }, uniquingKeysWith: { first, _ in first })
        let shown = entries.sorted { $0.watchedAt > $1.watchedAt }.filter { byKey[$0.key] != nil }.prefix(Self.limit)
        let days = Dictionary(grouping: shown) { Calendar.current.startOfDay(for: $0.watchedAt) }
        LazyVStack(alignment: .leading, spacing: Theme.Space.m) {
            ForEach(days.keys.sorted(by: >), id: \.self) { day in
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    SectionHead(Self.dayTitle(day))
                    VStack(spacing: 0) {
                        ForEach(days[day] ?? []) { entry in
                            if let item = byKey[entry.key] { HistoryRow(entry: entry, item: item) }
                        }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                }
            }
        }
    }

    private static func dayTitle(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }
        return day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }
}

private struct HistoryRow: View {
    let entry: HistoryEntry
    let item: MediaItem

    var body: some View {
        NavigationLink(value: Route.detail(item)) {
            HStack(spacing: Theme.Space.m) {
                Text(entry.watchedAt.formatted(date: .omitted, time: .shortened))
                    .font(Theme.Typeface.caption)
                    .rowInk(Theme.Palette.muted)
                    .lineLimit(1)
                    .frame(width: 70 * Theme.scale, alignment: .leading)
                RowThumb(url: item.smallBackdropURL ?? item.tmdbPosterURL, title: item.title, width: 96 * Theme.scale, height: 54 * Theme.scale)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(Theme.Typeface.heading).textCase(.uppercase).lineLimit(1)
                    Text(meta).font(Theme.Typeface.caption).rowInk(Theme.Palette.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                RowChevron()
            }
        }
        .buttonStyle(BrowseRowStyle())
        .accessibilityLabel(Reel.spokenListing(title: item.title, episode: entry.episode, extra: []))
    }

    /// An episode's code, or a film's year.
    private var meta: String {
        if let episode = entry.episode { return episode.code }
        return [item.year.map(String.init), item.type == .movie ? "Film" : "Series"].compactMap { $0 }.joined(separator: " · ")
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
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                BrowseHead(name, note: "Collection")
                if let collection {
                    RemoteImage(url: TMDBImage.url(collection.backdropPath, size: .backdropLarge))
                        .frame(height: 220 * Theme.scale).clipped()
                        .ruleFrame()
                        .padding(.horizontal, Theme.Space.gutter)
                    PosterGrid(items: collection.parts)
                } else if failed {
                    Text("Couldn't load this collection.").font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.muted)
                        .frame(maxWidth: .infinity).padding(.top, 60)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(.bottom, Theme.Space.l)
        }
        .browsePage(name)
        .task {
            failed = false
            collection = try? await model.catalog?.collection(collectionID)
            failed = collection == nil && !Task.isCancelled
        }
    }
}

extension AppModel {
    /// The order the viewer arranged their watchlist in, kept on this device and laid over the tracker's list.
    var watchlistOrder: [MediaKey] {
        get { (UserDefaults.standard.stringArray(forKey: "flow.watchlistOrder") ?? []).compactMap(MediaKey.init(string:)) }
        set { UserDefaults.standard.set(newValue.map(\.description), forKey: "flow.watchlistOrder") }
    }
}

#if os(iOS) && compiler(>=6.4)
/// iOS 27: the watchlist's posters can be lifted and dropped into a new place.
@available(iOS 27.0, *)
private struct ReorderableWatchlistGrid: View {
    @Binding var items: [MediaItem]
    /// The keys being moved, and the one they land before (nil for the end).
    let onMove: ([MediaKey], MediaKey?) -> Void

    var body: some View {
        LazyVGrid(columns: PosterGrid.columns, spacing: 22) {
            ForEach(items) { item in
                PosterFilmCard(item: item, context: "watchlist", width: nil)
            }
            .reorderable()
        }
        .padding(.horizontal, Theme.Space.gutter)
        .reorderContainer(for: MediaItem.self) { difference in
            let moving = difference.sources.compactMap(MediaKey.init(string:))
            switch difference.destination.position {
            case .before(let id): onMove(moving, MediaKey(string: id))
            case .end: onMove(moving, nil)
            }
        }
    }
}
#endif
