import SwiftUI
import FlowKit

/// A show's episodes as numbered rows (a red condensed number, the still, the title, its air date and runtime in mono, and
/// what it is about in serif), under a ruled label. Seasons are bordered tabs, or a menu for a long-running show.
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
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                RuleLine()
                HStack(alignment: .center) {
                    SectionLabel("Episodes")
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
            }
            .padding(.horizontal, Theme.Space.gutter)

            seasonPicker

            Group {
                if episodes.isEmpty && !isLoading {
                    VStack(alignment: .leading, spacing: Theme.Space.s) {
                        Text(failed ? "Couldn't load the episodes. Check your connection and try again." : "No episodes listed for this season yet.")
                            .font(Theme.Typeface.body)
                            .foregroundStyle(Theme.Palette.muted)
                        if failed { Button("Try Again", action: retry).buttonStyle(GlassButtonStyle()) }
                    }
                    .padding(.vertical, Theme.Space.l)
                } else if episodes.isEmpty {
                    VStack(spacing: 0) {
                        RuleLine()
                        ForEach(0..<3, id: \.self) { _ in
                            Rectangle().fill(Theme.Palette.tint1).frame(height: 96 * Theme.scale).ruledRow()
                        }
                    }
                    .shimmering()
                    .accessibilityHidden(true)
                } else {
                    VStack(spacing: 0) {
                        RuleLine()
                        LazyVStack(spacing: 0) {
                            ForEach(episodes) { episode in
                                EpisodeListing(show: show, episode: episode, libraryProviderID: libraryProviderID)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
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
        season.isSpecials ? "Specials" : "Season \(season.number)"
    }

    /// Bordered tabs while the seasons fit in a row; a menu for a long-running show.
    @ViewBuilder
    private var seasonPicker: some View {
        if orderedSeasons.count > 1 {
            if orderedSeasons.count <= 4 {
                ScrollView(.horizontal, showsIndicators: false) {
                    SegmentedTabs(options: orderedSeasons.map { (value: $0.number, title: seasonLabel($0)) }, selection: $selectedSeason)
                        .padding(.horizontal, Theme.Space.gutter)
                        .padding(.vertical, Platform.isTV ? 24 : 0)
                }
                .scrollClipDisabled()
            } else {
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
                    HStack(spacing: Theme.Space.xs) {
                        Text(orderedSeasons.first { $0.number == selectedSeason }.map(seasonLabel) ?? "Season")
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                    }
                }
                .buttonStyle(FilterChipStyle())
                .padding(.horizontal, Theme.Space.gutter)
                .accessibilityLabel("Season")
            }
        }
    }
}

/// One episode: its number, still, title and what it is about. Not-yet-aired episodes dim and do nothing; the rest play.
struct EpisodeListing: View {
    let show: MediaItem
    let episode: Episode
    /// The library the title was opened from, for Play From This Library Only.
    var libraryProviderID: String? = nil
    @Environment(AppModel.self) private var model

    private var aired: Bool { (episode.airDate ?? .distantFuture) <= Date() }
    private var watched: Bool { model.isEpisodeWatched(show, episode.ref) }
    private var hidden: Bool { model.hidesSpoilers(show, episode) }

    private var airText: String? { episode.airDate.map { Reel.airPrint(for: $0) } }

    /// "Mar 5 · 52m": when it aired (or will), and how long it runs.
    private var fact: String {
        var parts: [String] = []
        if let airText { parts.append(aired ? airText : "Airs \(airText)") } else { parts.append(aired ? "Aired" : "Not yet aired") }
        if let runtime = episode.runtimeMinutes, runtime > 0 { parts.append(Reel.compactDuration(minutes: runtime)) }
        return parts.joined(separator: " · ")
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
        if watched { extra.append("watched") }
        return Reel.spokenListing(title: episode.title, episode: episode.ref, extra: extra)
    }

    var body: some View {
        Button {
            guard aired else { return }
            Task { await model.play(show, episode: episode, library: libraryProviderID) }
        } label: {
            EpisodeRow(episode: episode,
                       art: hidden ? nil : (TMDBImage.url(episode.stillPath, size: .still) ?? show.smallBackdropURL),
                       artTitle: hidden ? "Episode \(episode.number)" : episode.title,
                       fact: fact,
                       overview: hidden ? nil : episode.overview,
                       fraction: fraction)
                .opacity(aired ? 1 : 0.55)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spoken)
        }
        .buttonStyle(RuledCellStyle())
        .ruledRow()
        .contextMenu { EpisodeMenu(show: show, episode: episode, libraryProviderID: libraryProviderID) }
    }
}

/// The row's layout. On a phone the synopsis runs the row's full width under the still; elsewhere it sits beside it.
private struct EpisodeRow: View {
    let episode: Episode
    let art: URL?
    let artTitle: String
    let fact: String
    let overview: String?
    let fraction: Double?
    @Environment(\.cellLit) private var lit

    private var stillWidth: CGFloat { Platform.isTV ? 320 : (Platform.isPhone ? 104 : (Platform.isPad ? 160 : 176)) }
    private var numberWidth: CGFloat { (Platform.isPhone ? 40 : 56) * Theme.scale }

    var body: some View {
        let text = overview.flatMap { $0.isEmpty ? nil : $0 }
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .top, spacing: Platform.isPhone ? Theme.Space.s : Theme.Space.m) {
                Text(String(format: "%02d", episode.number))
                    .font(Theme.Typeface.detailNumeral(Platform.isPhone ? 28 : 40))
                    .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.red)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: numberWidth, alignment: .leading)
                    .accessibilityHidden(true)
                still
                VStack(alignment: .leading, spacing: 4) {
                    Text(episode.title)
                        .font(Theme.Typeface.custom(Theme.Face.condensed, Platform.isPhone ? 18 : 22, .headline))
                        .textCase(.uppercase)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                    Text(fact)
                        .font(Theme.Typeface.caption)
                        .detailCaps()
                        .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted)
                        .lineLimit(1)
                    if let text, !Platform.isPhone { synopsis(text) }
                    if let fraction, fraction > 0 { bar(fraction) }
                }
                Spacer(minLength: 0)
            }
            if let text, Platform.isPhone { synopsis(text) }
        }
        .padding(.vertical, Theme.Space.m)
        .padding(.horizontal, Theme.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var still: some View {
        Color.clear
            .frame(width: stillWidth, height: stillWidth * 9 / 16)
            .overlay(RemoteImage(url: art, maxPixel: Platform.isTV ? 700 : 400, fallbackTitle: artTitle))
            .clipped()
            .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.onBlue : Theme.Palette.rule, lineWidth: Theme.Rule.thin))
    }

    private func synopsis(_ text: String) -> some View {
        Text(text)
            .font(Theme.Typeface.custom(Theme.Face.serif, 15, .subheadline))
            .lineSpacing(3)
            .lineLimit(3)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: 620 * Theme.scale, alignment: .leading)
            .padding(.top, 2)
    }

    /// How much of it is watched: a thin red bar with an ink border (on-blue while the row is lit).
    private func bar(_ fraction: Double) -> some View {
        Color.clear
            .frame(height: 8 * Theme.scale)
            .frame(maxWidth: 320 * Theme.scale)
            .overlay(alignment: .leading) {
                GeometryReader { proxy in
                    (lit ? Theme.Palette.onBlue : Theme.Palette.red).frame(width: proxy.size.width * min(1, max(0, fraction)))
                }
            }
            .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.onBlue : Theme.Palette.rule, lineWidth: Theme.Rule.thin))
            .padding(.top, 4)
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
