import SwiftUI
import FlowKit

struct SectionHeader<Destination: Hashable>: View {
    let title: String
    var destination: Destination?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            if let destination {
                NavigationLink(value: destination) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(title)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13 * Theme.scale, weight: .bold))
                            .foregroundStyle(Theme.Palette.textTertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                Text(title)
            }
            Spacer(minLength: 0)
        }
        .font(Theme.Typeface.sectionTitle)
        .foregroundStyle(Theme.Palette.text)
        .displayTracking()
        .padding(.horizontal, Theme.Space.gutter)
        .accessibilityAddTraits(.isHeader)
    }
}

extension SectionHeader where Destination == Route {
    init(_ title: String, route: Route? = nil) {
        self.title = title
        self.destination = route
    }
}

/// Horizontally scrolling row of posters that snaps to cards.
struct PosterRow: View {
    let items: [MediaItem]
    var context: String = "row"
    var libraryProviderID: String?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                ForEach(items) { item in PosterCard(item: item, context: context, libraryProviderID: libraryProviderID) }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Platform.isTV ? 36 : 6)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollClipDisabled()
        .pagingArrows(ids: items.map(\.id), itemWidth: Platform.posterWidth + 14)
    }
}

extension View {
    /// On the Mac, glass chevrons appear at a row's edges on hover and page it sideways,
    /// so a mouse without a horizontal wheel can still browse. Elsewhere this does nothing.
    @ViewBuilder
    func pagingArrows<ID: Hashable>(ids: [ID], itemWidth: CGFloat) -> some View {
        #if os(macOS)
        modifier(PagingArrows(ids: ids, itemWidth: itemWidth))
        #else
        self
        #endif
    }
}

#if os(macOS)
private struct PagingArrows<ID: Hashable>: ViewModifier {
    let ids: [ID]
    let itemWidth: CGFloat
    @State private var position: ID?
    @State private var hovering = false
    @State private var width: CGFloat = 0

    private var index: Int { position.flatMap { ids.firstIndex(of: $0) } ?? 0 }
    private var pageSize: Int { max(1, Int(width / max(itemWidth, 1)) - 1) }
    private var fitsOnScreen: Bool { CGFloat(ids.count) * itemWidth <= width }

    func body(content: Content) -> some View {
        content
            .scrollPosition(id: $position, anchor: .leading)
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { width = proxy.size.width }
                    .onChange(of: proxy.size.width) { _, new in width = new }
            })
            .overlay(alignment: .leading) {
                if hovering && index > 0 { arrow("chevron.left") { page(-1) }.padding(.leading, 10) }
            }
            .overlay(alignment: .trailing) {
                if hovering && !fitsOnScreen && index + pageSize < ids.count { arrow("chevron.right") { page(1) }.padding(.trailing, 10) }
            }
            .onHover { inside in withAnimation(Theme.Motion.fade) { hovering = inside } }
    }

    private func arrow(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.Palette.text)
                .frame(width: 36, height: 36)
                .flowGlass(Circle(), interactive: true)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(symbol == "chevron.left" ? "Previous Page" : "Next Page")
        .transition(.opacity)
    }

    private func page(_ direction: Int) {
        guard !ids.isEmpty else { return }
        let target = min(max(0, index + direction * pageSize), ids.count - 1)
        withAnimation(Theme.Motion.gentle) { position = ids[target] }
    }
}
#endif

/// A configured home/library shelf that loads its own content.
struct ShelfView: View {
    let shelf: ShelfConfig
    /// True in the Library tab, where a media server library's titles remember the server they were opened from.
    var inLibraryTab = false
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var loaded = false
    /// Replaces the configured title when the row names its seed ("Because You Watched Dune").
    @State private var title: String?

    var body: some View {
        Group {
            if case .builtIn(let b) = shelf.source, b == .continueWatching || b == .nextUp {
                ContinueWatchingShelf(title: shelf.title, nextUpOnly: b == .nextUp)
            } else if case .builtIn(.upcomingEpisodes) = shelf.source {
                UpcomingShelf(shelf: shelf)
            } else if case .builtIn(.streamingServices) = shelf.source {
                StreamingServicesShelf(shelf: shelf)
            } else if case .builtIn(.genres) = shelf.source {
                GenresShelf(shelf: shelf)
            } else if !items.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader(title ?? shelf.title, route: .shelf(shelf))
                    PosterRow(items: items, context: shelf.id, libraryProviderID: libraryProviderID)
                }
                .transition(.opacity)
            } else if !loaded {
                ShelfPlaceholder(title: shelf.title)
            }
        }
        .animation(Theme.Motion.fade, value: items.isEmpty)
        .task(id: "\(shelf.id)-\(reloadKey)") { await load() }
    }

    /// What this row's contents depend on. Catalogue rows (trending, popular, Discover) don't change
    /// when you mark something watched, so they don't reload with every library change.
    private var reloadKey: String {
        // Language and region change what TMDb returns, so they reload catalogue rows too.
        var filters = "\(model.settings.general.contentShelfLength)-\(model.settings.metadata.showUnreleasedTitles)-\(model.settings.metadata.language)-\(model.settings.metadata.region)"
        // Filtering to your servers depends on their index, which refreshes with the library.
        if model.settings.mediaServers.onlyShowServerContent { filters += "-\(model.contentVersion)" }
        switch shelf.source {
        case .builtIn(let builtIn) where builtIn.isContentShelf && builtIn != .recommendedForYou && builtIn != .becauseYouWatched:
            return filters
        case .discover:
            return filters
        default:
            return "\(filters)-\(model.contentVersion)"
        }
    }

    private var libraryProviderID: String? {
        if inLibraryTab, case .mediaServerLibrary(let serverID, _) = shelf.source { return serverID }
        return nil
    }

    private func load() async {
        // Upcoming loads its own dated entries, and folder rows their own tiles.
        if case .builtIn(.upcomingEpisodes) = shelf.source { return }
        if case .builtIn(let builtIn) = shelf.source, builtIn.isFolder { return }
        if case .builtIn(.becauseYouWatched) = shelf.source, let seed = model.becauseYouWatchedSeed,
           let source = await model.hydrate([seed]).first {
            title = "Because You Watched \(source.title)"
        }
        // Unchanged contents leave the row alone, so a reload never re-renders it.
        if let loadedItems = try? await model.shelfItems(for: shelf), loadedItems != items { items = loadedItems }
        loaded = true
    }
}

/// The next episodes (and, optionally, premieres and films) arriving soon, each with its date.
struct UpcomingShelf: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var entries: [UpcomingEntry] = []

    var body: some View {
        Group {
            if !entries.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader(shelf.title, route: .shelf(shelf))
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                            ForEach(entries) { entry in UpcomingCard(entry: entry, context: shelf.id) }
                        }
                        .padding(.horizontal, Theme.Space.gutter)
                        .padding(.vertical, Platform.isTV ? 36 : 6)
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.viewAligned)
                    .scrollClipDisabled()
                    .pagingArrows(ids: entries.map(\.id), itemWidth: Platform.posterWidth + 14)
                }
                .transition(.opacity)
            }
        }
        .animation(Theme.Motion.fade, value: entries.isEmpty)
        .task(id: "\(model.contentVersion)-\(model.settings.general.upcomingWithinDays)-\(model.settings.general.includeWatchlistPremieres)-\(model.settings.general.filmDates.rawValue)") {
            entries = await model.upcoming()
        }
    }
}

/// One server's libraries as cards with the server's own cover art, titled with the server's name.
struct ServerLibrariesShelf: View {
    let server: MediaServerConfig
    @Environment(AppModel.self) private var model
    @State private var libraries: [AppModel.ServerLibrary] = []

    var body: some View {
        Group {
            if !libraries.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader<Route>(server.name)
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                            ForEach(libraries) { entry in
                                ServerLibraryCard(entry: entry)
                            }
                        }
                        .padding(.horizontal, Theme.Space.gutter)
                        .padding(.vertical, Platform.isTV ? 36 : 6)
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.viewAligned)
                    .scrollClipDisabled()
                    .pagingArrows(ids: libraries.map(\.id), itemWidth: Platform.landscapeWidth + 14)
                }
                .transition(.opacity)
            }
        }
        .animation(Theme.Motion.fade, value: libraries.isEmpty)
        .task(id: "\(server.id)-\(model.contentVersion)") {
            libraries = await model.serverLibraries(for: server.id)
        }
    }
}

private struct ServerLibraryCard: View {
    let entry: AppModel.ServerLibrary

    private var width: CGFloat { Platform.landscapeWidth }
    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous) }

    var body: some View {
        NavigationLink(value: Route.shelf(entry.shelf)) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ZStack(alignment: .bottomLeading) {
                    RemoteImage(url: entry.library.imageURL, maxPixel: Platform.isTV ? 1000 : 700, fallbackTitle: entry.library.name)
                        .frame(width: width, height: width * 9 / 16)
                    // Without cover art the generated poster already carries the name.
                    if entry.library.imageURL != nil {
                        LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                        Text(entry.library.name)
                            .font(.system(.subheadline, weight: .bold))
                            .lineLimit(1)
                            .padding(Theme.Space.s)
                    }
                }
                .frame(width: width, height: width * 9 / 16)
                .clipShape(shape)
                .hairline(shape)
                .artworkShadow(0.5)
            }
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel("\(entry.library.name), \(entry.server.name)")
    }
}

struct ShelfPlaceholder: View {
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>(title).foregroundStyle(Theme.Palette.textTertiary)
            HStack(spacing: Platform.isTV ? 44 : 14) {
                ForEach(0..<8, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Theme.Radius.poster, style: .continuous)
                        .fill(Theme.Palette.surface)
                        .frame(width: Platform.posterWidth, height: Platform.posterWidth * 1.5)
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
            .shimmering()
        }
        .accessibilityHidden(true)
    }
}

struct ContinueWatchingShelf: View {
    let title: String
    var nextUpOnly = false
    @Environment(AppModel.self) private var model
    @State private var items: [MediaKey: MediaItem] = [:]

    /// Most recent first, so a limit keeps the latest.
    private var entries: [ContinueWatchingBuilder.Entry] {
        let all = nextUpOnly ? model.continueWatching.filter(\.isNextUp) : model.continueWatching
        guard let limit = model.settings.general.continueWatchingLimit else { return all }
        return Array(all.prefix(limit))
    }

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHeader(title, route: .library(.continueWatching))
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                        ForEach(entries) { entry in
                            if let item = items[entry.key] {
                                ContinueWatchingCard(entry: entry, item: item)
                            }
                        }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.vertical, Platform.isTV ? 36 : 6)
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollClipDisabled()
                .pagingArrows(ids: entries.map(\.id), itemWidth: Platform.landscapeWidth + 14)
            }
            .task(id: entries.map(\.id)) {
                let hydrated = await model.hydrate(entries.map(\.key))
                var map = items
                for item in hydrated { if let key = item.key { map[key] = item } }
                // Coming back to the page re-runs this; unchanged titles shouldn't redraw the row.
                guard map != items else { return }
                withAnimation(Theme.Motion.fade) { items = map }
            }
        }
    }
}

/// "★ 7.3 · 2026 · Horror, Science Fiction · 18A · Movie"
struct MetadataLine: View {
    let item: MediaItem
    var certification: String?
    var showType = false
    var showRating = true

    var body: some View {
        // Two genres when there's room, then one, then none: never "Science Fiction,…".
        ViewThatFits(in: .horizontal) {
            row(genres: 2)
            row(genres: 1)
            row(genres: 0)
        }
        .font(.system(.subheadline).monospacedDigit())
        .foregroundStyle(Theme.Palette.textSecondary)
        .lineLimit(1)
    }

    /// Plain words in one line: no star, no outlined rating, no type pill.
    private func row(genres count: Int) -> some View {
        var parts: [String] = []
        if showRating, let vote = item.voteAverage, vote > 0 { parts.append("TMDB " + String(format: "%.1f", vote)) }
        if let year = item.year { parts.append(String(year)) }
        if let runtime = item.runtimeMinutes, runtime > 0, !showType { parts.append(Reel.duration(minutes: runtime)) }
        let genres = item.genres.prefix(count).map(\.name).joined(separator: ", ")
        if !genres.isEmpty { parts.append(genres) }
        if let certification, !certification.isEmpty { parts.append(certification) }
        if showType { parts.append(item.type == .movie ? "Movie" : "Series") }
        // Measured at full width so ViewThatFits can tell; the last choice may still truncate if it must.
        return Text(parts.joined(separator: " · "))
            .fixedSize(horizontal: count > 0, vertical: false)
    }
}

/// Grid of posters with optional infinite scrolling.
struct PosterGrid: View {
    let items: [MediaItem]
    var context: String = "grid"
    var onReachEnd: (() -> Void)?

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: Platform.posterWidth, maximum: Platform.posterWidth * 1.35), spacing: Platform.isTV ? 44 : 14, alignment: .top)],
                  spacing: Platform.isTV ? 56 : 22) {
            ForEach(items) { item in
                PosterCardFlexible(item: item, context: context)
                    .onAppear { if item.id == items.last?.id { onReachEnd?() } }
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
    }
}

/// Poster that fills its grid cell width.
struct PosterCardFlexible: View {
    let item: MediaItem
    var context: String = "grid"

    var body: some View {
        NavigationLink(value: Route.detail(item, zoom: "\(context)-\(item.id)")) {
            PosterCardContent(item: item, width: nil, zoomID: "\(context)-\(item.id)")
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { MediaContextMenu(item: item) } preview: { PosterPreview(item: item) }
    }
}

struct ToastView: View {
    let message: String
    var body: some View {
        Text(message)
            .font(.system(.subheadline, weight: .semibold))
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .foregroundStyle(Theme.Palette.text)
            .flowGlass(Capsule(), tint: Theme.Palette.panel)
            .overlay(Capsule().strokeBorder(Theme.Palette.lineStrong, lineWidth: 1))
            .transition(.move(edge: .top).combined(with: .opacity))
    }
}

struct MissingKeyView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        ContentUnavailableView {
            Label("Add a TMDB API key", systemImage: "key.fill")
        } description: {
            Text("Flow uses TMDB for posters, details and discovery. Add your free key in Settings → Metadata.")
        } actions: {
            Button("Open Settings") { model.showSettings = true }.buttonStyle(PrimaryButtonStyle())
        }
    }
}

extension View {
    /// Reports whether the user is touching a scroll view (iOS 18+), to pause auto-advance.
    @ViewBuilder
    func onScrollPhaseChangeIfAvailable(_ action: @escaping (Bool) -> Void) -> some View {
        if #available(iOS 18.0, macOS 15.0, tvOS 18.0, *) {
            onScrollPhaseChange { _, phase in action(phase != .idle) }
        } else {
            self
        }
    }
}

/// Lays children out left to right, starting a new line when the next one doesn't fit.
/// Lines are centred or leading-aligned.
struct WrappingRow: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6
    var centered = false

    private func lines(_ subviews: Subviews, width: CGFloat) -> [[(index: Int, size: CGSize)]] {
        var lines: [[(index: Int, size: CGSize)]] = [[]]
        var x: CGFloat = 0
        for (i, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            if !lines[lines.count - 1].isEmpty, x + spacing + size.width > width {
                lines.append([])
                x = 0
            }
            x += (lines[lines.count - 1].isEmpty ? 0 : spacing) + size.width
            lines[lines.count - 1].append((i, size))
        }
        return lines
    }

    private func width(of line: [(index: Int, size: CGSize)]) -> CGFloat {
        line.reduce(0) { $0 + $1.size.width } + spacing * CGFloat(max(0, line.count - 1))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let available = proposal.width ?? .infinity
        let rows = lines(subviews, width: available)
        let height = rows.reduce(0) { $0 + ($1.map(\.size.height).max() ?? 0) } + lineSpacing * CGFloat(max(0, rows.count - 1))
        let widest = rows.map(width(of:)).max() ?? 0
        return CGSize(width: proposal.width.map { min($0, widest) } ?? widest, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for line in lines(subviews, width: bounds.width) {
            let lineHeight = line.map(\.size.height).max() ?? 0
            var x = centered ? bounds.minX + (bounds.width - width(of: line)) / 2 : bounds.minX
            for item in line {
                subviews[item.index].place(at: CGPoint(x: x, y: y + (lineHeight - item.size.height) / 2), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += lineHeight + lineSpacing
        }
    }
}
