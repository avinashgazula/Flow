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

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                ForEach(items) { item in PosterCard(item: item, context: context) }
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
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .flowGlass(Circle(), interactive: true)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
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
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var loaded = false
    /// Replaces the configured title when the row names its seed ("Because You Watched Dune").
    @State private var title: String?

    var body: some View {
        Group {
            if case .builtIn(let b) = shelf.source, b == .continueWatching || b == .nextUp {
                ContinueWatchingShelf(title: shelf.title, nextUpOnly: b == .nextUp)
            } else if !items.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader(title ?? shelf.title, route: .shelf(shelf))
                    PosterRow(items: items, context: shelf.id)
                }
                .transition(.opacity)
            } else if !loaded {
                ShelfPlaceholder(title: shelf.title)
            }
        }
        .animation(Theme.Motion.fade, value: items.isEmpty)
        .task(id: "\(shelf.id)-\(model.contentVersion)") { await load() }
    }

    private func load() async {
        if case .builtIn(.becauseYouWatched) = shelf.source, let seed = model.becauseYouWatchedSeed,
           let source = await model.hydrate([seed]).first {
            title = "Because You Watched \(source.title)"
        }
        if let page = try? await model.page(for: shelf) { items = page.items }
        loaded = true
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

    private var entries: [ContinueWatchingBuilder.Entry] {
        nextUpOnly ? model.continueWatching.filter(\.isNextUp) : model.continueWatching
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
                withAnimation(Theme.Motion.fade) { items = map }
            }
        }
    }
}

// MARK: - Hero

/// Paged, full-bleed hero. Reports the visible title so Home can tint itself with its artwork.
struct HeroCarousel: View {
    @Binding var current: MediaItem?
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var details: [String: MediaItem] = [:]
    @State private var currentID: String?
    @State private var interacting = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if items.isEmpty {
                Rectangle().fill(Theme.Palette.surface)
                    .frame(height: height)
                    .shimmering()
            } else {
                ZStack(alignment: Platform.isPhone ? .bottom : .bottomTrailing) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 0) {
                            ForEach(items) { item in
                                HeroPage(item: details[item.id] ?? item, height: height)
                                    .containerRelativeFrame(.horizontal)
                                    .id(item.id)
                                    .task { await loadDetail(item) }
                            }
                        }
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.paging)
                    .scrollPosition(id: $currentID)
                    .onScrollPhaseChangeIfAvailable { interacting = $0 }
                    PageDots(count: items.count, index: items.firstIndex { $0.id == currentID } ?? 0)
                        .padding(.bottom, Platform.isPhone ? 14 : Theme.Space.l)
                        .padding(.trailing, Platform.isPhone ? 0 : Theme.Space.gutter)
                }
                .frame(height: height)
            }
        }
        .visualEffect { content, proxy in
            // Stretch when pulled down; drift slower than the page when scrolled up.
            let y = proxy.frame(in: .scrollView(axis: .vertical)).minY
            return content
                .scaleEffect(y > 0 ? 1 + y / max(proxy.size.height, 1) : 1, anchor: .bottom)
                .offset(y: y < 0 ? -y * 0.35 : 0)
        }
        .task(id: model.contentVersion) {
            let loaded = await model.heroItems()
            withAnimation(Theme.Motion.fade) { items = loaded }
            if currentID == nil || !loaded.contains(where: { $0.id == currentID }) { currentID = loaded.first?.id }
        }
        .task(id: items.count) { await autoAdvance() }
        .onChange(of: currentID) { _, id in current = items.first { $0.id == id } }
    }

    private var height: CGFloat {
        #if os(tvOS)
        880
        #elseif os(macOS)
        560
        #else
        Platform.isPhone ? 620 : 600
        #endif
    }

    private func loadDetail(_ item: MediaItem) async {
        guard details[item.id] == nil, let catalog = model.catalog, let id = item.ids.tmdb,
              let detail = try? await catalog.details(item.type, id: id) else { return }
        details[item.id] = detail.item
    }

    private func autoAdvance() async {
        guard model.settings.general.heroAutoAdvance, !reduceMotion, items.count > 1 else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled, !interacting else { continue }
            let index = items.firstIndex { $0.id == currentID } ?? 0
            withAnimation(Theme.Motion.gentle) { currentID = items[(index + 1) % items.count].id }
        }
    }
}

private struct HeroPage: View {
    let item: MediaItem
    let height: CGFloat
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack(alignment: Platform.isPhone ? .bottom : .bottomLeading) {
            Button { model.navigate(to: .detail(item)) } label: {
                RemoteImage(url: artworkURL, maxPixel: Platform.isPhone ? 900 : 1920, fallbackTitle: item.title)
                    .frame(height: height)
                    .frame(maxWidth: .infinity)
                    .clipped()
            }
            .buttonStyle(.plain)
            #if os(tvOS)
            .focusable(false)
            #endif
            .accessibilityLabel("\(item.title), details")

            scrim.allowsHitTesting(false)

            VStack(alignment: Platform.isPhone ? .center : .leading, spacing: Theme.Space.s) {
                LogoOrTitle(logoPath: item.logoPath, title: item.title, maxHeight: Platform.isTV ? 170 : (Platform.isPhone ? 96 : 120),
                            alignment: Platform.isPhone ? .center : .leading)
                    .frame(maxWidth: Platform.isPhone ? 300 : 480, alignment: Platform.isPhone ? .center : .leading)
                MetadataLine(item: item, certification: item.certification, showType: true)
                if !Platform.isPhone, let overview = item.overview, !overview.isEmpty {
                    Text(overview)
                        .font(Theme.Typeface.body)
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(3)
                        .frame(maxWidth: 560 * Theme.scale, alignment: .leading)
                }
                HeroActions(item: item)
                    .padding(.top, Theme.Space.xs)
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.bottom, Platform.isPhone ? 44 : Theme.Space.xxl)
        }
        .frame(height: height)
    }

    private var artworkURL: URL? {
        Platform.isPhone ? TMDBImage.url(item.heroPosterPath, size: .original) : TMDBImage.url(item.backdropPath, size: .original)
    }

    private var scrim: some View {
        ZStack {
            LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: .black.opacity(0.55), location: 0.7), .init(color: .black, location: 1)],
                           startPoint: .top, endPoint: .bottom)
            if !Platform.isPhone {
                LinearGradient(colors: [.black.opacity(0.75), .black.opacity(0.2), .clear], startPoint: .leading, endPoint: .trailing)
            }
            // Keeps the status bar legible over bright posters.
            LinearGradient(colors: [.black.opacity(0.45), .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.18))
        }
    }
}

private struct HeroActions: View {
    let item: MediaItem
    @Environment(AppModel.self) private var model

    var body: some View {
        GlassGroup(spacing: 10) {
            HStack(spacing: 10) {
                Button { Task { await model.play(item) } } label: {
                    Label("Play", systemImage: "play.fill").labelStyle(.titleAndIcon)
                        .frame(minWidth: Platform.isPhone ? 150 : 140)
                }
                .buttonStyle(PrimaryButtonStyle())
                Button { Task { await model.toggleWatchlist(item) } } label: {
                    Image(systemName: model.isWatchlisted(item) ? "checkmark" : "plus")
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(GlassButtonStyle(circle: true))
                .accessibilityLabel(model.isWatchlisted(item) ? "Remove from Watchlist" : "Add to Watchlist")
                Button { model.navigate(to: .detail(item)) } label: { Image(systemName: "info") }
                    .buttonStyle(GlassButtonStyle(circle: true))
                    .accessibilityLabel("Details")
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
        HStack(spacing: 7) {
            if showRating, let vote = item.voteAverage, vote > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "star.fill").foregroundStyle(Theme.Palette.gold).imageScale(.small)
                    Text(String(format: "%.1f", vote))
                }
                dot
            }
            if let year = item.year { Text(String(year)); dot }
            if let runtime = item.runtimeMinutes, runtime > 0, !showType { Text(TimeFormat.runtime(runtime)); dot }
            if !item.genreLine.isEmpty { Text(item.genreLine).lineLimit(1) }
            if let certification, !certification.isEmpty {
                Text(certification)
                    .font(.system(size: 11 * Theme.scale, weight: .bold))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(.white.opacity(0.6), lineWidth: 1))
            }
            if showType {
                Text(item.type == .movie ? "Movie" : "Series")
                    .font(.system(.caption2, weight: .semibold))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(.white.opacity(0.14), in: Capsule())
            }
        }
        .font(.system(.footnote, weight: .medium))
        .foregroundStyle(.white.opacity(0.85))
        .lineLimit(1)
    }

    private var dot: some View { Text("·").foregroundStyle(Theme.Palette.textTertiary) }
}

struct PageDots: View {
    let count: Int
    let index: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(i == index ? Color.white : Color.white.opacity(0.32))
                    .frame(width: i == index ? 18 : 6, height: 6)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .animation(Theme.Motion.snappy, value: index)
        .accessibilityElement()
        .accessibilityLabel("Page \(index + 1) of \(count)")
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
            PosterCardContent(item: item, width: nil)
        }
        .buttonStyle(CardButtonStyle())
        .zoomSource("\(context)-\(item.id)")
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
            .flowGlass(Capsule())
            .shadow(color: .black.opacity(0.3), radius: 16, y: 6)
            .transition(.move(edge: .top).combined(with: .opacity))
    }
}

struct MissingKeyView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        ContentUnavailableView {
            Label("Add a TMDb API key", systemImage: "key.fill")
        } description: {
            Text("Flow uses TMDb for posters, details and discovery. Add your free key in Settings → Metadata.")
        } actions: {
            Button("Open Settings") { model.showSettings = true }.buttonStyle(.borderedProminent)
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
