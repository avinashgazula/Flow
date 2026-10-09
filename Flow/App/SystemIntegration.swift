import SwiftUI
import FlowKit
#if canImport(CoreSpotlight) && !os(tvOS)
import CoreSpotlight
import UniformTypeIdentifiers
#endif

/// Spotlight, Handoff and deep links: every way the system can bring someone to a title.
enum SystemIntegration {
    /// NSUserActivity type advertised by detail pages (also listed in Info.plist).
    static let titleActivity = "app.flow.title"

    /// flow://title/movie/603
    static func url(for key: MediaKey) -> URL {
        URL(string: "\(SetupShare.urlScheme)://title/\(key.type.rawValue)/\(key.tmdbID)")!
    }

    /// flow://play/movie/603 opens the title and starts it.
    static func playURL(for key: MediaKey) -> URL {
        URL(string: "\(SetupShare.urlScheme)://play/\(key.type.rawValue)/\(key.tmdbID)")!
    }

    static func key(from url: URL) -> MediaKey? {
        guard url.scheme == SetupShare.urlScheme, url.host == "title" || url.host == "play" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, let type = MediaType(rawValue: parts[0]), let id = Int(parts[1]) else { return nil }
        return MediaKey(type: type, tmdbID: id)
    }

    /// Indexes the watchlist and Continue Watching so they're findable from Spotlight.
    static func index(_ items: [MediaItem]) {
        #if canImport(CoreSpotlight) && !os(tvOS)
        let searchable: [CSSearchableItem] = items.compactMap { item in
            guard let key = item.key else { return nil }
            let attributes = CSSearchableItemAttributeSet(contentType: .movie)
            attributes.title = item.title
            attributes.contentDescription = [item.year.map(String.init), item.genreLine, item.overview].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            attributes.thumbnailURL = item.posterURL
            attributes.keywords = item.genres.map(\.name) + [item.type == .movie ? "movie" : "tv show"]
            return CSSearchableItem(uniqueIdentifier: key.description, domainIdentifier: "library", attributeSet: attributes)
        }
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: ["library"]) { _ in
            CSSearchableIndex.default().indexSearchableItems(searchable)
        }
        #endif
    }

    /// The MediaKey carried by a Spotlight tap or a Handoff activity.
    static func key(from activity: NSUserActivity) -> MediaKey? {
        #if canImport(CoreSpotlight) && !os(tvOS)
        if activity.activityType == CSSearchableItemActionType,
           let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            return MediaKey(string: id)
        }
        #endif
        if let raw = activity.userInfo?["key"] as? String { return MediaKey(string: raw) }
        return nil
    }
}

extension AppModel {
    /// Opens a title's detail page on the Home stack.
    func open(_ key: MediaKey) {
        Task {
            guard let catalog, let item = try? await catalog.item(key) else { return }
            activePlayback?.stop()
            sourcePickerRequest = nil
            selectedTab = .home
            paths[.home] = [.detail(item)]
        }
    }

    func refreshSpotlight() async {
        let keys = Array((continueWatching.map(\.key) + watchlistKeys).prefix(80))
        let items = await hydrate(keys, limit: 80)
        SystemIntegration.index(items)
    }
}

extension View {
    /// Advertises the title for Handoff to the user's other devices.
    func advertisesTitle(_ item: MediaItem) -> some View {
        userActivity(SystemIntegration.titleActivity, isActive: item.key != nil) { activity in
            activity.title = item.title
            activity.userInfo = ["key": item.key?.description ?? ""]
            activity.isEligibleForHandoff = true
            #if !os(tvOS)
            activity.isEligibleForSearch = false
            #endif
            if let key = item.key { activity.webpageURL = nil; activity.targetContentIdentifier = key.description }
        }
    }
}
