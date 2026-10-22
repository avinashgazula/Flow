import Foundation

/// A watchlist in the order the viewer arranged it. Trackers decide what is on a watchlist and when it was
/// added; the viewer decides the order they see it in, so that order is kept on the device and laid over
/// whatever the tracker returns.
public enum WatchlistOrder {
    /// The tracker's keys with the saved order laid over them: saved keys that are still on the list come first,
    /// in the saved order; anything newer follows in the tracker's own order.
    public static func applying(_ saved: [MediaKey], to keys: [MediaKey]) -> [MediaKey] {
        let present = Set(keys)
        var seen = Set<MediaKey>()
        var ordered = saved.filter { present.contains($0) && seen.insert($0).inserted }
        ordered += keys.filter { seen.insert($0).inserted }
        return ordered
    }

    /// `keys` with `moving` (in the order given) taken out and put back just before `target`, or at the end
    /// when `target` is nil or is itself being moved.
    public static func moving(_ moving: [MediaKey], before target: MediaKey?, in keys: [MediaKey]) -> [MediaKey] {
        let moved = Set(moving)
        let carried = moving.filter { keys.contains($0) }
        var rest = keys.filter { !moved.contains($0) }
        if let target, let index = rest.firstIndex(of: target) {
            rest.insert(contentsOf: carried, at: index)
        } else {
            rest += carried
        }
        return rest
    }
}
