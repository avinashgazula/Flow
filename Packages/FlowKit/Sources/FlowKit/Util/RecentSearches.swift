import Foundation

/// The Recent list under Search. Searches run as you type, so "the dark" followed moments later by
/// "the dark knight" is one search, not two: the newer replaces the one it grew out of (or was
/// trimmed back from). Searches further apart stay separate, even when one starts the other.
public enum RecentSearches {
    public static let limit = 12
    /// How close together two searches must be to count as one search still being typed.
    public static let typingWindow: TimeInterval = 8

    public static func adding(_ text: String, to list: [String], lastAdded: Date?, now: Date = Date()) -> [String] {
        let term = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return list }
        var out = list.filter { $0.caseInsensitiveCompare(term) != .orderedSame }
        if let head = out.first, let lastAdded, now.timeIntervalSince(lastAdded) < typingWindow {
            let a = head.lowercased(), b = term.lowercased()
            if a.hasPrefix(b) || b.hasPrefix(a) { out.removeFirst() }
        }
        out.insert(term, at: 0)
        return Array(out.prefix(limit))
    }
}
