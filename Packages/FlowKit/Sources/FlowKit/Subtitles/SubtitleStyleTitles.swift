import Foundation

extension SubtitleColor {
    public var title: String { rawValue.capitalized }
}

extension SubtitleBackground {
    public var title: String {
        switch self {
        case .none: return "None"
        case .shadow: return "Shadow"
        case .translucent: return "Translucent Box"
        case .solid: return "Solid Box"
        }
    }

    /// Whether the picture behind the text is a box, which is what `backgroundOpacity` fades.
    public var drawsBox: Bool { self == .translucent || self == .solid }
}
