import SwiftUI
import FlowKit

struct SeasonsSection: View {
    let show: MediaItem
    let seasons: [Season]
    let episodesBySeason: [Int: [Episode]]
    @Binding var selectedSeason: Int
    @Environment(AppModel.self) private var model

    private var orderedSeasons: [Season] {
        seasons.filter { $0.number > 0 } + seasons.filter { $0.number == 0 }
    }

    private var episodes: [Episode] {
        (episodesBySeason[selectedSeason] ?? []).sorted { $0.number < $1.number }
    }

    private var airedRefs: [EpisodeRef] { episodes.filter { ($0.airDate ?? .distantFuture) <= Date() }.map(\.ref) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            HStack(alignment: .firstTextBaseline) {
                Text("Episodes").font(Theme.Typeface.sectionTitle).displayTracking()
                Spacer()
                if !airedRefs.isEmpty {
                    let allWatched = airedRefs.allSatisfy { model.isEpisodeWatched(show, $0) }
                    Button {
                        Task { await model.setWatched(show, episodes: airedRefs, watched: !allWatched) }
                    } label: {
                        Label(allWatched ? "Unwatch Season" : "Watch Season", systemImage: allWatched ? "eye.slash" : "checkmark.circle")
                            .font(Theme.Typeface.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.Palette.textSecondary)
                }
            }
            .padding(.horizontal, Theme.Space.gutter)

            seasonPicker

            if episodes.isEmpty {
                VStack(spacing: Theme.Space.s) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.Palette.surface).frame(height: 84)
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .shimmering()
            } else if Platform.isPhone {
                LazyVStack(spacing: Theme.Space.m) {
                    ForEach(episodes) { episode in EpisodeRow(show: show, episode: episode) }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .animation(Theme.Motion.gentle, value: selectedSeason)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 16) {
                        ForEach(episodes) { episode in EpisodeCard(show: show, episode: episode) }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.vertical, Platform.isTV ? 36 : 4)
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollClipDisabled()
            }
        }
    }

    private var seasonPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.xs) {
                ForEach(orderedSeasons) { season in
                    let selected = season.number == selectedSeason
                    Button {
                        withAnimation(Theme.Motion.snappy) { selectedSeason = season.number }
                    } label: {
                        Text(season.isSpecials ? "Specials" : (orderedSeasons.count > 6 ? "S\(season.number)" : season.name))
                            .font(.system(size: 14 * Theme.scale, weight: .semibold))
                            .padding(.horizontal, Theme.Space.m)
                            .padding(.vertical, Theme.Space.xs + 1)
                            .foregroundStyle(selected ? Color.black : Color.white)
                            .background {
                                if selected { Capsule().fill(.white) } else { Capsule().fill(Theme.Palette.surface) }
                            }
                            .overlay(Capsule().strokeBorder(Theme.Palette.hairline, lineWidth: selected ? 0 : 1))
                    }
                    .buttonStyle(CardButtonStyle())
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Platform.isTV ? 16 : 0)
        }
        .scrollClipDisabled()
    }
}

/// iPhone: still on the left, title, air date and synopsis on the right.
struct EpisodeRow: View {
    let show: MediaItem
    let episode: Episode
    @Environment(AppModel.self) private var model

    private var aired: Bool { (episode.airDate ?? .distantFuture) <= Date() }
    private var watched: Bool { model.isEpisodeWatched(show, episode.ref) }

    var body: some View {
        Button {
            guard aired else { return }
            Task { await model.play(show, episode: episode) }
        } label: {
            HStack(alignment: .top, spacing: Theme.Space.s) {
                EpisodeStill(show: show, episode: episode, width: 140)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(episode.number). \(episode.title)")
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 5) {
                        if let date = episode.airDate {
                            Text(AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))
                        }
                        if let runtime = episode.runtimeMinutes, runtime > 0 { Text("· \(runtime)m") }
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.Palette.textTertiary)
                    if let overview = episode.overview, !overview.isEmpty {
                        Text(overview)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .opacity(aired ? 1 : 0.5)
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { EpisodeMenu(show: show, episode: episode) }
    }
}

/// iPad, Mac and TV: a wide still with text beneath.
struct EpisodeCard: View {
    let show: MediaItem
    let episode: Episode
    @Environment(AppModel.self) private var model

    private var aired: Bool { (episode.airDate ?? .distantFuture) <= Date() }

    var body: some View {
        Button {
            guard aired else { return }
            Task { await model.play(show, episode: episode) }
        } label: {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                EpisodeStill(show: show, episode: episode, width: Platform.landscapeWidth)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(episode.number). \(episode.title)").font(Theme.Typeface.headline).lineLimit(1)
                    HStack(spacing: 5) {
                        if let date = episode.airDate {
                            Text(AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))
                        }
                        if let runtime = episode.runtimeMinutes, runtime > 0 { Text("· \(runtime)m") }
                    }
                    .font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary)
                    if let overview = episode.overview, !overview.isEmpty {
                        Text(overview).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary).lineLimit(2)
                    }
                }
                .frame(width: Platform.landscapeWidth, alignment: .leading)
            }
            .opacity(aired ? 1 : 0.5)
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { EpisodeMenu(show: show, episode: episode) }
    }
}

struct EpisodeStill: View {
    let show: MediaItem
    let episode: Episode
    let width: CGFloat
    @Environment(AppModel.self) private var model

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.poster, style: .continuous) }

    var body: some View {
        RemoteImage(url: TMDBImage.url(episode.stillPath, size: .still) ?? show.smallBackdropURL, maxPixel: Int(width * 2.5), fallbackTitle: episode.title)
            .frame(width: width, height: width * 9 / 16)
            .clipShape(shape)
            .hairline(shape)
            .overlay(alignment: .bottomTrailing) {
                if model.isEpisodeWatched(show, episode.ref) { WatchedCheck().scaleEffect(0.85).padding(6) }
            }
            .overlay(alignment: .bottom) {
                if let p = model.progress(for: show, episode: episode.ref) {
                    ProgressCapsule(value: p.percent / 100).padding(.horizontal, 8).padding(.bottom, 7)
                }
            }
            .overlay {
                if (episode.airDate ?? .distantFuture) > Date() {
                    Text(episode.airDate.map { "Airs " + AirDateFormatting.string(for: $0, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone) } ?? "Upcoming")
                        .font(Theme.Typeface.micro)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(.black.opacity(0.6), in: Capsule())
                }
            }
    }
}

struct EpisodeMenu: View {
    let show: MediaItem
    let episode: Episode
    @Environment(AppModel.self) private var model

    var body: some View {
        let watched = model.isEpisodeWatched(show, episode.ref)
        if (episode.airDate ?? .distantFuture) <= Date() {
            Button { Task { await model.play(show, episode: episode) } } label: { Label("Play", systemImage: "play.fill") }
        }
        Button {
            Task { await model.setWatched(show, episodes: [episode.ref], watched: !watched) }
        } label: {
            Label(watched ? "Mark as Unwatched" : "Mark as Watched", systemImage: watched ? "eye.slash" : "eye")
        }
        Button {
            let earlier = (1...episode.number).map { EpisodeRef(season: episode.season, episode: $0) }
            Task { await model.setWatched(show, episodes: earlier, watched: true) }
        } label: {
            Label("Mark Watched Up to Here", systemImage: "checkmark.circle")
        }
    }
}
