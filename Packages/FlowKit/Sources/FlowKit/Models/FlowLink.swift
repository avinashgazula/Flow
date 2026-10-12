import Foundation

/// A `flow://` link from a widget, the Top Shelf, Shortcuts, Spotlight or someone's message.
public enum FlowLink: Equatable, Sendable {
    /// `flow://title/movie/693134`, the title's page. `tv` works as well as `show`, as on TMDb.
    case title(MediaKey)
    /// `flow://play/show/1399`, the title's page, then playback.
    case play(MediaKey)
    /// `flow://continue`, the latest thing in Continue Watching.
    case resume
    /// `flow://upcoming`
    case upcoming
    /// `flow://search?q=dune`
    case search(String)
    /// `flow://setup?d=…`, a setup shared from another device. Carries the whole link.
    case setup(String)

    /// Nil for anything Flow doesn't recognise, which is better ignored than answered with an error.
    public init?(url: URL) {
        guard url.scheme?.lowercased() == SetupShare.urlScheme else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        switch url.host?.lowercased() {
        case "title", "play":
            guard parts.count == 2, let id = Int(parts[1]) else { return nil }
            let type: MediaType
            switch parts[0].lowercased() {
            case "movie": type = .movie
            case "show", "tv": type = .show
            default: return nil
            }
            let key = MediaKey(type: type, tmdbID: id)
            self = url.host?.lowercased() == "play" ? .play(key) : .title(key)
        case "continue": self = .resume
        case "upcoming": self = .upcoming
        case "search":
            self = .search(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? "")
        case "setup": self = .setup(url.absoluteString)
        default: return nil
        }
    }
}
