import Foundation

/// Decides what to tell Trakt or Simkl about the title being played, and how far in, as the website's
/// `createScrobbler` does: start when playback begins or resumes, pause when it pauses or the app is left,
/// stop when it ends or the player closes. The player feeds in what happened and sends what comes back.
/// A service keeps a stop below 80 % as a resume point, so every call carries the real percent.
public struct ScrobbleReporter: Sendable {
    public enum Event: Equatable, Sendable {
        /// Playback began or resumed.
        case played
        case paused
        /// The app left the screen. `continues` is true when playback goes on anyway (Picture in Picture, background audio).
        case backgrounded(continues: Bool)
        /// The app came back; `playing` says whether the player is running.
        case foregrounded(playing: Bool)
        /// The title ended (`completed`, which counts as 100 %) or the player closed.
        case stopped(completed: Bool)
    }

    public struct Call: Equatable, Sendable {
        public var action: ScrobbleAction
        /// The `PlaybackRequest.id` the call is about; a stop for the old title can follow a new title's play.
        public var title: String
        public var percent: Double
        public init(_ action: ScrobbleAction, title: String, percent: Double) {
            self.action = action
            self.title = title
            self.percent = percent
        }
    }

    private var open: (title: String, playing: Bool, percent: Double)?

    public init() {}

    /// The calls to send, in order, for `event` on `title`. Nothing at all when Scrobble While Watching is off:
    /// a finished title then reaches the service through the ordinary watched mark.
    public mutating func handle(_ event: Event, title: String, position: Double, duration: Double, enabled: Bool) -> [Call] {
        guard enabled else {
            open = nil
            return []
        }
        let percent = Self.percent(position: position, duration: duration)
        switch event {
        case .played:
            var calls: [Call] = []
            // The player moved on to another title without closing: that one is over.
            if let old = open, old.title != title {
                calls.append(Call(.stop, title: old.title, percent: old.percent))
                open = nil
            }
            if open?.playing == true { return calls }
            open = (title, true, percent)
            return calls + [Call(.start, title: title, percent: percent)]
        case .paused, .backgrounded:
            // Playback that goes on in the background is still playing as far as the service is concerned.
            if case .backgrounded(let continues) = event, continues { return [] }
            guard let current = open, current.title == title, current.playing else { return [] }
            open = (title, false, percent)
            return [Call(.pause, title: title, percent: percent)]
        case .foregrounded(let playing):
            guard playing, let current = open, current.title == title, !current.playing else { return [] }
            open = (title, true, percent)
            return [Call(.start, title: title, percent: percent)]
        case .stopped(let completed):
            guard let current = open, current.title == title else { return [] }
            open = nil
            return [Call(.stop, title: title, percent: completed ? 100 : percent)]
        }
    }

    /// How far in, 0 to 100 and to two places; 0 while the length is unknown.
    static func percent(position: Double, duration: Double) -> Double {
        guard duration.isFinite, duration > 0, position.isFinite else { return 0 }
        return (min(100, max(0, position / duration * 100)) * 100).rounded() / 100
    }
}
