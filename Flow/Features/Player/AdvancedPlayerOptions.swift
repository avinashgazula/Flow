#if os(iOS)
import SwiftUI
import FlowKit

/// Fine control over how subtitles look and when they appear, plus playback speed, in a sheet so the
/// picture stays put behind it.
struct AdvancedPlayerOptions: View {
    let session: PlaybackSession
    let media: PlayerMediaOptions
    let showSearch: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    /// The boost while the slider is held; applied on release, since each change reloads the stream.
    @State private var boostDraft: Double?

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section {
                    SubtitleOverlay(text: "The quick brown fox jumps over the lazy dog.", settings: model.settings.subtitles)
                        .frame(height: 96)
                        .background(LinearGradient(colors: [.gray, .black], startPoint: .top, endPoint: .bottom))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .accessibilityHidden(true)
                    LabeledContent("Current", value: media.subtitleSummary(for: session))
                    delay
                    VStack(alignment: .leading, spacing: 4) {
                        LabeledContent("Size", value: String(format: "%.0f%%", model.settings.subtitles.fontScale * 100))
                        Slider(value: $model.settings.subtitles.fontScale, in: 0.6...2.0, step: 0.05)
                    }
                    Picker("Colour", selection: $model.settings.subtitles.color) {
                        ForEach(SubtitleColor.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                    Picker("Background", selection: $model.settings.subtitles.background) {
                        ForEach(SubtitleBackground.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        LabeledContent("Position", value: positionLabel(model.settings.subtitles.verticalPosition))
                        Slider(value: $model.settings.subtitles.verticalPosition, in: 0...0.4, step: 0.02)
                    }
                    Button("Get More Subtitles…") {
                        dismiss()
                        showSearch()
                    }
                } header: {
                    Text("Subtitles")
                } footer: {
                    Text("Size, colour, background and position apply to subtitles Flow draws itself.")
                }
                Section {
                    volumeBoost
                } header: {
                    Text("Audio")
                } footer: {
                    Text(session.volumeBoostHeadroom > 0
                         ? "Gives back the loudness Dolby Digital soundtracks hold in reserve: this one plays up to \(session.volumeBoostHeadroom) dB louder. Applies straight away and stays on for other films."
                         : "Volume Boost works on Dolby Digital and Dolby Digital Plus soundtracks in MKV files that leave headroom in their mix.")
                }
                Section("Playback") {
                    Picker("Speed", selection: Binding(get: { media.speed }, set: { media.setSpeed($0) })) {
                        ForEach(PlaybackSpeed.choices, id: \.self) { Text(PlaybackSpeed.label($0)).tag($0) }
                    }
                }
            }
            .navigationTitle("Advanced Options")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
    }

    /// Nudges in quarter-second steps, which is as fine as a person can judge by eye.
    private var delay: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Delay")
                Spacer()
                Button { session.subtitleOffset -= 0.25 } label: { Image(systemName: "minus.circle") }
                    .accessibilityLabel("Show subtitles earlier")
                Text(String(format: "%+.2f s", session.subtitleOffset))
                    .monospacedDigit()
                    .frame(minWidth: 72)
                Button { session.subtitleOffset += 0.25 } label: { Image(systemName: "plus.circle") }
                    .accessibilityLabel("Show subtitles later")
            }
            .buttonStyle(.borderless)
            .disabled(session.subtitle == nil)
            Text("Positive shows subtitles later. Only for subtitles Flow loads itself.")
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.textSecondary)
        }
    }

    /// In whole decibels up to what this soundtrack can give: anything past its headroom changes nothing.
    private var volumeBoost: some View {
        let headroom = session.volumeBoostHeadroom
        let current = boostDraft.map { Int($0.rounded()) } ?? min(model.settings.playback.volumeBoostDB, headroom)
        return VStack(alignment: .leading, spacing: 4) {
            LabeledContent("Volume Boost", value: current > 0 ? "+\(current) dB" : "Off")
            if headroom > 0 {
                Slider(value: Binding(get: { boostDraft ?? Double(current) }, set: { boostDraft = $0 }), in: 0...Double(headroom), step: 1) { editing in
                    guard !editing, let draft = boostDraft else { return }
                    session.setVolumeBoost(Int(draft.rounded()))
                    boostDraft = nil
                }
            }
        }
    }

    private func positionLabel(_ value: Double) -> String {
        value <= 0 ? "Default" : String(format: "+%.0f%%", value * 100)
    }
}
#endif
