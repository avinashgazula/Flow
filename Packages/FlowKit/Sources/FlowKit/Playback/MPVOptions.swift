import Foundation

/// How Flow's settings and streams are written for libmpv, the built-in player. Pure functions, so the
/// mapping is tested here and the app's player only passes the strings on.
public enum MPVOptions {
    /// `http-header-fields` takes a comma-separated list, so a value with a comma in it (an Accept
    /// header, a cookie) needs mpv's length prefix, `%length%value`, to stay in one piece.
    public static func headerFields(_ headers: [String: String]) -> String {
        headers.sorted { $0.key < $1.key }
            .map { name, value in
                let field = "\(name): \(value)"
                return "%\(field.utf8.count)%\(field)"
            }
            .joined(separator: ",")
    }

    /// mpv's `volume` is a percentage: 100 is the file's own level, and each dB of boost scales it up.
    public static func volumePercent(boostDB: Int, level: Double = 1) -> Double {
        let gain = pow(10, Double(max(0, boostDB)) / 20)
        return (100 * gain * min(max(level, 0), 1)).rounded(toPlaces: 2)
    }

    /// "5.1" for six channels, "Stereo" for two; empty when the count isn't a usual layout.
    public static func channelLabel(_ count: Int) -> String {
        switch count {
        case 1: return "Mono"
        case 2: return "Stereo"
        case 3: return "2.1"
        case 4: return "4.0"
        case 5: return "5.0"
        case 6: return "5.1"
        case 7: return "6.1"
        case 8: return "7.1"
        default: return ""
        }
    }

    /// `#AARRGGBB`, the form mpv reads colours in.
    static func colour(_ rgb: (Double, Double, Double), alpha: Double = 1) -> String {
        func byte(_ v: Double) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X%02X", byte(alpha), byte(rgb.0), byte(rgb.1), byte(rgb.2))
    }

    /// The viewer's subtitle look as mpv's `sub-*` options, for the subtitles mpv draws itself (the ones
    /// inside the file). Mirrors what the Apple player's text style rules and Flow's own overlay show.
    public static func subtitleOptions(_ s: SubtitleSettings) -> [(String, String)] {
        var options: [(String, String)] = []
        options.append(("sub-scale", String(format: "%.2f", s.fontScale)))
        let rgb: (Double, Double, Double) = switch s.color {
        case .white: (1, 1, 1)
        case .yellow: (1, 0.84, 0.04)
        case .cyan: (0.35, 0.78, 0.98)
        case .green: (0.2, 0.78, 0.35)
        }
        options.append(("sub-color", colour(rgb)))
        let family: String = switch s.font {
        case .system: "Helvetica Neue"
        case .serif: "Georgia"
        case .monospaced: "Menlo"
        case .rounded: "Arial Rounded MT Bold"
        case .condensed: "Avenir Next Condensed"
        }
        options.append(("sub-font", family))
        options.append(("sub-bold", s.weight == .bold || s.weight == .heavy ? "yes" : "no"))

        // The edge: a drop shadow is the default; an outline is a border; raised and depressed are a hard
        // shadow either side of the letter, as close as a plain outline-and-shadow style gets.
        var border = 0.0, shadow = 0.0
        var shadowColour = colour((0, 0, 0), alpha: 0.8)
        switch s.edgeStyle {
        case .dropShadow: shadow = 1.5
        case .none: break
        case .outline: border = 2.5
        case .raised: shadow = 1.2; shadowColour = colour((0, 0, 0), alpha: 0.9)
        case .depressed: shadow = 1.2; shadowColour = colour((1, 1, 1), alpha: 0.6)
        }
        options.append(("sub-border-size", String(format: "%.1f", border)))
        options.append(("sub-border-color", colour((0, 0, 0))))
        options.append(("sub-shadow-offset", String(format: "%.1f", shadow)))
        options.append(("sub-shadow-color", shadowColour))

        if s.background.drawsBox {
            options.append(("sub-border-style", "background-box"))
            options.append(("sub-back-color", colour((0, 0, 0), alpha: s.background.boxOpacity(s.backgroundOpacity))))
        } else {
            options.append(("sub-border-style", "outline-and-shadow"))
        }
        // 100 is the bottom of the picture; lifting by a fraction of its height moves toward 0.
        options.append(("sub-pos", String(Int((100 - min(max(s.verticalPosition, 0), 0.9) * 100).rounded()))))
        // Subtitles with their own styling keep it only when the viewer asked; otherwise the look above applies to all.
        options.append(("sub-ass-override", s.keepASSStyling ? "no" : "strip"))
        return options
    }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let factor = pow(10, Double(places))
        return (self * factor).rounded() / factor
    }
}
