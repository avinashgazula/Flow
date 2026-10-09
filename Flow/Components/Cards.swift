import SwiftUI
import FlowKit

/// Poster with progress, watched and media-server marks; zooms into the detail page on iOS 18+.
struct PosterCard: View {
    let item: MediaItem
    var width: CGFloat = Platform.posterWidth
    /// Distinguishes the same title appearing on several shelves, for the zoom transition.
    var context: String = "poster"
    @Environment(AppModel.self) private var model

    private var zoomID: String { "\(context)-\(item.id)" }

    var body: some View {
        NavigationLink(value: Route.detail(item, zoom: zoomID)) {
            PosterCardContent(item: item, width: width)
        }
        .buttonStyle(CardButtonStyle())
        .zoomSource(zoomID)
        .contextMenu { MediaContextMenu(item: item) } preview: { PosterPreview(item: item) }
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var parts = [item.title]
        if let year = item.year { parts.append(String(year)) }
        if model.isWatched(item) { parts.append("Watched") }
        return parts.joined(separator: ", ")
    }
}

struct PosterCardContent: View {
    let item: MediaItem
    var width: CGFloat?
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            PosterArtwork(item: item)
                .frame(width: width, height: width.map { $0 * 1.5 })
            if model.settings.general.showPosterTitles {
                Text(item.title)
                    .font(.system(.footnote, weight: .medium))
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(1)
                    .frame(width: width, alignment: .leading)
            }
        }
    }
}

/// The artwork block shared by shelves and grids.
struct PosterArtwork: View {
    let item: MediaItem
    @Environment(AppModel.self) private var model

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.poster, style: .continuous) }

    var body: some View {
        Color.clear
            .aspectRatio(2 / 3, contentMode: .fit)
            .overlay(RemoteImage(url: item.posterURL, maxPixel: Platform.isTV ? 600 : 420, fallbackTitle: item.title))
            .clipShape(shape)
            .hairline(shape)
            .overlay(alignment: .bottom) { progressBar }
            .overlay(alignment: .bottomTrailing) {
                if model.settings.general.showWatchedBadges && model.isWatched(item) {
                    WatchedCheck().padding(Theme.Space.xs)
                }
            }
            .overlay(alignment: .topTrailing) {
                if model.settings.mediaServers.showBadgeOnPosters && model.isOnServer(item) {
                    Image(systemName: "server.rack")
                        .font(.system(size: 9 * Theme.scale, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 22 * Theme.scale, height: 22 * Theme.scale)
                        .background(.black.opacity(0.55), in: Circle())
                        .overlay(Circle().strokeBorder(.white.opacity(0.15)))
                        .padding(Theme.Space.xs)
                }
            }
            .artworkShadow(0.55)
    }

    @ViewBuilder
    private var progressBar: some View {
        if item.type == .movie, let p = model.progress(for: item), p.percent > 1 {
            ProgressCapsule(value: p.percent / 100)
                .padding(.horizontal, Theme.Space.xs)
                .padding(.bottom, Theme.Space.xs)
        }
    }
}

/// Thin, rounded progress indicator used on artwork.
struct ProgressCapsule: View {
    let value: Double
    var height: CGFloat = 3 * Theme.scale

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.28))
                Capsule().fill(.white).frame(width: max(height, proxy.size.width * min(1, max(0, value))))
            }
        }
        .frame(height: height)
    }
}

struct WatchedCheck: View {
    var body: some View {
        Image(systemName: "checkmark")
            .font(.system(size: 11 * Theme.scale, weight: .heavy))
            .foregroundStyle(.black)
            .frame(width: 22 * Theme.scale, height: 22 * Theme.scale)
            .background(.white, in: Circle())
            .shadow(color: .black.opacity(0.4), radius: 4, y: 1)
            .accessibilityHidden(true)
    }
}

/// Long-press preview: the backdrop with title and overview.
struct PosterPreview: View {
    let item: MediaItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RemoteImage(url: item.smallBackdropURL ?? item.posterURL, maxPixel: 900, fallbackTitle: item.title)
                .frame(width: 320, height: 180)
                .clipped()
            VStack(alignment: .leading, spacing: 6) {
                Text(item.title).font(.headline)
                MetadataLine(item: item, showRating: true)
                if let overview = item.overview { Text(overview).font(.footnote).foregroundStyle(.secondary).lineLimit(4) }
            }
            .padding([.horizontal, .bottom], 14)
        }
        .frame(width: 320)
        .background(Theme.Palette.elevated)
    }
}

/// Wide card for Continue Watching: still/backdrop, progress and what's next.
struct ContinueWatchingCard: View {
    let entry: ContinueWatchingBuilder.Entry
    let item: MediaItem
    @Environment(AppModel.self) private var model

    private var width: CGFloat { Platform.landscapeWidth }
    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous) }

    var body: some View {
        Button {
            Task { await model.play(item, episode: nil) }
        } label: {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ZStack(alignment: .bottomLeading) {
                    RemoteImage(url: item.smallBackdropURL ?? item.posterURL, maxPixel: Platform.isTV ? 1000 : 700, fallbackTitle: item.title)
                        .frame(width: width, height: width * 9 / 16)
                    LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                    VStack(alignment: .leading, spacing: Theme.Space.xs) {
                        HStack(alignment: .lastTextBaseline) {
                            if let ep = entry.episode {
                                Text(ep.code)
                                    .font(.system(size: 12 * Theme.scale, weight: .bold).monospacedDigit())
                            }
                            Spacer()
                            if let badge = badgeText {
                                Text(badge)
                                    .font(.system(.caption2, weight: .semibold))
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(.black.opacity(0.5), in: Capsule())
                            }
                        }
                        if let p = entry.progress { ProgressCapsule(value: p.percent / 100) }
                    }
                    .padding(Theme.Space.s)
                    Image(systemName: "play.fill")
                        .font(.system(size: 15 * Theme.scale, weight: .bold))
                        .frame(width: 38 * Theme.scale, height: 38 * Theme.scale)
                        .flowGlass(Circle())
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .opacity(0.95)
                }
                .frame(width: width, height: width * 9 / 16)
                .clipShape(shape)
                .hairline(shape)
                .artworkShadow(0.5)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.system(.subheadline, weight: .semibold)).lineLimit(1)
                    Text(subtitle).font(.system(.caption)).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                }
                .frame(width: width, alignment: .leading)
            }
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu {
            Button { model.navigate(to: .detail(item)) } label: { Label("Go to Details", systemImage: "info.circle") }
            Button { Task { await model.setWatched(item, episodes: entry.episode.map { [$0] }, watched: true) } } label: {
                Label("Mark as Watched", systemImage: "checkmark.circle")
            }
            Button(role: .destructive) {
                Task { await model.removeFromContinueWatching(entry) }
            } label: { Label("Remove from Continue Watching", systemImage: "xmark.circle") }
        }
    }

    private var badgeText: String? {
        if let p = entry.progress {
            if let r = p.remainingSeconds { return TimeFormat.remaining(r) }
            if let runtime = item.runtimeMinutes { return TimeFormat.remaining(Double(runtime) * 60 * (1 - p.percent / 100)) }
            return "\(Int(p.percent))%"
        }
        return entry.isNextUp ? "Up Next" : nil
    }

    private var subtitle: String {
        if entry.episode != nil { return entry.isNextUp ? "Next episode" : "Resume episode" }
        return [item.year.map(String.init), item.genres.first?.name].compactMap { $0 }.joined(separator: " · ")
    }
}

/// Lifts cards on focus (tvOS) and compresses gently on press elsewhere.
struct CardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(FocusLift())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .brightness(configuration.isPressed ? -0.04 : 0)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
    }
}

/// tvOS focus effect for custom button styles: scale up and cast a shadow. No-op elsewhere.
struct FocusLift: ViewModifier {
    @Environment(\.isFocused) private var focused

    func body(content: Content) -> some View {
        #if os(tvOS)
        content
            .scaleEffect(focused ? 1.08 : 1)
            .shadow(color: .black.opacity(focused ? 0.55 : 0), radius: 24, y: 14)
            .brightness(focused ? 0.05 : 0)
            .animation(Theme.Motion.snappy, value: focused)
        #else
        content
        #endif
    }
}

struct MediaContextMenu: View {
    let item: MediaItem
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { Task { await model.play(item) } } label: { Label("Play", systemImage: "play.fill") }
        Button { Task { await model.toggleWatchlist(item) } } label: {
            Label(model.isWatchlisted(item) ? "Remove from Watchlist" : "Add to Watchlist", systemImage: model.isWatchlisted(item) ? "bookmark.slash" : "bookmark")
        }
        Button { Task { await model.setWatched(item, episodes: nil, watched: !model.isWatched(item)) } } label: {
            Label(model.isWatched(item) ? "Mark as Unwatched" : "Mark as Watched", systemImage: model.isWatched(item) ? "eye.slash" : "eye")
        }
        Button { Task { await model.toggleFavourite(item) } } label: {
            Label(model.isFavourite(item) ? "Remove from Favourites" : "Add to Favourites", systemImage: model.isFavourite(item) ? "heart.slash" : "heart")
        }
        if item.type == .show {
            Button { Task { await model.shufflePlay(item) } } label: { Label("Shuffle Play", systemImage: "shuffle") }
        }
    }
}

struct PersonCard: View {
    let id: Int
    let name: String
    let role: String
    let profilePath: String?

    var body: some View {
        NavigationLink(value: Route.person(id: id, name: name)) {
            VStack(spacing: Theme.Space.xs) {
                RemoteImage(url: TMDBImage.url(profilePath, size: .profile), maxPixel: 300)
                    .overlay {
                        if profilePath == nil {
                            Text(initials).font(.system(size: size * 0.32, weight: .semibold)).foregroundStyle(Theme.Palette.textSecondary)
                        }
                    }
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    .overlay(Circle().strokeBorder(Theme.Palette.hairline))
                VStack(spacing: 1) {
                    Text(name).font(.system(.caption, weight: .semibold)).lineLimit(1)
                    Text(role).font(.system(.caption2)).foregroundStyle(Theme.Palette.textTertiary).lineLimit(1)
                }
            }
            .frame(width: size + 18)
        }
        .buttonStyle(CardButtonStyle())
    }

    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
    }

    private var size: CGFloat { Platform.isTV ? 150 : 78 }
}
