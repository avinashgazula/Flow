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
}

/// A tile is a ruled picture with its name set under it, as every card is; nothing is drawn over the artwork.
private struct FolderTileLabel: View {
    let name: String

    var body: some View {
        Text(name)
            .font(Theme.Typeface.cardTitle)
            .foregroundStyle(Theme.Palette.fg)
            .lineLimit(1)
            .frame(width: FolderTile.width, alignment: .leading)
    }
}

private struct ServiceTile: View {
    let service: StreamingService
    let region: String

    private var logoURL: URL? { TMDBImage.url(service.logoPath, size: .posterSmall) }
    private var logoSize: CGFloat { FolderTile.height * 0.5 }

    var body: some View {
        NavigationLink(value: Route.shelf(shelf)) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ZStack {
                    if logoURL != nil {
                        Theme.Palette.tint1
                        RemoteImage(url: logoURL, maxPixel: 200)
                            .frame(width: logoSize, height: logoSize)
                            .clipped()
                    } else {
                        // No logo to show: the generated poster already carries the name.
                        GeneratedArtwork(title: service.name)
                    }
                }
                .frame(width: FolderTile.width, height: FolderTile.height)
                .clipped()
                .cardFrame()
                FolderTileLabel(name: service.name)
            }
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
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

    var body: some View {
        NavigationLink(value: Route.shelf(shelf)) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ZStack {
                    Theme.Palette.tint2
                    if artworkURL != nil {
                        RemoteImage(url: artworkURL, maxPixel: Platform.isTV ? 1000 : 700)
                    }
                }
                .frame(width: FolderTile.width, height: FolderTile.height)
                .clipped()
                .cardFrame()
                FolderTileLabel(name: genre.name)
            }
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .accessibilityLabel(genre.name)
    }

    private var shelf: ShelfConfig {
        ShelfConfig(id: "genre-\(genre.id)", title: genre.name, source: .discover(genre.query))
    }
}
