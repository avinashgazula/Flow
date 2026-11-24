import Foundation

/// When the lead at the top of Home turns through its titles by itself. The website's rule, minus the part about
/// something being in progress: what you were watching stays first, and the rest follows it.
public enum HomeRotation {
    /// How long a title stays up before the next one, in seconds.
    public static let dwell: TimeInterval = 8

    /// Turns only when the viewer wants it, there is something to turn to, and motion is welcome.
    public static func advancesByItself(setting: Bool, titles: Int, reduceMotion: Bool) -> Bool {
        setting && titles > 1 && !reduceMotion
    }
}
