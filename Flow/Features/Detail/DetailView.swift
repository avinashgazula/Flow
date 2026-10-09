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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Platform.isTV ? 40 : 26) {
                header
                VStack(alignment: .leading, spacing: 18) {
                    RatingsRow(ratings: ratings)
                    if let overview = current.overview, !overview.isEmpty {
                        Text(overview)
                            .font(Platform.isTV ? .title3 : .body)
                            .lineLimit(showFullOverview ? nil : 4)
                            .onTapGesture { withAnimation { showFullOverview.toggle() } }
                    }
                    actionButtons
                    if current.type == .show { showExtras }
                }
                .padding(.horizontal, Platform.horizontalPadding)

                if current.type == .show, let detail, !detail.seasons.isEmpty {
                    SeasonsSection(show: current, seasons: detail.seasons, episodesBySeason: episodesBySeason, selectedSeason: $selectedSeason)
                }
                if let detail {
                    if !detail.castRow.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader<Route>("Cast")
                            ScrollView(.horizontal, showsIndicators: false) {
                                LazyHStack(alignment: .top, spacing: 14) {
                                    ForEach(detail.castRow.prefix(30)) { member in
                                        PersonCard(id: member.id, name: member.name, role: member.role, profilePath: member.profilePath)
                                    }
                                }
                                .padding(.horizontal, Platform.horizontalPadding)
                                .padding(.vertical, Platform.isTV ? 20 : 0)
                            }
                        }
                    }
                    if !detail.trailers.isEmpty { trailerSection(detail.trailers) }
                    if let collection = detail.collection {
                        NavigationLink(value: Route.collection(id: collection.id, name: collection.name)) {
                            HStack {
                                RemoteImage(url: TMDBImage.url(collection.backdropPath, size: .backdrop))
                                    .frame(width: 120, height: 68).clipShape(RoundedRectangle(cornerRadius: 8))
                                VStack(alignment: .leading) {
                                    Text("Part of").font(.caption).foregroundStyle(.secondary)
                                    Text(collection.name).font(.headline)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }
                            .padding(12)
                            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(CardButtonStyle())
                        .padding(.horizontal, Platform.horizontalPadding)
                    }
                    if !detail.recommendations.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader<Route>("More Like This")
                            PosterRow(items: detail.recommendations)
                        }
                    }
                    if !detail.similar.isEmpty && detail.recommendations.count < 6 {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader<Route>("Similar")
                            PosterRow(items: detail.similar)
                        }
                    }
                    infoSection(detail)
                } else if let error {
                    ContentUnavailableView("Couldn't Load Details", systemImage: "exclamationmark.triangle", description: Text(error))
                }
            }
            .padding(.bottom, 50)
        }
        .background(backgroundGlow)
        .ignoresSafeArea(edges: .top)
        .transparentNavigationBar()
        .inlineNavigationTitle()
        .task(id: item.id) { await load() }
        .sheet(item: $downloadRequest) { request in
            SourcePickerView(request: request, forDownload: true).environment(model)
        }
    }

    // MARK: Header

    private var header: some View {
        ZStack(alignment: .bottom) {
            RemoteImage(url: Platform.isPhone ? TMDBImage.url(current.posterPath, size: .original) : current.backdropURL)
                .frame(height: headerHeight)
                .frame(maxWidth: .infinity)
                .clipped()
            LinearGradient(colors: [.clear, .clear, .black.opacity(0.6), .black], startPoint: .top, endPoint: .bottom)
            VStack(spacing: 12) {
                LogoOrTitle(logoPath: current.logoPath, title: current.title, maxHeight: Platform.isTV ? 180 : 110)
                    .frame(maxWidth: Platform.isPhone ? 320 : 520)
                MetadataLine(item: current, certification: current.certification, showRating: false)
                if let tagline = detail?.tagline {
                    Text(tagline).font(.subheadline.italic()).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 8)
        }
        .frame(height: headerHeight)
    }

    private var headerHeight: CGFloat {
        #if os(tvOS)
        720
        #elseif os(macOS)
        460
        #else
        Platform.isPhone ? 620 : 540
        #endif
    }

    private var backgroundGlow: some View {
        RemoteImage(url: current.smallBackdropURL)
            .blur(radius: 80)
            .opacity(0.35)
            .ignoresSafeArea()
            .overlay(Color.black.opacity(0.55).ignoresSafeArea())
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
        return "Play"
    }

    private var actionButtons: some View {
        HStack(spacing: 12) {
            Button {
                Task { await model.play(current) }
            } label: {
                Label(playLabel, systemImage: "play.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(ActionButtonStyle(prominent: true))

            ActionIcon(systemImage: model.isWatched(current) ? "eye.fill" : "eye", active: model.isWatched(current)) {
                Task { await model.setWatched(current, episodes: nil, watched: !model.isWatched(current)) }
            }
            ActionIcon(systemImage: model.isFavourite(current) ? "heart.fill" : "heart", active: model.isFavourite(current)) {
                Task { await model.toggleFavourite(current) }
            }
            ActionIcon(systemImage: model.isWatchlisted(current) ? "bookmark.fill" : "bookmark", active: model.isWatchlisted(current)) {
                Task { await model.toggleWatchlist(current) }
            }
            if Platform.supportsDownloads {
                ActionIcon(systemImage: "arrow.down.circle", active: false) {
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

    private var showExtras: some View {
        HStack(spacing: 12) {
            Button {
                Task { await model.shufflePlay(current) }
            } label: {
                Label("Shuffle", systemImage: "shuffle").font(.subheadline.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 9)
            }
            .buttonStyle(ActionButtonStyle(prominent: false))
            Button {
                Task {
                    if rewatching { await model.endRewatch(current) } else { await model.startRewatch(current) }
                    rewatching.toggle()
                }
            } label: {
                Label(rewatching ? "End Rewatch" : "Rewatch", systemImage: "arrow.counterclockwise")
                    .font(.subheadline.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 9)
            }
            .buttonStyle(ActionButtonStyle(prominent: false))
            if let next = detail?.nextEpisode, let date = next.airDate {
                Text("Next: \(next.code) · \(AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Trailers & info

    private func trailerSection(_ trailers: [Video]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if trailers.count > 1 {
                    Menu {
                        ForEach(Array(trailers.enumerated()), id: \.offset) { index, video in
                            Button(video.name) { selectedTrailer = index }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text("Trailer").font(.title2.weight(.bold))
                            Image(systemName: "chevron.up.chevron.down").font(.subheadline.weight(.semibold))
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("Trailer").font(.title2.weight(.bold))
                }
                Spacer()
            }
            .padding(.horizontal, Platform.horizontalPadding)
            let video = trailers[min(selectedTrailer, trailers.count - 1)]
            Button {
                if let url = video.youtubeURL { model.openExternally(url) }
            } label: {
                ZStack {
                    RemoteImage(url: video.thumbnailURL)
                    Image(systemName: "play.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(.black)
                        .frame(width: 64, height: 64)
                        .background(.white, in: Circle())
                }
                .frame(width: Platform.landscapeWidth * 1.6, height: Platform.landscapeWidth * 0.9)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(alignment: .bottomLeading) {
                    Text(video.name).font(.caption.weight(.semibold)).padding(10).shadow(radius: 4)
                }
            }
            .buttonStyle(CardButtonStyle())
            .padding(.horizontal, Platform.horizontalPadding)
        }
    }

    private func infoSection(_ detail: MediaDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Information").font(.title3.weight(.bold))
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                if let date = detail.item.releaseDate {
                    info(detail.item.type == .movie ? "Released" : "First Aired", AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))
                }
                if let status = detail.item.status { info("Status", status) }
                if let runtime = detail.item.runtimeMinutes, runtime > 0 { info("Runtime", TimeFormat.runtime(runtime)) }
                if !detail.networks.isEmpty { info("Network", detail.networks.joined(separator: ", ")) }
                if let seasons = detail.numberOfSeasons { info("Seasons", String(seasons)) }
                let directors = detail.crew.filter { $0.role == "Director" || $0.role == "Creator" }.map(\.name)
                if !directors.isEmpty { info(detail.item.type == .movie ? "Director" : "Created By", directors.joined(separator: ", ")) }
                if let lang = detail.item.originalLanguage { info("Language", Locale.current.localizedString(forLanguageCode: lang) ?? lang) }
            }
            .font(.subheadline)
        }
        .padding(.horizontal, Platform.horizontalPadding)
    }

    private func info(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary)
            Text(value)
        }
    }

    // MARK: Loading

    private func load() async {
        guard let catalog = model.catalog, let id = item.ids.tmdb else { return }
        do {
            let loaded = try await catalog.details(item.type, id: id)
            detail = loaded
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
            ratings = await ratingsTask
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ActionButtonStyle: ButtonStyle {
    var prominent: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(prominent ? Color.black : Color.white)
            .background(prominent ? Color.white.opacity(configuration.isPressed ? 0.8 : 1) : Color.white.opacity(configuration.isPressed ? 0.2 : 0.12),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .modifier(FocusLift())
    }
}

struct ActionIcon: View {
    let systemImage: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(active ? Color.accentColor : .white)
                .frame(width: Platform.isTV ? 90 : 56, height: Platform.isTV ? 70 : 50)
                .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(CardButtonStyle())
    }
}

/// IMDb · RT · Popcornmeter · Metacritic · TMDB · Letterboxd · Trakt
struct RatingsRow: View {
    let ratings: Ratings

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 16) {
                if let imdb = ratings.imdb {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill").foregroundStyle(.yellow)
                        Text(String(format: "%.1f", imdb)).fontWeight(.semibold)
                    }
                }
                if let rt = ratings.rottenTomatoes { badge("RT", "\(rt)%", color: rt >= 60 ? .red : .green) }
                if let popcorn = ratings.popcorn {
                    HStack(spacing: 4) {
                        Image(systemName: "popcorn.fill").foregroundStyle(.orange)
                        Text("\(popcorn)%").fontWeight(.semibold)
                    }
                }
                if let mc = ratings.metacritic { badge("MC", "\(mc)", color: mc >= 61 ? .green : mc >= 40 ? .yellow : .red, filled: true) }
                if let tmdb = ratings.tmdb, tmdb > 0 { badge("TMDB", String(format: "%.1f", tmdb), color: .teal) }
                if let lb = ratings.letterboxd { badge("LB", String(format: "%.1f", lb), color: .gray) }
                if let trakt = ratings.trakt { badge("Trakt", "\(trakt)%", color: .gray) }
            }
            .font(Platform.isTV ? .callout : .subheadline)
        }
    }

    private func badge(_ label: String, _ value: String, color: Color, filled: Bool = false) -> some View {
        HStack(spacing: 5) {
            Text(label)
                .font(.caption2.weight(.heavy))
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(filled ? color : Color.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 4))
                .foregroundStyle(filled ? .black : .white)
            Text(value).fontWeight(.semibold)
        }
    }
}
