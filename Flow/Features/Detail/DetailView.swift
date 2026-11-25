import SwiftUI
import FlowKit

/// A title's page, opened as Home's lead is: the picture edge to edge under the bar, the logo (or the name) and one line of
/// facts over its fade, then one even row of ratings, the synopsis, and Play with the list actions as round buttons of one
/// size beside it. Under that, how the title plays, the episodes (a row of cards under a season picker), cast and the rest,
/// each section under its title at one even gap.
struct DetailView: View {
    let item: MediaItem
    /// The library the title was opened from, if any.
    var libraryProviderID: String?
    @Environment(AppModel.self) private var model
    @State private var detail: MediaDetail?
    @State private var ratings = Ratings()
    @State private var error: String?
    @State private var episodesBySeason: [Int: [Episode]] = [:]
    @State private var loadingEpisodes = true
    @State private var episodesFailed = false
    @State private var selectedSeason = 1
    @State private var rewatching = false
    @State private var downloadRequest: PlaybackRequest?
    @State private var showFullOverview = false
    @State private var reviews: [Review] = []
    /// The title has scrolled up under the navigation bar, so the bar shows it instead.
    @State private var titleCollapsed = false
    /// Where the navigation bar ends, so the title collapses once it has passed beneath it.
    @State private var barBottom: CGFloat = 100
    /// The page's size: its width chooses the phone's centred head or the wide page's column over the picture, and both
    /// size the picture.
    @State private var width: CGFloat = Platform.isPhone ? 0 : 1200
    @State private var viewport: CGFloat = Platform.isPhone ? 0 : 900
    /// The logo art, asked for once the details are in: an empty path is "none".
    @State private var logo: String?
    /// Apple TV starts focus on Play, so Down from the tab bar and one press of Select play the title.
    @FocusState private var focus: DetailFocus?

    private enum DetailFocus: Hashable { case play }

    private var general: GeneralSettings { model.settings.general }
    private var current: MediaItem { detail?.item ?? item }
    /// A wide page sets the head over the picture's lower left, as Home's lead does; a phone centres it under the logo.
    private var wide: Bool { Platform.isTV || width >= HeroLead.wideFrom }
    private var shape: HeroLead.Shape { HeroLead.shape(width: Double(width), isTV: Platform.isTV) }

    var body: some View {
        ScrollViewReader { reader in
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.section) {
                VStack(alignment: .center, spacing: Theme.Space.l) {
                    hero
                    if !wide {
                        headColumn(alignment: .center)
                            .padding(.horizontal, Theme.Space.gutter)
                    }
                }
                // Specials alone, with Specials Season off, leave nothing to list.
                if current.type == .show, let detail, detail.seasons.contains(where: { $0.number > 0 || general.showSpecialsSeason }) {
                    SeasonsSection(show: current, seasons: detail.seasons, episodesBySeason: episodesBySeason, selectedSeason: $selectedSeason, libraryProviderID: libraryProviderID,
                                   isLoading: loadingEpisodes, failed: episodesFailed) { Task { await loadEpisodes(detail) } }
                        .id("detail-episodes")
                }
                if let detail {
                    sections(detail)
                } else if let error {
                    ContentUnavailableView("Couldn't Load Details", systemImage: "exclamationmark.triangle", description: Text(error))
                }
            }
            .padding(.bottom, Theme.Space.xxl)
        }
        .scrollIndicators(.hidden)
        // The screenshot tour scrolls down to the episodes; nothing else sets this.
        .onChange(of: model.pageScrollTarget) { _, target in
            guard target == "detail-episodes" else { return }
            reader.scrollTo(target, anchor: .center)
            model.pageScrollTarget = nil
        }
        }
        .detailTextSize(general.detailTextSize)
        .background(AmbientBackground(url: nil))
        .onGeometryChange(for: CGSize.self) { $0.size } action: { new in
            if abs(new.width - width) > 0.5 { width = new.width }
            if abs(new.height - viewport) > 0.5 { viewport = new.height }
        }
        #if os(iOS)
        .ignoresSafeArea(edges: .top)
        .background {
            Color.clear.onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { new in
                if new > 0, abs(new - barBottom) > 0.5 { barBottom = new }
            }
        }
        #elseif os(tvOS)
        .ignoresSafeArea(edges: [.top, .horizontal])
        .defaultFocus($focus, .play)
        #endif
        .collapsingNavigationTitle(current.title, collapsed: titleCollapsed)
        .inlineNavigationTitle()
        .flowMinimizingToolbar()
        .task(id: item.id) { await load() }
        .task(id: current.ids.tmdb) { await loadLogo() }
        .advertisesTitle(current)
        .sheet(item: $downloadRequest) { request in
            SourcePickerView(request: request, forDownload: true).environment(model).largeSheetOnPad()
        }
    }

    // MARK: Head

    /// How far the picture runs up under the bar: the navigation bar on iPhone and iPad, the tab bar on Apple TV.
    private var topExtra: CGFloat {
        #if os(iOS)
        return barBottom
        #elseif os(tvOS)
        return 110
        #else
        return 0
        #endif
    }

    /// The title's picture, edge to edge and up under the bar, fading into the page, with the logo (or the name) and the
    /// facts over the fade: Home's lead, standing still. On a wide page the ratings, the synopsis and the actions join them
    /// in the column at the lower left, so Play is on the first screen; on a phone they follow under the picture.
    private var hero: some View {
        let pictureHeight = CGFloat(TitleHead.height(shape: shape, width: Double(width), viewport: Double(viewport + topExtra)))
        let alignment: HorizontalAlignment = wide ? .leading : .center
        return VStack(alignment: alignment, spacing: Theme.Space.s) {
            // One fixed slot from the first frame, whether the logo is still coming, arrives, or the name stands in.
            HeroLogo(path: logo, title: current.title, maxWidth: logoMaxWidth, maxHeight: logoMaxHeight,
                     nameSize: nameSize, alignment: wide ? .leading : .center)
                .frame(height: logoMaxHeight, alignment: wide ? .bottomLeading : .bottom)
            factsLine(alignment: alignment)
            if wide {
                headColumn(alignment: .leading)
                    .padding(.top, Theme.Space.xs)
            }
        }
        .frame(maxWidth: wide ? (Platform.isTV ? 1100 : 640) * Theme.scale : .infinity, alignment: wide ? .leading : .center)
        .frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.top, topExtra + Theme.Space.xl)
        .padding(.bottom, wide ? Theme.Space.xl : 0)
        // At least the picture's height, and taller when the words need it (a phone on its side): the picture fills the rest.
        .frame(minHeight: pictureHeight, alignment: .bottom)
        .background(alignment: .top) {
            ZStack {
                RemoteImage(url: TMDBImage.url(current.backdropPath, size: .original) ?? current.tmdbPosterURL,
                            maxPixel: Platform.isTV ? 1920 : 2400, fallbackTitle: nil)
                    .accessibilityHidden(true)
                HeroFade(wide: wide)
                HeroScrim(topInset: topExtra)
            }
            .clipped()
        }
        #if os(iOS)
        // With a margin each way, so the bar changing as the title collapses can't flip it straight back.
        .onGeometryChange(for: Bool.self) { [barBottom, titleCollapsed] proxy in
            guard proxy.size.height > 0 else { return false }
            let bottom = proxy.frame(in: .global).maxY
            if bottom < barBottom + 40 { return true }
            if bottom > barBottom + 56 { return false }
            return titleCollapsed
        } action: { collapsed in
            withAnimation(Theme.Motion.state) { titleCollapsed = collapsed }
        }
        #endif
    }

    private var logoMaxHeight: CGFloat {
        switch shape {
        case .phone: return 104
        case .wide: return min(120, max(64, viewport * 0.14))
        case .tv: return 170
        }
    }

    private var logoMaxWidth: CGFloat {
        switch shape {
        case .phone: return 300
        case .wide: return 460
        case .tv: return 700
        }
    }

    /// The name in Archivo capitals for a title with no logo, as Home's lead sets it.
    private var nameSize: CGFloat {
        switch shape {
        case .phone: return 44
        case .wide: return Platform.isMac ? 52 : 56
        case .tv: return 80
        }
    }

    /// "2024 · Science Fiction, Adventure · 2h47" and the certification in an outlined badge, one centred line under the
    /// logo (from the leading edge on a wide page).
    private func factsLine(alignment: HorizontalAlignment) -> some View {
        let parts = TitleHead.facts(year: current.year, genres: current.genres.map(\.name),
                                    runtimeMinutes: current.type == .movie ? current.runtimeMinutes : nil,
                                    seasons: current.type == .show ? detail?.numberOfSeasons : nil)
        let certification = current.certification.flatMap { $0.isEmpty ? nil : $0 }
        return HStack(spacing: Theme.Space.xs) {
            if !parts.isEmpty {
                Text(HeroLead.line(parts))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            if let certification {
                Text(certification)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 5 * Theme.scale)
                    .padding(.vertical, 1)
                    .overlay(Rectangle().strokeBorder(Theme.Palette.fg, lineWidth: Theme.Rule.thin))
                    .accessibilityLabel("Rated \(certification)")
            }
        }
        .font(Theme.Typeface.facts)
        .textCase(.uppercase)
        .tracking(0.06 * 12 * Theme.scale)
        .foregroundStyle(Theme.Palette.fg)
        .accessibilityElement(children: .combine)
    }

    /// Under the facts: how far into a started film, the ratings, the synopsis, then Play and the list actions in one row.
    private func headColumn(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: Theme.Space.m) {
            if let fraction = startedFraction {
                VStack(alignment: alignment, spacing: Theme.Space.xs) {
                    ProgressCapsule(value: fraction, height: 3 * Theme.scale)
                        .frame(width: 200 * Theme.scale)
                        .accessibilityElement()
                        .accessibilityLabel("\(Int((fraction * 100).rounded())) percent watched")
                    printLine
                }
            } else {
                printLine
            }
            ratingsRow(centered: alignment == .center)
            overviewBlock(alignment: alignment)
            actions(alignment: alignment)
        }
        .frame(maxWidth: wide ? .infinity : 560 * Theme.scale, alignment: wide ? .leading : .center)
    }

    private var startedFraction: Double? {
        guard current.type == .movie else { return nil }
        let progress = model.progress(for: current)
        return (progress?.percent ?? 0) > 1 ? Reel.watchedFraction(progress) : nil
    }

    /// "1h44 left · ends 22:56" for a started film; it ticks each minute, so the end time is right whenever it is read.
    @ViewBuilder
    private var printLine: some View {
        if current.type == .movie, startedFraction != nil {
            let progress = model.progress(for: current)
            let minutes = Reel.minutesLeft(progress: progress, runtimeMinutes: current.runtimeMinutes)
            let edge = EdgePrint(key: minutes.map { Reel.compactLeft(minutes: $0) }, endsInMinutes: minutes)
            if !edge.segments().isEmpty {
                TimelineView(.everyMinute) { context in
                    Text(edge.segments(now: context.date).map(\.text).joined(separator: " · "))
                        .font(Theme.Typeface.facts)
                        .detailCaps()
                        .foregroundStyle(Theme.Palette.muted)
                        .lineLimit(1)
                }
            }
        }
    }

    /// The scores fade in where their lines were kept from the first frame (as many as the chosen sources would fill), so
    /// the synopsis and Play don't move when they arrive.
    private func ratingsRow(centered: Bool) -> some View {
        let perLine = Platform.isPhone ? 4 : 7
        let expected = model.settings.metadata.ratingsShown.filter { $0 != .mal }.count
        let lines = expected == 0 ? 0 : (expected + perLine - 1) / perLine
        let reserved = CGFloat(lines) * 36 * Theme.scale + CGFloat(max(0, lines - 1)) * Theme.Space.xs
        return Group {
            if !ratings.isEmpty || current.voteAverage != nil {
                RatingsRow(ratings: ratings.isEmpty ? Ratings(tmdb: current.voteAverage) : ratings, item: current, centered: centered)
            }
        }
        .frame(minHeight: reserved, alignment: .top)
    }

    /// The synopsis, three lines until More; the tagline and the credits-scene note come with the rest of it.
    @ViewBuilder
    private func overviewBlock(alignment: HorizontalAlignment) -> some View {
        if let overview = current.overview, !overview.isEmpty {
            let textAlignment: TextAlignment = alignment == .center ? .center : .leading
            VStack(alignment: alignment, spacing: Theme.Space.xs) {
                if showFullOverview, let tagline = detail?.tagline, !tagline.isEmpty {
                    Text(tagline)
                        .font(Theme.Typeface.readingItalic)
                        .foregroundStyle(Theme.Palette.muted)
                        .multilineTextAlignment(textAlignment)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(overview)
                    .font(Theme.Typeface.reading)
                    .foregroundStyle(Theme.Palette.fg)
                    .lineSpacing(4)
                    .multilineTextAlignment(textAlignment)
                    .lineLimit(showFullOverview ? nil : 3)
                    .fixedSize(horizontal: false, vertical: true)
                // Decided by what is known from the first frame, so the button never appears late and moves what follows.
                if overview.count > 110 {
                    Button(showFullOverview ? "Less" : "More") { withAnimation(Theme.Motion.enter) { showFullOverview.toggle() } }
                        .buttonStyle(QuietButtonStyle())
                        // The word lines up with the text above, not with the button's own padding.
                        .padding(.leading, alignment == .leading ? -(Theme.Space.m + 2) : 0)
                        .padding(.vertical, -Theme.Space.xs)
                }
                if let scenes = detail?.creditsScenes, scenes.any {
                    Label(scenes.afterCredits ? (scenes.duringCredits ? "Scenes during and after the credits" : "Scene after the credits")
                                              : "Scene during the credits", systemImage: "sparkles")
                        .font(Theme.Typeface.facts)
                        .detailCaps()
                        .foregroundStyle(Theme.Palette.muted)
                }
            }
            .frame(maxWidth: 640 * Theme.scale, alignment: alignment == .center ? .center : .leading)
        }
    }

    // MARK: Actions

    /// What Play says: the verb, with the episode it would play ("S03E07") beside it in muted type. A film's time left is
    /// already on the line above, so its button says only Resume.
    private var playParts: (verb: String, detail: String?) {
        if current.type == .movie, let p = model.progress(for: current), p.percent > 1 {
            return ("Resume", nil)
        }
        if current.type == .show, let key = current.key, let entry = model.continueWatching.first(where: { $0.key == key }), let ep = entry.episode {
            return (entry.progress != nil ? "Resume" : "Play", ep.code)
        }
        // What Play opens: the next unwatched aired episode (a rewatch keeps its own list, so just "Play").
        if current.type == .show, !rewatching, let detail, let key = current.key {
            let aired = AppModel.airedEpisodes(detail)
            let state = model.showStates[key] ?? ShowWatchState(key: key)
            if let next = state.nextUp(aired: aired) ?? aired.first { return ("Play", next.code) }
        }
        return ("Play", nil)
    }

    /// "Resume S03E07", "Resume · 1 h 44 min left", "Play · ends 21:40": the button's spoken name, in full.
    private var playLabel: String {
        let parts = playParts
        if current.type == .movie, parts.verb == "Resume" {
            if let p = model.progress(for: current), let minutes = Reel.minutesLeft(progress: p, runtimeMinutes: current.runtimeMinutes) {
                return "Resume · \(Reel.left(minutes: minutes))"
            }
            return "Resume"
        }
        if let code = parts.detail { return "\(parts.verb) \(code)" }
        if current.type == .movie, let runtime = current.runtimeMinutes, runtime > 0 {
            return "Play · ends \(Reel.clock(Reel.endDate(from: Date(), minutesLeft: runtime)))"
        }
        return parts.verb
    }

    /// The height of every button in the row, and the width of each round one.
    private var buttonSide: CGFloat { Platform.isPhone ? 46 : 52 }

    /// Play, then the list actions as round buttons of one size, in one row. What doesn't fit on an iPhone or iPad is in
    /// More; the Mac and Apple TV have the room for all of it. Your rating, the next airing and Request follow.
    private func actions(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: Theme.Space.s) {
            HStack(spacing: Theme.Space.xs) {
                playButton
                ForEach(rowActions, id: \.self) { iconButton($0) }
                #if os(iOS)
                moreMenu
                #endif
            }
            .frame(maxWidth: wide ? nil : .infinity)
            RequestButton(item: current, seasons: detail?.seasons ?? [])
            if model.isWatched(current) || model.rating(for: current) != nil {
                HStack(spacing: Theme.Space.s) {
                    Text("Your Rating")
                        .font(Theme.Typeface.detailKey)
                        .detailCaps()
                        .foregroundStyle(Theme.Palette.muted)
                    RatingStars(item: current, size: 18)
                }
            }
            if let next = detail?.nextEpisode, let date = next.airDate { airsLine(next, date: date) }
        }
    }

    /// The one solid control: Resume or Play, with what it would play in muted type, taking the row's spare width on a phone.
    private var playButton: some View {
        let parts = playParts
        return Button { Task { await model.play(current, library: libraryProviderID) } } label: {
            HStack(spacing: 6 * Theme.scale) {
                Image(systemName: "play.fill")
                Text(parts.verb)
                if let detail = parts.detail {
                    Text(detail).opacity(0.6)
                }
            }
            .frame(minWidth: wide ? 180 * Theme.scale : nil)
        }
        .buttonStyle(HeroButtonStyle(kind: .pill, size: buttonSide, fill: !wide))
        .accessibilityLabel(playLabel)
        .focused($focus, equals: .play)
    }

    private enum ListAction: Hashable { case trailer, watchlist, watched, favourite, download, shuffle, rewatch, share }

    private var trailers: [Video] { detail?.trailers ?? [] }

    /// The round buttons in the row. A phone keeps Watchlist and Watched beside Play, so Play has room to say what it plays
    /// (Trailer leads its More); an iPad adds Trailer and Favourite; the Mac and Apple TV show everything, having no More.
    private var rowActions: [ListAction] {
        var out: [ListAction] = []
        if !trailers.isEmpty, !Platform.isPhone { out.append(.trailer) }
        out += [.watchlist, .watched]
        #if os(iOS)
        if Platform.isPad { out.append(.favourite) }
        #else
        out.append(.favourite)
        if Platform.supportsDownloads { out.append(.download) }
        if current.type == .show { out += [.shuffle, .rewatch] }
        #if os(macOS)
        out.append(.share)
        #endif
        #endif
        return out
    }

    @ViewBuilder
    private func iconButton(_ action: ListAction) -> some View {
        switch action {
        case .trailer:
            if trailers.count > 1 {
                Menu {
                    ForEach(Array(trailers.enumerated()), id: \.offset) { _, video in
                        Button(video.name) { openTrailer(video) }
                    }
                } label: {
                    Image(systemName: "film")
                }
                .buttonStyle(HeroButtonStyle(kind: .circle, size: buttonSide))
                .menuIndicator(.hidden)
                .accessibilityLabel("Trailer")
                .help("Trailer")
            } else if let video = trailers.first {
                round("Trailer", symbol: "film") { openTrailer(video) }
                    .accessibilityHint("Opens \(video.name) in YouTube")
            }
        case .watchlist:
            let listed = model.isWatchlisted(current)
            round(listed ? "Remove from Watchlist" : "Add to Watchlist", symbol: listed ? "bookmark.fill" : "bookmark", on: listed) {
                Task { await model.toggleWatchlist(current) }
            }
        case .watched:
            let watched = model.isWatched(current)
            round(watched ? "Watched" : "Mark Watched", symbol: watched ? "checkmark.circle.fill" : "checkmark.circle", on: watched) {
                Task { await model.setWatched(current, episodes: nil, watched: !watched) }
            }
        case .favourite:
            let favourite = model.isFavourite(current)
            round(favourite ? "Remove from Favourites" : "Add to Favourites", symbol: favourite ? "heart.fill" : "heart", on: favourite) {
                Task { await model.toggleFavourite(current) }
            }
        case .download:
            round("Download", symbol: "arrow.down.circle") { Task { await download() } }
        case .shuffle:
            round("Shuffle Play", symbol: "shuffle") { Task { await model.shufflePlay(current) } }
        case .rewatch:
            round(rewatching ? "End Rewatch" : "Rewatch", symbol: "arrow.counterclockwise", on: rewatching) { toggleRewatch() }
        case .share:
            #if os(tvOS)
            EmptyView()
            #else
            TitleShareLink(item: current) { Image(systemName: "square.and.arrow.up") }
                .buttonStyle(HeroButtonStyle(kind: .circle, size: buttonSide))
                .accessibilityLabel("Share")
                .help("Share")
            #endif
        }
    }

    /// One round action. One that is on draws its symbol filled, so "on" is told by shape and not by colour alone.
    private func round(_ label: String, symbol: String, on: Bool = false, perform: @escaping () -> Void) -> some View {
        Button(action: perform) { Image(systemName: symbol) }
            .buttonStyle(HeroButtonStyle(kind: .circle, size: buttonSide))
            .accessibilityLabel(label)
            .help(label)
            .sensoryFeedbackIfAvailable(on)
    }

    #if os(iOS)
    /// The rest of what can be done with the title, for the phone's and the iPad's shorter row.
    private var moreMenu: some View {
        Menu {
            if Platform.isPhone {
                ForEach(Array(trailers.enumerated()), id: \.offset) { _, video in
                    Button { openTrailer(video) } label: {
                        Label(trailers.count > 1 ? video.name : "Trailer", systemImage: "film")
                    }
                }
                let favourite = model.isFavourite(current)
                Button { Task { await model.toggleFavourite(current) } } label: {
                    Label(favourite ? "Remove from Favourites" : "Add to Favourites", systemImage: favourite ? "heart.fill" : "heart")
                }
            }
            if Platform.supportsDownloads {
                Button { Task { await download() } } label: { Label("Download", systemImage: "arrow.down.circle") }
            }
            if current.type == .show {
                Button { Task { await model.shufflePlay(current) } } label: { Label("Shuffle Play", systemImage: "shuffle") }
                Button { toggleRewatch() } label: {
                    Label(rewatching ? "End Rewatch" : "Rewatch", systemImage: "arrow.counterclockwise")
                }
            }
            TitleShareLink(item: current) { Label("Share", systemImage: "square.and.arrow.up") }
        } label: {
            Image(systemName: "ellipsis")
        }
        .buttonStyle(HeroButtonStyle(kind: .circle, size: buttonSide))
        .menuIndicator(.hidden)
        .accessibilityLabel("More")
    }
    #endif

    private func openTrailer(_ video: Video) {
        if let url = video.youtubeURL { model.openExternally(url) }
    }

    @ViewBuilder
    private func airsLine(_ next: Episode, date: Date) -> some View {
        let line = Label("\(next.code) airs \(AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))", systemImage: "calendar")
            .font(Theme.Typeface.facts)
            .detailCaps()
            .foregroundStyle(Theme.Palette.muted)
        #if os(tvOS)
        line
        #else
        Menu {
            AddToCalendarButton(item: current, episode: next, date: date)
        } label: {
            HStack(spacing: 4) {
                line
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.Palette.faint)
            }
        }
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        #endif
    }

    private func toggleRewatch() {
        Task {
            if rewatching { await model.endRewatch(current) } else { await model.startRewatch(current) }
            rewatching.toggle()
        }
    }

    /// The film, or the episode Play would open, through the picker unless automatic downloads pick for itself.
    private func download() async {
        var request: PlaybackRequest?
        if current.type == .movie {
            request = PlaybackRequest(item: current)
        } else if let ep = await model.nextEpisodeToPlay(for: current) {
            request = PlaybackRequest(item: current, episode: ep)
        }
        guard let request else { return }
        if model.settings.downloads.downloadAutomatically, await model.downloadAutomatically(request) { return }
        downloadRequest = request
    }

    // MARK: Sections

    @ViewBuilder
    private func sections(_ detail: MediaDetail) -> some View {
        if !detail.castRow.isEmpty {
            CastSection(cast: Array(detail.castRow.prefix(30)))
        }
        if general.showWhereToWatch, let availability = detail.availability, !availability.isEmpty {
            WhereToWatch(availability: availability)
        }
        if general.showReviews, !reviews.isEmpty {
            ReviewsSection(reviews: reviews, textSize: general.detailTextSize)
        }
        if let collection = detail.collection { collectionRow(collection) }
        if !detail.recommendations.isEmpty {
            RuledSection(title: "More Like This", paddedContent: false) {
                PosterRow(items: detail.recommendations, context: "recs-\(current.id)")
            }
        }
        if !detail.similar.isEmpty && detail.recommendations.count < 6 {
            RuledSection(title: "Similar", paddedContent: false) {
                PosterRow(items: detail.similar, context: "similar-\(current.id)")
            }
        }
        let about = AboutSection(detail: detail, essentialsOnly: !general.showAboutSection,
                                 airDatesInLocalTimeZone: model.settings.metadata.airDatesInLocalTimeZone)
        if !about.isEmpty { about }
    }

    /// The collection a film belongs to, as one row that lights up under the pointer or in focus.
    private func collectionRow(_ collection: MediaCollection) -> some View {
        RuledSection(title: "Collection") {
            Button { model.navigate(to: .collection(id: collection.id, name: collection.name)) } label: {
                CollectionCell(collection: collection)
            }
            .buttonStyle(RuledCellStyle())
        }
    }

    // MARK: Loading

    /// Skipped entirely when Reviews is off, so no request goes out.
    private func fetchReviews(from catalog: CatalogService, for item: MediaItem) async -> [Review] {
        guard general.showReviews else { return [] }
        return await catalog.reviews(for: item)
    }

    /// The title's logo art (cached by the catalogue), or "" when it has none, so its name is set instead.
    private func loadLogo() async {
        guard let catalog = model.catalog else { return }
        let found = await catalog.logo(for: current) ?? ""
        guard !Task.isCancelled else { return }
        logo = found
    }

    private func load() async {
        guard let catalog = model.catalog, let id = item.ids.tmdb else { return }
        do {
            let loaded = try await catalog.details(item.type, id: id)
            withAnimation(Theme.Motion.fade) { detail = loaded }
            Task { await model.prefetchSources(for: loaded.item) }
            if let key = loaded.item.key, loaded.item.type == .show {
                model.completedShowThresholds[key] = AppModel.airedEpisodes(loaded).count
                rewatching = await model.isRewatching(loaded.item)
                let firstRegular = loaded.seasons.first { $0.number > 0 }?.number ?? 0
                if let entry = model.continueWatching.first(where: { $0.key == key }), let ep = entry.episode, ep.season > 0 || general.showSpecialsSeason {
                    selectedSeason = ep.season
                } else {
                    selectedSeason = firstRegular
                }
            }
            async let ratingsTask = catalog.ratings(for: loaded.item)
            async let reviewsTask = fetchReviews(from: catalog, for: loaded.item)
            if loaded.item.type == .show { await loadEpisodes(loaded) }
            let fetched = await ratingsTask
            withAnimation(Theme.Motion.fade) { ratings = fetched }
            let fetchedReviews = await reviewsTask
            withAnimation(Theme.Motion.fade) { reviews = fetchedReviews }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension DetailView {
    /// Every season's episodes in one go; a failure leaves a Try Again in place of the list.
    fileprivate func loadEpisodes(_ loaded: MediaDetail) async {
        guard let provider = model.episodeProvider else { loadingEpisodes = false; return }
        loadingEpisodes = true
        episodesFailed = false
        do {
            episodesBySeason = try await provider.episodes(for: loaded.item, seasons: loaded.seasons)
        } catch is CancellationError {
            return
        } catch {
            episodesFailed = true
        }
        loadingEpisodes = false
    }
}


/// Cast as a row of round portraits (initials when TMDB has none), each with the name and the role under it, at one size.
private struct CastSection: View {
    let cast: [CastMember]

    private var side: CGFloat { (Platform.isPhone ? 88 : 104) * Theme.scale }

    var body: some View {
        RuledSection(title: "Cast", paddedContent: false) {
            FilmScroller(ids: cast.map(\.id), itemWidth: side) {
                ForEach(cast, id: \.id) { member in
                    NavigationLink(value: Route.person(id: member.id, name: member.name)) {
                        CastCell(member: member, side: side)
                    }
                    .buttonStyle(CardButtonStyle(lift: 1.04))
                    .accessibilityLabel(member.role.isEmpty ? member.name : "\(member.name), \(member.role)")
                }
            }
        }
    }
}

private struct CastCell: View {
    let member: CastMember
    let side: CGFloat
    @Environment(\.isFocused) private var focused

    var body: some View {
        VStack(spacing: Theme.Space.xs) {
            ZStack {
                Circle().fill(Theme.Palette.tint2)
                if member.profilePath != nil {
                    RemoteImage(url: TMDBImage.url(member.profilePath, size: .profile), maxPixel: 300)
                } else {
                    Text(initials)
                        .font(Theme.Typeface.custom(Theme.Face.sans, 26, .title3))
                        .foregroundStyle(Theme.Palette.muted)
                }
            }
            .frame(width: side, height: side)
            .clipShape(Circle())
            // Focus on Apple TV (and a keyboard) is the blue ring, round like the portrait.
            .overlay(Circle().strokeBorder(Theme.Palette.blue, lineWidth: focused ? Theme.Rule.focus : 0))
            .accessibilityHidden(true)
            // Two lines kept for every name, so a long one wraps and the row stays even.
            VStack(spacing: 2) {
                Text(member.name)
                    .font(Theme.Typeface.cardTitle)
                    .foregroundStyle(Theme.Palette.fg)
                    .lineLimit(2, reservesSpace: true)
                Text(member.role.isEmpty ? " " : member.role)
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.muted)
                    .lineLimit(1)
            }
            .multilineTextAlignment(.center)
            .frame(width: side)
        }
        .frame(width: side)
    }

    private var initials: String {
        member.name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
    }
}

/// The collection row: the franchise's still, its name and a line saying what is behind it.
private struct CollectionCell: View {
    let collection: MediaCollection
    @Environment(\.cellLit) private var lit

    var body: some View {
        HStack(spacing: Theme.Space.m) {
            Color.clear
                .frame(width: 120 * Theme.scale, height: 120 * Theme.scale * 9 / 16)
                .overlay(RemoteImage(url: TMDBImage.url(collection.backdropPath, size: .backdrop), maxPixel: 400, fallbackTitle: collection.name))
                .clipped()
                .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.onBlue : Theme.Palette.rule, lineWidth: Theme.Rule.thin))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(collection.name)
                    .font(Theme.Typeface.heading)
                    .textCase(.uppercase)
                    .multilineTextAlignment(.leading)
                Text("Every film in the collection")
                    .font(Theme.Typeface.facts)
                    .detailCaps()
                    .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 13 * Theme.scale, weight: .bold))
        }
        .padding(Theme.Space.s)
    }
}
