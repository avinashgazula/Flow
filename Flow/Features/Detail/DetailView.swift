import SwiftUI
import FlowKit

struct DetailView: View {
    let item: MediaItem
    @Environment(AppModel.self) private var model
    @State private var detail: MediaDetail?
    @State private var ratings = Ratings()
    @State private var error: String?
    @State private var episodesBySeason: [Int: [Episode]] = [:]
    @State private var selectedSeason = 1
    @State private var selectedTrailer = 0
    @State private var rewatching = false
    @State private var downloadRequest: PlaybackRequest?
    @State private var showFullOverview = false

    private var current: MediaItem { detail?.item ?? item }
    private var wide: Bool { !Platform.isPhone }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                header
                if current.type == .show, let detail, !detail.seasons.isEmpty {
                    SeasonsSection(show: current, seasons: detail.seasons, episodesBySeason: episodesBySeason, selectedSeason: $selectedSeason)
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
        .background(AmbientBackground(url: current.smallBackdropURL ?? current.posterURL))
        #if os(iOS)
        .ignoresSafeArea(edges: .top)
        #elseif os(tvOS)
        .ignoresSafeArea(edges: [.top, .horizontal])
        #endif
        .transparentNavigationBar()
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
                .mask(LinearGradient(stops: [.init(color: .black, location: 0.55), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
                .visualEffect { content, proxy in
                    let y = proxy.frame(in: .scrollView(axis: .vertical)).minY
                    return content
                        .scaleEffect(y > 0 ? 1 + y / max(proxy.size.height, 1) : 1, anchor: .bottom)
                        .offset(y: y < 0 ? -y * 0.4 : 0)
                }
            if wide {
                LinearGradient(colors: [.black.opacity(0.7), .clear], startPoint: .leading, endPoint: .center)
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
            MetadataLine(item: current, certification: current.certification, showRating: false)
            if !ratings.isEmpty || current.voteAverage != nil {
                RatingsRow(ratings: ratings.isEmpty ? Ratings(tmdb: current.voteAverage) : ratings, centered: !wide)
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
                }
                .contentShape(Rectangle())
                .onTapGesture { withAnimation(Theme.Motion.gentle) { showFullOverview.toggle() } }
                .frame(maxWidth: 640 * Theme.scale, alignment: wide ? .leading : .center)
            }
        }
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
        return current.type == .show ? "Play S01E01" : "Play"
    }

    private var actions: some View {
        VStack(spacing: Theme.Space.s) {
            Button { Task { await model.play(current) } } label: {
                Label(playLabel, systemImage: "play.fill")
                    .frame(maxWidth: wide ? nil : .infinity)
                    .frame(minWidth: wide ? 240 * Theme.scale : nil)
            }
            .buttonStyle(PrimaryButtonStyle())
            .frame(maxWidth: wide ? nil : 420)

            GlassGroup(spacing: 12) {
                HStack(spacing: 12) {
                    action(model.isWatched(current) ? "eye.fill" : "eye", label: model.isWatched(current) ? "Watched" : "Mark Watched", active: model.isWatched(current)) {
                        Task { await model.setWatched(current, episodes: nil, watched: !model.isWatched(current)) }
                    }
                    action(model.isWatchlisted(current) ? "bookmark.fill" : "bookmark", label: "Watchlist", active: model.isWatchlisted(current)) {
                        Task { await model.toggleWatchlist(current) }
                    }
                    action(model.isFavourite(current) ? "heart.fill" : "heart", label: "Favourite", active: model.isFavourite(current)) {
                        Task { await model.toggleFavourite(current) }
                    }
                    if current.type == .show {
                        action("shuffle", label: "Shuffle", active: false) { Task { await model.shufflePlay(current) } }
                        action("arrow.counterclockwise", label: rewatching ? "End Rewatch" : "Rewatch", active: rewatching) {
                            Task {
                                if rewatching { await model.endRewatch(current) } else { await model.startRewatch(current) }
                                rewatching.toggle()
                            }
                        }
                    }
                    if Platform.supportsDownloads {
                        action("arrow.down.circle", label: "Download", active: false) {
                            Task {
                                if current.type == .movie {
                                    downloadRequest = PlaybackRequest(item: current)
                                } else if let ep = await model.nextEpisodeToPlay(for: current) {
                                    downloadRequest = PlaybackRequest(item: current, episode: ep)
                                }
                            }
                        }
                    }
                }
            }
            if let next = detail?.nextEpisode, let date = next.airDate {
                Label("\(next.code) airs \(AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))", systemImage: "calendar")
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.textSecondary)
            }
        }
    }

    private func action(_ symbol: String, label: String, active: Bool, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Image(systemName: symbol)
                .foregroundStyle(active ? Color.accentColor : .white)
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(GlassButtonStyle(circle: true))
        .accessibilityLabel(label)
        .sensoryFeedbackIfAvailable(active)
    }

    // MARK: Sections

    @ViewBuilder
    private func sections(_ detail: MediaDetail) -> some View {
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
                if let status = detail.item.status { info("Status", status) }
                if let seasons = detail.numberOfSeasons { info("Seasons", String(seasons)) }
                if !detail.networks.isEmpty { info("Network", detail.networks.joined(separator: ", ")) }
                let directors = detail.crew.filter { $0.role == "Director" || $0.role == "Creator" }.map(\.name)
                if !directors.isEmpty { info(detail.item.type == .movie ? "Director" : "Created By", directors.joined(separator: ", ")) }
                if let lang = detail.item.originalLanguage { info("Language", Locale.current.localizedString(forLanguageCode: lang) ?? lang) }
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

    private func load() async {
        guard let catalog = model.catalog, let id = item.ids.tmdb else { return }
        do {
            let loaded = try await catalog.details(item.type, id: id)
            withAnimation(Theme.Motion.fade) { detail = loaded }
            if let key = loaded.item.key, loaded.item.type == .show {
                model.completedShowThresholds[key] = AppModel.airedEpisodes(loaded).count
                rewatching = await model.isRewatching(loaded.item)
                let firstRegular = loaded.seasons.first { $0.number > 0 }?.number ?? 0
                if let entry = model.continueWatching.first(where: { $0.key == key }), let ep = entry.episode {
                    selectedSeason = ep.season
                } else {
                    selectedSeason = firstRegular
                }
            }
            async let ratingsTask = catalog.ratings(for: loaded.item)
            if loaded.item.type == .show, let provider = model.episodeProvider {
                episodesBySeason = (try? await provider.episodes(for: loaded.item, seasons: loaded.seasons)) ?? [:]
            }
            let fetched = await ratingsTask
            withAnimation(Theme.Motion.fade) { ratings = fetched }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// IMDb · Rotten Tomatoes · Popcornmeter · Metacritic · TMDb · Letterboxd · Trakt
struct RatingsRow: View {
    let ratings: Ratings
    var centered = false

    var body: some View {
        // Centred when it fits, scrollable when it doesn't — never wider than the screen.
        GeometryReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                row
                    .padding(.horizontal, Theme.Space.gutter)
                    .frame(minWidth: proxy.size.width, alignment: centered ? .center : .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(height: 24 * Theme.scale)
        // Bleed to the screen edges so long rows scroll under the margins instead of clipping at them.
        .padding(.horizontal, -Theme.Space.gutter)
    }

    private var row: some View {
        HStack(spacing: 14 * Theme.scale) {
            if let imdb = ratings.imdb { badge("IMDb", String(format: "%.1f", imdb), fill: Color(red: 0.96, green: 0.77, blue: 0.09), dark: true) }
            if let rt = ratings.rottenTomatoes {
                score(symbol: rt >= 60 ? "circle.fill" : "drop.fill", color: rt >= 60 ? Color(red: 0.98, green: 0.2, blue: 0.1) : Color(red: 0.4, green: 0.75, blue: 0.2), "\(rt)%")
            }
            if let popcorn = ratings.popcorn { score(symbol: "popcorn.fill", color: Color(red: 0.98, green: 0.65, blue: 0.2), "\(popcorn)%") }
            if let mc = ratings.metacritic {
                badge("MC", "\(mc)", fill: mc >= 61 ? Color(red: 0.4, green: 0.8, blue: 0.2) : mc >= 40 ? Color(red: 1, green: 0.8, blue: 0.2) : Color(red: 1, green: 0.25, blue: 0.25), dark: true)
            }
            if let tmdb = ratings.tmdb, tmdb > 0 { badge("TMDB", String(format: "%.1f", tmdb), fill: Color(red: 0.05, green: 0.75, blue: 0.75), dark: true) }
            if let lb = ratings.letterboxd { badge("LB", String(format: "%.1f", lb), fill: .white.opacity(0.18), dark: false) }
            if let trakt = ratings.trakt { badge("Trakt", "\(trakt)%", fill: .white.opacity(0.18), dark: false) }
        }
        .font(.system(.subheadline, weight: .semibold).monospacedDigit())
        .fixedSize()
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
        .accessibilityElement(children: .combine)
    }

    private func score(symbol: String, color: Color, _ value: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).foregroundStyle(color).imageScale(.small)
            Text(value)
        }
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
