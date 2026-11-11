import SwiftUI
import FlowKit

/// A title as a poster frame with its print-only strip: the one poster on every shelf, grid and search result.
/// The runtime and rating are printed on the strip's edge, and so is "WATCHED"; nothing is drawn over the artwork.
/// The caller fixes the width per row; a grid passes nil and every column is the same.
struct PosterFilmCard: View {
    let item: MediaItem
    /// Distinguishes the same title appearing on several shelves, for the zoom transition.
    var context: String = "poster"
    /// The provider of the library this poster belongs to, when it's on a library's shelf.
    var libraryProviderID: String?
    var width: CGFloat? = Platform.posterWidth
    @Environment(AppModel.self) private var model
    /// Shelves list titles without runtimes, so each card asks for its own as it appears.
    @State private var runtime: Int?

    private var zoomID: String { "\(context)-\(item.id)" }

    private var spoken: String {
        var extra: [String] = []
        if let year = item.year { extra.append(String(year)) }
        if let runtime { extra.append(Reel.spokenDuration(minutes: runtime)) }
        if let vote = item.voteAverage, vote > 0 { extra.append("rated " + String(format: "%.1f", vote)) }
        if model.isWatched(item) { extra.append("watched") }
        return Reel.spokenListing(title: item.title, extra: extra)
    }

    var body: some View {
        NavigationLink(value: Route.detail(item, zoom: zoomID, library: libraryProviderID)) {
            FilmCard(art: .poster(item), strip: model.posterPrint(for: item, runtime: runtime),
                     title: model.settings.general.showPosterTitles ? item.title : nil,
                     meta: model.settings.general.showReleaseYear ? item.year.map { String($0) } : nil,
                     width: width, spoken: spoken, zoomID: zoomID)
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu { MediaContextMenu(item: item, libraryProviderID: libraryProviderID) } preview: { PosterPreview(item: item) }
        .task(id: item.id) { runtime = await model.posterRuntime(for: item) }
    }
}

extension AppModel {
    /// The print under a poster: runtime and rating, and what has been watched, as the settings allow.
    func posterPrint(for item: MediaItem, runtime: Int?) -> EdgePrint {
        let episodes = settings.general.showEpisodesRemaining ? episodeProgress(for: item) : nil
        return .poster(runtimeMinutes: runtime, isSeries: item.type == .show, rating: item.voteAverage,
                       watched: settings.general.showWatchedBadges && isWatched(item),
                       episodesWatched: episodes?.watched, episodesAired: episodes?.aired,
                       onServer: settings.mediaServers.showBadgeOnPosters && isOnServer(item))
    }

    /// The runtime a poster prints: the one the title carries, else a film's from its details.
    func posterRuntime(for item: MediaItem) async -> Int? {
        if let known = item.runtimeMinutes, known > 0 { return known }
        guard item.type == .movie, let catalog = self.catalog, let id = item.ids.tmdb else { return nil }
        guard let minutes = (try? await catalog.details(item.type, id: id))?.item.runtimeMinutes, minutes > 0 else { return nil }
        return minutes
    }
}

/// Thin progress line used on artwork: a flat track and a red bar for how far you are, square at both ends.
struct ProgressCapsule: View {
    let value: Double
    var height: CGFloat = 3 * Theme.scale
    var tint: Color = Theme.Palette.red

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle().fill(Theme.Palette.tint3)
                Rectangle().fill(tint).frame(width: proxy.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

/// Long-press preview: the backdrop with title and overview, in the Index's type.
struct PosterPreview: View {
    let item: MediaItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RemoteImage(url: item.smallBackdropURL ?? item.tmdbPosterURL, maxPixel: 900, fallbackTitle: item.title)
                .frame(width: 320, height: 180)
                .clipped()
            VStack(alignment: .leading, spacing: 6) {
                Text(item.title).font(Theme.Typeface.heading).foregroundStyle(Theme.Palette.fg)
                MetadataLine(item: item, showRating: true)
                if let overview = item.overview {
                    Text(overview).font(Theme.Typeface.reading).foregroundStyle(Theme.Palette.muted).lineLimit(4)
                }
            }
            .padding([.horizontal, .bottom], 14)
        }
        .frame(width: 320)
        .background(Theme.Palette.bg)
    }
}

/// Lifts cards on focus (tvOS) and compresses gently on press elsewhere.
struct CardButtonStyle: ButtonStyle {
    /// How far a focused card grows on Apple TV. A card that draws its own ring around its picture (`FilmFrame`,
    /// `cardFrame()`) lifts less, and a smaller lift says so: this style then adds no ring of its own, so the ring
    /// never takes in the card's words.
    var lift: CGFloat = 1.08

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(FocusLift(scale: lift, ring: lift == 1.08))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
    }
}

/// tvOS focus effect for custom button styles: scale up and draw the blue focus ring. No-op elsewhere.
struct FocusLift: ViewModifier {
    /// Artwork lifts a little more than a control, so it still reads as focused with no fill behind it.
    var scale: CGFloat = 1.08
    /// False when the content draws its own focus ring.
    var ring = true
    @Environment(\.isFocused) private var focused

    func body(content: Content) -> some View {
        #if os(tvOS)
        content
            .scaleEffect(focused ? scale : 1)
            // Focus is a blue ring, always visible, on top of the lift: no shadow, nothing soft.
            .overlay { if ring { Rectangle().strokeBorder(Theme.Palette.blue, lineWidth: focused ? Theme.Rule.focus : 0) } }
            .animation(Theme.Motion.snappy, value: focused)
        #else
        content
        #endif
    }
}

extension Theme.Typeface {
    /// A card's title under its picture.
    static var cardTitle: Font { custom(Theme.Face.condensedSemiBold, 16, .subheadline) }
}

/// The 2px ink frame around a card's picture. Blue under the pointer, and a thicker blue ring when focused (Apple TV, a
/// keyboard), so there is always something unmistakable.
private struct CardFrame: ViewModifier {
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    func body(content: Content) -> some View {
        let lit = focused || hovering
        content
            .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.blue : Theme.Palette.rule, lineWidth: focused ? Theme.Rule.focus : Theme.Rule.heavy))
            .animation(Theme.Motion.hover, value: lit)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

extension View {
    /// Frames a card's picture: square, 2px ink, blue when hovered or focused.
    func cardFrame() -> some View { modifier(CardFrame()) }
}

// MARK: - Frame and facts

/// The facts under a card's picture as one mono line: `S2 E3 · 46M LEFT`, `2H47 · 8.4`, `WATCHED`. The fact that decides
/// whether to press play is red. It always carries real facts, and the end time ticks each minute. All of the line if it
/// fits, else without its least important facts, each dropped whole: an end time cut to "ENDS 8:4…" is worse than none.
struct FactsLine: View {
    let print: EdgePrint

    var body: some View {
        Group {
            if print.endsInMinutes != nil {
                TimelineView(.everyMinute) { context in line(now: context.date) }
            } else {
                line(now: Date())
            }
        }
    }

    private func line(now: Date) -> some View {
        ViewThatFits(in: .horizontal) {
            text(now: now, dropping: 0)
            text(now: now, dropping: 1)
            text(now: now, dropping: 2)
            text(now: now, dropping: 3)
            text(now: now, dropping: 4)
        }
    }

    private func text(now: Date, dropping count: Int) -> some View {
        factsText(print.segments(droppingLeast: count, now: now))
            .font(Theme.Typeface.caption)
            .textCase(.uppercase)
            .tracking(0.06 * 12 * Theme.scale)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private func factsText(_ segments: [EdgePrint.Segment]) -> Text {
        var out = AttributedString()
        for (index, segment) in segments.enumerated() {
            if index > 0 {
                var dot = AttributedString(" · ")
                dot.foregroundColor = Theme.Palette.faint
                out += dot
            }
            var part = AttributedString(segment.text)
            part.foregroundColor = segment.isKey ? Theme.Palette.red : Theme.Palette.muted
            out += part
        }
        return Text(out)
    }
}

/// A still or poster in its 2px frame with the facts line under it, one object. Progress is a thin red bar along the
/// foot of the picture. It fills the width it is given; the caller fixes the size per row.
struct FilmFrame: View {
    let art: ProgrammeArt
    var strip: EdgePrint?

    private var aspect: CGFloat {
        if case .posterImage = art { return 2.0 / 3.0 }
        return 16.0 / 9.0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Color.clear
                .aspectRatio(aspect, contentMode: .fit)
                .overlay(image)
                .overlay(alignment: .bottom) {
                    if let progress = strip?.progress, progress > 0 {
                        ProgressCapsule(value: progress, height: 4 * Theme.scale)
                            .padding(Theme.Rule.heavy)
                    }
                }
                .clipped()
                .cardFrame()
            if let strip, !strip.segments().isEmpty { FactsLine(print: strip) }
        }
    }

    @ViewBuilder
    private var image: some View {
        switch art {
        case .posterImage(let url, let fallback, let title):
            RemoteImage(url: url, maxPixel: Platform.isTV ? 600 : 420, fallbackTitle: title, fallbackURL: fallback)
        case .stillImage(let url, let title):
            RemoteImage(url: url, maxPixel: Platform.isTV ? 1000 : 700, fallbackTitle: title)
        case .none:
            Theme.Palette.tint2
        }
    }
}

/// A frame and facts line with the title and one meta line under it. Wrap it in a button or link; its spoken
/// label reads the facts naturally ("Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:30 PM").
struct FilmCard: View {
    let art: ProgrammeArt
    var strip: EdgePrint?
    /// Nil leaves it out (Show Titles Under Posters is off), so the meta line stands alone.
    let title: String?
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
            if title != nil || !(meta ?? "").isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    if let title {
                        Text(title)
                            .font(Theme.Typeface.cardTitle)
                            .foregroundStyle(Theme.Palette.fg)
                            // Two lines, so "Dune: Part Two" on a phone's narrow poster isn't cut to "Dune: Part T...".
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let meta, !meta.isEmpty {
                        Text(meta)
                            .font(Theme.Typeface.caption)
                            .foregroundStyle(Theme.Palette.muted)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: width ?? .infinity, alignment: .leading)
            }
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

    @Environment(\.rowLit) private var rowLit

    // A row under the pointer, pressed or focused is filled blue, so its text turns to on-blue.
    private var lit: Bool { focused || rowLit }
    private var primary: Color { lit ? Theme.Palette.onBlue : Theme.Palette.fg }
    private var secondary: Color { lit ? Theme.Palette.onBlue : Theme.Palette.muted }
    private var tertiary: Color { lit ? Theme.Palette.onBlue : Theme.Palette.faint }

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
                    .font(Theme.Typeface.cardTitle)
                    .foregroundStyle(primary)
                    .lineLimit(2)
                if let meta = metaText(now: now, roomy: roomy) {
                    Text(meta)
                        .font(Theme.Typeface.caption)
                        .foregroundStyle(secondary)
                        .lineLimit(2)
                }
                if let version = row.version, !version.isEmpty {
                    Text(version)
                        .font(Theme.Typeface.caption)
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
                    .font(Theme.Typeface.micro)
                    .textCase(.uppercase)
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
        return VStack(alignment: .leading, spacing: 4 * Theme.scale) {
            image
                .frame(width: size.width, height: size.height)
                .clipped()
                .ruleFrame(lit ? Theme.Palette.onBlue : Theme.Palette.rule)
            if let progress = row.progress {
                ProgrammeProgressLine(value: progress, focused: lit).frame(width: size.width)
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

/// A 2 pt line under a listing's artwork: a flat track and a red bar for what's played.
struct ProgrammeProgressLine: View {
    let value: Double
    var focused = false

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle().fill(focused ? Theme.Palette.onBlue.opacity(0.35) : Theme.Palette.tint3)
                Rectangle()
                    .fill(focused ? Theme.Palette.onBlue : Theme.Palette.red)
                    .frame(width: proxy.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 2 * Theme.scale)
        .accessibilityHidden(true)
    }
}

/// A listing's own surface, an Index row: a 1px ink rule under it, and the whole row fills blue with on-blue words under
/// the pointer, while pressed and (Apple TV) when focused. The selected row sits on a tint.
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

    private var lit: Bool { configuration.isPressed || hovering || focused }

    private var fill: Color {
        if lit { return Theme.Palette.blue }
        return selected ? Theme.Palette.tint2 : Color.clear
    }

    var body: some View {
        configuration.label
            .environment(\.rowLit, lit)
            .background(fill)
            .contentShape(Rectangle())
            .ruledRow()
            .animation(Theme.Motion.hover, value: lit)
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
                .clipped()
                .cardFrame()
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(Theme.Typeface.cardTitle).foregroundStyle(Theme.Palette.fg).lineLimit(1)
                    Text(role).font(Theme.Typeface.micro).foregroundStyle(Theme.Palette.muted).lineLimit(1)
                }
                .frame(width: width, alignment: .leading)
            }
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
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
        Theme.Palette.tint2
            .overlay {
                Text(Self.initials(name))
                    .font(.custom(Theme.Face.condensed, size: fontSize))
                    .foregroundStyle(Theme.Palette.muted)
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

/// A tab in a filter row (genres, channel groups, periods): a bordered mono cell, the current one inverted ink, blue under
/// the pointer and on Apple TV focus. It is `FilterChipStyle` under the name the screens already use.
struct FilterTabStyle: ButtonStyle {
    var selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        FilterChipStyle(current: selected).makeBody(configuration: configuration)
    }
}

/// An action beside a row of filter tabs (Filters, Refresh, Guide): how tvOS reaches what other platforms keep
/// in the navigation bar. It is a base-3 control, with the selected look only while it is switched on.
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
        }
        .buttonStyle(FilterTabStyle(selected: active))
        .accessibilityLabel(title ?? "")
    }
}
