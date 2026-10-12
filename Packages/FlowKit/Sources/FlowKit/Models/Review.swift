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

/// Review text as people wrote it: TMDb and Trakt pass on HTML entities, tags and Markdown
/// ("&amp;", "<em>", "**great**", "[link](https://…)"), which read as noise in plain text.
public enum ReviewText {
    public static func clean(_ raw: String) -> String {
        var text = raw
            .replacingOccurrences(of: #"<br\s*/?>"#, with: "\n", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"</?[A-Za-z][^>]*>"#, with: "", options: .regularExpression)
            // [words](https://…) keeps the words.
            .replacingOccurrences(of: #"\[([^\]]+)\]\((https?://[^)\s]+)\)"#, with: "$1", options: .regularExpression)
            // **bold**, __bold__, *italic*, _italic_ keep their words.
            .replacingOccurrences(of: #"(\*\*|__)(\S(?:.*?\S)?)\1"#, with: "$2", options: .regularExpression)
            .replacingOccurrences(of: #"(?<![\w*])\*(\S(?:[^*]*?\S)?)\*(?![\w*])"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"(?<!\w)_(\S(?:[^_]*?\S)?)_(?!\w)"#, with: "$1", options: .regularExpression)
        text = decodeEntities(text)
        // Paragraph breaks at most one blank line apart.
        text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        let named = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ",
                     "hellip": "…", "mdash": "—", "ndash": "–", "rsquo": "’", "lsquo": "‘", "rdquo": "”", "ldquo": "“"]
        var result = ""
        var rest = Substring(text)
        while let amp = rest.firstIndex(of: "&") {
            result += rest[..<amp]
            let after = rest[rest.index(after: amp)...]
            if let semi = after.prefix(10).firstIndex(of: ";") {
                let name = String(after[..<semi])
                var decoded: String?
                if name.hasPrefix("#x") || name.hasPrefix("#X") {
                    decoded = UInt32(name.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
                } else if name.hasPrefix("#") {
                    decoded = UInt32(name.dropFirst()).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
                } else {
                    decoded = named[name.lowercased()]
                }
                if let decoded {
                    result += decoded
                    rest = after[after.index(after: semi)...]
                    continue
                }
            }
            result += "&"
            rest = after
        }
        return result + rest
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
