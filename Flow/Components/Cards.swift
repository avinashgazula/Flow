import SwiftUI
import FlowKit

/// Poster with progress, watched and media-server marks; zooms into the detail page on iOS 18+.
struct PosterCard: View {
    let item: MediaItem
    var width: CGFloat = Platform.posterWidth
    /// Distinguishes the same title appearing on several shelves, for the zoom transition.
    var context: String = "poster"
    /// The provider of the library this poster belongs to, when it's on a library's shelf.
    var libraryProviderID: String?
    @Environment(AppModel.self) private var model

    private var zoomID: String { "\(context)-\(item.id)" }

    var body: some View {
        NavigationLink(value: Route.detail(item, zoom: zoomID, library: libraryProviderID)) {
            PosterCardContent(item: item, width: width, zoomID: zoomID)
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { MediaContextMenu(item: item, libraryProviderID: libraryProviderID) } preview: { PosterPreview(item: item) }
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
    /// The zoom transition grows from the artwork alone; including the title would clip it to the poster's corners.
    var zoomID: String?
    @Environment(AppModel.self) private var model

    private var showTitle: Bool { model.settings.general.showPosterTitles }
    /// With titles hidden the year stands alone under the poster.
    private var year: Int? { model.settings.general.showReleaseYear ? item.year : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            PosterArtwork(item: item)
                .frame(width: width, height: width.map { $0 * 1.5 })
                .zoomSource(zoomID)
            if showTitle || year != nil {
                VStack(alignment: .leading, spacing: 1) {
                    if showTitle {
                        Text(item.title)
                            .font(.system(.footnote, weight: .medium))
                            .foregroundStyle(.white.opacity(0.9))
                            .lineLimit(1)
                    }
                    if let year {
                        Text(String(year))
                            .font(.system(.caption))
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .lineLimit(1)
                    }
                }
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
            .overlay(RemoteImage(url: item.posterURL, maxPixel: Platform.isTV ? 600 : 420, fallbackTitle: item.title, fallbackURL: item.tmdbPosterURL))
            .clipShape(shape)
            .hairline(shape)
            .overlay(alignment: .bottom) { progressBar }
            .overlay(alignment: .bottomTrailing) {
                if model.settings.general.showWatchedBadges && model.isWatched(item) {
                    WatchedCheck().padding(Theme.Space.xs)
                }
            }
            .overlay(alignment: .bottomLeading) { episodeCount }
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

    /// "3/10": episodes watched of those aired, where the app knows the show's watch state.
    @ViewBuilder
    private var episodeCount: some View {
        if model.settings.general.showEpisodesRemaining, let p = model.episodeProgress(for: item), p.watched > 0 {
            Text("\(p.watched)/\(p.aired)")
                .font(.system(size: 10 * Theme.scale, weight: .bold).monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(.black.opacity(0.55), in: Capsule())
                .overlay(Capsule().strokeBorder(.white.opacity(0.15)))
                .padding(Theme.Space.xs)
                .accessibilityLabel("\(p.watched) of \(p.aired) episodes watched")
        }
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
            RemoteImage(url: item.smallBackdropURL ?? item.tmdbPosterURL, maxPixel: 900, fallbackTitle: item.title)
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

/// Poster for the Upcoming shelf with when it arrives: "S02E05 · Thu" for an episode, the day for a film.
struct UpcomingCard: View {
    let entry: UpcomingEntry
    var context: String = "upcoming"
    @Environment(AppModel.self) private var model

    private var zoomID: String { "\(context)-\(entry.id)" }

    var body: some View {
        NavigationLink(value: Route.detail(entry.item, zoom: zoomID)) {
            VStack(alignment: .leading, spacing: 2) {
                PosterCardContent(item: entry.item, width: Platform.posterWidth, zoomID: zoomID)
                Text(caption)
                    .font(.system(.caption, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .lineLimit(1)
                    .frame(width: Platform.posterWidth, alignment: .leading)
            }
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { MediaContextMenu(item: entry.item) } preview: { PosterPreview(item: entry.item) }
        .accessibilityLabel("\(entry.item.title), \(caption)")
    }

    /// Air dates are bare days (midnight UTC), so they're written in UTC or they'd slip a day.
    private var caption: String {
        let day = Self.dayLabel(entry.date)
        guard let episode = entry.episode else { return day }
        return "\(episode.code) · \(day)"
    }

    private static func dayLabel(_ date: Date) -> String {
        let soon = date.timeIntervalSinceNow < 6 * 86400
        return (soon ? weekday : monthDay).string(from: date)
    }

    private static let weekday = formatter("EEE")
    private static let monthDay = formatter("MMM d")

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate(format)
        return f
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
            if model.settings.playback.skipDetailsOnContinueWatching {
                Task { await model.play(item, episode: nil) }
            } else {
                model.navigate(to: .detail(item))
            }
        } label: {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ZStack(alignment: .bottomLeading) {
                    RemoteImage(url: item.smallBackdropURL ?? item.tmdbPosterURL, maxPixel: Platform.isTV ? 1000 : 700, fallbackTitle: item.title)
                        .frame(width: width, height: width * 9 / 16)
                    // Only what reads at a glance sits on the picture: how far in. The rest is in the line below.
                    if let p = entry.progress {
                        LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                        ProgressCapsule(value: p.percent / 100)
                            .padding(Theme.Space.s)
                    }
                    if let remaining = episodesRemaining {
                        Text("\(remaining) Remaining")
                            .font(.system(.caption2, weight: .semibold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(.black.opacity(0.5), in: Capsule())
                            .padding(Theme.Space.s)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    }
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

    /// Episodes of a show not yet watched, once the app knows how many have aired.
    private var episodesRemaining: Int? {
        guard model.settings.general.showEpisodesRemaining, entry.episode != nil, let p = model.episodeProgress(for: item) else { return nil }
        let remaining = p.aired - p.watched
        return remaining > 0 ? remaining : nil
    }

    /// "S3 E7 · 18m left", "S4 E1 · Up Next", "1h 12m left", or the year and genre of a film not yet started.
    private var subtitle: String {
        var parts: [String] = []
        if let ep = entry.episode { parts.append("S\(ep.season) E\(ep.episode)") }
        if let badge = badgeText {
            parts.append(badge)
        } else if entry.episode == nil {
            if model.settings.general.showContinueWatchingReleaseDate, let year = item.year { parts.append(String(year)) }
            if let genre = item.genres.first?.name { parts.append(genre) }
        }
        return parts.joined(separator: " · ")
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
    var libraryProviderID: String?
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { Task { await model.play(item, library: libraryProviderID) } } label: { Label("Play", systemImage: "play.fill") }
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
                ZStack {
                    if profilePath == nil {
                        Monogram(name: name, fontSize: size * 0.32)
                    } else {
                        RemoteImage(url: TMDBImage.url(profilePath, size: .profile), maxPixel: 300)
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

    private var size: CGFloat { Platform.isTV ? 150 : 78 }
}

/// Initials on a gradient whose hue comes from the name, for people and channels without a picture.
/// Fills whatever it's given; the caller clips and strokes it.
struct Monogram: View {
    let name: String
    var fontSize: CGFloat
    /// Channel plates use a heavy condensed face; people a semibold one.
    var condensed = false

    var body: some View {
        let hue = Self.hue(for: name)
        LinearGradient(
            colors: [
                Color(hue: hue, saturation: 0.45, brightness: 0.38),
                Color(hue: (hue + 0.06).truncatingRemainder(dividingBy: 1), saturation: 0.55, brightness: 0.22),
            ],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        .overlay {
            Text(Self.initials(name))
                .font(condensed ? .system(size: fontSize, weight: .heavy).width(.condensed) : .system(size: fontSize, weight: .semibold))
                .foregroundStyle(.white.opacity(0.92))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .accessibilityHidden(true)
    }

    static func initials(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }

    /// Stable across launches (String.hashValue is seeded per process): djb2 over the unicode scalars.
    static func hue(for name: String) -> Double {
        let hash = name.lowercased().unicodeScalars.reduce(UInt32(5381)) { ($0 &* 33) &+ $1.value }
        return Double(hash % 360) / 360
    }
}

/// A capsule action beside a row of filter chips (Filters, Refresh, Guide): how tvOS reaches what
/// other platforms keep in the navigation bar.
struct ActionChip: View {
    let title: String?
    let systemImage: String
    var active = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                if let title { Text(title) }
            }
            .font(.system(.subheadline, weight: .semibold))
            .padding(.horizontal, Theme.Space.m).padding(.vertical, Theme.Space.xs + 1)
            .foregroundStyle(active ? Color.black : Color.white)
            .background(active ? Color.white : Theme.Palette.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.Palette.hairline, lineWidth: active ? 0 : 1))
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel(title ?? "")
    }
}
