import SwiftUI
import FlowKit

/// A title's page: a masthead (the title, its plain facts, ratings as numbers, the one pink action, the best
/// version) beside or under a framed still, then episodes as listings, cast, and the rest.
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
    /// What Play would start, once the sources the page searched for have answered.
    @State private var bestVersion: AppModel.BestVersion?
    /// The title has scrolled up under the navigation bar, so the bar shows it instead.
    @State private var titleCollapsed = false
    /// Where the navigation bar ends, so the title collapses once it has passed beneath it.
    @State private var barBottom: CGFloat = 100
    /// The page's width, to choose between the one-column and two-column masthead.
    @State private var width: CGFloat = Platform.isPhone ? 0 : 1200

    private var general: GeneralSettings { model.settings.general }
    private var current: MediaItem { detail?.item ?? item }
    /// The still beside the text once there's room for both; above it otherwise.
    private var wide: Bool { Platform.isTV || width >= 820 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                topInset
                masthead
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
        .background(AmbientBackground(url: nil))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        #if os(iOS)
        .ignoresSafeArea(edges: .top)
        .background { Color.clear.onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { if $0 > 0 { barBottom = $0 } } }
        #elseif os(tvOS)
        .ignoresSafeArea(edges: [.top, .horizontal])
        #endif
        .collapsingNavigationTitle(current.title, collapsed: titleCollapsed)
        .inlineNavigationTitle()
        .flowMinimizingToolbar()
        .task(id: item.id) { await load() }
        .task(id: item.id) { await watchBestVersion() }
        .advertisesTitle(current)
        .sheet(item: $downloadRequest) { request in
            SourcePickerView(request: request, forDownload: true).environment(model)
        }
    }

    /// The page runs under the navigation bar on iPhone and iPad, and under the tab bar on Apple TV.
    @ViewBuilder
    private var topInset: some View {
        #if os(iOS)
        Color.clear.frame(height: max(0, barBottom - Theme.Space.s))
        #elseif os(tvOS)
        Color.clear.frame(height: 110)
        #endif
    }

    // MARK: Masthead

    private var stillWidth: CGFloat { Platform.isTV ? 760 : min(460, width * 0.42) }

    /// The still and, under it, the film-can label: one object; beside the text on wide screens, above it otherwise.
    private var masthead: some View {
        let visual = VStack(alignment: .leading, spacing: Theme.Space.m) {
            still
            versionLabel
        }
        return Group {
            if wide {
                HStack(alignment: .top, spacing: Theme.Space.xl) {
                    visual.frame(width: stillWidth)
                    textColumn.frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    visual
                    textColumn
                }
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
    }

    /// The title's frame with its edge strip: progress if it is started, and `2024 · 2 H 47 · ENDS 22:56`.
    private var still: some View {
        let progress = model.progress(for: current)
        let started = current.type == .movie && (progress?.percent ?? 0) > 1
        let minutes = current.type == .movie ? Reel.minutesLeft(progress: progress, runtimeMinutes: current.runtimeMinutes) : nil
        var lead: [String] = []
        if let year = current.year { lead.append(String(year)) }
        if current.type == .show {
            if let seasons = detail?.numberOfSeasons { lead.append(seasons == 1 ? "1 season" : "\(seasons) seasons") }
        } else if !started, let runtime = current.runtimeMinutes, runtime > 0 {
            lead.append(Reel.compactDuration(minutes: runtime))
        }
        let strip = EdgePrint(progress: started ? (progress?.percent ?? 0) / 100 : nil, lead: lead,
                              key: started ? minutes.map { Reel.compactLeft(minutes: $0) } : nil, endsInMinutes: minutes)
        return FilmFrame(art: .still(current), strip: strip)
            .accessibilityHidden(true)
    }

    private var textColumn: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                let factsText = facts
                if !factsText.isEmpty {
                    Text(factsText)
                        .font(.system(.subheadline).monospacedDigit())
                        .foregroundStyle(Theme.Palette.textSecondary)
                }
                Text(current.title)
                    .font(.system(.largeTitle, weight: .bold))
                    .tracking(-0.7)
                    .foregroundStyle(Theme.Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    #if os(iOS)
                    .onGeometryChange(for: Bool.self) { [barBottom] in $0.size.height > 0 && $0.frame(in: .global).maxY < barBottom } action: { collapsed in
                        withAnimation(Theme.Motion.fade) { titleCollapsed = collapsed }
                    }
                    #endif
            }
            if !ratings.isEmpty || current.voteAverage != nil {
                RatingsRow(ratings: ratings.isEmpty ? Ratings(tmdb: current.voteAverage) : ratings, item: current)
            }
            actions
            overviewBlock
        }
    }

    /// "2024 · 2 h 47 min · PG-13 · Science Fiction".
    private var facts: String {
        var parts: [String] = []
        if let year = current.year { parts.append(String(year)) }
        if current.type == .movie, let runtime = current.runtimeMinutes, runtime > 0 {
            parts.append(Reel.duration(minutes: runtime))
        } else if current.type == .show, let seasons = detail?.numberOfSeasons {
            parts.append(seasons == 1 ? "1 season" : "\(seasons) seasons")
        }
        if let certification = current.certification, !certification.isEmpty { parts.append(certification) }
        let genres = current.genres.prefix(2).map(\.name)
        if !genres.isEmpty { parts.append(genres.joined(separator: ", ")) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var overviewBlock: some View {
        if let overview = current.overview, !overview.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                if let tagline = detail?.tagline, !tagline.isEmpty {
                    Text(tagline).font(Theme.Typeface.headline).foregroundStyle(Theme.Palette.text)
                }
                Text(overview)
                    .font(.system(.body))
                    .foregroundStyle(Theme.Palette.text)
                    .lineSpacing(4)
                    .lineLimit(showFullOverview ? nil : 5)
                if !showFullOverview && overview.count > 220 {
                    Text("More").font(.system(.subheadline, weight: .semibold)).foregroundStyle(Theme.Palette.textSecondary)
                }
                if let scenes = detail?.creditsScenes, scenes.any {
                    Label(scenes.afterCredits ? (scenes.duringCredits ? "Scenes during and after the credits" : "Scene after the credits")
                                              : "Scene during the credits", systemImage: "sparkles")
                        .font(Theme.Typeface.caption)
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .padding(.top, 6)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { withAnimation(Theme.Motion.gentle) { showFullOverview.toggle() } }
            .frame(maxWidth: 640 * Theme.scale, alignment: .leading)
        }
    }

    // MARK: Actions

    private var playLabel: String {
        if current.type == .movie, let p = model.progress(for: current), p.percent > 1 {
            if let minutes = Reel.minutesLeft(progress: p, runtimeMinutes: current.runtimeMinutes) { return "Resume · \(Reel.left(minutes: minutes))" }
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
        if current.type == .movie, let runtime = current.runtimeMinutes, runtime > 0 {
            return "Play · ends \(Reel.clock(Reel.endDate(from: Date(), minutesLeft: runtime)))"
        }
        return "Play"
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(spacing: Theme.Space.s) {
                Button { Task { await model.play(current, library: libraryProviderID) } } label: {
                    Label(playLabel, systemImage: "play.fill")
                        // One line, always: "Resume · 1 h 44 min left" must not wrap on Apple TV.
                        .lineLimit(1)
                        .fixedSize(horizontal: wide, vertical: false)
                        .frame(maxWidth: wide ? nil : .infinity)
                        .frame(minWidth: wide ? 220 * Theme.scale : nil)
                }
                .buttonStyle(PrimaryButtonStyle())
                if let trailers = detail?.trailers, !trailers.isEmpty { trailerButton(trailers) }
            }
            textActions
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

    /// Owners decide by trailers, so it sits beside Play. More than one trailer makes it a menu.
    @ViewBuilder
    private func trailerButton(_ trailers: [Video]) -> some View {
        if trailers.count > 1 {
            Menu {
                ForEach(Array(trailers.enumerated()), id: \.offset) { _, video in
                    Button(video.name) { openTrailer(video) }
                }
            } label: {
                Text("Trailer")
            }
            .buttonStyle(GlassButtonStyle())
        } else if let video = trailers.first {
            Button { openTrailer(video) } label: { Text("Trailer") }
                .buttonStyle(GlassButtonStyle())
                .accessibilityHint("Opens \(video.name) in YouTube")
        }
    }

    private func openTrailer(_ video: Video) {
        if let url = video.youtubeURL { model.openExternally(url) }
    }

    /// Watchlist, Watched, Favourite, Download and Share as plain labelled text, wrapping when they must.
    private var textActions: some View {
        WrappingRow(spacing: Theme.Space.m, lineSpacing: 0) {
            let watched = model.isWatched(current)
            textAction("Watched", active: watched, accessibility: watched ? "Watched" : "Mark Watched") {
                Task { await model.setWatched(current, episodes: nil, watched: !watched) }
            }
            let listed = model.isWatchlisted(current)
            textAction("Watchlist", active: listed, accessibility: listed ? "Remove from Watchlist" : "Add to Watchlist") {
                Task { await model.toggleWatchlist(current) }
            }
            let favourite = model.isFavourite(current)
            textAction("Favourite", active: favourite, accessibility: favourite ? "Remove from Favourites" : "Add to Favourites") {
                Task { await model.toggleFavourite(current) }
            }
            if Platform.supportsDownloads {
                textAction("Download", active: false, accessibility: "Download") { Task { await download() } }
            }
            if current.type == .show {
                textAction("Shuffle", active: false, accessibility: "Shuffle Play") { Task { await model.shufflePlay(current) } }
                textAction(rewatching ? "End Rewatch" : "Rewatch", active: rewatching, accessibility: rewatching ? "End Rewatch" : "Rewatch") { toggleRewatch() }
            }
            #if !os(tvOS)
            TitleShareLink(item: current) { Text("Share") }
                .buttonStyle(PlainActionButtonStyle())
            #endif
        }
    }

    /// One text action; a small check after the word says it is on.
    private func textAction(_ title: String, active: Bool, accessibility: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            HStack(spacing: 4) {
                Text(title)
                if active { Image(systemName: "checkmark").imageScale(.small) }
            }
        }
        .buttonStyle(PlainActionButtonStyle())
        .accessibilityLabel(accessibility)
        .sensoryFeedbackIfAvailable(active)
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

    /// The film-can label: what will play and how, as edge print. Best version, how it plays on this device, and
    /// the sources (which open the picker).
    @ViewBuilder
    private var versionLabel: some View {
        if let best = bestVersion {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                labelRow("Best version") {
                    Text(best.line.isEmpty ? "Unknown format" : best.line)
                        .foregroundStyle(Theme.Palette.print)
                }
                labelRow("Plays") {
                    if let note = best.note, note.isWarning {
                        Text(note.text).foregroundStyle(Theme.Palette.warn)
                    } else if let note = best.note {
                        Text("Direct · " + note.text).foregroundStyle(Theme.Palette.print)
                    } else {
                        Text("Direct").foregroundStyle(Theme.Palette.stock)
                    }
                }
                Button { Task { await model.play(current, library: libraryProviderID) } } label: {
                    labelRow("Sources") {
                        Text(([String(best.count)] + best.providers.prefix(3)).joined(separator: " · "))
                            .foregroundStyle(Theme.Palette.print)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the source list")
            }
            .padding(Theme.Space.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Palette.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.frame, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.frame, style: .continuous).strokeBorder(Theme.Palette.line, lineWidth: 1))
            .transition(.opacity)
        }
    }

    /// One row of the label: a small tracked name, then its value in larger print.
    private func labelRow<Value: View>(_ name: String, @ViewBuilder value: () -> Value) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
            Text(name)
                .font(Theme.Typeface.edgePrint)
                .edgePrint(tracking: 1.6)
                .foregroundStyle(Theme.Palette.textTertiary)
                .frame(width: 92 * Theme.scale, alignment: .leading)
            value()
                .font(Font.system(.subheadline, weight: .semibold).width(.condensed).monospacedDigit())
                .edgePrint()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
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
        if let collection = detail.collection { collectionRow(collection) }
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
        let about = AboutSection(detail: detail, essentialsOnly: !general.showAboutSection,
                                 airDatesInLocalTimeZone: model.settings.metadata.airDatesInLocalTimeZone)
        if !about.isEmpty { about }
    }

    /// The collection a film belongs to, as one listing.
    private func collectionRow(_ collection: MediaCollection) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>("Collection")
            ProgrammeList {
                ProgrammeRow(
                    art: .stillImage(url: TMDBImage.url(collection.backdropPath, size: .backdrop), title: collection.name),
                    title: collection.name,
                    meta: "Every film in the collection",
                    action: { model.navigate(to: .collection(id: collection.id, name: collection.name)) }
                )
            }
        }
    }

    // MARK: Loading

    /// Skipped entirely when Reviews is off, so no request goes out.
    private func fetchReviews(from catalog: CatalogService, for item: MediaItem) async -> [Review] {
        guard general.showReviews else { return [] }
        return await catalog.reviews(for: item)
    }

    /// The sources Prefetch on Detail View finds arrive a little after the page opens, so this waits for them.
    private func watchBestVersion() async {
        guard let request = await model.playRequest(for: item) else { return }
        for _ in 0..<40 {
            if let found = model.bestVersion(for: request) {
                withAnimation(Theme.Motion.fade) { bestVersion = found }
                return
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if Task.isCancelled { return }
        }
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

/// The scores chosen in Settings → Metadata → Ratings Shown, in that order: each an aligned number with the
/// source's name under it. No logos and no colour; a custom icon pack (Settings) still replaces the name.
struct RatingsRow: View {
    let ratings: Ratings
    /// The title, so a score can open its site's page when Tap a Rating is on.
    var item: MediaItem?
    @Environment(AppModel.self) private var model

    private var metadata: MetadataSettings { model.settings.metadata }
    /// Only while a pack URL is set, so clearing the field brings the plain names straight back.
    private var iconPack: RatingIconPack? { metadata.ratingIconPackURL == nil ? nil : model.ratingIconPack }

    var body: some View {
        // One line when it fits; otherwise a second line, never a score cut off at the screen's edge.
        WrappingRow(spacing: 28 * Theme.scale, lineSpacing: 14 * Theme.scale) {
            ForEach(metadata.ratingsShown) { source in
                score(source)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: metadata.ratingIconPackURL) { await model.loadRatingIconPack() }
    }

    @ViewBuilder
    private func score(_ source: RatingSource) -> some View {
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

    private func content(_ source: RatingSource, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(.title2, weight: .semibold).monospacedDigit())
                .foregroundStyle(Theme.Palette.text)
            if let icon = iconPack?[source] {
                RemoteImage(url: icon, contentMode: .fit, maxPixel: 96)
                    .frame(width: 24 * Theme.scale, height: 14 * Theme.scale, alignment: .leading)
            } else {
                Text(source.title)
                    .font(.system(.caption))
                    .foregroundStyle(Theme.Palette.textTertiary)
            }
        }
        .fixedSize()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(source.spokenScore(value))
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

/// A plain labelled text action: paper text on the ground, 44 pt tall. On Apple TV the focused one fills with the spot.
struct PlainActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PlainActionBody(configuration: configuration)
    }
}

private struct PlainActionBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) private var focused

    var body: some View {
        configuration.label
            .font(.system(.subheadline, weight: .semibold))
            // A word is never broken across lines ("Watche / d").
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .foregroundStyle(focused ? Theme.Palette.onStock : Theme.Palette.text)
            .padding(.horizontal, Theme.Space.xs)
            .frame(minHeight: 44 * Theme.scale)
            .background(focused ? Theme.Palette.spot : Color.clear, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
            .modifier(FocusLift(scale: 1.04))
    }
}
