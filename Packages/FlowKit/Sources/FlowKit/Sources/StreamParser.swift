import Foundation

/// Extracts quality traits from free-form stream text (add-on titles, filenames, server media info).
public enum StreamParser {
    public static func parse(_ texts: String?...) -> StreamTraits {
        parse(texts.compactMap { $0 }.joined(separator: "\n"))
    }

    public static func parse(_ text: String) -> StreamTraits {
        var t = StreamTraits()
        let lower = text.lowercased()
        t.resolution = resolution(lower)
        t.quality = quality(lower)
        t.videoCodec = videoCodec(lower)
        t.hdr = hdr(lower)
        t.audioCodec = audioCodec(lower)
        t.audioChannels = first(#"(?<!\d)([257]\.[01])(?!\d)"#, in: lower)
        t.sizeBytes = size(text)
        t.languages = languages(text)
        t.isCached = cached(text)
        t.seeders = first(#"(?:👤|seeders?:?|seeds?:?)\s*(\d+)"#, in: lower).flatMap { Int($0) }
        if lower.range(of: #"\b10[ -]?bit\b"#, options: .regularExpression) != nil { t.bitDepth = 10 }
        t.releaseGroup = first(#"-([a-z0-9]{2,12})(?:\.(?:mkv|mp4|avi|m4v|ts))?\s*$"#, in: lower.components(separatedBy: "\n").first { $0.contains(".mkv") || $0.contains(".mp4") } ?? "")
        return t
    }

    static func matches(_ pattern: String, _ text: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func first(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range) else { return nil }
        let group = match.numberOfRanges > 1 ? match.range(at: 1) : match.range
        guard let r = Range(group, in: text) else { return nil }
        return String(text[r])
    }

    static func resolution(_ s: String) -> VideoResolution {
        if matches(#"\b(2160p|4k|uhd)\b"#, s) || s.contains("✨ 4k") { return .uhd4k }
        if matches(#"\b1440p\b"#, s) { return .uhd1440 }
        if matches(#"\b(1080p|1080i|fhd)\b"#, s) { return .hd1080 }
        if matches(#"\b720p\b"#, s) { return .hd720 }
        if matches(#"\b(480p|576p|360p|sd|dvdrip)\b"#, s) { return .sd }
        return .unknown
    }

    static func quality(_ s: String) -> ReleaseQuality {
        if matches(#"\bremux\b"#, s) { return .remux }
        if matches(#"\b(blu-?ray|bdrip|brrip|bdremux|bd25|bd50)\b"#, s) { return .bluray }
        if matches(#"\b(web-?dl|webdl|web dl|amzn|nf|dsnp|atvp|hmax)\b"#, s) { return .webdl }
        if matches(#"\b(web-?rip|webrip)\b"#, s) { return .webrip }
        if matches(#"\bweb\b"#, s) { return .webdl }
        if matches(#"\b(hdtv|pdtv|dsr)\b"#, s) { return .hdtv }
        if matches(#"\b(hd-?cam|cam-?rip|cam)\b"#, s) { return .cam }
        if matches(#"\b(hd-?ts|telesync|ts|pdvd)\b"#, s) { return .telesync }
        if matches(#"\b(hd-?tc|telecine|tc)\b"#, s) { return .telecine }
        if matches(#"\b(dvd-?scr|screener|scr)\b"#, s) { return .screener }
        return .unknown
    }

    static func videoCodec(_ s: String) -> String? {
        if matches(#"\b(x265|h\.?265|hevc)\b"#, s) { return "HEVC" }
        if matches(#"\b(x264|h\.?264|avc)\b"#, s) { return "H264" }
        if matches(#"\bav1\b"#, s) { return "AV1" }
        if matches(#"\bvp9\b"#, s) { return "VP9" }
        if matches(#"\b(xvid|divx)\b"#, s) { return "XviD" }
        return nil
    }

    static func hdr(_ s: String) -> [String] {
        var out: [String] = []
        if matches(#"\b(dolby ?vision|dovi|dv)\b"#, s) { out.append("DV") }
        if matches(#"\bhdr10\+|hdr10plus"#, s) { out.append("HDR10+") }
        else if matches(#"\bhdr(10)?\b"#, s) { out.append("HDR") }
        if matches(#"\bhlg\b"#, s) { out.append("HLG") }
        return out
    }

    static func audioCodec(_ s: String) -> String? {
        if matches(#"\batmos\b"#, s) { return matches(#"\btruehd\b"#, s) ? "TrueHD Atmos" : "Atmos" }
        if matches(#"\btruehd\b"#, s) { return "TrueHD" }
        if matches(#"\bdts-?hd(\.| )?ma\b"#, s) { return "DTS-HD MA" }
        if matches(#"\bdts-?x\b"#, s) { return "DTS:X" }
        if matches(#"\bdts\b"#, s) { return "DTS" }
        if matches(#"(\bddp|\bdd\+|\be-?ac-?3\b|\beac3\b)"#, s) { return "DD+" }
        if matches(#"\b(dd|ac-?3|dolby digital)\b"#, s) { return "DD" }
        if matches(#"\baac\b"#, s) { return "AAC" }
        if matches(#"\bflac\b"#, s) { return "FLAC" }
        if matches(#"\bopus\b"#, s) { return "Opus" }
        if matches(#"\bmp3\b"#, s) { return "MP3" }
        return nil
    }

    /// Largest size mentioned, in bytes. Add-ons sometimes list per-file and total sizes.
    public static func size(_ s: String) -> Int64? {
        guard let regex = try? NSRegularExpression(pattern: #"(\d+(?:[.,]\d+)?)\s*(TB|TiB|GB|GiB|MB|MiB)\b"#, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(s.startIndex..., in: s)
        var best: Int64?
        for match in regex.matches(in: s, range: range) {
            guard let vr = Range(match.range(at: 1), in: s), let ur = Range(match.range(at: 2), in: s),
                  let value = Double(s[vr].replacingOccurrences(of: ",", with: ".")) else { continue }
            let unit = s[ur].lowercased()
            let multiplier: Double = unit.hasPrefix("t") ? 1_099_511_627_776 : unit.hasPrefix("g") ? 1_073_741_824 : 1_048_576
            let bytes = Int64(value * multiplier)
            best = max(best ?? 0, bytes)
        }
        return best
    }

    static let languageNames: [(name: String, patterns: [String])] = [
        ("English", ["english", "🇬🇧", "🇺🇸", "\\beng\\b"]),
        ("Hindi", ["hindi", "🇮🇳", "\\bhin\\b"]),
        ("Tamil", ["tamil", "\\btam\\b"]),
        ("Telugu", ["telugu", "\\btel\\b"]),
        ("Malayalam", ["malayalam", "\\bmal\\b"]),
        ("Kannada", ["kannada", "\\bkan\\b"]),
        ("Bengali", ["bengali", "\\bben\\b"]),
        ("Spanish", ["spanish", "español", "castellano", "latino", "🇪🇸", "🇲🇽", "\\bspa\\b"]),
        ("French", ["french", "français", "\\bvff\\b", "\\bvf\\b", "🇫🇷", "\\bfre\\b"]),
        ("German", ["german", "deutsch", "🇩🇪", "\\bger\\b"]),
        ("Italian", ["italian", "italiano", "🇮🇹", "\\bita\\b"]),
        ("Portuguese", ["portuguese", "português", "🇧🇷", "🇵🇹", "\\bpor\\b"]),
        ("Russian", ["russian", "🇷🇺", "\\brus\\b"]),
        ("Japanese", ["japanese", "🇯🇵", "\\bjpn\\b"]),
        ("Korean", ["korean", "🇰🇷", "\\bkor\\b"]),
        ("Chinese", ["chinese", "mandarin", "cantonese", "🇨🇳", "\\bchi\\b"]),
        ("Arabic", ["arabic", "🇸🇦", "\\bara\\b"]),
        ("Turkish", ["turkish", "🇹🇷", "\\btur\\b"]),
        ("Polish", ["polish", "🇵🇱", "\\bpol\\b"]),
        ("Dutch", ["dutch", "🇳🇱", "\\bdut\\b"]),
        ("Multi", ["\\bmulti\\b", "dual audio", "\\bdual\\b"]),
    ]

    static func languages(_ s: String) -> [String] {
        let lower = s.lowercased()
        return languageNames.filter { entry in entry.patterns.contains { matches($0, lower) } }.map(\.name)
    }

    /// Debrid cache markers used by AIOStreams, Torrentio, Comet, MediaFusion and friends.
    static func cached(_ s: String) -> Bool? {
        if matches(#"\[(rd|ad|pm|tb|dl|ed|oc|pkp|tr|eb)\+\]"#, s) || s.contains("⚡") || matches(#"\binstant\b|\bcached\b"#, s) { return true }
        if matches(#"\[(rd|ad|pm|tb|dl|ed|oc|pkp|tr|eb)( download|⏳)?\]"#, s) || s.contains("⏳") || matches(#"\buncached\b"#, s) { return false }
        return nil
    }

    /// Season/episode from a filename: S01E02, 1x02, "Season 1 Episode 2".
    public static func episodeRef(in filename: String) -> EpisodeRef? {
        let lower = filename.lowercased()
        let patterns = [#"s(\d{1,2})[ ._-]?e(\d{1,3})"#, #"\b(\d{1,2})x(\d{2,3})\b"#, #"season[ ._-]?(\d{1,2})[ ._-]*episode[ ._-]?(\d{1,3})"#]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let match = regex.firstMatch(in: lower, range: NSRange(lower.startIndex..., in: lower)),
                  let sr = Range(match.range(at: 1), in: lower), let er = Range(match.range(at: 2), in: lower),
                  let s = Int(lower[sr]), let e = Int(lower[er]) else { continue }
            return EpisodeRef(season: s, episode: e)
        }
        return nil
    }

    /// "The.Matrix.1999.1080p.BluRay.x264.mkv" → ("the matrix", 1999)
    public static func titleAndYear(from filename: String) -> (title: String, year: Int?) {
        var name = filename
        if let dot = name.lastIndex(of: "."), name.distance(from: dot, to: name.endIndex) <= 5 { name = String(name[..<dot]) }
        name = name.replacingOccurrences(of: #"[._]"#, with: " ", options: .regularExpression)
        var year: Int?
        // The last year-like token is the release year ("Blade Runner 2049 (2017)").
        if let regex = try? NSRegularExpression(pattern: #"(?:^|[\s(\[])((?:19|20)\d{2})(?=[\s)\]]|$)"#),
           let match = regex.matches(in: name, range: NSRange(name.startIndex..., in: name)).last(where: { $0.range.location > 0 }),
           let yr = Range(match.range(at: 1), in: name), let yi = Int(name[yr]) {
            year = yi
            name = String(name[..<yr.lowerBound])
        } else if let range = name.range(of: #"\b(s\d{1,2}e\d{1,3}|\d{3,4}p|season \d+)"#, options: [.regularExpression, .caseInsensitive]) {
            name = String(name[..<range.lowerBound])
        }
        let title = name.replacingOccurrences(of: #"[\[\]()]"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        return (normalizeTitle(title), year)
    }

    /// Lowercase, ASCII-folded, punctuation-free form used for fuzzy title matching.
    public static func normalizeTitle(_ title: String) -> String {
        let folded = title.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let replaced = folded.replacingOccurrences(of: "&", with: " and ")
        let cleaned = replaced.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : " " }
        return String(cleaned).split(separator: " ").joined(separator: " ")
    }

    public static func formatBytes(_ bytes: Int64) -> String {
        let gb = Double(bytes) / 1_073_741_824
        if gb >= 1 { return String(format: "%.2f GB", gb) }
        return String(format: "%.1f MB", Double(bytes) / 1_048_576)
    }
}
