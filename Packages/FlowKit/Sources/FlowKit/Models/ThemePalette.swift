import Foundation

/// The colour themes, as plain data: the twelve tokens of each theme's light and dark side. The app turns these into
/// colours (Flow/Design/Theme.swift) and the website into custom properties (web/src/styles/tokens.css); both are tested
/// against `testdata/contracts/themes.json`, so the two can't drift. Admit One is the default: one red, as on the
/// app's ticket icon, for marks and for action. Index is the website's first palette, red marks and blue action.
/// Opening Night keeps the red marks and sets action in bulb gold.
public enum ThemeChoice: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case admitOne, index, openingNight

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .admitOne: return "Admit One"
        case .index: return "Index"
        case .openingNight: return "Opening Night"
        }
    }

    /// An id this build doesn't know (a newer build's theme) reads as the default instead of failing the whole file.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ThemeChoice(rawValue: raw) ?? .admitOne
    }

    public static let `default`: ThemeChoice = .admitOne
}

/// One side (light or dark) of a theme. Colours are 0xRRGGBB.
public struct ThemeTokens: Hashable, Sendable {
    /// Paper.
    public let bg: UInt32
    /// Ink.
    public let fg: UInt32
    /// Labels, numerals, progress, live; the red.
    public let mark: UInt32
    /// Action: links, focus and hover fills, selection, switch tracks.
    public let spot: UInt32
    public let spotPressed: UInt32
    /// Text and icons on a spot fill.
    public let onSpot: UInt32
    public let muted: UInt32
    public let faint: UInt32
    public let tint1: UInt32
    public let tint2: UInt32
    public let tint3: UInt32
    public let warn: UInt32

    /// The tokens by name, in the order the contract file lists them.
    public var all: [(name: String, value: UInt32)] {
        [("bg", bg), ("fg", fg), ("mark", mark), ("spot", spot), ("spotPressed", spotPressed), ("onSpot", onSpot),
         ("muted", muted), ("faint", faint), ("tint1", tint1), ("tint2", tint2), ("tint3", tint3), ("warn", warn)]
    }
}

public enum ThemePalette {
    /// The tokens of a theme's light or dark side.
    public static func tokens(_ theme: ThemeChoice, dark: Bool) -> ThemeTokens {
        switch (theme, dark) {
        case (.admitOne, false):
            return ThemeTokens(bg: 0xF4F1EA, fg: 0x0A0A0A, mark: 0xC9120A, spot: 0xC9120A, spotPressed: 0xA50E08, onSpot: 0xFFFFFF,
                               muted: 0x57534C, faint: 0x625D55, tint1: 0xEBE7DD, tint2: 0xDFDACD, tint3: 0xCCC6B6, warn: 0xA64B00)
        case (.admitOne, true):
            return ThemeTokens(bg: 0x0D0B0A, fg: 0xF4F1EA, mark: 0xFF5A4E, spot: 0xFF5A4E, spotPressed: 0xFF8A80, onSpot: 0x0A0A0A,
                               muted: 0xB6B0A7, faint: 0x948E85, tint1: 0x181513, tint2: 0x24201D, tint3: 0x37322E, warn: 0xFF9F43)
        case (.index, false):
            return ThemeTokens(bg: 0xFFFFFF, fg: 0x0A0A0A, mark: 0xC9120A, spot: 0x1A3DFF, spotPressed: 0x0F2BD6, onSpot: 0xFFFFFF,
                               muted: 0x555555, faint: 0x636363, tint1: 0xF3F3F0, tint2: 0xE7E7E3, tint3: 0xD4D4CE, warn: 0xA64B00)
        case (.index, true):
            return ThemeTokens(bg: 0x0A0A0A, fg: 0xF2F2EE, mark: 0xFF5A4E, spot: 0x8FA2FF, spotPressed: 0xB4C1FF, onSpot: 0x0A0A0A,
                               muted: 0xB0B0AC, faint: 0x8F8F8B, tint1: 0x151515, tint2: 0x212121, tint3: 0x333333, warn: 0xFF9F43)
        case (.openingNight, false):
            return ThemeTokens(bg: 0xFBF7EE, fg: 0x0A0A0A, mark: 0xC9120A, spot: 0x8A5A00, spotPressed: 0x6E4700, onSpot: 0xFFFFFF,
                               muted: 0x5A5448, faint: 0x655E51, tint1: 0xF2ECDF, tint2: 0xE6DFCF, tint3: 0xD3CAB6, warn: 0xA64B00)
        case (.openingNight, true):
            return ThemeTokens(bg: 0x0A0A0A, fg: 0xFFF4D6, mark: 0xFF5A4E, spot: 0xFFB21A, spotPressed: 0xFFC857, onSpot: 0x0A0A0A,
                               muted: 0xBDB3A0, faint: 0x9A917F, tint1: 0x151412, tint2: 0x211F1B, tint3: 0x333029, warn: 0xFF9F43)
        }
    }

    /// `#rrggbb`, lowercase, as the contract file and the website write it.
    public static func hex(_ value: UInt32) -> String {
        String(format: "#%06x", value & 0xFFFFFF)
    }

    /// WCAG relative luminance of an 0xRRGGBB colour.
    public static func luminance(_ value: UInt32) -> Double {
        func channel(_ shift: UInt32) -> Double {
            let c = Double((value >> shift) & 0xFF) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }

    /// WCAG contrast ratio of two colours, 1 to 21.
    public static func contrast(_ a: UInt32, _ b: UInt32) -> Double {
        let x = luminance(a), y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    /// Every text or mark and the paper it sits on, with the least contrast WCAG AA allows: 4.5 for text, 3 for large
    /// text and the parts of controls. The design only puts these pairs together.
    public static let requiredPairs: [(foreground: String, background: String, minimum: Double)] = [
        ("fg", "bg", 4.5), ("fg", "tint1", 4.5),
        ("muted", "bg", 4.5), ("muted", "tint1", 4.5), ("muted", "tint2", 4.5),
        ("faint", "bg", 4.5), ("faint", "tint1", 4.5),
        ("mark", "bg", 4.5), ("mark", "tint1", 4.5), ("mark", "tint2", 3),
        ("spot", "bg", 4.5), ("spot", "tint1", 4.5), ("spot", "tint2", 3),
        ("onSpot", "spot", 4.5), ("onSpot", "spotPressed", 4.5),
        ("warn", "bg", 4.5),
        ("spotPressed", "bg", 3),
        ("bg", "mark", 4.5),
    ]
}
