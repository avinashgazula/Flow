import Foundation
import FlowKit
#if os(iOS)
import WidgetKit
#endif
#if os(tvOS)
import TVServices
#endif

extension AppModel {
    /// Refreshes what the Home Screen widget and the Apple TV Top Shelf show.
    func publishSnapshot() async {
        guard FlowSnapshot.fileURL != nil else { return }
        let entries = Array(continueWatching.prefix(8))
        let watch = Array(watchlistKeys.prefix(12))
        let items = await hydrate(entries.map(\.key) + watch, limit: 20)
        let byKey = Dictionary(items.compactMap { item in item.key.map { ($0, item) } }, uniquingKeysWith: { a, _ in a })

        let continuing: [FlowSnapshot.Item] = entries.compactMap { entry in
            guard let item = byKey[entry.key] else { return nil }
            let subtitle: String
            if let episode = entry.episode {
                subtitle = entry.isNextUp ? "Next: S\(episode.season), E\(episode.episode)" : "S\(episode.season), E\(episode.episode)"
            } else if let p = entry.progress, let remaining = p.remainingSeconds {
                subtitle = TimeFormat.remaining(remaining)
            } else {
                subtitle = item.year.map(String.init) ?? ""
            }
            return FlowSnapshot.Item(id: entry.id, title: item.title, subtitle: subtitle,
                                     progress: entry.progress.map { $0.percent / 100 },
                                     imageURL: item.backdropURL ?? item.posterURL, posterURL: item.posterURL,
                                     link: SystemIntegration.url(for: entry.key), playLink: SystemIntegration.playURL(for: entry.key))
        }
        let watchlist: [FlowSnapshot.Item] = watch.compactMap { key in
            guard let item = byKey[key] else { return nil }
            return FlowSnapshot.Item(id: key.description, title: item.title, subtitle: item.year.map(String.init) ?? "",
                                     progress: nil, imageURL: item.backdropURL, posterURL: item.posterURL,
                                     link: SystemIntegration.url(for: key), playLink: SystemIntegration.playURL(for: key))
        }

        FlowSnapshot(continueWatching: continuing, watchlist: watchlist, updatedAt: Date()).save()
        #if os(iOS)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
        #if os(tvOS)
        TVTopShelfContentProvider.topShelfContentDidChange()
        #endif
    }
}
