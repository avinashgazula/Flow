import SwiftUI
import FlowKit

struct SeasonsSection: View {
    let show: MediaItem
    let seasons: [Season]
    let episodesBySeason: [Int: [Episode]]
    @Binding var selectedSeason: Int
    @Environment(AppModel.self) private var model

    private var orderedSeasons: [Season] {
        // Specials go last, like most players.
        seasons.filter { $0.number > 0 } + seasons.filter { $0.number == 0 }
    }

    private var episodes: [Episode] {
        (episodesBySeason[selectedSeason] ?? []).sorted { $0.number < $1.number }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Menu {
                    ForEach(orderedSeasons) { season in
                        Button(season.name) { selectedSeason = season.number }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(orderedSeasons.first { $0.number == selectedSeason }?.name ?? "Season \(selectedSeason)")
                            .font(.title2.weight(.bold))
                        Image(systemName: "chevron.up.chevron.down").font(.subheadline.weight(.semibold))
                    }
                }
                .buttonStyle(.plain)
                Spacer()
                let refs = episodes.filter { ($0.airDate ?? .distantFuture) <= Date() }.map(\.ref)
                if !refs.isEmpty {
                    let allWatched = refs.allSatisfy { model.isEpisodeWatched(show, $0) }
                    Button(allWatched ? "Mark Season Unwatched" : "Mark Season Watched") {
                        Task { await model.setWatched(show, episodes: refs, watched: !allWatched) }
                    }
                    .font(.subheadline)
                }
            }
            .padding(.horizontal, Platform.horizontalPadding)

            if episodes.isEmpty {
                HStack { ProgressView(); Text("Loading episodes…").foregroundStyle(.secondary) }
                    .padding(.horizontal, Platform.horizontalPadding)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Platform.isTV ? 40 : 14) {
                        ForEach(episodes) { episode in
                            EpisodeCard(show: show, episode: episode)
                        }
                    }
                    .padding(.horizontal, Platform.horizontalPadding)
                    .padding(.vertical, Platform.isTV ? 30 : 0)
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                #if os(tvOS)
                .scrollClipDisabled()
                #endif
            }
        }
    }
}

struct EpisodeCard: View {
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
            VStack(alignment: .leading, spacing: 8) {
                RemoteImage(url: TMDBImage.url(episode.stillPath, size: .still) ?? show.smallBackdropURL)
                    .frame(width: Platform.landscapeWidth, height: Platform.landscapeWidth * 9 / 16)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(alignment: .topLeading) {
                        Text("E\(episode.number)")
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(.black.opacity(0.6), in: Capsule())
                            .padding(8)
                    }
                    .overlay(alignment: .bottomTrailing) { if watched { WatchedCheck().padding(8) } }
                    .overlay(alignment: .bottom) {
                        if let p = model.progress(for: show, episode: episode.ref) {
                            ProgressView(value: min(1, p.percent / 100)).tint(.white).padding(8)
                        }
                    }
                    .opacity(aired ? 1 : 0.5)
                VStack(alignment: .leading, spacing: 3) {
                    Text(episode.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    HStack(spacing: 6) {
                        if let date = episode.airDate {
                            Text(AirDateFormatting.string(for: date, localTimeZone: model.settings.metadata.airDatesInLocalTimeZone))
                        }
                        if let runtime = episode.runtimeMinutes, runtime > 0 { Text("· \(runtime)m") }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    if let overview = episode.overview, !overview.isEmpty {
                        Text(overview).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                .frame(width: Platform.landscapeWidth, alignment: .leading)
            }
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu {
            if aired {
                Button { Task { await model.play(show, episode: episode) } } label: { Label("Play", systemImage: "play.fill") }
            }
            Button {
                Task { await model.setWatched(show, episodes: [episode.ref], watched: !watched) }
            } label: {
                Label(watched ? "Mark Unwatched" : "Mark Watched", systemImage: watched ? "eye.slash" : "eye")
            }
            Button {
                let earlier = (1...episode.number).map { EpisodeRef(season: episode.season, episode: $0) }
                Task { await model.setWatched(show, episodes: earlier, watched: true) }
            } label: {
                Label("Mark Watched Up To Here", systemImage: "checkmark.circle")
            }
        }
    }
}
