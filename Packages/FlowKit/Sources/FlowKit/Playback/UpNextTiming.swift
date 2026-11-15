import Foundation

/// When the player moves on: the Up Next countdown, the credits notice and suggestions, and the skip buttons.
public enum UpNextTiming {
    /// Shortest episode that gets a countdown at all; a clip this short is not an episode.
    public static let shortestEpisode: Double = 60
    /// Seconds before the episode's end the countdown aims to finish when the viewer wants the credits to run.
    static let tailBeforeEnd: Double = 20
    static let tailWhenWaitingForEnd: Double = 1

    /// The playhead time at which the countdown starts: as the credits begin when a credits segment is known
    /// (and the viewer doesn't prefer to see them), otherwise so that it runs out just before the end.
    public static func countdownStart(duration: Double, creditsStart: Double?, waitsForEnd: Bool, countdownSeconds: Int) -> Double {
        let credits = waitsForEnd ? nil : creditsStart
        let tail = waitsForEnd ? tailWhenWaitingForEnd : tailBeforeEnd
        return credits ?? (duration - Double(countdownSeconds) - tail)
    }

    public struct CountdownInput: Equatable, Sendable {
        public var autoPlayNext: Bool
        public var hasUpNext: Bool
        /// The sleep timer is set to "End of Episode or Movie": the episode ends the chain.
        public var sleepEndsWithItem: Bool
        public var switchingEpisode: Bool
        public var countdownRunning: Bool
        public var duration: Double
        public var currentTime: Double
        public var creditsStart: Double?
        public var waitsForEnd: Bool
        public var countdownSeconds: Int

        public init(autoPlayNext: Bool, hasUpNext: Bool, sleepEndsWithItem: Bool, switchingEpisode: Bool, countdownRunning: Bool,
                    duration: Double, currentTime: Double, creditsStart: Double?, waitsForEnd: Bool, countdownSeconds: Int) {
            self.autoPlayNext = autoPlayNext
            self.hasUpNext = hasUpNext
            self.sleepEndsWithItem = sleepEndsWithItem
            self.switchingEpisode = switchingEpisode
            self.countdownRunning = countdownRunning
            self.duration = duration
            self.currentTime = currentTime
            self.creditsStart = creditsStart
            self.waitsForEnd = waitsForEnd
            self.countdownSeconds = countdownSeconds
        }
    }

    public static func shouldStartCountdown(_ input: CountdownInput) -> Bool {
        guard input.autoPlayNext, input.hasUpNext, !input.sleepEndsWithItem, !input.switchingEpisode, !input.countdownRunning, input.duration > shortestEpisode else { return false }
        return input.currentTime >= countdownStart(duration: input.duration, creditsStart: input.creditsStart, waitsForEnd: input.waitsForEnd, countdownSeconds: input.countdownSeconds)
    }

    // MARK: Credits

    /// Titles shorter than this (seconds) get no credits notice or suggestions: they are episodes and shorts.
    public static let shortestFilm: Double = 3600 * 0.5

    /// "Stay for the credits" is said once, as the credits begin and while there is still time to stay.
    public static func creditsNoticeIsDue(alreadyShown: Bool, hasNotice: Bool, duration: Double, creditsSegmentStart: Double?, time: Double) -> Bool {
        guard !alreadyShown, hasNotice, duration > shortestFilm else { return false }
        let creditsStart = creditsSegmentStart ?? duration * 0.94
        return time >= creditsStart && time < duration - 10
    }

    public enum SuggestionsAction: Equatable, Sendable {
        case none
        /// Seeking back out of the credits takes the card away and lets it come back.
        case withdraw
        case show
    }

    /// "Because You Watched" as a film's credits begin, unless there's a scene to stay for.
    public static func suggestionsAction(hasSuggestions: Bool, hasCreditsScene: Bool, duration: Double, isPlaying: Bool, creditsSegmentStart: Double?, time: Double, alreadyOffered: Bool) -> SuggestionsAction {
        guard hasSuggestions, !hasCreditsScene, duration > shortestFilm, isPlaying else { return .none }
        let creditsStart = creditsSegmentStart ?? max(duration * 0.96, duration - 180)
        if time < creditsStart { return .withdraw }
        if !alreadyOffered, time < duration - 5 { return .show }
        return .none
    }

    // MARK: Skipping

    /// What happens when a skippable segment is reached. Credits that hide a scene are never skipped by themselves.
    public static func skipBehaviour(kind: SkipSegmentKind, intro: SkipBehaviour, recap: SkipBehaviour, credits: SkipBehaviour, creditsHideAScene: Bool) -> SkipBehaviour {
        switch kind {
        case .intro: return intro
        case .recap: return recap
        case .credits: return creditsHideAScene && credits == .automatic ? .button : credits
        case .preview, .commercial: return intro
        }
    }

    /// Skipping the credits at the end of an episode starts the next one, unless "End of Episode" is the sleep timer:
    /// then the credits run out instead.
    public static func skipStartsNextEpisode(kind: SkipSegmentKind, hasUpNext: Bool, sleepEndsWithItem: Bool, segmentEnd: Double, duration: Double) -> Bool {
        kind == .credits && hasUpNext && !sleepEndsWithItem && segmentEnd >= duration - 5
    }
}
