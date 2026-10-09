import SwiftUI
import FlowKit

struct SectionHeader<Destination: Hashable>: View {
    let title: String
    var destination: Destination?

    var body: some View {
        HStack {
            if let destination {
                NavigationLink(value: destination) {
                    HStack(spacing: 6) {
                        Text(title)
                        Image(systemName: "chevron.right").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            } else {
                Text(title)
            }
            Spacer()
        }
        .font(Platform.isTV ? .title3.weight(.bold) : .title2.weight(.bold))
        .padding(.horizontal, Platform.horizontalPadding)
    }
}

extension SectionHeader where Destination == Route {
    init(_ title: String, route: Route? = nil) {
        self.title = title
        self.destination = route
    }
}

/// Horizontally scrolling row of posters.
struct PosterRow: View {
    let items: [MediaItem]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: Platform.isTV ? 40 : 14) {
                ForEach(items) { item in PosterCard(item: item) }
            }
            .padding(.horizontal, Platform.horizontalPadding)
            .padding(.vertical, Platform.isTV ? 30 : 0)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        #if os(tvOS)
        .scrollClipDisabled()
        #endif
    }
}

/// A configured home/library shelf that loads its own content.
struct ShelfView: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        Group {
            if case .builtIn(let b) = shelf.source, b == .continueWatching || b == .nextUp {
                ContinueWatchingShelf(title: shelf.title, nextUpOnly: b == .nextUp)
            } else if !items.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(shelf.title, route: .shelf(shelf))
                    PosterRow(items: items)
                }
            } else if !loaded {
                ShelfPlaceholder(title: shelf.title)
            }
        }
        .task(id: "\(shelf.id)-\(model.contentVersion)") { await load() }
    }

    private func load() async {
        do {
            items = try await model.page(for: shelf).items
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

struct ShelfPlaceholder: View {
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader<Route>(title)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(0..<6, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 10).fill(.white.opacity(0.06))
                            .frame(width: Platform.posterWidth, height: Platform.posterWidth * 1.5)
                    }
                }
                .padding(.horizontal, Platform.horizontalPadding)
            }
            .disabled(true)
        }
        .redacted(reason: .placeholder)
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
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title, route: .library(.continueWatching))
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Platform.isTV ? 40 : 14) {
                        ForEach(entries) { entry in
                            if let item = items[entry.key] {
                                ContinueWatchingCard(entry: entry, item: item)
                            }
                        }
                    }
                    .padding(.horizontal, Platform.horizontalPadding)
                    .padding(.vertical, Platform.isTV ? 30 : 0)
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                #if os(tvOS)
                .scrollClipDisabled()
                #endif
            }
            .task(id: entries.map(\.id)) {
                let hydrated = await model.hydrate(entries.map(\.key))
                var map = items
                for item in hydrated { if let key = item.key { map[key] = item } }
                items = map
            }
        }
    }
}

/// Full-screen paged hero with backdrop/poster, logo, metadata and paging dots.
struct HeroCarousel: View {
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var logos: [String: String] = [:]
    @State private var certifications: [String: String] = [:]
    @State private var current: String?

    var body: some View {
        VStack(spacing: 14) {
            if items.isEmpty {
                RoundedRectangle(cornerRadius: 24).fill(.white.opacity(0.05))
                    .frame(height: heroHeight)
                    .padding(.horizontal, Platform.isPhone ? 12 : Platform.horizontalPadding)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 0) {
                        ForEach(items) { item in
                            NavigationLink(value: Route.detail(item)) {
                                HeroCard(item: item, logoPath: logos[item.id], certification: certifications[item.id], height: heroHeight)
                                    .padding(.horizontal, Platform.isPhone ? 12 : Platform.horizontalPadding)
                            }
                            .buttonStyle(CardButtonStyle())
                            .containerRelativeFrame(.horizontal)
                            .id(item.id)
                            .task { await loadExtras(item) }
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollPosition(id: $current)
                .frame(height: heroHeight)
                PageDots(count: items.count, index: items.firstIndex { $0.id == current } ?? 0)
            }
        }
        .task(id: model.contentVersion) {
            items = await model.heroItems()
            if current == nil { current = items.first?.id }
        }
        .task(id: items.count) { await autoAdvance() }
    }

    private var heroHeight: CGFloat {
        #if os(tvOS)
        760
        #elseif os(macOS)
        460
        #else
        Platform.isPhone ? 560 : 520
        #endif
    }

    private func loadExtras(_ item: MediaItem) async {
        guard logos[item.id] == nil, let catalog = model.catalog else { return }
        if let detail = try? await catalog.details(item.type, id: item.ids.tmdb ?? 0) {
            logos[item.id] = detail.item.logoPath ?? ""
            certifications[item.id] = detail.item.certification ?? ""
        }
    }

    private func autoAdvance() async {
        guard model.settings.general.heroAutoAdvance, items.count > 1 else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 7_000_000_000)
            guard !Task.isCancelled else { return }
            let index = items.firstIndex { $0.id == current } ?? 0
            withAnimation(.easeInOut(duration: 0.6)) { current = items[(index + 1) % items.count].id }
        }
    }
}

struct HeroCard: View {
    let item: MediaItem
    let logoPath: String?
    let certification: String?
    let height: CGFloat

    var body: some View {
        ZStack(alignment: .bottom) {
            RemoteImage(url: Platform.isPhone ? TMDBImage.url(item.posterPath, size: .posterLarge) : item.backdropURL)
                .frame(height: height)
                .frame(maxWidth: .infinity)
                .clipped()
            LinearGradient(colors: [.clear, .clear, .black.opacity(0.55), .black.opacity(0.9)], startPoint: .top, endPoint: .bottom)
            VStack(spacing: 12) {
                LogoOrTitle(logoPath: logoPath?.nonEmpty, title: item.title, maxHeight: Platform.isTV ? 160 : 96)
                    .frame(maxWidth: Platform.isPhone ? 300 : 460)
                MetadataLine(item: item, certification: certification?.nonEmpty, showType: true)
                if let overview = item.overview, !overview.isEmpty {
                    Text(overview)
                        .font(Platform.isTV ? .body : .footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 640)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 26)
        }
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: Platform.isPhone ? 28 : 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Platform.isPhone ? 28 : 22, style: .continuous).stroke(.white.opacity(0.08)))
    }
}

/// "★ 7.3 • 2026 • Horror, Science Fiction • [18A] • Movie"
struct MetadataLine: View {
    let item: MediaItem
    var certification: String?
    var showType = false
    var showRating = true

    var body: some View {
        HStack(spacing: 8) {
            if showRating, let vote = item.voteAverage, vote > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "star.fill").foregroundStyle(.yellow)
                    Text(String(format: "%.1f", vote))
                }
                dot
            }
            if let year = item.year { Text(String(year)); dot }
            if let runtime = item.runtimeMinutes, runtime > 0, !showType { Text(TimeFormat.runtime(runtime)); dot }
            if !item.genreLine.isEmpty { Text(item.genreLine).lineLimit(1) }
            if let certification {
                dot
                Text(certification)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(.primary.opacity(0.7), lineWidth: 1))
            }
            if showType {
                dot
                Text(item.type == .movie ? "Movie" : "Series")
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.white.opacity(0.15), in: Capsule())
            }
        }
        .font(Platform.isTV ? .callout : .subheadline)
        .foregroundStyle(.primary.opacity(0.85))
    }

    private var dot: some View { Text("•").foregroundStyle(.secondary) }
}

struct PageDots: View {
    let count: Int
    let index: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(i == index ? Color.white : Color.white.opacity(0.35))
                    .frame(width: i == index ? 22 : 7, height: 7)
            }
        }
        .animation(.easeInOut, value: index)
    }
}

/// Grid of posters with optional infinite scrolling.
struct PosterGrid: View {
    let items: [MediaItem]
    var onReachEnd: (() -> Void)?

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: Platform.posterWidth, maximum: Platform.posterWidth * 1.4), spacing: Platform.isTV ? 40 : 14, alignment: .top)],
                  spacing: Platform.isTV ? 50 : 20) {
            ForEach(items) { item in
                PosterCardFlexible(item: item)
                    .onAppear { if item.id == items.last?.id { onReachEnd?() } }
            }
        }
        .padding(.horizontal, Platform.horizontalPadding)
    }
}

/// Poster that fills its grid cell width.
struct PosterCardFlexible: View {
    let item: MediaItem
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationLink(value: Route.detail(item)) {
            VStack(alignment: .leading, spacing: 8) {
                Color.clear
                    .aspectRatio(2 / 3, contentMode: .fit)
                    .overlay(RemoteImage(url: item.posterURL))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(alignment: .bottomTrailing) {
                        if model.settings.general.showWatchedBadges && model.isWatched(item) { WatchedCheck().padding(8) }
                    }
                    .overlay(alignment: .topTrailing) {
                        if model.settings.mediaServers.showBadgeOnPosters && model.isOnServer(item) {
                            Image(systemName: "server.rack").font(.system(size: 10, weight: .bold)).padding(5)
                                .background(.black.opacity(0.65), in: Circle()).padding(6)
                        }
                    }
                if model.settings.general.showPosterTitles {
                    Text(item.title).font(.subheadline).lineLimit(1).foregroundStyle(.primary)
                }
            }
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { MediaContextMenu(item: item) }
    }
}

struct ToastView: View {
    let message: String
    var body: some View {
        Text(message)
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(.regularMaterial, in: Capsule())
            .shadow(radius: 10)
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
