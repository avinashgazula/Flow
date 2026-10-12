import SwiftUI
import FlowKit

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
    @State private var selectedTrailer = 0
    @State private var rewatching = false
    @State private var downloadRequest: PlaybackRequest?
    @State private var showFullOverview = false
    @State private var reviews: [Review] = []
    /// The logo has scrolled up under the navigation bar, so the bar shows the title instead.
    @State private var titleCollapsed = false
    /// Where the navigation bar ends, so the title collapses once the logo has passed beneath it.
    @State private var barBottom: CGFloat = 100

    private var general: GeneralSettings { model.settings.general }
    private var current: MediaItem { detail?.item ?? item }
    private var wide: Bool { !Platform.isPhone }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                header
                // Specials alone, with Specials Season off, leave nothing to list.
                if current.type == .show, let detail, detail.seasons.contains(where: { $0.number > 0 || general.showSpecialsSeason }) {
                    SeasonsSection(show: current, seasons: detail.seasons, episodesBySeason: episodesBySeason, selectedSeason: $selectedSeason, libraryProviderID: libraryProviderID,
                                   isLoading: loadingEpisodes, failed: episodesFailed) { Task { await loadEpisodes(detail) } }
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
        .detailTextSize(general.detailTextSize)
        .background(AmbientBackground(url: current.smallBackdropURL ?? current.tmdbPosterURL))
        #if os(iOS)
        .ignoresSafeArea(edges: .top)
        .background { Color.clear.onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { if $0 > 0 { barBottom = $0 } } }
        #elseif os(tvOS)
        .ignoresSafeArea(edges: [.top, .horizontal])
        #endif
        .collapsingNavigationTitle(current.title, collapsed: titleCollapsed)
        .inlineNavigationTitle()
        .task(id: item.id) { await load() }
        .advertisesTitle(current)
        .sheet(item: $downloadRequest) { request in
            SourcePickerView(request: request, forDownload: true).environment(model)
        }
    }

    // MARK: Header

    private var header: some View {
        ZStack(alignment: wide ? .bottomLeading : .bottom) {
            RemoteImage(url: wide ? TMDBImage.url(current.backdropPath, size: .original) : TMDBImage.url(current.heroPosterPath, size: .original),
                        maxPixel: wide ? 2000 : 1100, fallbackTitle: current.title)
                .frame(height: headerHeight)
                .frame(maxWidth: .infinity)
                .clipped()
                .mask(LinearGradient(stops: headerFade, startPoint: .top, endPoint: .bottom))
                .visualEffect { content, proxy in
                    let y = proxy.frame(in: .scrollView(axis: .vertical)).minY
                    return content
                        .scaleEffect(y > 0 ? 1 + y / max(proxy.size.height, 1) : 1, anchor: .bottom)
                        .offset(y: y < 0 ? -y * 0.4 : 0)
                }
            if wide {
                // Reaches across the text column, so ratings stay readable over bright skies.
                LinearGradient(stops: [.init(color: .black.opacity(0.75), location: 0), .init(color: .black.opacity(0.45), location: 0.4),
                                       .init(color: .clear, location: 0.75)],
                               startPoint: .leading, endPoint: .trailing)
                    .allowsHitTesting(false)
            }
            headerContent
                .padding(.horizontal, Theme.Space.gutter)
                .frame(maxWidth: wide ? 720 * Theme.scale : .infinity, alignment: wide ? .leading : .center)
        }
        .frame(minHeight: headerHeight)
    }

    private var headerContent: some View {
        VStack(alignment: wide ? .leading : .center, spacing: Theme.Space.m) {
            LogoOrTitle(logoPath: current.logoPath, title: current.title, maxHeight: Platform.isTV ? 200 : (wide ? 130 : 110),
                        alignment: wide ? .leading : .center)
                .frame(maxWidth: wide ? 520 : 330, alignment: wide ? .leading : .center)
                #if os(iOS)
                .onGeometryChange(for: Bool.self) { [barBottom] in $0.size.height > 0 && $0.frame(in: .global).maxY < barBottom } action: { collapsed in
                    withAnimation(Theme.Motion.fade) { titleCollapsed = collapsed }
                }
                #endif
            MetadataLine(item: current, certification: current.certification, showRating: false)
            if !ratings.isEmpty || current.voteAverage != nil {
                RatingsRow(ratings: ratings.isEmpty ? Ratings(tmdb: current.voteAverage) : ratings, item: current, centered: !wide)
            }
            actions
            if let overview = current.overview, !overview.isEmpty {
                VStack(alignment: wide ? .leading : .center, spacing: 4) {
                    if let tagline = detail?.tagline {
                        Text(tagline).font(Theme.Typeface.headline).foregroundStyle(.white.opacity(0.9))
                    }
                    Text(overview)
                        .font(Theme.Typeface.body)
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .multilineTextAlignment(wide ? .leading : .center)
                        .lineLimit(showFullOverview ? nil : 3)
                        .lineSpacing(2)
                    if !showFullOverview && overview.count > 160 {
                        Text("MORE").font(Theme.Typeface.micro).kerning(1).foregroundStyle(.white.opacity(0.85))
                    }
                    if let scenes = detail?.creditsScenes, scenes.any {
                        Label(scenes.afterCredits ? (scenes.duringCredits ? "Scenes during and after the credits" : "Scene after the credits")
                                                  : "Scene during the credits", systemImage: "sparkles")
                            .font(Theme.Typeface.caption)
                            .foregroundStyle(.white.opacity(0.85))
                            .padding(.top, 6)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { withAnimation(Theme.Motion.gentle) { showFullOverview.toggle() } }
                .frame(maxWidth: 640 * Theme.scale, alignment: wide ? .leading : .center)
            }
        }
    }

    /// On iPhone the poster's lower third carries its own title art; fade it out before the logo and buttons sit on it.
    private var headerFade: [Gradient.Stop] {
        wide
            ? [.init(color: .black, location: 0.55), .init(color: .clear, location: 1)]
            : [.init(color: .black, location: 0.4), .init(color: .black.opacity(0.4), location: 0.66), .init(color: .clear, location: 0.86)]
    }

    private var headerHeight: CGFloat {
        #if os(tvOS)
        900
        #elseif os(macOS)
        560
        #else
        Platform.isPhone ? 720 : 640
        #endif
    }

    // MARK: Actions

    private var playLabel: String {
        if current.type == .movie, let p = model.progress(for: current), p.percent > 1 {
            if let r = p.remainingSeconds { return "Resume · \(TimeFormat.remaining(r))" }
            return "Resume"
        }
        if current.type == .show, let key = current.key, let entry = model.continueWatching.first(where: { $0.key == key }), let ep = entry.episode {
            return entry.progress != nil ? "Resume \(ep.code)" : "Play \(ep.code)"
        }
        // What Play opens: the next unwatched aired episode (a rewatch keeps its own list, so just "Play").
        if current.type == .show, !rewatching, let detail, let key = current.key {
            let aired = AppModel.airedEpisodes(detail)
            let state = model.showStates[key] ?? ShowWatchState(key: key)
            if let next = state.nextUp(aired: aired) ?? aired.first { return "Play \(next.code)" }
        }
        return "Play"
    }

    private var actions: some View {
        VStack(alignment: wide ? .leading : .center, spacing: Theme.Space.s) {
            Button { Task { await model.play(current, library: libraryProviderID) } } label: {
                Label(playLabel, systemImage: "play.fill")
                    .frame(maxWidth: wide ? nil : .infinity)
                    .frame(minWidth: wide ? 240 * Theme.scale : nil)
            }
            .buttonStyle(PrimaryButtonStyle())
            .frame(maxWidth: wide ? nil : 420)

            GlassGroup(spacing: 12) {
                HStack(alignment: .top, spacing: wide ? Theme.Space.m : Theme.Space.xs) {
                    let watched = model.isWatched(current)
                    action(watched ? "checkmark.circle.fill" : "checkmark.circle", title: "Watched",
                           accessibility: watched ? "Watched" : "Mark Watched", active: watched) {
                        Task { await model.setWatched(current, episodes: nil, watched: !watched) }
                    }
                    action(model.isWatchlisted(current) ? "bookmark.fill" : "bookmark", title: "Watchlist", active: model.isWatchlisted(current)) {
                        Task { await model.toggleWatchlist(current) }
                    }
                    action(model.isFavourite(current) ? "heart.fill" : "heart", title: "Favourite", active: model.isFavourite(current)) {
                        Task { await model.toggleFavourite(current) }
                    }
                    if Platform.supportsDownloads {
                        action("arrow.down.circle", title: "Download", active: false) { Task { await download() } }
                    }
                    if current.type == .show {
                        // iPhone has room for four labelled actions; the show-only ones fold into More.
                        if wide {
                            action("shuffle", title: "Shuffle", active: false) { Task { await model.shufflePlay(current) } }
                            action("arrow.counterclockwise", title: rewatching ? "End Rewatch" : "Rewatch", active: rewatching) { toggleRewatch() }
                        } else {
                            Menu {
                                Button { Task { await model.shufflePlay(current) } } label: { Label("Shuffle Play", systemImage: "shuffle") }
                                Button { toggleRewatch() } label: {
                                    Label(rewatching ? "End Rewatch" : "Rewatch", systemImage: "arrow.counterclockwise")
                                }
                                #if !os(tvOS)
                                TitleShareLink(item: current) { Label("Share", systemImage: "square.and.arrow.up") }
                                #endif
                            } label: {
                                Label("More", systemImage: "ellipsis").labelStyle(DetailActionLabelStyle(active: false, glass: false))
                            }
                            .buttonStyle(DetailActionButtonStyle())
                            // iOS 27 stretches glass inside a menu's label over the whole label, title and all,
                            // so the circle sits behind the menu instead.
                            .background(alignment: .top) { DetailActionLabelStyle.circle }
                        }
                    }
                    #if !os(tvOS)
                    // On iPhone a show's Share lives in More; a film has the room for it (five across, like a show with More).
                    if wide || current.type == .movie {
                        TitleShareLink(item: current) {
                            Label("Share", systemImage: "square.and.arrow.up").labelStyle(DetailActionLabelStyle(active: false))
                        }
                        .buttonStyle(DetailActionButtonStyle())
                    }
                    #endif
                }
            }
            if model.isWatched(current) || model.rating(for: current) != nil {
                HStack(spacing: Theme.Space.s) {
                    Text("Your Rating").font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary)
                    RatingStars(item: current, size: 18)
                }
            }
            RequestButton(item: current, seasons: detail?.seasons ?? [])
            if let next = detail?.nextEpisode, let date = next.airDate { airsLine(next, date: date) }
        }
    }

    @ViewBuilder
    private func airsLine(_ next: Episode, date: Date) -> some View {
        let line = Label("\(next.code) airs \(AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))", systemImage: "calendar")
            .font(Theme.Typeface.caption)
            .foregroundStyle(Theme.Palette.textSecondary)
        #if os(tvOS)
        line
        #else
        Menu {
            AddToCalendarButton(item: current, episode: next, date: date)
        } label: {
            HStack(spacing: 4) {
                line
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.Palette.textTertiary)
            }
        }
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        #endif
    }

    /// An icon in a glass circle with its name underneath, so nobody has to guess what a symbol does.
    private func action(_ symbol: String, title: String, accessibility: String? = nil, active: Bool, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Label(title, systemImage: symbol).labelStyle(DetailActionLabelStyle(active: active))
        }
        .buttonStyle(DetailActionButtonStyle())
        .accessibilityLabel(accessibility ?? title)
        .sensoryFeedbackIfAvailable(active)
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
        if general.showWhereToWatch, let availability = detail.availability, !availability.isEmpty {
            WhereToWatch(availability: availability)
        }
        if general.showAboutSection {
            let about = AboutSection(detail: detail)
            if !about.isEmpty { about }
        }
        if general.showReviews, !reviews.isEmpty {
            ReviewsSection(reviews: reviews, textSize: general.detailTextSize)
        }
        if !detail.castRow.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHeader<Route>("Cast & Crew")
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Theme.Space.m) {
                        ForEach(detail.castRow.prefix(30)) { member in
                            PersonCard(id: member.id, name: member.name, role: member.role, profilePath: member.profilePath)
                        }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.vertical, Platform.isTV ? 24 : 2)
                }
                .scrollClipDisabled()
            }
        }
        if !detail.trailers.isEmpty { trailerSection(detail.trailers) }
        if let collection = detail.collection { collectionCard(collection) }
        if !detail.recommendations.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHeader<Route>("More Like This")
                PosterRow(items: detail.recommendations, context: "recs-\(current.id)")
            }
        }
        if !detail.similar.isEmpty && detail.recommendations.count < 6 {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHeader<Route>("Similar")
                PosterRow(items: detail.similar, context: "similar-\(current.id)")
            }
        }
        infoSection(detail)
    }

    private func collectionCard(_ collection: MediaCollection) -> some View {
        NavigationLink(value: Route.collection(id: collection.id, name: collection.name)) {
            ZStack(alignment: .bottomLeading) {
                RemoteImage(url: TMDBImage.url(collection.backdropPath, size: .backdropLarge), maxPixel: 1400, fallbackTitle: collection.name)
                    .frame(height: 150 * Theme.scale)
                    .frame(maxWidth: .infinity)
                    .clipped()
                LinearGradient(colors: [.clear, .black.opacity(0.8)], startPoint: .top, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 2) {
                    Text("PART OF THE").font(Theme.Typeface.micro).kerning(1.2).foregroundStyle(Theme.Palette.textSecondary)
                    Text(collection.name).font(Theme.Typeface.title).displayTracking()
                }
                .padding(Theme.Space.m)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .hairline(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        }
        .buttonStyle(CardButtonStyle())
        .padding(.horizontal, Theme.Space.gutter)
    }

    private func trailerSection(_ trailers: [Video]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack {
                if trailers.count > 1 {
                    Menu {
                        ForEach(Array(trailers.enumerated()), id: \.offset) { index, video in
                            Button(video.name) { selectedTrailer = index }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text("Trailers")
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 12 * Theme.scale, weight: .bold)).foregroundStyle(Theme.Palette.textTertiary)
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("Trailer")
                }
                Spacer()
            }
            .font(Theme.Typeface.sectionTitle)
            .displayTracking()
            .padding(.horizontal, Theme.Space.gutter)
            let video = trailers[min(selectedTrailer, trailers.count - 1)]
            Button {
                if let url = video.youtubeURL { model.openExternally(url) }
            } label: {
                ZStack {
                    RemoteImage(url: video.thumbnailURL, maxPixel: 900, fallbackTitle: video.name)
                    Color.black.opacity(0.15)
                    Image(systemName: "play.fill")
                        .font(.system(size: 22 * Theme.scale, weight: .bold))
                        .frame(width: 60 * Theme.scale, height: 60 * Theme.scale)
                        .flowGlass(Circle())
                }
                .frame(width: Platform.landscapeWidth * 1.5, height: Platform.landscapeWidth * 1.5 * 9 / 16)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .hairline(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .overlay(alignment: .bottomLeading) {
                    Text(video.name).font(Theme.Typeface.caption).padding(Theme.Space.s).shadow(radius: 4)
                }
                .artworkShadow(0.5)
            }
            .buttonStyle(CardButtonStyle())
            .accessibilityLabel("Play \(video.name)")
            .accessibilityHint("Opens in YouTube")
            .padding(.horizontal, Theme.Space.gutter)
        }
    }

    private func infoSection(_ detail: MediaDetail) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            Text("Information").font(Theme.Typeface.sectionTitle).displayTracking()
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150 * Theme.scale), spacing: Theme.Space.l, alignment: .topLeading)], alignment: .leading, spacing: Theme.Space.m) {
                if let date = detail.item.releaseDate {
                    info(detail.item.type == .movie ? "Released" : "First Aired", AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))
                }
                if let runtime = detail.item.runtimeMinutes, runtime > 0 { info("Runtime", TimeFormat.runtime(runtime)) }
                // About already lists these.
                if !general.showAboutSection, let status = detail.item.status { info("Status", status) }
                if let seasons = detail.numberOfSeasons { info("Seasons", String(seasons)) }
                if !general.showAboutSection, !detail.networks.isEmpty { info("Network", detail.networks.joined(separator: ", ")) }
                let directors = detail.crew.filter { $0.role == "Director" || $0.role == "Creator" }.map(\.name)
                if !directors.isEmpty { info(detail.item.type == .movie ? "Director" : "Created By", directors.joined(separator: ", ")) }
                if !general.showAboutSection, let lang = detail.item.originalLanguage { info("Language", Locale.current.localizedString(forLanguageCode: lang) ?? lang) }
                if let certification = detail.item.certification { info("Rated", certification) }
            }
        }
        .padding(Theme.Space.l)
        .background(Theme.Palette.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous))
        .hairline(RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous))
        .padding(.horizontal, Theme.Space.gutter)
    }

    private func info(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased()).font(Theme.Typeface.micro).kerning(0.8).foregroundStyle(Theme.Palette.textTertiary)
            Text(value).font(Theme.Typeface.body).foregroundStyle(.white.opacity(0.9))
        }
    }

    // MARK: Loading

    /// Skipped entirely when Reviews is off, so no request goes out.
    private func fetchReviews(from catalog: CatalogService, for item: MediaItem) async -> [Review] {
        guard general.showReviews else { return [] }
        return await catalog.reviews(for: item)
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

/// The scores chosen in Settings → Metadata → Ratings Shown, in that order.
struct RatingsRow: View {
    let ratings: Ratings
    /// The title, so a score can open its site's page when Tap a Rating is on.
    var item: MediaItem?
    var centered = false
    @Environment(AppModel.self) private var model

    private var metadata: MetadataSettings { model.settings.metadata }
    /// Only while a pack URL is set, so clearing the field brings the built-in badges straight back.
    private var iconPack: RatingIconPack? { metadata.ratingIconPackURL == nil ? nil : model.ratingIconPack }

    var body: some View {
        // One line when it fits; otherwise a second line, never a badge cut off at the screen's edge.
        WrappingRow(spacing: 14 * Theme.scale, lineSpacing: 10 * Theme.scale, centered: centered) {
            ForEach(metadata.ratingsShown) { source in
                chip(source)
            }
        }
        .font(.system(.subheadline, weight: .semibold).monospacedDigit())
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
        .task(id: metadata.ratingIconPackURL) { await model.loadRatingIconPack() }
    }

    @ViewBuilder
    private func chip(_ source: RatingSource) -> some View {
        if let value = text(for: source) {
            if let link = reviewsURL(for: source) {
                Button { model.openExternally(link) } label: { content(source, value) }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens \(source.title)")
            } else {
                content(source, value)
            }
        }
    }

    /// Nil when the source has no score for this title (MyAnimeList never does: Flow has no score source for it).
    private func text(for source: RatingSource) -> String? {
        switch source {
        case .imdb: return ratings.imdb.map { String(format: "%.1f", $0) }
        case .tomatometer: return ratings.rottenTomatoes.map { "\($0)%" }
        case .popcornmeter: return ratings.popcorn.map { "\($0)%" }
        case .metacritic: return ratings.metacritic.map { "\($0)" }
        case .tmdb: return ratings.tmdb.flatMap { $0 > 0 ? String(format: "%.1f", $0) : nil }
        case .letterboxd: return ratings.letterboxd.map { String(format: "%.1f", $0) }
        case .trakt: return ratings.trakt.map { "\($0)%" }
        case .mal: return nil
        }
    }

    /// Apple TV can't open web pages.
    private func reviewsURL(for source: RatingSource) -> URL? {
        #if os(tvOS)
        return nil
        #else
        guard metadata.tapRatingOpensReviews, let item else { return nil }
        return RatingLinks.url(for: source, item: item)
        #endif
    }

    @ViewBuilder
    private func content(_ source: RatingSource, _ value: String) -> some View {
        if let icon = iconPack?[source] {
            HStack(spacing: 5) {
                RemoteImage(url: icon, contentMode: .fit, maxPixel: 96)
                    .frame(width: 24 * Theme.scale, height: 16 * Theme.scale)
                Text(value)
            }
            .fixedSize()
            .accessibilityElement(children: .combine)
            .accessibilityLabel(source.spokenScore(value))
        } else {
            builtIn(source, value)
                .accessibilityLabel(source.spokenScore(value))
        }
    }

    @ViewBuilder
    private func builtIn(_ source: RatingSource, _ value: String) -> some View {
        switch source {
        case .imdb: badge("IMDb", value, fill: Color(red: 0.96, green: 0.77, blue: 0.09), dark: true)
        case .tomatometer:
            let rt = ratings.rottenTomatoes ?? 0
            score(symbol: rt >= 60 ? "circle.fill" : "drop.fill", color: rt >= 60 ? Color(red: 0.98, green: 0.2, blue: 0.1) : Color(red: 0.4, green: 0.75, blue: 0.2), value)
        case .popcornmeter: score(symbol: "popcorn.fill", color: Color(red: 0.98, green: 0.65, blue: 0.2), value)
        case .metacritic:
            let mc = ratings.metacritic ?? 0
            badge("MC", value, fill: mc >= 61 ? Color(red: 0.4, green: 0.8, blue: 0.2) : mc >= 40 ? Color(red: 1, green: 0.8, blue: 0.2) : Color(red: 1, green: 0.25, blue: 0.25), dark: true)
        case .tmdb: badge("TMDB", value, fill: Color(red: 0.05, green: 0.75, blue: 0.75), dark: true)
        case .letterboxd: badge("LB", value, fill: .white.opacity(0.18), dark: false)
        case .trakt: badge("Trakt", value, fill: .white.opacity(0.18), dark: false)
        case .mal: badge("MAL", value, fill: .white.opacity(0.18), dark: false)
        }
    }

    private func badge(_ label: String, _ value: String, fill: Color, dark: Bool) -> some View {
        HStack(spacing: 5) {
            Text(label)
                .font(.system(size: 10 * Theme.scale, weight: .heavy))
                .padding(.horizontal, 4).padding(.vertical, 2)
                .background(fill, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                .foregroundStyle(dark ? .black : .white)
            Text(value)
        }
        // Never squeezed: laid out at exactly its ideal width, a fraction of a point short truncates the label.
        .fixedSize()
        .accessibilityElement(children: .combine)
    }

    private func score(symbol: String, color: Color, _ value: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).foregroundStyle(color).imageScale(.small)
            Text(value)
        }
        .fixedSize()
        .accessibilityElement(children: .combine)
    }
}

extension View {
    /// A light tap when a toggle flips (iOS 17+).
    @ViewBuilder
    func sensoryFeedbackIfAvailable<T: Equatable>(_ trigger: T) -> some View {
        #if os(iOS)
        sensoryFeedback(.selection, trigger: trigger)
        #else
        self
        #endif
    }
}

/// The streaming services, rentals and stores carrying the title in the viewer's region.
struct WhereToWatch: View {
    let availability: Availability
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .firstTextBaseline) {
                Text("Where to Watch").font(Theme.Typeface.sectionTitle).displayTracking()
                Spacer()
                Text("Data from JustWatch").font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary)
            }
            .padding(.horizontal, Theme.Space.gutter)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.s) {
                    ForEach(availability.offers) { offer in
                        tile(offer.provider, kind: offer.kind)
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Platform.isTV ? 24 : 2)
            }
            .scrollClipDisabled()
        }
    }

    private func tile(_ provider: WatchProvider, kind: Availability.Kind) -> some View {
        Button {
            #if !os(tvOS)
            if let link = availability.link { model.openExternally(link) }
            #endif
        } label: {
            HStack(spacing: Theme.Space.s) {
                RemoteImage(url: TMDBImage.url(provider.logoPath, size: .posterSmall), maxPixel: 160, fallbackTitle: provider.providerName)
                    .frame(width: 40 * Theme.scale, height: 40 * Theme.scale)
                    .clipShape(RoundedRectangle(cornerRadius: 10 * Theme.scale, style: .continuous))
                    .hairline(RoundedRectangle(cornerRadius: 10 * Theme.scale, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(provider.providerName).font(.system(.subheadline, weight: .semibold)).lineLimit(1)
                    Text(kind.label).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary)
                }
            }
            .padding(.leading, Theme.Space.xs)
            .padding(.trailing, Theme.Space.m)
            .padding(.vertical, Theme.Space.xs)
            .background(Theme.Palette.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).strokeBorder(Theme.Palette.hairline))
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel("\(provider.providerName), \(kind.label)")
    }
}

/// A detail page action: the symbol in a glass circle, its name in small type below.
struct DetailActionLabelStyle: LabelStyle {
    let active: Bool
    var glass = true

    func makeBody(configuration: Configuration) -> some View {
        DetailActionLabel(icon: configuration.icon, title: configuration.title, active: active, glass: glass)
    }

    /// The glass circle on its own, for a label drawn with `glass: false`.
    static var circle: some View {
        Color.clear
            .frame(width: 50 * Theme.scale, height: 50 * Theme.scale)
            .flowGlass(Circle(), interactive: true)
            .allowsHitTesting(false)
    }
}

private struct DetailActionLabel<Icon: View, Title: View>: View {
    let icon: Icon
    let title: Title
    let active: Bool
    let glass: Bool
    /// Apple TV shows focus the system way: the circle turns white.
    @Environment(\.isFocused) private var focused

    var body: some View {
        VStack(spacing: 6 * Theme.scale) {
            icon
                .font(.system(size: 19 * Theme.scale, weight: .semibold))
                .foregroundStyle(focused ? Color.black : (active ? Color.accentColor : .white))
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 50 * Theme.scale, height: 50 * Theme.scale)
                .background { if focused { Circle().fill(.white) } }
                .modifier(ActionGlass(enabled: glass))
            title
                .font(.system(size: 11 * Theme.scale, weight: .semibold))
                .foregroundStyle(active || focused ? .white : Theme.Palette.textSecondary)
                .lineLimit(1)
                .fixedSize()
        }
        .frame(minWidth: 64 * Theme.scale)
        .contentShape(Rectangle())
    }
}

private struct ActionGlass: ViewModifier {
    let enabled: Bool

    func body(content: Content) -> some View {
        if enabled { content.flowGlass(Circle(), interactive: true) } else { content }
    }
}

struct DetailActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
            .modifier(FocusLift())
    }
}
