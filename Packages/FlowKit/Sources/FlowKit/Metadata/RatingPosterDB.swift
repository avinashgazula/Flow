import Foundation

/// RatingPosterDB: the poster with its ratings drawn on.
public enum RatingPosterDB {
    /// nil without a key or any ID to look the title up by. Lists from TMDb carry no IMDb ID, so the TMDb ID
    /// stands in for it and every shelf gets enhanced posters. `fallback=true` makes the service answer with the plain
    /// poster when it has no ratings art.
    public static func posterURL(apiKey: String?, item: MediaItem) -> URL? {
        let lookup: String
        if let imdb = item.ids.imdb?.trimmingCharacters(in: .whitespaces).nilIfEmpty {
            lookup = "imdb/poster-default/\(imdb.addingPercentEncoding(withAllowedCharacters: .urlComponentAllowed) ?? imdb)"
        } else if let tmdb = item.ids.tmdb {
            lookup = "tmdb/poster-default/\(item.type == .movie ? "movie" : "series")-\(tmdb)"
        } else {
            return nil
        }
        guard let key = apiKey?.trimmingCharacters(in: .whitespaces).nilIfEmpty,
              let encodedKey = key.addingPercentEncoding(withAllowedCharacters: .urlComponentAllowed) else { return nil }
        return URL(string: "https://api.ratingposterdb.com/\(encodedKey)/\(lookup).jpg?fallback=true")
    }
}
