import SwiftUI
import FlowKit

/// The live preview at the top of Subtitles settings: Flow's own overlay over a stand-in picture.
struct SubtitlePreviewSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section {
            SubtitleOverlay(text: "This is a subtitle preview.\nIt updates as you change the options below.", settings: model.settings.subtitles)
                .frame(height: Platform.isTV ? 300 : 170)
                .background(LinearGradient(colors: [.gray, .black], startPoint: .top, endPoint: .bottom))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .accessibilityHidden(true)
        }
    }
}

/// How subtitles look: font, size, colour, edge, background and where they sit.
struct SubtitleAppearanceSections: View {
    @Environment(AppModel.self) private var model
    @State private var confirmingReset = false

    private static let sizes: [Double] = (5...20).map { Double($0) / 10 }
    private static let opacities: [Double] = (1...10).map { Double($0) / 10 }
    /// Every half second from −5 to +5; the picker adds a stored value that falls between.
    private static let offsets: [Double] = (-10...10).map { Double($0) / 2 }
    /// The same positions the Apple TV and Mac players list.
    private static let positions = SubtitleStyleOptions.positionSteps

    var body: some View {
        @Bindable var model = model
        Section("Appearance") {
            FilmPicker("Font", selection: $model.settings.subtitles.font) {
                ForEach(SubtitleFont.allCases) { Text($0.title).tag($0) }
            }
            FilmPicker("Size", selection: $model.settings.subtitles.fontScale) {
                ForEach(Self.choices(Self.sizes, including: model.settings.subtitles.fontScale), id: \.self) { Text(Self.percent($0)).tag($0) }
            }
            FilmPicker("Weight", selection: $model.settings.subtitles.weight) {
                ForEach(SubtitleWeight.allCases) { Text($0.title).tag($0) }
            }
            FilmPicker("Colour", selection: $model.settings.subtitles.color) {
                ForEach(SubtitleColor.allCases) { Text($0.title).tag($0) }
            }
        }
        Section("Style") {
            FilmPicker("Text Edge Style", selection: $model.settings.subtitles.edgeStyle) {
                ForEach(SubtitleEdgeStyle.allCases) { Text($0.title).tag($0) }
            }
            FilmPicker("Background", selection: Binding(get: { model.settings.subtitles.background.choice }, set: { model.settings.subtitles.background = $0 })) {
                ForEach(SubtitleBackground.choices) { Text($0.title).tag($0) }
            }
            FilmPicker("Opacity", selection: $model.settings.subtitles.backgroundOpacity) {
                ForEach(Self.choices(Self.opacities, including: model.settings.subtitles.backgroundOpacity), id: \.self) { Text(Self.percent($0)).tag($0) }
            }
            .disabled(!model.settings.subtitles.background.drawsBox)
        }
        Section {
            FilmPicker("Vertical Alignment", selection: $model.settings.subtitles.verticalPosition) {
                ForEach(Self.positions, id: \.self) { Text(SubtitleStyleOptions.positionLabel($0)).tag($0) }
                // The player's slider can leave any value in between.
                if !Self.positions.contains(where: { abs($0 - model.settings.subtitles.verticalPosition) < 0.001 }) {
                    Text("Custom (+\(Int((model.settings.subtitles.verticalPosition * 100).rounded()))%)").tag(model.settings.subtitles.verticalPosition)
                }
            }
            FilmPicker("Sync Offset", selection: $model.settings.subtitles.defaultOffsetSeconds) {
                ForEach(Self.choices(Self.offsets, including: model.settings.subtitles.defaultOffsetSeconds), id: \.self) { Text(Self.offsetLabel($0)).tag($0) }
            }
        } header: {
            Text("Position")
        } footer: {
            Text("Every subtitle style syncs across your devices.")
        }
        Section {
            Toggle("Keep original ASS styling", isOn: $model.settings.subtitles.keepASSStyling)
        } header: {
            Text("Advanced")
        } footer: {
            Text("Draw ASS/SSA subtitles the way their author styled them (colour, weight, size and placement) instead of the settings above. Mostly matters for anime, whose subtitles style each sign and speaker differently. Karaoke and animated effects aren't drawn. Applies to subtitles Flow draws itself; anything a subtitle leaves unspecified keeps your settings.")
        }
        Section {
            Button("Reset to Defaults", role: .destructive) { confirmingReset = true }
                .confirmationDialog("Reset subtitle appearance?", isPresented: $confirmingReset, titleVisibility: .visible) {
                    Button("Reset to Defaults", role: .destructive) { reset() }
                } message: {
                    Text("Font, size, colour, style and position go back to their defaults. Languages, sources and sync offset stay as they are.")
                }
        }
    }

    /// Only how subtitles look; which ones load and when stay put.
    private func reset() { model.settings.subtitles.resetAppearance() }

    /// The presets, plus the stored value when it falls between them, so the picker always has a match.
    private static func choices(_ presets: [Double], including current: Double) -> [Double] {
        presets.contains(current) ? presets : (presets + [current]).sorted()
    }

    private static func percent(_ value: Double) -> String { "\(Int((value * 100).rounded()))%" }

    private static func offsetLabel(_ seconds: Double) -> String {
        seconds == 0 ? "None" : String(format: "%+.1f s", seconds)
    }
}
