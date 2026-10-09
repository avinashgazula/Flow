import Foundation
import FlowKit

/// One dated thing in the calendar: an episode of a show you follow, or a film on your watchlist.
struct CalendarEntry: Identifiable, Hashable {
    let item: MediaItem
    let episode: Episode?
    let date: Date

    var id: String { episode?.id ?? "movie:\(item.id)" }
    var hasAired: Bool { date <= Date() }
    var isPremiere: Bool { episode?.number == 1 }
}

extension AppModel {
    /// Shows in the library worth following: watchlist, favourites, history and Continue Watching.
    var followedShowKeys: [MediaKey] {
        var seen = Set<MediaKey>()
        let all = continueWatching.map(\.key) + watchlistKeys + favouriteKeys + history.map(\.key)
        return all.filter { $0.type == .show && seen.insert($0).inserted }
    }

    /// Episodes from a week ago to six weeks out, plus watchlisted films opening within the year.
    func calendar(pastDays: Int = 7, futureDays: Int = 45) async -> [CalendarEntry] {
        guard let catalog else { return [] }
        let now = Date()
        let from = now.addingTimeInterval(-Double(pastDays) * 86400)
        let to = now.addingTimeInterval(Double(futureDays) * 86400)

        let shows = Array(followedShowKeys.prefix(40))
        let episodes = await withTaskGroup(of: [CalendarEntry].self) { group in
            for key in shows {
                group.addTask {
                    @Sendable func inWindow(_ date: Date?) -> Bool { date.map { $0 >= from && $0 <= to } ?? false }
                    guard let detail = try? await catalog.details(.show, id: key.tmdbID) else { return [] }
                    var found: [Episode] = []
                    if let next = detail.nextEpisode, inWindow(next.airDate) {
                        // The rest of the airing season, not just the next one.
                        let season = (try? await catalog.tmdb.season(showID: key.tmdbID, season: next.season)) ?? [next]
                        found = season.filter { inWindow($0.airDate) }
                    }
                    if let last = detail.lastEpisode, inWindow(last.airDate), !found.contains(where: { $0.id == last.id }) {
                        found.append(last)
                    }
                    return found.compactMap { episode in
                        episode.airDate.map { CalendarEntry(item: detail.item, episode: episode, date: $0) }
                    }
                }
            }
            var all: [CalendarEntry] = []
            for await chunk in group { all += chunk }
            return all
        }

        let movieKeys = watchlistKeys.filter { $0.type == .movie }
        let films = await hydrate(movieKeys, limit: 120).compactMap { item -> CalendarEntry? in
            guard let date = item.releaseDate, date >= from, date <= now.addingTimeInterval(365 * 86400) else { return nil }
            return CalendarEntry(item: item, episode: nil, date: date)
        }

        return (episodes + films).sorted { ($0.date, $0.item.title) < ($1.date, $1.item.title) }
    }
}
