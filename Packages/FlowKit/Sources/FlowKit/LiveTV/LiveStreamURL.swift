import Foundation

/// Addresses to try for a live channel. AVPlayer plays MPEG-TS only inside HLS, and most IPTV
/// panels (Xtream Codes and its clones) serve the same channel as HLS at ".m3u8".
public enum LiveStreamURL {
    public enum PlaybackCandidate: Hashable, Sendable {
        case native(URL)
        case builtIn(URL)
    }

    public static func playbackCandidates(for url: URL) -> [PlaybackCandidate] {
        let alternatives = candidates(for: url)
        let native = alternatives.filter {
            switch ContainerDetector.container(url: $0, filename: nil) {
            case .unsupported, .matroska: return false
            case .native, .unknown: return true
            }
        }.map(PlaybackCandidate.native)
        // FFmpeg can usually open the address exactly as the provider supplied it.
        return native + ([url] + alternatives.filter { $0 != url }).map(PlaybackCandidate.builtIn)
    }

    public static func candidates(for url: URL) -> [URL] {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "ts", "mpegts":
            return [swapped(url, to: "m3u8"), url].compactMap { $0 }
        case "":
            // ".../live/user/pass/1234" or ".../user/pass/1234": a panel stream id without an extension.
            if let last = url.pathComponents.last, Int(last) != nil, url.pathComponents.count >= 4 {
                return [url, url.appendingPathExtension("m3u8")]
            }
            return [url]
        default:
            return [url]
        }
    }

    private static func swapped(_ url: URL, to ext: String) -> URL? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        components.path = (components.path as NSString).deletingPathExtension + "." + ext
        return components.url
    }
}
