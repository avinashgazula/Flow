import Foundation

/// Keeps things that aren't video out of the source list. Torrent indexes are full of fakes:
/// "Movie.2026.1080p.mkv.exe", password-protected archives, and shortcut files.
public enum SourceSafety {
    static let unsafeExtensions: Set<String> = [
        "exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "js", "jar", "ps1", "app", "dmg", "pkg", "apk", "lnk", "url",
        "zip", "rar", "7z", "tar", "gz", "cab", "iso.exe",
    ]

    /// True for names ending in an executable, installer, archive or shortcut extension.
    public static func isUnsafeFileName(_ name: String) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let dot = trimmed.lastIndex(of: ".") else { return false }
        let ext = String(trimmed[trimmed.index(after: dot)...])
        return unsafeExtensions.contains(ext)
    }

    public static func isUnsafe(_ source: StreamSource) -> Bool {
        if let filename = source.filename, isUnsafeFileName(filename) { return true }
        if let url = source.location.playableURL, isUnsafeFileName(url.lastPathComponent) { return true }
        // Add-on text sometimes carries the real file name on its own line.
        return source.title.split(separator: "\n").contains { isUnsafeFileName(String($0)) }
    }
}
