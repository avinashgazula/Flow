import Foundation

/// When the built-in player may apply the track the session chose for the start.
///
/// libmpv answers a subtitle switch with a "refresh seek" so the new track's earlier lines show. Asked while the file
/// is still starting, that seek lands before the beginning of the file and mpv can be left seeking for good, so the
/// film never plays. The starting choice therefore waits until playback is really under way.
public enum TrackSwitchGate {
    /// The playhead must have moved at least this far (seconds) before a playing file takes a switch.
    public static let minimumPlayhead: Double = 0.5

    /// `restarted`: mpv has reported its first playback restart since the file loaded.
    /// A paused file (waiting for the resume question) has nothing running to disturb, so the restart is enough.
    public static func canApplyStartingChoice(restarted: Bool, paused: Bool, coreIdle: Bool, playhead: Double) -> Bool {
        guard restarted else { return false }
        if paused { return true }
        return !coreIdle && playhead.isFinite && playhead >= minimumPlayhead
    }
}
