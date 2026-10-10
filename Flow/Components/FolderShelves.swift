import SwiftUI
import FlowKit

// Rows of tiles that open other shelves: where to watch, and what genre.

/// Streaming services as logo tiles; each opens what's popular on that service in the viewer's region.
struct StreamingServicesShelf: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var services: [StreamingService] = []

    var body: some View {
        Group {
            if !services.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader<Route>(shelf.title)
                    FolderRow(ids: services.map(\.id)) {
                        ForEach(services) { service in
                            ServiceTile(service: service, region: model.settings.metadata.region)
                        }
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(Theme.Motion.fade, value: services.isEmpty)
        .task(id: "\(model.settings.metadata.region)-\(model.contentVersion)") {
            services = await model.catalog?.streamingServices() ?? []
        }
    }
}

/// Genres as tiles over a backdrop from a popular title in each. Artwork loads after the row appears;
/// until then (and for genres with none) a gradient stands in.
struct GenresShelf: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var genres = GenreTile.featured
    @State private var artwork: [Int: URL] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>(shelf.title)
            FolderRow(ids: genres.map(\.id)) {
                ForEach(genres) { genre in GenreTileCard(genre: genre, artworkURL: artwork[genre.id]) }
            }
        }
        .task(id: model.contentVersion) { await loadArtwork() }
    }

    private func loadArtwork() async {
        guard let catalog = model.catalog else { return }
        let pages = await withTaskGroup(of: (Int, [MediaItem]?).self) { group in
            for genre in GenreTile.featured {
                group.addTask { (genre.id, try? await catalog.discover(genre.query).items) }
            }
            var all: [Int: [MediaItem]] = [:]
            for await (id, items) in group { if let items { all[id] = items } }
            return all
        }
        // A film that isn't out yet makes a poor face for a genre.
        let now = Date()
        var found: [Int: URL] = [:]
        for (id, items) in pages {
            let pick = items.first { $0.backdropPath != nil && ($0.releaseDate ?? .distantPast) <= now }
            if let url = pick?.smallBackdropURL { found[id] = url }
        }
        withAnimation(Theme.Motion.fade) {
            artwork = found
            // A genre that came back empty has nothing to open.
            genres = GenreTile.featured.filter { pages[$0.id]?.isEmpty != true }
        }
    }
}

/// The shared scrolling row, with the usual snapping and Mac paging arrows.
private struct FolderRow<ID: Hashable, Content: View>: View {
    let ids: [ID]
    let content: Content

    init(ids: [ID], @ViewBuilder content: () -> Content) {
        self.ids = ids
        self.content = content()
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                content
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Platform.isTV ? 36 : 6)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollClipDisabled()
        .pagingArrows(ids: ids, itemWidth: FolderTile.width + 14)
    }
}

private enum FolderTile {
    /// Landscape like the other cards, a little narrower so more of the row shows (about 180pt on iPhone).
    static var width: CGFloat { Platform.landscapeWidth * 0.76 }
    static var height: CGFloat { width * 9 / 16 }
    static var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous) }
}

private struct ServiceTile: View {
    let service: StreamingService
    let region: String

    private var logoURL: URL? { TMDBImage.url(service.logoPath, size: .posterSmall) }
    private var logoSize: CGFloat { FolderTile.height * 0.5 }

    var body: some View {
        NavigationLink(value: Route.shelf(shelf)) {
            ZStack {
                if logoURL != nil {
                    // The logo's own colour, blurred, behind the sharp logo.
                    RemoteImage(url: logoURL, maxPixel: 64)
                        .blur(radius: 30)
                        .saturation(1.3)
                        .opacity(0.55)
                        .scaleEffect(1.6)
                    Theme.Palette.surface.opacity(0.55)
                    VStack(spacing: Theme.Space.xs) {
                        RemoteImage(url: logoURL, maxPixel: 200)
                            .frame(width: logoSize, height: logoSize)
                            .clipShape(RoundedRectangle(cornerRadius: logoSize * 0.22, style: .continuous))
                            .shadow(color: .black.opacity(0.35), radius: 6, y: 3)
                        Text(service.name)
                            .font(.system(.caption, weight: .semibold))
                            .lineLimit(1)
                    }
                } else {
                    // No logo to show: the generated poster already carries the name.
                    GeneratedArtwork(title: service.name)
                }
            }
            .frame(width: FolderTile.width, height: FolderTile.height)
            .clipShape(FolderTile.shape)
            .hairline(FolderTile.shape)
            .artworkShadow(0.5)
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel(service.name)
    }

    /// The id is fixed per service and region so the pushed page keeps its identity across redraws.
    private var shelf: ShelfConfig {
        ShelfConfig(id: "service-\(service.id)-\(region)", title: service.name, source: .discover(service.query(region: region)))
    }
}

private struct GenreTileCard: View {
    let genre: GenreTile
    let artworkURL: URL?

    private var hue: Double { Double(genre.id % 97) / 97 }

    var body: some View {
        NavigationLink(value: Route.shelf(shelf)) {
            ZStack(alignment: .bottomLeading) {
                LinearGradient(colors: [Color(hue: hue, saturation: 0.55, brightness: 0.42), Color(hue: (hue + 0.08).truncatingRemainder(dividingBy: 1), saturation: 0.7, brightness: 0.16)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                if artworkURL != nil {
                    RemoteImage(url: artworkURL, maxPixel: Platform.isTV ? 1000 : 700)
                }
                LinearGradient(colors: [.black.opacity(0.1), .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                Text(genre.name)
                    .font(.system(.headline, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .shadow(color: .black.opacity(0.5), radius: 4)
                    .padding(Theme.Space.s)
            }
            .frame(width: FolderTile.width, height: FolderTile.height)
            .clipShape(FolderTile.shape)
            .hairline(FolderTile.shape)
            .artworkShadow(0.5)
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel(genre.name)
    }

    private var shelf: ShelfConfig {
        ShelfConfig(id: "genre-\(genre.id)", title: genre.name, source: .discover(genre.query))
    }
}
