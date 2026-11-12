import Foundation

/// Spots the short video some add-ons serve in place of the film when they refuse a request. ElfHosted's
/// public add-ons tie each play link to the internet connection that asked for it, and a link opened
/// from anywhere else gets a slate ("Opened on a different connection ... Expected IP / Current IP")
/// instead of an error, so a player that only checks for HTTP errors plays it as if it were the title.
public enum StreamSlate {
    /// Longest a slate runs. Real slates are seconds long; anything under this for a title that should be
    /// much longer is not the title.
    static let longestSlate: Double = 180
    /// A title this short (minutes) might really be a short, so it never counts as a slate by length.
    static let shortestRealTitleMinutes = 20
    /// A slate is a few hundred kilobytes; a listing this big never describes a file that small.
    static let smallestListedBytes: Int64 = 200 * 1024 * 1024
    static let largestSlateBytes: Int64 = 40 * 1024 * 1024

    /// True when the address a play link ended up at (after redirects) is a slate: a host or path that
    /// has "slate" as a word of its own ("slate.example.com", "/slates/wrong-ip.mp4").
    public static func isSlateURL(_ url: URL) -> Bool {
        let words = ((url.host ?? "") + "/" + url.path).lowercased().split { !$0.isLetter && !$0.isNumber }
        return words.contains { $0 == "slate" || $0 == "slates" }
    }

    /// True when what loaded is far too short to be the title: a few seconds or minutes for a film or an
    /// episode that runs 20 minutes or more.
    public static func isTooShort(duration: Double, expectedRuntimeMinutes: Int?) -> Bool {
        guard duration.isFinite, duration > 0, let minutes = expectedRuntimeMinutes, minutes >= shortestRealTitleMinutes else { return false }
        return duration < min(longestSlate, Double(minutes) * 60 * 0.1)
    }

    /// True when the file is tiny next to the size its listing promised.
    public static func isTooSmall(bytes: Int64?, listedBytes: Int64?) -> Bool {
        guard let bytes, bytes > 0, let listedBytes, listedBytes >= smallestListedBytes else { return false }
        return bytes <= largestSlateBytes
    }

    /// Whether any sign says this is a slate. Everything is optional: whatever the player has learned so far.
    public static func detect(finalURL: URL? = nil, duration: Double? = nil, bytes: Int64? = nil, listedBytes: Int64? = nil, expectedRuntimeMinutes: Int? = nil) -> Bool {
        if let finalURL, isSlateURL(finalURL) { return true }
        if let duration, isTooShort(duration: duration, expectedRuntimeMinutes: expectedRuntimeMinutes) { return true }
        return isTooSmall(bytes: bytes, listedBytes: listedBytes)
    }

    /// Shown when Marquee moves to the next source by itself.
    public static let triedNextMessage = "This link only works on the connection that asked for it, so Marquee tried the next source. Check your add-on's proxy setting."
    /// Shown when fail-over is off or no source is left.
    public static let stoppedMessage = "This link only works on the connection that asked for it, so it can't play here. Try another source, and check your add-on's proxy setting."

    /// True for hosts known to tie play links to the requesting connection. Their links have to be
    /// opened by the device that plays them, never through a relay.
    public static func bindsLinksToConnection(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "elfhosted.com" || host.hasSuffix(".elfhosted.com")
    }
}
