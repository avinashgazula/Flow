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

    /// Whether the picture behind the text is a box.
    public var drawsBox: Bool { self == .translucent || self == .solid }

    /// How opaque the box is: a solid box is solid, and `backgroundOpacity` fades the translucent one. The web
    /// draws them the same way.
    public func boxOpacity(_ backgroundOpacity: Double) -> Double {
        switch self {
        case .solid: return 1
        case .translucent: return min(max(backgroundOpacity, 0), 1)
        case .none, .shadow: return 0
        }
    }
}
