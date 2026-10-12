import Foundation

/// Counts episodes that played one after another with nobody touching anything, for "Are You Still
/// Watching?". Any sign of someone there starts the count again.
public struct StillWatching: Equatable, Sendable {
    public private(set) var unattendedEpisodes = 0

    public init() {}

    /// A tap, skip, seek or menu choice.
    public mutating func noteInteraction() { unattendedEpisodes = 0 }

    /// The player paused. A pause in the last seconds is the episode ending on its own, which says
    /// nothing about whether anyone is watching, so it doesn't count.
    public mutating func notePause(at time: Double, duration: Double) {
        guard duration <= 0 || time < duration - Self.endSlack else { return }
        unattendedEpisodes = 0
    }

    /// Whether the next episode should wait for an answer. `limit` 0 means never ask.
    public func shouldAsk(limit: Int) -> Bool { limit > 0 && unattendedEpisodes >= limit }

    /// The next episode started by itself.
    public mutating func noteAutomaticAdvance() { unattendedEpisodes += 1 }

    static let endSlack: Double = 3
}
