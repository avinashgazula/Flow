import Foundation

/// The rules behind Home's lead, drawn as a streaming app's hero: how tall the picture is, the one line of facts under the
/// title's logo, and where a step or a swipe lands. The views only measure and draw what this returns.
public enum HeroLead {
    // MARK: Size

    public enum Shape: Equatable, Sendable {
        /// A phone held upright: a tall picture cropped to fill, with everything centred.
        case phone
        /// A tablet, a Mac window or a phone on its side: 16:9, with the words at the lower left.
        case wide
        /// Apple TV: nearly the whole screen, the first shelf peeking at the foot.
        case tv
    }

    /// From this width (in points) the picture is 16:9 and the words move to the left. An iPad held upright is 744 or more,
    /// the widest phone upright 440.
    public static let wideFrom: Double = 640

    public static func shape(width: Double, isTV: Bool) -> Shape {
        isTV ? .tv : (width >= wideFrom ? .wide : .phone)
    }

    /// The picture's height, in points, for a window `viewport` points high (the whole window, including under the bars the
    /// picture runs beneath). A phone takes 68% of it, a wide picture is 16:9 but no more than 75%, so the first shelf shows
    /// under it, and Apple TV takes 82%.
    public static func height(shape: Shape, width: Double, viewport: Double) -> Double {
        switch shape {
        case .phone: return max(320, viewport * 0.68)
        case .wide: return max(280, min(width * 9 / 16, viewport * 0.75))
        case .tv: return viewport * 0.82
        }
    }

    // MARK: Facts

    public enum Kind: Equatable, Sendable {
        /// Something started: where you are and how long is left.
        case resume
        /// The next episode of a series being followed.
        case nextUp
        /// A title not started, from the top picks.
        case pick
    }

    /// The one short line of facts under the logo, as its parts. Something started says where you are and how long is left
    /// ("S3 E7", "18m left"); the next episode says so ("S3 E8", "Up next"); anything else says what it is ("Drama",
    /// "2008", "TV-MA": the first genre, the year and the rating). Parts it doesn't know are left out, so the line never has
    /// a gap in it.
    public static func facts(kind: Kind, episode: EpisodeRef?, year: Int?, genres: [String], certification: String?, minutesLeft: Int?) -> [String] {
        let code = episode.map { "S\($0.season) E\($0.episode)" }
        let parts: [String?]
        switch kind {
        case .resume: parts = [code ?? year.map(String.init), minutesLeft.map { Reel.compactLeft(minutes: $0) }]
        case .nextUp: parts = [code ?? year.map(String.init), "Up next"]
        case .pick: parts = [genres.first, year.map(String.init), certification]
        }
        return parts.compactMap { $0 }.filter { !$0.isEmpty }
    }

    /// The same, as the single line the views set, with a middle dot between the parts.
    public static func line(_ facts: [String]) -> String { facts.joined(separator: " · ") }

    // MARK: Turning

    /// The title `delta` steps from `index`, going round: past the last is the first.
    public static func wrapped(_ index: Int, by delta: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return ((index + delta) % count + count) % count
    }

    /// What a finished swipe does: -1 for the previous title, 1 for the next, 0 to settle back. A swipe left (a negative
    /// translation) brings the next title in, as a page turns. It takes a fifth of the width, or a quick flick in the same
    /// direction (`velocity` in points per second), so a short slow drag that changes its mind doesn't turn the page.
    public static func swipe(translation: Double, velocity: Double, width: Double) -> Int {
        guard width > 0, translation != 0 else { return 0 }
        let far = abs(translation) >= width * 0.2
        let flick = abs(velocity) >= 500 && (velocity < 0) == (translation < 0)
        guard far || flick else { return 0 }
        return translation < 0 ? 1 : -1
    }
}

/// Whether a title's logo is light or dark, so the lead can keep it readable on the page's colour. TMDb's wordmarks are made
/// for dark screens (most are white), and some for light ones (black); over a paper-coloured fade one of them would vanish.
/// The lead flips the lightness of one that would, and leaves alone one that already reads.
public enum LogoTone: Equatable, Sendable {
    case light, dark, mid

    /// The brightness of the opaque part of an image, from its RGBA bytes: each pixel's luminance weighted by how opaque it
    /// is, so the transparent surround doesn't count. Above 0.5 is a light logo (white lettering on a coloured tile still is),
    /// below 0.3 a dark one, between them neither.
    public static func of(rgba: [UInt8]) -> LogoTone {
        var weight = 0.0
        var sum = 0.0
        var i = 0
        while i + 3 < rgba.count {
            let alpha = Double(rgba[i + 3]) / 255
            if alpha >= 0.1 {
                weight += alpha
                sum += alpha * (0.2126 * Double(rgba[i]) + 0.7152 * Double(rgba[i + 1]) + 0.0722 * Double(rgba[i + 2])) / 255
            }
            i += 4
        }
        guard weight > 0 else { return .mid }
        let mean = sum / weight
        return mean > 0.5 ? .light : mean < 0.3 ? .dark : .mid
    }

    /// Whether the logo's lightness is flipped on a page of this side: a light logo on a light page, a dark one on a dark page.
    public func flips(onDarkPage dark: Bool) -> Bool {
        (self == .light && !dark) || (self == .dark && dark)
    }
}
