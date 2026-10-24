import Foundation
import FlowKit

/// The subtitle looks the Apple TV and Mac players put in reach of their menus: one list of fields and
/// choices for both, so the two can't drift apart. Weight, box opacity and ASS styling stay in Settings.
/// The sizes and positions come from FlowKit, which also snaps a value the iPhone's sliders left between steps.
enum SubtitleStyleField: String, CaseIterable, Identifiable {
    case size, font, colour, edge, background, position

    var id: String { rawValue }

    var title: String {
        switch self {
        case .size: return "Size"
        case .font: return "Font"
        case .colour: return "Colour"
        case .edge: return "Edge"
        case .background: return "Background"
        case .position: return "Position"
        }
    }

    /// One choice for a field: what it's called, and how it changes the settings.
    struct Choice: Identifiable {
        let id: String
        let title: String
        let apply: (inout SubtitleSettings) -> Void
    }

    /// Every choice for this field, in the order a menu lists them.
    var choices: [Choice] {
        switch self {
        case .size:
            return SubtitleStyleOptions.sizeSteps.map { step in
                Choice(id: "\(step)", title: SubtitleStyleOptions.sizeLabel(step)) { $0.fontScale = step }
            }
        case .font:
            return SubtitleFont.allCases.map { font in Choice(id: font.rawValue, title: font.title) { $0.font = font } }
        case .colour:
            return SubtitleColor.allCases.map { colour in Choice(id: colour.rawValue, title: colour.title) { $0.color = colour } }
        case .edge:
            return SubtitleEdgeStyle.allCases.map { edge in Choice(id: edge.rawValue, title: edge.title) { $0.edgeStyle = edge } }
        case .background:
            return SubtitleBackground.choices.map { background in
                Choice(id: background.rawValue, title: background.title) { $0.background = background }
            }
        case .position:
            return SubtitleStyleOptions.positionSteps.map { step in
                Choice(id: "\(step)", title: SubtitleStyleOptions.positionLabel(step)) { $0.verticalPosition = step }
            }
        }
    }

    /// The choice in force. A size or position left between two steps by the iPhone's sliders counts as the nearest one.
    func currentID(_ settings: SubtitleSettings) -> String {
        switch self {
        case .size: return "\(SubtitleStyleOptions.nearestSize(settings.fontScale))"
        case .font: return settings.font.rawValue
        case .colour: return settings.color.rawValue
        case .edge: return settings.edgeStyle.rawValue
        case .background: return settings.background.choice.rawValue
        case .position: return "\(SubtitleStyleOptions.nearestPosition(settings.verticalPosition))"
        }
    }

    func currentTitle(_ settings: SubtitleSettings) -> String {
        let id = currentID(settings)
        return choices.first { $0.id == id }?.title ?? ""
    }

    /// Switches to the choice after the current one, wrapping round at the end.
    func advance(_ settings: inout SubtitleSettings) {
        let all = choices
        let ids = all.map(\.id)
        guard let next = SubtitleStyleOptions.next(after: currentID(settings), in: ids),
              let choice = all.first(where: { $0.id == next }) else { return }
        choice.apply(&settings)
    }

    /// Sets the choice with this id, if the field has one.
    func select(_ id: String, _ settings: inout SubtitleSettings) {
        choices.first { $0.id == id }?.apply(&settings)
    }

    /// Under the controls, as the iPhone's Advanced Options does: which subtitles the look reaches.
    static let footer = "Applies to subtitles Flow draws itself. Subtitles inside the stream follow every option except Position. Weight, opacity and ASS styling are in Settings."
}
