import Foundation

/// The top of a title's page, laid out as Home's lead is: the picture's height, the one centred line of facts under the
/// logo, the ratings in equal columns, and the facts on an episode's card. Kept here so the rules are tested.
public enum TitleHead {
    /// The picture's height for a window `viewport` points high (including what runs under the bars). Shorter than Home's
    /// lead, so the ratings, the synopsis and Play follow it on the first screen: half the window on a phone, 16:9 up to 62% on a wide
    /// window, and 70% on Apple TV.
    public static func height(shape: HeroLead.Shape, width: Double, viewport: Double) -> Double {
        switch shape {
        case .phone: return max(300, viewport * 0.5)
        case .wide: return max(260, min(width * 9 / 16, viewport * 0.62))
        case .tv: return viewport * 0.7
        }
    }

    /// "2024", "Science Fiction, Adventure", "2h47" (or "5 seasons"): the line under the logo. Two genres at most; the
    /// certification is left to its own outlined badge after the line.
    public static func facts(year: Int?, genres: [String], runtimeMinutes: Int?, seasons: Int?) -> [String] {
        var parts: [String] = []
        if let year { parts.append(String(year)) }
        let named = genres.filter { !$0.isEmpty }.prefix(2)
        if !named.isEmpty { parts.append(named.joined(separator: ", ")) }
        if let seasons, seasons > 0 {
            parts.append(seasons == 1 ? "1 season" : "\(seasons) seasons")
        } else if let runtimeMinutes, runtimeMinutes > 0 {
            parts.append(Reel.compactDuration(minutes: runtimeMinutes))
        }
        return parts
    }

    /// How many equal columns `count` ratings take, at most `perLine` to a line. More than fit are shared out evenly over
    /// the fewest lines (six on a phone are three and three, not four and two), so every column lines up and no score is
    /// left alone on a line.
    public static func ratingColumns(count: Int, perLine: Int) -> Int {
        guard count > 0, perLine > 0 else { return 1 }
        let lines = (count + perLine - 1) / perLine
        return (count + lines - 1) / lines
    }

    /// "52m · ★ 8.0" on an episode's card: how long it runs and how it was rated, either left out when unknown.
    public static func episodeFacts(runtimeMinutes: Int?, rating: Double?) -> String {
        var parts: [String] = []
        if let runtimeMinutes, runtimeMinutes > 0 { parts.append(Reel.compactDuration(minutes: runtimeMinutes)) }
        if let rating, rating > 0 { parts.append("★ " + String(format: "%.1f", rating)) }
        return parts.joined(separator: " · ")
    }
}
