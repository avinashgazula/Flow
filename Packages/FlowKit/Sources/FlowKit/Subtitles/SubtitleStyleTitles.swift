import Foundation

extension SubtitleColor {
    public var title: String { rawValue.capitalized }
}

extension SubtitleBackground {
    public var title: String {
        switch self {
        case .none, .shadow: return "Off"
        case .translucent: return "Translucent Box"
        case .solid: return "Solid Box"
        }
    }

    /// The choices worth offering: the shadow now comes from the edge style, so `.shadow` is just "no box".
    public static var choices: [SubtitleBackground] { [.none, .translucent, .solid] }

    /// What a picker shows as selected (`.shadow`, from older settings, reads as Off).
    public var choice: SubtitleBackground { self == .shadow ? .none : self }

    /// Whether the picture behind the text is a box, which is what `backgroundOpacity` fades.
    public var drawsBox: Bool { self == .translucent || self == .solid }
}
