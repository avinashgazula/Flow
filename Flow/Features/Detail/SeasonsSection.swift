import SwiftUI
import FlowKit

/// A show's episodes as a row of equal cards under the season's name, which is the picker (a menu: "Season 3 ⌄"). Each card
/// is a 16:9 still (the show's art, dimmed, with the number over it when TMDB has no still), then "Episode 7", the title,
/// the runtime and rating, and the air date, every line one line high. The row opens at the episode to watch next.
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

    /// The first aired episode not yet watched: where the row opens.
    private var nextID: Episode.ID? {
        episodes.first { ($0.airDate ?? .distantFuture) <= Date() && !model.isEpisodeWatched(show, $0.ref) }?.id
    }

    private var cardWidth: CGFloat { Platform.landscapeWidth }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                seasonPicker
                Spacer(minLength: 0)
                if !airedRefs.isEmpty {
                    let allWatched = airedRefs.allSatisfy { model.isEpisodeWatched(show, $0) }
                    Button {
                        Task { await model.setWatched(show, episodes: airedRefs, watched: !allWatched) }
                    } label: {
                        Text(allWatched ? "Unwatch Season" : "Watch Season")
                    }
                    .buttonStyle(QuietButtonStyle())
                    // The word's right edge lines up with the page's margin, not with the button's own padding.
                    .padding(.trailing, -(Theme.Space.m + 2))
                }
            }
            .padding(.horizontal, Theme.Space.gutter)

            if episodes.isEmpty && !isLoading {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    Text(failed ? "Couldn't load the episodes. Check your connection and try again." : "No episodes listed for this season yet.")
                        .font(Theme.Typeface.body)
                        .foregroundStyle(Theme.Palette.muted)
                    if failed { Button("Try Again", action: retry).buttonStyle(GlassButtonStyle()) }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Theme.Space.s)
            } else if episodes.isEmpty {
                HStack(spacing: Theme.Space.card) {
                    ForEach(0..<4, id: \.self) { _ in
                        Rectangle().fill(Theme.Palette.tint1)
                            .frame(width: cardWidth, height: cardWidth * 9 / 16)
                            .ruleFrame(Theme.Palette.tint3, width: Theme.Rule.thin)
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .frame(maxWidth: .infinity, alignment: .leading)
                .clipped()
                .shimmering()
                .accessibilityHidden(true)
            } else {
                ScrollViewReader { proxy in
                    FilmScroller(ids: episodes.map(\.id), itemWidth: cardWidth) {
                        ForEach(episodes) { episode in
                            EpisodeListing(show: show, episode: episode, libraryProviderID: libraryProviderID, width: cardWidth)
                                .id(episode.id)
                        }
                    }
                    .onAppear { reveal(proxy) }
                    .onChange(of: selectedSeason) { _, _ in reveal(proxy) }
                }
            }
        }
        .onAppear(perform: keepSelectionVisible)
        .onChange(of: model.settings.general.showSpecialsSeason) { _, _ in keepSelectionVisible() }
    }

    /// Opens the row at the episode to watch next, so a show halfway through doesn't start at its first episode.
    private func reveal(_ proxy: ScrollViewProxy) {
        guard let nextID, nextID != episodes.first?.id else { return }
        DispatchQueue.main.async { proxy.scrollTo(nextID, anchor: .leading) }
    }

    /// Specials turned off while season 0 was the one in view.
    private func keepSelectionVisible() {
        if !orderedSeasons.contains(where: { $0.number == selectedSeason }), let first = orderedSeasons.first {
            selectedSeason = first.number
        }
    }

    private func seasonLabel(_ season: Season) -> String {
        season.isSpecials ? "Specials" : "Season \(season.number)"
    }

    private var currentLabel: String {
        orderedSeasons.first { $0.number == selectedSeason }.map(seasonLabel) ?? "Episodes"
    }

    /// The season's name as the section's title; with more than one season it is a menu of them, marked by a chevron.
    @ViewBuilder
    private var seasonPicker: some View {
        if orderedSeasons.count > 1 {
            Menu {
                ForEach(orderedSeasons) { season in
                    Button { selectedSeason = season.number } label: {
                        if season.number == selectedSeason {
                            Label(seasonLabel(season), systemImage: "checkmark")
                        } else {
                            Text(seasonLabel(season))
                        }
                    }
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 6 * Theme.scale) {
                    Text(currentLabel)
                        .font(Theme.Typeface.shelfTitle)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: (Platform.isPhone ? 13 : 15) * Theme.scale, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .lineLimit(1)
            }
            .buttonStyle(SeasonPickerStyle())
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("Season")
            .accessibilityValue(currentLabel)
        } else {
            Text(currentLabel)
                .font(Theme.Typeface.shelfTitle)
                .foregroundStyle(Theme.Palette.fg)
                .accessibilityAddTraits(.isHeader)
        }
    }
}

/// The season picker's title: ink at rest, inverted to the action colour under the pointer or in focus, as the shelves'
/// titles are.
private struct SeasonPickerStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        SeasonPickerBody(configuration: configuration)
    }
}

private struct SeasonPickerBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering
        let pad = (Platform.isTV ? 12 : 6) * Theme.scale
        configuration.label
            .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.fg)
            .padding(.horizontal, pad)
            .padding(.vertical, pad / 2)
            .background(lit ? Theme.Palette.blue : Color.clear)
            .padding(.horizontal, -pad)
            .padding(.vertical, -pad / 2)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
            .scaleEffect(focused ? 1.04 : 1, anchor: .leading)
            .animation(Theme.Motion.hover, value: lit)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// One episode as a card. Not-yet-aired episodes dim and do nothing; the rest play. Spoiler hiding swaps the still and
/// title for the number.
struct EpisodeListing: View {
    let show: MediaItem
    let episode: Episode
    /// The library the title was opened from, for Play From This Library Only.
    var libraryProviderID: String? = nil
    var width: CGFloat = Platform.landscapeWidth
    @Environment(AppModel.self) private var model

    private var aired: Bool { (episode.airDate ?? .distantFuture) <= Date() }
    private var watched: Bool { model.isEpisodeWatched(show, episode.ref) }
    private var hidden: Bool { model.hidesSpoilers(show, episode) }

    private var airText: String? { episode.airDate.map { Reel.airPrint(for: $0) } }

    /// "Aired May 23 2010", "Airs Tue 12": when it aired, or will.
    private var dateLine: String {
        if let airText { return aired ? airText : "Airs \(airText)" }
        return aired ? "Aired" : "Not yet aired"
    }

    /// A watched episode's bar is full; one in progress shows how far.
    private var fraction: Double? {
        guard aired else { return nil }
        if watched { return 1 }
        return model.progress(for: show, episode: episode.ref).map { Reel.watchedFraction($0) }
    }

    private var spoken: String {
        var extra: [String] = []
        if let airText { extra.append(airText) }
        if let runtime = episode.runtimeMinutes, runtime > 0 { extra.append(Reel.spokenDuration(minutes: runtime)) }
        if let rating = episode.voteAverage, rating > 0 { extra.append("rated " + String(format: "%.1f", rating)) }
        if watched { extra.append("watched") }
        return Reel.spokenListing(title: hidden ? "Episode \(episode.number)" : episode.title, episode: episode.ref, extra: extra)
    }

    var body: some View {
        Button {
            guard aired else { return }
            Task { await model.play(show, episode: episode, library: libraryProviderID) }
        } label: {
            EpisodeCard(episode: episode,
                        art: hidden ? nil : TMDBImage.url(episode.stillPath, size: .still),
                        fallback: show.smallBackdropURL ?? show.tmdbPosterURL,
                        title: hidden ? "Episode \(episode.number)" : episode.title,
                        facts: TitleHead.episodeFacts(runtimeMinutes: episode.runtimeMinutes, rating: episode.voteAverage),
                        dateLine: dateLine,
                        fraction: fraction,
                        width: width)
                .opacity(aired ? 1 : 0.55)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spoken)
                .accessibilityHint(hidden ? "" : (episode.overview ?? ""))
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu { EpisodeMenu(show: show, episode: episode, libraryProviderID: libraryProviderID) }
    }
}

/// The card's layout: the framed still with a red bar along its foot for how far in, then four lines, each one line high,
/// so every card in the row is the same size.
private struct EpisodeCard: View {
    let episode: Episode
    let art: URL?
    let fallback: URL?
    let title: String
    let facts: String
    let dateLine: String
    let fraction: Double?
    let width: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            StillArt(url: art, fallback: fallback, label: "\(episode.number)", title: title)
                .frame(width: width, height: width * 9 / 16)
                .overlay(alignment: .bottom) {
                    if let fraction, fraction > 0 {
                        ProgressCapsule(value: fraction, height: 4 * Theme.scale)
                            .padding(Theme.Rule.thin)
                    }
                }
                .clipped()
                .cardFrame()
            VStack(alignment: .leading, spacing: 2) {
                Text(episode.season == 0 ? "Special \(episode.number)" : "Episode \(episode.number)")
                    .font(Theme.Typeface.facts)
                    .detailCaps()
                    .foregroundStyle(Theme.Palette.muted)
                Text(title)
                    .font(Theme.Typeface.cardTitle)
                    .foregroundStyle(Theme.Palette.fg)
                    .truncationMode(.tail)
                Text(facts.isEmpty ? " " : facts)
                    .font(Theme.Typeface.facts)
                    .foregroundStyle(Theme.Palette.muted)
                Text(dateLine)
                    .font(Theme.Typeface.facts)
                    .detailCaps()
                    .foregroundStyle(Theme.Palette.muted)
            }
            .lineLimit(1)
            .multilineTextAlignment(.leading)
            .frame(width: width, alignment: .leading)
        }
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
