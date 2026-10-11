import Foundation

/// Where a score on the detail page leads: the site's own page for the title.
public enum RatingLinks {
    /// nil when the site can't be reached from what we know about the title (no IMDb ID, no TMDb ID, no film).
    public static func url(for source: RatingSource, item: MediaItem) -> URL? {
        let imdb = item.ids.imdb?.nilIfEmpty
        let title = item.title.addingPercentEncoding(withAllowedCharacters: .urlComponentAllowed) ?? item.title
        let string: String?
        switch source {
        case .imdb:
            string = imdb.map { "https://www.imdb.com/title/\($0)/reviews" }
        case .tomatometer, .popcornmeter:
            string = "https://www.rottentomatoes.com/search?search=\(title)"
        case .metacritic:
            string = "https://www.metacritic.com/search/\(title)/"
        case .tmdb:
            string = item.ids.tmdb.map { "https://www.themoviedb.org/\(item.type == .movie ? "movie" : "tv")/\($0)/reviews" }
        case .letterboxd:
            // Letterboxd only lists films.
            string = item.type == .movie ? imdb.map { "https://letterboxd.com/imdb/\($0)/" } : nil
        case .trakt:
            string = imdb.map { "https://trakt.tv/search/imdb/\($0)" }
        case .mal:
            string = "https://myanimelist.net/anime.php?q=\(title)"
        }
        return string.flatMap(URL.init(string:))
    }
}
