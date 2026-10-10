import Foundation

/// Chooses the source "Download Automatically" saves, from sources already in the user's order.
public enum DownloadPicker {
    /// Direct files can be saved; streams (HLS) and torrents can't.
    public static func isDownloadable(_ source: StreamSource) -> Bool {
        guard let url = source.location.playableURL else { return false }
        return url.pathExtension.lowercased() != "m3u8"
    }

    /// The first source that fits the limits. A limit only applies once it is set, and a source that
    /// doesn't report the size or resolution being limited is skipped rather than guessed at.
    public static func pick(from ranked: [StreamSource], isMovie: Bool, settings: DownloadSettings) -> StreamSource? {
        let limitGB = isMovie ? settings.movieLimitGB : settings.episodeLimitGB
        return ranked.first { source in
            guard isDownloadable(source) else { return false }
            if let limitGB {
                guard let size = source.traits.sizeBytes, Double(size) <= limitGB * 1_073_741_824 else { return false }
            }
            if settings.resolution != .unknown {
                let resolution = source.traits.resolution
                guard resolution != .unknown, resolution <= settings.resolution else { return false }
            }
            return true
        }
    }
}
