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
            Button("What Did They Say?") { session.replayWithSubtitles() }
                .keyboardShortcut("r", modifiers: [.command])
            Button(session.songs.isListening ? "Listening…" : "Identify Song") { session.songs.identify(session) }
                .disabled(session.songs.isListening)
                .keyboardShortcut("i", modifiers: [.command, .shift])
            Divider()
            Menu("Sleep Timer") {
                ForEach(SleepTimer.choices) { choice in
                    Button { session.sleepTimer = choice } label: { checked(choice.title, session.sleepTimer == choice) }
                }
                if session.sleepTimer != nil {
                    Divider()
                    Button("Turn Off") { session.sleepTimer = nil }
                }
            }
            // The video stays in view while the menu is open, so each change shows on the subtitles at once.
            Menu("Subtitle Style") {
                ForEach(SubtitleStyleField.allCases) { field in
                    Picker(field.title, selection: Binding(get: { field.currentID(model.settings.subtitles) },
                                                           set: { field.select($0, &model.settings.subtitles) })) {
                        ForEach(field.choices) { Text($0.title).tag($0.id) }
                    }
                    .pickerStyle(.menu)
                }
                Divider()
                Button("Reset to Default") { model.settings.subtitles.resetAppearance() }
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
            Image(systemName: "ellipsis").macBarIcon()
        }
        .macBarMenu(label: "Options")
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

/// The Mac player's controls are a compact bar of small icon buttons like a toolbar's, not the phone's round
/// glass buttons: one rounded glass strip over the picture, each button lighting under the pointer.
struct MacControlBar<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        GlassGroup(spacing: 4) {
            HStack(spacing: 2) { content }
                .padding(3)
                .flowGlass(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous), tint: Theme.Palette.overPicture)
        }
    }
}

extension View {
    /// A bar icon: white, small, and the same size whichever control it sits in.
    func macBarIcon() -> some View {
        font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
    }

    /// A borderless menu dressed as a bar button.
    func macBarMenu(label: String) -> some View {
        menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .modifier(MacBarHover())
            .accessibilityLabel(label)
            .help(label)
    }
}

/// A soft fill under the pointer, as a toolbar button gives.
struct MacBarHover: ViewModifier {
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .frame(width: 30, height: 28)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(.white.opacity(hovering ? 0.18 : 0)))
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .onHover { hovering = $0 }
            .animation(Theme.Motion.fade, value: hovering)
    }
}

struct MacBarButton: View {
    let systemImage: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage).macBarIcon()
                .modifier(MacBarHover())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .help(label)
    }
}
#endif
