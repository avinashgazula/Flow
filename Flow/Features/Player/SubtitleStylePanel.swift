#if os(tvOS)
import SwiftUI
import FlowKit

/// How subtitles look, as a tab in Apple TV's info panel beside X-Ray and Details. Each button shows
/// what's chosen and steps to the next choice when selected, so the Siri Remote needs nothing but
/// swipes and clicks; a preview shows the result, and the subtitles on screen follow as it changes.
struct SubtitleStyleTVPanel: View {
    let model: AppModel
    @FocusState private var focus: Field?

    /// The six looks, then Reset, in the order focus moves through them.
    private enum Field: Hashable {
        case style(SubtitleStyleField)
        case reset
    }

    /// Four to a row: the six looks and Reset make two rows beside the preview.
    private let columns = Array(repeating: GridItem(.flexible(), spacing: Theme.Space.s), count: 4)
    fileprivate static let tileHeight: CGFloat = 125

    var body: some View {
        let settings = model.settings.subtitles
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            HStack(alignment: .top, spacing: 40) {
                preview(settings)
                LazyVGrid(columns: columns, spacing: Theme.Space.s) {
                    ForEach(SubtitleStyleField.allCases) { field in
                        Button { model.settings.subtitles = Self.advanced(field, model.settings.subtitles) } label: {
                            StyleTile(title: field.title, value: field.currentTitle(settings), symbol: "chevron.right")
                        }
                        .buttonStyle(StyleTileButtonStyle())
                        .focused($focus, equals: .style(field))
                        .accessibilityLabel("\(field.title), \(field.currentTitle(settings))")
                        .accessibilityHint("Selects the next choice")
                    }
                    Button { model.settings.subtitles.resetAppearance() } label: {
                        StyleTile(title: "Reset", value: "Default", symbol: "arrow.counterclockwise")
                    }
                    .buttonStyle(StyleTileButtonStyle())
                    .focused($focus, equals: .reset)
                    .accessibilityLabel("Reset to Default")
                }
                // Takes whatever the preview leaves, so the tiles are wide enough for "Translucent Box".
                .frame(maxWidth: .infinity)
                .focusSection()
            }
            Text(SubtitleStyleField.footer)
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.textSecondary)
                .lineLimit(2)
        }
        .padding(.horizontal, 60)
        .padding(.vertical, 30)
        .frame(maxWidth: .infinity, alignment: .leading)
        // The panel is a tab the viewer swipes into, so focus starts on its first button.
        .onAppear { if focus == nil { focus = .style(.size) } }
    }

    private static func advanced(_ field: SubtitleStyleField, _ settings: SubtitleSettings) -> SubtitleSettings {
        var next = settings
        field.advance(&next)
        return next
    }

    /// Flow's own overlay at the size it has on the screen, shrunk to fit beside the buttons. Its
    /// margins are those of a full picture, so the text sits where it would on the television.
    private func preview(_ settings: SubtitleSettings) -> some View {
        let scale: CGFloat = 0.6
        let size = CGSize(width: 1000, height: 455)
        return SubtitleOverlay(text: "Subtitles look like this.", settings: settings)
            .frame(width: size.width, height: size.height)
            .background(LinearGradient(colors: [.gray, .black], startPoint: .top, endPoint: .bottom))
            .scaleEffect(scale)
            .frame(width: size.width * scale, height: size.height * scale)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.frame, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// The tour can't open the system player's info panel, so it shows the Subtitle Style tab over the
/// picture, at the foot of the screen where the panel sits.
struct SubtitleStyleTourPanel: View {
    let model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Text("Subtitle Style")
                .font(Theme.Typeface.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 60)
            SubtitleStyleTVPanel(model: model)
        }
        .padding(.top, 60)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .top, endPoint: .center))
    }
}

/// A label over its value, with a small mark for what selecting does.
private struct StyleTile: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            HStack {
                Text(title).font(Theme.Typeface.caption).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: symbol).font(.system(size: 18, weight: .bold))
            }
            Text(value)
                .font(Theme.Typeface.body)
                .fontWeight(.semibold)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, Theme.Space.s)
        .frame(maxWidth: .infinity, minHeight: SubtitleStyleTVPanel.tileHeight, alignment: .leading)
    }
}

/// Focus is the film-stock yellow with dark ink; at rest, the control ink with paper text.
private struct StyleTileButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Tile(configuration: configuration)
    }

    private struct Tile: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isFocused) private var focused

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
            configuration.label
                .foregroundStyle(focused ? Theme.Palette.onStock : Theme.Palette.text)
                .background(focused ? Theme.Palette.stock : Theme.Palette.control, in: shape)
                .contentShape(shape)
                .scaleEffect(configuration.isPressed ? 0.98 : 1)
                .animation(Theme.Motion.snappy, value: configuration.isPressed)
                .modifier(FocusLift(scale: 1.05))
        }
    }
}
#endif
