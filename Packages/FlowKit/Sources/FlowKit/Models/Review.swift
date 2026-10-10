import Foundation

/// A viewer's review of a title, from TMDb or a Trakt comment.
public struct Review: Codable, Hashable, Sendable, Identifiable {
    public enum Source: String, Codable, Hashable, Sendable {
        case tmdb, trakt
        public var name: String { self == .tmdb ? "TMDB" : "Trakt" }
    }

    public var id: String
    public var source: Source
    public var author: String
    public var text: String
    /// Out of 10, when the reviewer scored the title.
    public var rating: Int?
    public var date: Date?
    /// Trakt lets commenters flag spoilers; TMDb has no such flag.
    public var spoiler: Bool

    public init(id: String, source: Source, author: String, text: String, rating: Int? = nil, date: Date? = nil, spoiler: Bool = false) {
        self.id = id
        self.source = source
        self.author = author
        self.text = text
        self.rating = rating
        self.date = date
        self.spoiler = spoiler
    }

    /// Both sources interleaved, newest first, so neither crowds the row.
    public static func merged(_ lists: [Review]...) -> [Review] {
        lists.flatMap { $0 }.sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }
}

/// Dollar amounts the way a film's page prints them: "$80M", "$120.4M".
public enum CompactMoney {
    public static func string(_ dollars: Int) -> String {
        func scaled(_ value: Double, _ suffix: String) -> String {
            let rounded = (value * 10).rounded() / 10
            let text = rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
            return "$\(text)\(suffix)"
        }
        let amount = Double(dollars)
        if amount >= 1_000_000_000 { return scaled(amount / 1_000_000_000, "B") }
        if amount >= 1_000_000 { return scaled(amount / 1_000_000, "M") }
        if amount >= 1_000 { return scaled(amount / 1_000, "K") }
        return "$\(dollars)"
    }
}
