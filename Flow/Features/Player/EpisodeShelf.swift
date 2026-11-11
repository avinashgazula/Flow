#if os(iOS)
import SwiftUI
import FlowKit

/// The rest of the season as a glass shelf over the scrubber, opened scrolled to the episode on
/// screen so "what's next" is always a glance away.
struct EpisodeShelf: View {
    let session: PlaybackSession
    @Binding var isPresented: Bool

    private let cardWidth: CGFloat = 200

    var body: some View {
        ZStack(alignment: .bottom) {
            if isPresented {
                // Tapping the picture above the shelf closes it.
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { close() }
                    .accessibilityHidden(true)
                shelf
                    .padding(.horizontal, 20)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .allowsHitTesting(isPresented)
        .animation(Theme.Motion.snappy, value: isPresented)
    }

    private var shelf: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(seasonTitle).font(Theme.Typeface.heading).foregroundStyle(Theme.Palette.fg)
                Spacer()
                CircleButton(systemImage: "xmark", label: "Close Episodes", size: 32) { close() }
                    .accessibilityLabel("Close episodes")
            }
            .padding(.horizontal, 20)

            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        ForEach(session.seasonEpisodes) { episode in
                            card(episode).id(episode.id)
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .onAppear {
                    if let id = session.request.episode?.id { proxy.scrollTo(id, anchor: .center) }
                }
            }
        }
        .padding(.vertical, 16)
        .foregroundStyle(Theme.Palette.fg)
        .playerPanel()
        .accessibilityAction(.escape) { close() }
    }

    private var seasonTitle: String {
        guard let season = session.request.episode?.season else { return "Episodes" }
        return "Season \(season)"
    }

    private func card(_ episode: Episode) -> some View {
        let isCurrent = episode.id == session.request.episode?.id
        return Button {
            close()
            if !isCurrent { Task { await session.play(episode: episode) } }
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                RemoteImage(url: TMDBImage.url(episode.stillPath, size: .still) ?? session.request.item.smallBackdropURL,
                            maxPixel: Int(cardWidth * 3), fallbackTitle: episode.title)
                    .frame(width: cardWidth, height: cardWidth * 9 / 16)
                    .overlay(alignment: .bottomLeading) {
                        if isCurrent {
                            Label("Now Playing", systemImage: "play.fill")
                                .font(Theme.Typeface.micro)
                                .textCase(.uppercase)
                                .foregroundStyle(Theme.Palette.bg)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Theme.Palette.red)
                                .padding(8)
                        }
                    }
                    .clipShape(Rectangle())
                    .overlay {
                        Rectangle().strokeBorder(Theme.Palette.fg, lineWidth: isCurrent ? Theme.Rule.heavy : 0)
                    }
                VStack(alignment: .leading, spacing: 2) {
                    Text("E\(episode.number) · \(episode.title)")
                        .font(Theme.Typeface.headline)
                        .lineLimit(1)
                    if let minutes = episode.runtimeMinutes, minutes > 0 {
                        Text(TimeFormat.runtime(minutes))
                            .font(Theme.Typeface.caption)
                            .foregroundStyle(Theme.Palette.muted)
                    }
                }
                .frame(width: cardWidth, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(episode.code), \(episode.title)\(isCurrent ? ", now playing" : "")")
    }

    private func close() {
        withAnimation(Theme.Motion.snappy) { isPresented = false }
    }
}
#endif
