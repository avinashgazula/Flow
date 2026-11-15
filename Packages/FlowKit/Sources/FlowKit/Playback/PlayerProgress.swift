import Foundation

/// How far through a title the viewer is, when that is reported or saved, and what counts as watched.
public enum PlayerProgress {
    /// Seconds between progress reports to a media server while playing.
    public static let reportInterval: Double = 10
    /// A stream that ends before this many seconds of playback is a failure, not a finished viewing.
    public static let shortestRealViewing: Double = 5
    /// Playback has run long enough for subtitle auto-sync to listen to the soundtrack.
    public static let longEnoughSeconds: Double = 60

    public static func reportIsDue(secondsSinceLastReport: Double) -> Bool { secondsSinceLastReport > reportInterval }

    public static func hasPlayedLongEnough(_ seconds: Double) -> Bool { seconds >= longEnoughSeconds }

    /// Percent of the length, not capped (a playhead a little past a short length reads over 100), 0 when the length is unknown.
    public static func percent(position: Double, duration: Double) -> Double {
        duration > 0 ? position / duration * 100 : 0
    }

    /// Where a finished viewing counts as having stopped: a completed one is at least at the end.
    public static func stopPosition(completed: Bool, currentTime: Double, duration: Double) -> Double {
        completed ? max(currentTime, duration) : currentTime
    }

    /// The percent sent with a "stopped" report to a tracker, capped at 100.
    public static func stopPercent(position: Double, duration: Double) -> Double {
        duration > 0 ? min(100, position / duration * 100) : 0
    }

    /// Where a seek may go: not before the start, and not past the end when the length is known.
    public static func clampedSeekTarget(_ seconds: Double, duration: Double) -> Double {
        max(0, duration > 0 ? min(seconds, duration) : seconds)
    }

    // MARK: Saving a viewing

    public enum SaveOutcome: Equatable, Sendable {
        /// The title (or episode) is watched: mark it, drop its resume point.
        case watched
        /// Keep a resume point at this percent.
        case progress(percent: Double)
        /// Too little watched to keep, or no length to measure against.
        case ignore
    }

    /// A viewing that finished, or got to the viewer's "Mark Watched At" percent, is watched. Anything past 1 percent
    /// but short of that keeps a resume point. With no length nothing is saved.
    public static func saveOutcome(position: Double, duration: Double, finished: Bool, watchedThresholdPercent: Double) -> SaveOutcome {
        guard duration > 0 else { return .ignore }
        let percent = min(100, position / duration * 100)
        if finished || percent >= watchedThresholdPercent { return .watched }
        if percent > 1 { return .progress(percent: percent) }
        return .ignore
    }

    // MARK: When the stream ends

    public enum EndOfStream: Equatable, Sendable {
        /// It ended without really playing: an error, never a finished viewing.
        case unexpected
        /// Record it as watched and close the player.
        case finishAndClose
        /// Record this one and start the next episode (or ask "Are You Still Watching?").
        case advance
        /// Record it and end on "Because You Watched".
        case showSuggestions
    }

    /// `sleepEndsWithItem` is the sleep timer set to "End of Episode or Movie".
    public static func endOfStream(didStart: Bool, currentTime: Double, sleepEndsWithItem: Bool, hasUpNext: Bool, autoPlayNext: Bool, hasSuggestions: Bool) -> EndOfStream {
        guard didStart, currentTime > shortestRealViewing else { return .unexpected }
        if sleepEndsWithItem { return .finishAndClose }
        if hasUpNext, autoPlayNext { return .advance }
        if !hasUpNext, hasSuggestions { return .showSuggestions }
        return .finishAndClose
    }
}
