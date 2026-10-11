#if os(macOS)
import SwiftUI
import FlowKit

/// The Mac player's options: what the iPhone's options panel offers beyond the audio and subtitle
/// menus AVPlayerView already has. One menu, so it reads like any Mac app's.
struct MacPlayerMenu: View {
    let session: PlaybackSession
    @State private var speed: Float = 1

    private static let speeds: [Float] = [0.5, 0.75, 1, 1.25, 1.5, 2]

    var body: some View {
        Menu {
            if session.sources.count > 1 {
                Menu("Source") {
                    ForEach(session.sources) { source in
                        Button { session.switchSource(to: source) } label: {
                            checked(sourceTitle(source), source.id == session.source.id)
                        }
                    }
                }
            }
            if let current = session.request.episode, !session.seasonEpisodes.isEmpty {
                Menu("Season \(current.season)") {
                    ForEach(session.seasonEpisodes) { episode in
                        Button { Task { await session.play(episode: episode) } } label: {
                            checked("\(episode.number). \(episode.title)", episode.id == current.id)
                        }
                    }
                }
            }
            Menu("Speed") {
                ForEach(Self.speeds, id: \.self) { rate in
                    Button { setSpeed(rate) } label: { checked(rate == 1 ? "Normal" : String(format: "%gx", rate), speed == rate) }
                }
            }
            Menu("Sleep Timer") {
                ForEach(SleepTimer.choices) { choice in
                    Button { session.sleepTimer = choice } label: { checked(choice.title, session.sleepTimer == choice) }
                }
                if session.sleepTimer != nil {
                    Divider()
                    Button("Turn Off") { session.sleepTimer = nil }
                }
            }
            if session.subtitle != nil {
                Menu("Subtitle Timing") {
                    Text(String(format: "Delay %+.2f s", session.subtitleOffset))
                    Button("Show Earlier (−0.25 s)") { session.subtitleOffset -= 0.25 }
                    Button("Show Later (+0.25 s)") { session.subtitleOffset += 0.25 }
                    Button("Reset") { session.subtitleOffset = 0 }
                    if session.canAutoSync {
                        Divider()
                        Button(session.isAutoSyncing ? "Syncing…" : "Auto-sync (Beta)") { session.autoSyncSubtitles() }
                            .disabled(session.isAutoSyncing)
                    }
                }
            }
            if session.volumeBoostHeadroom > 0 {
                Menu("Volume Boost") {
                    ForEach(Array(stride(from: 0, through: session.volumeBoostHeadroom, by: 1)), id: \.self) { dB in
                        Button { session.setVolumeBoost(dB) } label: { checked(dB == 0 ? "Off" : "+\(dB) dB", currentBoost == dB) }
                    }
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 16, weight: .bold))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        // A borderless menu draws only its label's image, so the glass goes around the menu itself.
        .frame(width: 44, height: 44)
        .contentShape(Circle())
        .flowGlass(Circle(), interactive: true)
        .accessibilityLabel("Options")
        .onAppear { speed = session.player.defaultRate }
    }

    @Environment(AppModel.self) private var model

    private var currentBoost: Int { min(model.settings.playback.volumeBoostDB, session.volumeBoostHeadroom) }

    private func sourceTitle(_ source: StreamSource) -> String {
        let t = source.traits
        let parts = [t.resolution == .unknown ? nil : t.resolution.label, t.quality == .unknown ? nil : t.quality.rawValue,
                     t.sizeBytes.map(StreamParser.formatBytes)].compactMap { $0 }
        return ([source.providerName] + parts).joined(separator: " · ")
    }

    private func setSpeed(_ rate: Float) {
        speed = rate
        session.player.defaultRate = rate
        if session.player.rate > 0 { session.player.rate = rate }
    }

    @ViewBuilder
    private func checked(_ title: String, _ isOn: Bool) -> some View {
        if isOn { Label(title, systemImage: "checkmark") } else { Text(title) }
    }
}
#endif
