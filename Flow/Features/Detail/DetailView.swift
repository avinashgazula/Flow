import SwiftUI
import FlowKit

/// A title's page, as the website sets it: the giant uppercase title with its facts line under a rule, then a framed
/// still with the "how this plays" block under it beside the ratings, the one solid Play and what the viewer can do with
/// the title, then episodes, cast and the rest, each section opened by a 2px rule and a red label.
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
    private var wide: Bool { Platform.isTV || width >= 680 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xxl) {
                VStack(alignment: .leading, spacing: Theme.Space.xl) {
                    topInset
                    head
                    masthead
                }
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
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { new in
            if abs(new - width) > 0.5 { width = new }
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
        #endif
        .collapsingNavigationTitle(current.title, collapsed: titleCollapsed)
        .inlineNavigationTitle()
        .flowMinimizingToolbar()
        .task(id: item.id) { await load() }
        .task(id: item.id) { await watchBestVersion() }
        .advertisesTitle(current)
        .sheet(item: $downloadRequest) { request in
            SourcePickerView(request: request, forDownload: true).environment(model).largeSheetOnPad()
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

    // MARK: Head

    /// The giant title, then the facts line between a thin rule and the 2px rule that closes the head; the rules run edge
    /// to edge.
    private var head: some View {
        VStack(alignment: .leading, spacing: 0) {
            GiantTitle(text: current.title, width: width)
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.bottom, Theme.Space.m)
                #if os(iOS)
                // With a margin each way, so the bar changing as the title collapses can't flip it straight back.
                .onGeometryChange(for: Bool.self) { [barBottom, titleCollapsed] proxy in
                    guard proxy.size.height > 0 else { return false }
                    let bottom = proxy.frame(in: .global).maxY
                    if bottom < barBottom - 4 { return true }
                    if bottom > barBottom + 12 { return false }
                    return titleCollapsed
                } action: { collapsed in
                    withAnimation(Theme.Motion.state) { titleCollapsed = collapsed }
                }
                #endif
            let parts = factParts
            if !parts.isEmpty {
                RuleLine(thin: true)
                TitleFactsLine(parts: parts)
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.vertical, Theme.Space.s)
            }
            RuleLine()
        }
    }

    /// "2024", "2 h 47 min", "PG-13", "Science Fiction, Adventure": a mono line, a rule between the parts.
    private var factParts: [String] {
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
        return parts
    }

    // MARK: Masthead

    private var stillWidth: CGFloat { Platform.isTV ? 760 : min(520, width * 0.44) }

    /// The framed still and, under it, how the title plays: one column; beside the text on wide screens, above it otherwise.
    private var masthead: some View {
        Group {
            if wide {
                HStack(alignment: .top, spacing: Theme.Space.xl) {
                    visual.frame(width: stillWidth)
                    textColumn.frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    // Above the text a still never needs more than this, which keeps the title in view in a short window.
                    visual.frame(maxWidth: Platform.isPhone ? .infinity : 560, alignment: .leading)
                    textColumn
                }
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
    }

    private var visual: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            still
            progressBar
            printLine
            versionBlock.padding(.top, Theme.Space.s)
        }
    }

    /// The title's frame: the backdrop in a 2px rule.
    private var still: some View {
        Color.clear
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .overlay(RemoteImage(url: current.smallBackdropURL ?? current.tmdbPosterURL, maxPixel: Platform.isTV ? 1000 : 700, fallbackTitle: current.title))
            .clipped()
            .ruleFrame()
            .accessibilityHidden(true)
    }

    private var startedFraction: Double? {
        guard current.type == .movie else { return nil }
        let progress = model.progress(for: current)
        return (progress?.percent ?? 0) > 1 ? Reel.watchedFraction(progress) : nil
    }

    /// How far into a started film: a thin red bar with an ink border under the frame.
    @ViewBuilder
    private var progressBar: some View {
        if let fraction = startedFraction {
            Color.clear
                .frame(height: 12 * Theme.scale)
                .overlay(alignment: .leading) {
                    GeometryReader { proxy in
                        Theme.Palette.red.frame(width: proxy.size.width * min(1, max(0, fraction)))
                    }
                }
                .overlay(Rectangle().strokeBorder(Theme.Palette.rule, lineWidth: Theme.Rule.thin))
                .accessibilityElement()
                .accessibilityLabel("\(Int((fraction * 100).rounded())) percent watched")
        }
    }

    /// "1 h 44 left · ends 22:56" under the frame; it ticks each minute, so the end time is right whenever it is read.
    @ViewBuilder
    private var printLine: some View {
        if current.type == .movie {
            let progress = model.progress(for: current)
            let started = startedFraction != nil
            let minutes = Reel.minutesLeft(progress: progress, runtimeMinutes: current.runtimeMinutes)
            let edge = EdgePrint(key: started ? minutes.map { Reel.compactLeft(minutes: $0) } : nil, endsInMinutes: minutes)
            if !edge.segments().isEmpty {
                TimelineView(.everyMinute) { context in
                    Text(edge.segments(now: context.date).map(\.text).joined(separator: " · "))
                        .font(Theme.Typeface.caption)
                        .detailCaps()
                        .foregroundStyle(Theme.Palette.muted)
                        .lineLimit(2)
                }
            }
        }
    }

    private var textColumn: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            // Wide: the ratings lead the column. On a phone they come after the actions, so Play stays above the fold.
            if wide { ratingsRow }
            actions
            if !wide { ratingsRow }
            overviewBlock
        }
    }

    @ViewBuilder
    private var ratingsRow: some View {
        if !ratings.isEmpty || current.voteAverage != nil {
            RatingsRow(ratings: ratings.isEmpty ? Ratings(tmdb: current.voteAverage) : ratings, item: current)
        }
    }

    @ViewBuilder
    private var overviewBlock: some View {
        if let overview = current.overview, !overview.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                if let tagline = detail?.tagline, !tagline.isEmpty {
                    Text(tagline)
                        .font(Theme.Typeface.heading)
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.Palette.fg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(overview)
                    .font(Theme.Typeface.reading)
                    .foregroundStyle(Theme.Palette.fg)
                    .lineSpacing(5)
                    .lineLimit(showFullOverview ? nil : 5)
                    .fixedSize(horizontal: false, vertical: true)
                if overview.count > 220 {
                    Button(showFullOverview ? "Less" : "More") { withAnimation(Theme.Motion.enter) { showFullOverview.toggle() } }
                        .buttonStyle(QuietButtonStyle())
                        // The word lines up with the text above, not with the button's own padding.
                        .padding(.leading, -(Theme.Space.m + 2))
                }
                if let scenes = detail?.creditsScenes, scenes.any {
                    Label(scenes.afterCredits ? (scenes.duringCredits ? "Scenes during and after the credits" : "Scene after the credits")
                                              : "Scene during the credits", systemImage: "sparkles")
                        .font(Theme.Typeface.caption)
                        .detailCaps()
                        .foregroundStyle(Theme.Palette.muted)
                        .padding(.top, 6)
                }
            }
            .frame(maxWidth: 640 * Theme.scale, alignment: .leading)
            .padding(.top, Theme.Space.xs)
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
            if wide {
                #if os(tvOS)
                // Always one line at ten feet; the wrapping row measured wider than it was placed and dropped Trailer
                // half under the list actions.
                HStack(spacing: Theme.Space.s) {
                    playButton
                    if let trailers = detail?.trailers, !trailers.isEmpty { trailerButton(trailers, fill: false) }
                    RequestButton(item: current, seasons: detail?.seasons ?? [])
                }
                #else
                WrappingRow(spacing: Theme.Space.s, lineSpacing: Theme.Space.s) {
                    playButton
                    if let trailers = detail?.trailers, !trailers.isEmpty { trailerButton(trailers, fill: false) }
                    RequestButton(item: current, seasons: detail?.seasons ?? [])
                }
                #endif
            } else {
                // Play takes the line; Trailer and Request share the next, so the list under them stays above the fold.
                playButton
                HStack(spacing: Theme.Space.s) {
                    if let trailers = detail?.trailers, !trailers.isEmpty { trailerButton(trailers, fill: true) }
                    RequestButton(item: current, seasons: detail?.seasons ?? [], fill: true)
                }
            }
            listRow
                .padding(.top, Theme.Space.xs)
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

    /// The one solid control: Resume or Play, filling a phone's width.
    private var playButton: some View {
        Button { Task { await model.play(current, library: libraryProviderID) } } label: {
            Label(playLabel, systemImage: "play.fill")
                // One line, always: "Resume · 1 h 44 min left" must not wrap on Apple TV.
                .lineLimit(1)
                .frame(minWidth: wide ? 200 * Theme.scale : nil)
        }
        .buttonStyle(PrimaryButtonStyle(fill: !wide))
    }

    /// Owners decide by trailers, so it sits beside Play. More than one trailer makes it a menu.
    @ViewBuilder
    private func trailerButton(_ trailers: [Video], fill: Bool) -> some View {
        if trailers.count > 1 {
            Menu {
                ForEach(Array(trailers.enumerated()), id: \.offset) { _, video in
                    Button(video.name) { openTrailer(video) }
                }
            } label: {
                Text("Trailer")
            }
            .buttonStyle(GlassButtonStyle(fill: fill))
        } else if let video = trailers.first {
            Button { openTrailer(video) } label: { Text("Trailer") }
                .buttonStyle(GlassButtonStyle(fill: fill))
                .accessibilityHint("Opens \(video.name) in YouTube")
        }
    }

    private func openTrailer(_ video: Video) {
        if let url = video.youtubeURL { model.openExternally(url) }
    }

    private enum ListAction: Hashable { case watchlist, watched, favourite, download, shuffle, rewatch, share, more }

    /// Watchlist, Watched, Favourite and the rest, in the order they are laid out. An iPad's row would wrap onto a second
    /// line, so everything after the three list actions shares a menu there.
    private var listActions: [ListAction] {
        var out: [ListAction] = [.watchlist, .watched, .favourite]
        #if os(iOS)
        if Platform.isPad { return out + [.more] }
        #endif
        if Platform.supportsDownloads { out.append(.download) }
        if current.type == .show { out += [.shuffle, .rewatch] }
        #if !os(tvOS)
        out.append(.share)
        #endif
        return out
    }

    /// Everywhere but the phone, a bordered segmented row: the cells share their borders, and the ones that are on are inverted with a check. More
    /// than four split into even lines (five become three and two) so a lone cell never hangs on a line of its own, and
    /// the last line's cells stretch to fill it.
    @ViewBuilder
    private var listRow: some View {
        if Platform.isPhone {
            // One compact row of icon-over-label actions, as Apple's TV app sets them; it scrolls when a show adds
            // Shuffle and Rewatch, and stays put when everything fits.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(listActions, id: \.self) { listCell($0) }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Your List")
        } else {
            gridListRow
        }
    }

    private var gridListRow: some View {
        let actions = listActions
        let perLine = Platform.isPhone ? 2 : 4
        let lines = Int((Double(actions.count) / Double(perLine)).rounded(.up))
        let size = Int((Double(actions.count) / Double(max(lines, 1))).rounded(.up))
        let rows = stride(from: 0, to: actions.count, by: max(size, 1)).map { Array(actions[$0..<min($0 + size, actions.count)]) }
        return VStack(spacing: -Theme.Rule.heavy) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: -Theme.Rule.heavy) {
                    ForEach(rows[r], id: \.self) { listCell($0) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your List")
    }

    @ViewBuilder
    private func listCell(_ action: ListAction) -> some View {
        switch action {
        case .watched:
            let watched = model.isWatched(current)
            toggleCell("Watched", symbol: "checkmark.circle", onSymbol: "checkmark.circle.fill", on: watched, accessibility: watched ? "Watched" : "Mark Watched") {
                Task { await model.setWatched(current, episodes: nil, watched: !watched) }
            }
        case .watchlist:
            let listed = model.isWatchlisted(current)
            toggleCell("Watchlist", symbol: "bookmark", onSymbol: "bookmark.fill", on: listed, accessibility: listed ? "Remove from Watchlist" : "Add to Watchlist") {
                Task { await model.toggleWatchlist(current) }
            }
        case .favourite:
            let favourite = model.isFavourite(current)
            toggleCell("Favourite", symbol: "heart", onSymbol: "heart.fill", on: favourite, accessibility: favourite ? "Remove from Favourites" : "Add to Favourites") {
                Task { await model.toggleFavourite(current) }
            }
        case .download:
            toggleCell("Download", symbol: "arrow.down.circle", on: false, accessibility: "Download") { Task { await download() } }
        case .shuffle:
            toggleCell("Shuffle", symbol: "shuffle", on: false, accessibility: "Shuffle Play") { Task { await model.shufflePlay(current) } }
        case .rewatch:
            toggleCell(rewatching ? "End Rewatch" : "Rewatch", symbol: "arrow.counterclockwise", on: rewatching, accessibility: rewatching ? "End Rewatch" : "Rewatch") { toggleRewatch() }
        case .share:
            #if os(tvOS)
            EmptyView()
            #else
            TitleShareLink(item: current) {
                if Platform.isPhone { ListChipLabel(title: "Share", symbol: "square.and.arrow.up") } else { Text("Share") }
            }
            .buttonStyle(Platform.isPhone ? AnyButtonStyle(ListChipStyle()) : AnyButtonStyle(ListActionStyle()))
            #endif
        case .more:
            #if os(iOS)
            Menu {
                if Platform.supportsDownloads {
                    Button("Download") { Task { await download() } }
                }
                if current.type == .show {
                    Button("Shuffle") { Task { await model.shufflePlay(current) } }
                    Button(rewatching ? "End Rewatch" : "Rewatch") { toggleRewatch() }
                }
                TitleShareLink(item: current) { Label("Share", systemImage: "square.and.arrow.up") }
            } label: {
                Text("More")
            }
            .buttonStyle(ListActionStyle())
            #else
            EmptyView()
            #endif
        }
    }

    /// One list action; a check before the word says it is on.
    private func toggleCell(_ title: String, symbol: String, onSymbol: String? = nil, on: Bool, accessibility: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            if Platform.isPhone {
                ListChipLabel(title: title, symbol: on ? (onSymbol ?? symbol) : symbol)
            } else {
                HStack(spacing: 4) {
                    if on { Image(systemName: "checkmark").imageScale(.small) }
                    Text(title)
                }
            }
        }
        .buttonStyle(Platform.isPhone ? AnyButtonStyle(ListChipStyle(on: on)) : AnyButtonStyle(ListActionStyle(on: on)))
        .accessibilityLabel(accessibility)
        .sensoryFeedbackIfAvailable(on)
    }

    @ViewBuilder
    private func airsLine(_ next: Episode, date: Date) -> some View {
        let line = Label("\(next.code) airs \(AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))", systemImage: "calendar")
            .font(Theme.Typeface.caption)
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

    /// How the title plays, as ruled mono rows under the frame: the best version, how it plays on this device, and
    /// the sources (which open the picker).
    @ViewBuilder
    private var versionBlock: some View {
        if let best = bestVersion {
            VStack(alignment: .leading, spacing: 0) {
                RuleLine()
                VersionRow("Best version") {
                    Text(best.line.isEmpty ? "Unknown format" : best.line)
                }
                VersionRow("Plays") {
                    if let note = best.note, note.isWarning {
                        Text(note.text).foregroundStyle(Theme.Palette.warn)
                    } else if let note = best.note {
                        Text("Direct · " + note.text)
                    } else {
                        Text("Direct")
                    }
                }
                Button { Task { await model.play(current, library: libraryProviderID) } } label: {
                    VersionRow("Sources", bordered: false) {
                        HStack(spacing: Theme.Space.xs) {
                            Text(([String(best.count)] + best.providers.prefix(3)).joined(separator: " · "))
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.system(size: 11 * Theme.scale, weight: .bold))
                        }
                    }
                }
                .buttonStyle(RuledCellStyle())
                .ruledRow()
                .accessibilityHint("Opens the source list")
            }
            .transition(.opacity)
        }
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

    /// The collection a film belongs to, as one ruled row.
    private func collectionRow(_ collection: MediaCollection) -> some View {
        RuledSection(title: "Collection") {
            VStack(spacing: 0) {
                RuleLine(thin: true)
                Button { model.navigate(to: .collection(id: collection.id, name: collection.name)) } label: {
                    CollectionCell(collection: collection)
                }
                .buttonStyle(RuledCellStyle())
                .ruledRow()
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


/// One row of the how-it-plays block: a small muted name, then its value in larger print, a 1px rule under it. Inside the
/// Sources button it reads `cellLit`, since muted has no contrast on the blue.
private struct VersionRow<Value: View>: View {
    let name: String
    var bordered = true
    let value: Value
    @Environment(\.cellLit) private var lit

    init(_ name: String, bordered: Bool = true, @ViewBuilder value: () -> Value) {
        self.name = name
        self.bordered = bordered
        self.value = value()
    }

    var body: some View {
        let row = HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
            Text(name)
                .font(Theme.Typeface.detailKey)
                .detailCaps(0.12)
                .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted)
                .frame(width: 108 * Theme.scale, alignment: .leading)
            value
                .font(Theme.Typeface.control)
                .detailCaps(0.06, size: 13)
                .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, Theme.Space.s)
        .padding(.horizontal, Theme.Space.xs)
        .accessibilityElement(children: .combine)
        if bordered { row.ruledRow() } else { row }
    }
}

/// Cast as a ruled grid of cells: a portrait when TMDB has one, then the name and role. Six show; Show All opens the rest.
private struct CastSection: View {
    let cast: [CastMember]
    @State private var all = false

    private static let shown = 6

    var body: some View {
        RuledSection(title: "Cast") {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                RuledGrid(items: Array(cast.prefix(all ? cast.count : Self.shown)), columns: Platform.ruledColumns) { member, _ in
                    NavigationLink(value: Route.person(id: member.id, name: member.name)) {
                        CastCell(member: member)
                    }
                    .buttonStyle(RuledCellStyle())
                    .accessibilityLabel(member.role.isEmpty ? member.name : "\(member.name), \(member.role)")
                }
                if cast.count > Self.shown {
                    Button(all ? "Show Fewer" : "Show All \(cast.count)") { withAnimation(Theme.Motion.enter) { all.toggle() } }
                        .buttonStyle(QuietButtonStyle())
                        .padding(.leading, -(Theme.Space.m + 2))
                }
            }
        }
    }
}

private struct CastCell: View {
    let member: CastMember
    @Environment(\.cellLit) private var lit

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Space.s) {
            if member.profilePath != nil {
                RemoteImage(url: TMDBImage.url(member.profilePath, size: .profile), maxPixel: 200)
                    .frame(width: 44 * Theme.scale, height: 66 * Theme.scale)
                    .clipped()
                    .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.onBlue : Theme.Palette.rule, lineWidth: Theme.Rule.thin))
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name)
                    .font(Theme.Typeface.custom(Theme.Face.condensed, 17, .headline))
                    .textCase(.uppercase)
                    .multilineTextAlignment(.leading)
                if !member.role.isEmpty {
                    Text(member.role)
                        .font(Theme.Typeface.caption)
                        .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted)
                        .multilineTextAlignment(.leading)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
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
                    .font(Theme.Typeface.caption)
                    .detailCaps()
                    .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 13 * Theme.scale, weight: .bold))
        }
        .padding(Theme.Space.s)
    }
}
