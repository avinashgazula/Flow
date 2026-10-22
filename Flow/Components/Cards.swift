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
    @Environment(\.isFocused) private var focused

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.poster, style: .continuous) }

    var body: some View {
        Color.clear
            .aspectRatio(2 / 3, contentMode: .fit)
            .overlay(RemoteImage(url: item.posterURL, maxPixel: Platform.isTV ? 600 : 420, fallbackTitle: item.title, fallbackURL: item.tmdbPosterURL))
            .clipShape(shape)
            .hairline(shape)
            // Focus is the spot colour: a ring around the poster on Apple TV, and for keyboard focus elsewhere.
            .overlay { if focused { shape.strokeBorder(Theme.Palette.spot, lineWidth: Platform.isTV ? 5 : 2) } }
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
                        .foregroundStyle(Theme.Palette.text)
                        .frame(width: 22 * Theme.scale, height: 22 * Theme.scale)
                        .background(Theme.Palette.overPicture, in: Circle())
                        .padding(Theme.Space.xs)
                }
            }
    }

    /// "3/10": episodes watched of those aired, where the app knows the show's watch state.
    @ViewBuilder
    private var episodeCount: some View {
        if model.settings.general.showEpisodesRemaining, let p = model.episodeProgress(for: item), p.watched > 0 {
            Text("\(p.watched)/\(p.aired)")
                .font(.system(size: 10 * Theme.scale, weight: .bold).monospacedDigit())
                .foregroundStyle(Theme.Palette.text)
                .padding(.horizontal, 6).padding(.vertical, 3)
                .background(Theme.Palette.overPicture, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
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

/// Thin progress line used on artwork: the control ink for the track, the spot for what's been played ("now").
struct ProgressCapsule: View {
    let value: Double
    var height: CGFloat = 3 * Theme.scale
    var tint: Color = Theme.Palette.stock

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.Palette.lineStrong)
                Capsule().fill(tint).frame(width: max(height, proxy.size.width * min(1, max(0, value))))
            }
        }
        .frame(height: height)
    }
}

/// A plain paper check on flat ink: watched, with no badge colour.
struct WatchedCheck: View {
    var body: some View {
        Image(systemName: "checkmark")
            .font(.system(size: 11 * Theme.scale, weight: .bold))
            .foregroundStyle(Theme.Palette.text)
            .frame(width: 22 * Theme.scale, height: 22 * Theme.scale)
            .background(Theme.Palette.overPicture, in: Circle())
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
    private var zoomID: String { "continue-\(item.id)" }

    var body: some View {
        Button {
            if model.settings.playback.skipDetailsOnContinueWatching {
                Task { await model.play(item, episode: nil) }
            } else {
                model.navigate(to: .detail(item, zoom: zoomID))
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
                        // Says what's left: "44 Remaining" read as minutes as easily as episodes.
                        Text(remaining == 1 ? "1 episode left" : "\(remaining) episodes left")
                            .font(.system(.caption2, weight: .semibold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(.black.opacity(0.5), in: Capsule())
                            .padding(Theme.Space.s)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    }
                }
                .frame(width: width, height: width * 9 / 16)
                .zoomSource(zoomID)
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
    /// How far a focused card grows on Apple TV; a frame with its strip, which draws its own ring, lifts less.
    var lift: CGFloat = 1.08

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(FocusLift(scale: lift))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
    }
}

/// tvOS focus effect for custom button styles: scale up and cast a shadow. No-op elsewhere.
struct FocusLift: ViewModifier {
    /// Artwork lifts a little more than a control, so it still reads as focused with no fill behind it.
    var scale: CGFloat = 1.08
    @Environment(\.isFocused) private var focused

    func body(content: Content) -> some View {
        #if os(tvOS)
        content
            .scaleEffect(focused ? scale : 1)
            .shadow(color: .black.opacity(focused ? 0.35 : 0), radius: 24, y: 8)
            .animation(Theme.Motion.snappy, value: focused)
        #else
        content
        #endif
    }
}

// MARK: - Frame and edge strip

/// The printed edge of 35mm stock under a frame: perforations that fill as you watch, then the facts that
/// decide what to watch in edge print (condensed, uppercase, tracked), with the key one in yellow. It always
/// carries real progress and/or real facts. The end time ticks each minute.
struct EdgeStrip: View {
    let print: EdgePrint
    var focused = false

    private var scale: CGFloat { Theme.scale }

    var body: some View {
        Group {
            if print.endsInMinutes != nil {
                TimelineView(.everyMinute) { context in strip(now: context.date) }
            } else {
                strip(now: Date())
            }
        }
        .frame(height: 24 * scale)
        .background(Theme.Palette.edge)
        .flowDimsWhenInactive()
    }

    private func strip(now: Date) -> some View {
        GeometryReader { proxy in
            HStack(spacing: 8 * scale) {
                if let progress = print.progress { perforations(progress, frameWidth: proxy.size.width) }
                printText(now: now)
                    .font(Theme.Typeface.edgePrint)
                    .edgePrint()
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8 * scale)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .leading)
        }
    }

    /// Fewer, never fewer than four, on a narrow frame so the print keeps its room.
    private func perforations(_ progress: Double, frameWidth: CGFloat) -> some View {
        let pitch = 11 * scale
        let count = min(30, max(4, Int(frameWidth * 0.3 / pitch)))
        let filled = EdgePrint.filledPerforations(progress: progress, of: count)
        return HStack(spacing: 4 * scale) {
            ForEach(0..<count, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2 * scale, style: .continuous)
                    .fill(index < filled ? Theme.Palette.stock : Theme.Palette.lineStrong)
                    .frame(width: 7 * scale, height: 9 * scale)
            }
        }
        .accessibilityHidden(true)
    }

    private func printText(now: Date) -> Text {
        var out = AttributedString()
        for (index, segment) in print.segments(now: now).enumerated() {
            if index > 0 {
                var dot = AttributedString(" · ")
                dot.foregroundColor = Theme.Palette.textTertiary
                out += dot
            }
            var part = AttributedString(segment.text)
            // The key fact is yellow, and on Apple TV a focused frame prints all of it in yellow.
            part.foregroundColor = (segment.isKey || focused) ? Theme.Palette.stock : Theme.Palette.print
            out += part
        }
        return Text(out)
    }
}

/// A still or poster with its edge strip attached, one object: the frame's top corners and the strip's bottom
/// corners are the same radius. It fills the width it is given; the caller fixes the size per row.
struct FilmFrame: View {
    let art: ProgrammeArt
    var strip: EdgePrint?
    @Environment(\.isFocused) private var focused

    private var aspect: CGFloat {
        if case .posterImage = art { return 2.0 / 3.0 }
        return 16.0 / 9.0
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.artwork, style: .continuous)
        VStack(spacing: 0) {
            Color.clear
                .aspectRatio(aspect, contentMode: .fit)
                .overlay(image)
            if let strip { EdgeStrip(print: strip, focused: focused) }
        }
        .clipShape(shape)
        // Focus is a yellow outline around frame and strip together.
        .overlay { shape.strokeBorder(focused ? Theme.Palette.stock : Theme.Palette.hairline, lineWidth: focused ? (Platform.isTV ? 4 : 2) : 1) }
    }

    @ViewBuilder
    private var image: some View {
        switch art {
        case .posterImage(let url, let fallback, let title):
            RemoteImage(url: url, maxPixel: Platform.isTV ? 600 : 420, fallbackTitle: title, fallbackURL: fallback)
        case .stillImage(let url, let title):
            RemoteImage(url: url, maxPixel: Platform.isTV ? 1000 : 700, fallbackTitle: title)
        case .none:
            Theme.Palette.control
        }
    }
}

/// A frame and strip with the title and one meta line under it. Wrap it in a button or link; its spoken
/// label reads the facts naturally ("Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:30 PM").
struct FilmCard: View {
    let art: ProgrammeArt
    var strip: EdgePrint?
    let title: String
    var meta: String?
    /// Nil fills the width the card is given (a grid column).
    var width: CGFloat?
    let spoken: String
    /// The id the detail page's zoom transition grows from (iOS 18+); it grows from the frame alone.
    var zoomID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            FilmFrame(art: art, strip: strip)
                .zoomSource(zoomID)
                .frame(width: width)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.Typeface.headline)
                    .foregroundStyle(Theme.Palette.text)
                    .lineLimit(1)
                if let meta, !meta.isEmpty {
                    Text(meta)
                        .font(.system(.subheadline).monospacedDigit())
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: width ?? .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }
}

extension MediaItem {
    /// "2024 · Science Fiction": the short plain facts under a card's title.
    var shortMeta: String {
        var parts: [String] = []
        if let year { parts.append(String(year)) }
        if let genre = genres.first?.name { parts.append(genre) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - The programme listing

/// The one fixed size per kind of artwork, so a section never mixes sizes.
enum ProgrammeMetrics {
    /// Posters, 2:3: 48×72 on iPhone, 64×96 on iPad and Mac, 96×144 on Apple TV.
    static var poster: CGSize {
        #if os(tvOS)
        CGSize(width: 96, height: 144)
        #else
        Platform.isPhone ? CGSize(width: 48, height: 72) : CGSize(width: 64, height: 96)
        #endif
    }

    /// Episode stills and Continue Watching items, 16:9: 128×72, 160×90 on iPad and Mac, 256×144 on Apple TV.
    static var still: CGSize {
        #if os(tvOS)
        CGSize(width: 256, height: 144)
        #else
        Platform.isPhone ? CGSize(width: 128, height: 72) : CGSize(width: 160, height: 90)
        #endif
    }

    /// The time column.
    static var timeColumn: CGFloat {
        #if os(tvOS)
        150
        #else
        Platform.isPhone ? 64 : 72
        #endif
    }

    /// Past this the column stops growing with Dynamic Type and its text shrinks to fit.
    static var timeColumnCap: CGFloat { timeColumn * (Platform.isTV ? 1.15 : 1.4) }

    /// How far a row's own band reaches past its text, so the page gutter lines headings up with the text.
    static var inset: CGFloat { Platform.isTV ? 24 : 12 }
}

/// What a listing's artwork is.
enum ProgrammeArt {
    case posterImage(url: URL?, fallback: URL?, title: String)
    case stillImage(url: URL?, title: String)
    case none

    static func poster(_ item: MediaItem) -> ProgrammeArt {
        .posterImage(url: item.posterURL, fallback: item.tmdbPosterURL, title: item.title)
    }

    static func still(_ item: MediaItem) -> ProgrammeArt {
        .stillImage(url: item.smallBackdropURL ?? item.tmdbPosterURL, title: item.title)
    }

    var size: CGSize {
        switch self {
        case .posterImage: return ProgrammeMetrics.poster
        case .stillImage: return ProgrammeMetrics.still
        case .none: return .zero
        }
    }

    var hasImage: Bool {
        if case .none = self { return false }
        return true
    }
}

/// A listing in tonight's programme: a time column, fixed-size artwork, then the title and plain facts.
/// Used for Continue Watching, picks and upcoming episodes. The whole row is one button; its time
/// column ticks each minute so "ends 21:48" is always true if you pressed play now.
struct ProgrammeRow: View {
    enum Column {
        /// When it would end if started now, `minutes` from now, with "ends" beneath. `resume` is true when
        /// `minutes` is what is left of something already started rather than a whole runtime.
        case ends(minutes: Int, resume: Bool)
        /// A plain label in the column: an air day ("Tue 12", "airs"), or a resolution.
        case label(String, sub: String?)
        case none
    }

    var column: Column = .none
    var art: ProgrammeArt = .none
    let title: String
    var meta: String?
    /// The version that would play, as plain text.
    var version: String?
    /// 0...1, drawn as a 2 pt line under the artwork.
    var progress: Double?
    /// Only for the spoken label: "season 3 episode 7".
    var episode: EpisodeRef?
    /// More for the spoken label, before the time: "airs Tuesday".
    var spokenExtra: [String] = []
    /// The listing the page's side frame is showing: its row sits on the panel ink.
    var selected = false
    var dimmed = false
    /// Called when the row takes focus (Apple TV) or the pointer rests on it (Mac, iPad).
    var onFocus: (() -> Void)?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ProgrammeRowContent(row: self)
        }
        .buttonStyle(ProgrammeRowButtonStyle(selected: selected))
        #if !os(tvOS)
        .onHover { if $0 { onFocus?() } }
        #endif
    }
}

private struct ProgrammeRowContent: View {
    let row: ProgrammeRow
    @Environment(\.isFocused) private var focused
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .headline) private var timeWidth: CGFloat = ProgrammeMetrics.timeColumn

    // On Apple TV a focused row is filled with the spot, so its text turns to ink.
    private var primary: Color { focused ? Theme.Palette.onSpot : Theme.Palette.text }
    private var secondary: Color { focused ? Theme.Palette.onSpot.opacity(0.85) : Theme.Palette.textSecondary }
    private var tertiary: Color { focused ? Theme.Palette.onSpot.opacity(0.78) : Theme.Palette.textTertiary }

    private var hasColumn: Bool {
        if case .none = row.column { return false }
        return true
    }

    private var minutes: Int? {
        if case .ends(let minutes, _) = row.column { return minutes }
        return nil
    }

    var body: some View {
        Group {
            if minutes != nil {
                TimelineView(.everyMinute) { context in line(now: context.date) }
            } else {
                line(now: Date())
            }
        }
        .onChange(of: focused) { _, isFocused in
            if isFocused { row.onFocus?() }
        }
    }

    private func line(now: Date) -> some View {
        // At accessibility sizes the column and artwork would squeeze the words, so the time joins the meta line.
        let roomy = !typeSize.isAccessibilitySize
        return HStack(alignment: .top, spacing: Theme.Space.m) {
            if roomy && hasColumn {
                timeColumn(now: now)
                    .frame(width: min(timeWidth, ProgrammeMetrics.timeColumnCap), alignment: .leading)
            }
            if roomy && row.art.hasImage { artwork }
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(Theme.Typeface.headline)
                    .foregroundStyle(primary)
                    .lineLimit(2)
                if let meta = metaText(now: now, roomy: roomy) {
                    Text(meta)
                        .font(.system(.subheadline).monospacedDigit())
                        .foregroundStyle(secondary)
                        .lineLimit(2)
                }
                if let version = row.version, !version.isEmpty {
                    Text(version)
                        .font(.system(.footnote).monospacedDigit())
                        .foregroundStyle(tertiary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, ProgrammeMetrics.inset)
        .padding(.vertical, Theme.Space.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 44 * Theme.scale)
        .opacity(row.dimmed ? 0.55 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(now: now))
    }

    @ViewBuilder
    private func timeColumn(now: Date) -> some View {
        switch row.column {
        case .ends(let minutes, _):
            columnText(Reel.clock(Reel.endDate(from: now, minutesLeft: minutes)), sub: "ends")
        case .label(let text, let sub):
            columnText(text, sub: sub)
        case .none:
            EmptyView()
        }
    }

    private func columnText(_ text: String, sub: String?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(text)
                .font(Theme.Typeface.time)
                .foregroundStyle(primary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let sub {
                Text(sub)
                    .font(.system(.caption))
                    .foregroundStyle(tertiary)
                    .lineLimit(1)
            }
        }
    }

    private func metaText(now: Date, roomy: Bool) -> String? {
        var parts: [String] = []
        if !roomy, let minutes {
            parts.append("Ends \(Reel.clock(Reel.endDate(from: now, minutesLeft: minutes)))")
        }
        if let meta = row.meta, !meta.isEmpty { parts.append(meta) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var artwork: some View {
        let size = row.art.size
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.artwork, style: .continuous)
        return VStack(alignment: .leading, spacing: 4 * Theme.scale) {
            image
                .frame(width: size.width, height: size.height)
                .clipShape(shape)
                .hairline(shape)
            if let progress = row.progress {
                ProgrammeProgressLine(value: progress, focused: focused).frame(width: size.width)
            }
        }
    }

    @ViewBuilder
    private var image: some View {
        switch row.art {
        case .posterImage(let url, let fallback, let title):
            RemoteImage(url: url, maxPixel: Platform.isTV ? 400 : 240, fallbackTitle: title, fallbackURL: fallback)
        case .stillImage(let url, let title):
            RemoteImage(url: url, maxPixel: Platform.isTV ? 600 : 400, fallbackTitle: title)
        case .none:
            EmptyView()
        }
    }

    /// "Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:48 PM".
    private func spoken(now: Date) -> String {
        var extra = row.spokenExtra
        var left: Int?
        var ends: Date?
        switch row.column {
        case .ends(let minutes, let resume):
            ends = Reel.endDate(from: now, minutesLeft: minutes)
            if resume { left = minutes } else { extra.append(Reel.spokenDuration(minutes: minutes)) }
        case .label(let text, let sub):
            extra.append([text, sub].compactMap { $0 }.joined(separator: " "))
        case .none:
            break
        }
        if let version = row.version, !version.isEmpty { extra.append(version) }
        return Reel.spokenListing(title: row.title, episode: row.episode, minutesLeft: left, endsAt: ends, extra: extra)
    }
}

/// A 2 pt line under a listing's artwork: the control ink for the track, the spot for what's played.
struct ProgrammeProgressLine: View {
    let value: Double
    var focused = false

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle().fill(focused ? Theme.Palette.onSpot.opacity(0.25) : Theme.Palette.control)
                Rectangle()
                    .fill(focused ? Theme.Palette.onSpot : Theme.Palette.spot)
                    .frame(width: proxy.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 2 * Theme.scale)
        .accessibilityHidden(true)
    }
}

/// A listing's own surface: nothing at rest, the panel ink under the pointer, a press or the selection,
/// and on Apple TV the spot colour with a 1.02 lift.
struct ProgrammeRowButtonStyle: ButtonStyle {
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        ProgrammeRowChrome(configuration: configuration, selected: selected)
    }
}

private struct ProgrammeRowChrome: View {
    let configuration: ButtonStyleConfiguration
    let selected: Bool
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    private var fill: Color {
        #if os(tvOS)
        return focused ? Theme.Palette.spot : (selected ? Theme.Palette.panel : Color.clear)
        #else
        return configuration.isPressed || hovering || selected ? Theme.Palette.panel : Color.clear
        #endif
    }

    private var scale: CGFloat {
        if configuration.isPressed { return 0.98 }
        #if os(tvOS)
        return focused ? 1.02 : 1
        #else
        return 1
        #endif
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.frame, style: .continuous)
        configuration.label
            .background(fill, in: shape)
            .contentShape(shape)
            .scaleEffect(scale)
            .shadow(color: .black.opacity(focused ? 0.35 : 0), radius: 24, y: 8)
            .animation(Theme.Motion.snappy, value: focused)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

extension MediaItem {
    /// "2024 · 2 h 47 min · Science Fiction · TMDB 8.4": the plain facts under a listing's title.
    var programmeMeta: String {
        var parts: [String] = []
        if let year { parts.append(String(year)) }
        if type == .show {
            parts.append("Series")
        } else if let runtimeMinutes, runtimeMinutes > 0 {
            parts.append(Reel.duration(minutes: runtimeMinutes))
        }
        if let genre = genres.first?.name { parts.append(genre) }
        if let vote = voteAverage, vote > 0 { parts.append("TMDB " + String(format: "%.1f", vote)) }
        return parts.joined(separator: " · ")
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
        #if !os(tvOS)
        TitleShareLink(item: item) { Label("Share", systemImage: "square.and.arrow.up") }
        #endif
    }
}

extension MediaItem {
    /// The title's page on TMDb, which opens anywhere.
    var tmdbWebURL: URL? {
        ids.tmdb.flatMap { URL(string: "https://www.themoviedb.org/\(type == .movie ? "movie" : "tv")/\($0)") }
    }
}

#if !os(tvOS)
/// The system share sheet for a title: its TMDb page, with "Dune: Part Two (2024)" as the message
/// and the poster in the sheet's header (the app icon until it has loaded).
struct TitleShareLink<Content: View>: View {
    let item: MediaItem
    @ViewBuilder var label: () -> Content
    @State private var poster: CGImage?

    var body: some View {
        if let url = item.tmdbWebURL {
            Group {
                if let poster {
                    ShareLink(item: url, subject: Text(item.title), message: Text(message),
                              preview: SharePreview(item.title, image: Image(decorative: poster, scale: 1)), label: label)
                } else {
                    ShareLink(item: url, subject: Text(item.title), message: Text(message), preview: SharePreview(item.title), label: label)
                }
            }
            .task(id: item.id) {
                guard let posterURL = item.tmdbPosterURL else { return }
                poster = await ImagePipeline.shared.image(posterURL, maxPixel: 300)
            }
        }
    }

    private var message: String {
        item.year.map { "\(item.title) (\($0))" } ?? item.title
    }
}
#endif

struct PersonCard: View {
    let id: Int
    let name: String
    let role: String
    let profilePath: String?

    var body: some View {
        NavigationLink(value: Route.person(id: id, name: name)) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ZStack {
                    if profilePath == nil {
                        Monogram(name: name, fontSize: width * 0.32)
                    } else {
                        RemoteImage(url: TMDBImage.url(profilePath, size: .profile), maxPixel: 300)
                    }
                }
                .frame(width: width, height: width * 1.5)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.artwork, style: .continuous))
                .hairline(RoundedRectangle(cornerRadius: Theme.Radius.artwork, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.system(.caption, weight: .semibold)).foregroundStyle(Theme.Palette.text).lineLimit(1)
                    Text(role).font(.system(.caption2)).foregroundStyle(Theme.Palette.textTertiary).lineLimit(1)
                }
                .frame(width: width, alignment: .leading)
            }
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel(role.isEmpty ? name : "\(name), \(role)")
    }

    /// Small 2:3 portraits, one size for the whole row.
    private var width: CGFloat { Platform.isTV ? 150 : 76 }
}

/// Initials on a flat control-ink plate, for people and channels without a picture.
/// Fills whatever it's given; the caller clips and strokes it.
struct Monogram: View {
    let name: String
    var fontSize: CGFloat
    /// Kept for channel plates; the programme sets every monogram in the same system weight.
    var condensed = false

    var body: some View {
        Theme.Palette.control
            .overlay {
                Text(Self.initials(name))
                    .font(.system(size: fontSize, weight: .semibold))
                    .foregroundStyle(Theme.Palette.textSecondary)
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
            .frame(minHeight: 44 * Theme.scale)
            .foregroundStyle(active ? Theme.Palette.onSpot : Theme.Palette.text)
            .background(active ? Theme.Palette.spot : Theme.Palette.control, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel(title ?? "")
    }
}
