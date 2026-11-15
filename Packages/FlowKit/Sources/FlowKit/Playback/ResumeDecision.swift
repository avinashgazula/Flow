import Foundation

/// What the player does with a saved place once the stream is open and its length is known (or not).
/// The built-in player and Apple's player share this: only the way each one seeks differs.
public enum ResumeDecision: Equatable, Sendable {
    /// Play from the start: the saved place is unusable (zero, or at or near the end of this stream).
    case playFromStart
    /// Jump to the saved place and play.
    case seek(Double)
    /// Hold still and ask "Resume or start over?".
    case ask(Double)

    /// A resume point this close to the end (seconds) is ignored: seeking there would "finish" the stream
    /// at once. It can come from another cut or another source of the same title.
    public static let endMargin: Double = 30

    /// Resume only when the position is known to be well before the end of this stream. A length that isn't
    /// known (zero, negative, NaN or infinite) can't contradict the saved place, so it resumes.
    public static func shouldResume(at position: Double, duration: Double) -> Bool {
        guard position > 0 else { return false }
        guard duration.isFinite, duration > 0 else { return true }
        return position < duration - endMargin
    }

    /// `saved` is where the last viewing stopped; `duration` is what the stream reports now.
    public static func decide(saved: Double, duration: Double, askToResume: Bool) -> ResumeDecision {
        guard shouldResume(at: saved, duration: duration) else { return .playFromStart }
        return askToResume ? .ask(saved) : .seek(saved)
    }

    /// Whether Apple's player waits for the viewer's answer before it plays at all. It does for any saved
    /// place, even one `decide` will turn out to ignore once the length is known (then it plays at once).
    public static func holdsPlaybackForAnswer(saved: Double?, askToResume: Bool) -> Bool {
        saved != nil && askToResume
    }

    /// Where an external player should start: the playhead once the viewer is past the first half
    /// minute, otherwise the saved place (nil when there is none).
    public static func externalStart(currentTime: Double, saved: Double?) -> Double? {
        currentTime > 30 ? currentTime : saved
    }
}
