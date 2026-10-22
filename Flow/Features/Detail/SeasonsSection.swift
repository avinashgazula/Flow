import SwiftUI
import FlowKit

/// A show's episodes as stills with edge strips (the air date, the runtime, perforations for what is watched),
/// then the title and what it is about. Seasons are a standard segmented control.
struct SeasonsSection: View {
    let show: MediaItem
    let seasons: [Season]
    let episodesBySeason: [Int: [Episode]]
    @Binding var selectedSeason: Int
    var libraryProviderID: String?
    var isLoading = false
    var failed = false
    var retry: () -> Void = {}
    @Environment(AppModel.self) private var model

    private var orderedSeasons: [Season] {
        seasons.filter { $0.number > 0 } + (model.settings.general.showSpecialsSeason ? seasons.filter { $0.number == 0 } : [])
    }

    private var episodes: [Episode] {
        (episodesBySeason[selectedSeason] ?? []).sorted { $0.number < $1.number }
    }

    private var airedRefs: [EpisodeRef] { episodes.filter { ($0.airDate ?? .distantFuture) <= Date() }.map(\.ref) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            HStack(alignment: .firstTextBaseline) {
                Text("Episodes")
                    .font(Theme.Typeface.sectionTitle)
                    .foregroundStyle(Theme.Palette.text)
                    .displayTracking()
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if !airedRefs.isEmpty {
                    let allWatched = airedRefs.allSatisfy { model.isEpisodeWatched(show, $0) }
                    Button {
                        Task { await model.setWatched(show, episodes: airedRefs, watched: !allWatched) }
                    } label: {
                        Text(allWatched ? "Unwatch Season" : "Watch Season")
                    }
                    .buttonStyle(PlainActionButtonStyle())
                }
            }
            .padding(.horizontal, Theme.Space.gutter)

            seasonPicker

            if episodes.isEmpty && !isLoading {
                VStack(spacing: Theme.Space.s) {
                    Text(failed ? "Couldn't load the episodes. Check your connection and try again." : "No episodes listed for this season yet.")
                        .font(Theme.Typeface.body)
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .multilineTextAlignment(.center)
                    if failed { Button("Try Again", action: retry).buttonStyle(GlassButtonStyle()) }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.Space.l)
            } else if episodes.isEmpty {
                VStack(spacing: Theme.Space.s) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: Theme.Radius.artwork, style: .continuous).fill(Theme.Palette.panel).frame(height: 100)
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .shimmering()
            } else {
                LazyVStack(alignment: .leading, spacing: Theme.Space.m) {
                    ForEach(episodes) { episode in
                        EpisodeListing(show: show, episode: episode, libraryProviderID: libraryProviderID)
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
            }
        }
        .onAppear(perform: keepSelectionVisible)
        .onChange(of: model.settings.general.showSpecialsSeason) { _, _ in keepSelectionVisible() }
    }

    /// Specials turned off while season 0 was the one in view.
    private func keepSelectionVisible() {
        if !orderedSeasons.contains(where: { $0.number == selectedSeason }), let first = orderedSeasons.first {
            selectedSeason = first.number
        }
    }

    private func seasonLabel(_ season: Season) -> String {
        if season.isSpecials { return "Specials" }
        return orderedSeasons.count > 5 ? "S\(season.number)" : "Season \(season.number)"
    }

    private var seasonPicker: some View {
        let picker = Picker("Season", selection: $selectedSeason) {
            ForEach(orderedSeasons) { season in
                Text(seasonLabel(season)).tag(season.number)
            }
        }
        return Group {
            // A segmented control while the seasons fit across; a menu for a long-running show.
            if orderedSeasons.count <= 8 {
                picker.pickerStyle(.segmented)
            } else {
                picker.pickerStyle(.menu)
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
    }
}

/// One episode: its still with the edge strip, then the title and what it is about. Not-yet-aired episodes dim and
/// do nothing; the rest play.
struct EpisodeListing: View {
    let show: MediaItem
    let episode: Episode
    /// The library the title was opened from, for Play From This Library Only.
    var libraryProviderID: String? = nil
    @Environment(AppModel.self) private var model

    private var aired: Bool { (episode.airDate ?? .distantFuture) <= Date() }
    private var watched: Bool { model.isEpisodeWatched(show, episode.ref) }
    private var hidden: Bool { model.hidesSpoilers(show, episode) }
    private var frameWidth: CGFloat { Platform.isTV ? 420 : (Platform.isPhone ? 168 : 240) }

    /// With Episode Spoilers off, an aired, unwatched episode's still stays out of sight.
    private var art: ProgrammeArt {
        if hidden { return .stillImage(url: nil, title: "Episode \(episode.number)") }
        return .stillImage(url: TMDBImage.url(episode.stillPath, size: .still) ?? show.smallBackdropURL, title: episode.title)
    }

    private var airText: String? { episode.airDate.map { Programme.airPrint(for: $0) } }

    /// Perforations fill with how much is watched: all of them for a watched episode, none for one not yet started.
    private var strip: EdgePrint {
        let progress = model.progress(for: show, episode: episode.ref).map { $0.percent / 100 }
        let fill: Double? = aired ? (watched ? 1 : (progress ?? 0)) : nil
        let runtime = episode.runtimeMinutes.flatMap { $0 > 0 ? Programme.duration(minutes: $0) : nil }
        return EdgePrint(progress: fill, lead: [airText ?? "TBA"], tail: runtime.map { [$0] } ?? [])
    }

    private var spoken: String {
        var extra: [String] = []
        if let airText { extra.append(airText) }
        if let runtime = episode.runtimeMinutes, runtime > 0 { extra.append(Programme.spokenDuration(minutes: runtime)) }
        if watched { extra.append("watched") }
        return Programme.spokenListing(title: episode.title, episode: episode.ref, extra: extra)
    }

    var body: some View {
        Button {
            guard aired else { return }
            Task { await model.play(show, episode: episode, library: libraryProviderID) }
        } label: {
            HStack(alignment: .top, spacing: Theme.Space.m) {
                FilmFrame(art: art, strip: strip)
                    .frame(width: frameWidth)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(episode.number). \(episode.title)")
                        .font(Theme.Typeface.headline)
                        .foregroundStyle(Theme.Palette.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if let overview = episode.overview, !overview.isEmpty, !hidden {
                        Text(overview)
                            .font(.system(.subheadline))
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .lineLimit(Platform.isPhone ? 3 : 4)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .opacity(aired ? 1 : 0.55)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu { EpisodeMenu(show: show, episode: episode, libraryProviderID: libraryProviderID) }
    }
}

struct EpisodeMenu: View {
    let show: MediaItem
    let episode: Episode
    /// The library the title was opened from, for Play From This Library Only.
    var libraryProviderID: String? = nil
    @Environment(AppModel.self) private var model

    var body: some View {
        let watched = model.isEpisodeWatched(show, episode.ref)
        if (episode.airDate ?? .distantFuture) <= Date() {
            Button { Task { await model.play(show, episode: episode, library: libraryProviderID) } } label: { Label("Play", systemImage: "play.fill") }
        }
        Button {
            Task { await model.setWatched(show, episodes: [episode.ref], watched: !watched) }
        } label: {
            Label(watched ? "Mark as Unwatched" : "Mark as Watched", systemImage: watched ? "eye.slash" : "eye")
        }
        Button {
            // Specials can be numbered 0, and 1...0 would trap.
            let earlier = stride(from: min(1, episode.number), through: episode.number, by: 1).map { EpisodeRef(season: episode.season, episode: $0) }
            Task { await model.setWatched(show, episodes: earlier, watched: true) }
        } label: {
            Label("Mark Watched Up to Here", systemImage: "checkmark.circle")
        }
    }
}
