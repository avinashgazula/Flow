import Foundation

/// A live channel that looks like it carries a game.
public struct ChannelMatch: Hashable, Sendable, Identifiable {
    public var channel: Channel
    /// The guide entry that named the teams, when that's how it matched.
    public var programme: Programme?
    public var score: Int

    public var id: String { channel.id }
}

/// Finds the IPTV channels showing a game: guide entries around kick-off that name the teams,
/// then channels named after the league.
public enum SportsChannelMatcher {
    /// Programmes starting this long before kick-off, or running up to three hours after, count.
    static let earlyWindow: TimeInterval = 30 * 60
    static let lateWindow: TimeInterval = 3 * 3600
    static let minimumScore = 20

    /// Best first; the first element is what press-and-hold plays.
    public static func matches(for event: SportsEvent, channels: [Channel], epg: EPG, now: Date = Date()) -> [ChannelMatch] {
        let teams = [event.homeTeam, event.awayTeam].compactMap { $0 }.map(normalised).filter { !$0.isEmpty }
        let league = event.league.map(normalised) ?? ""
        let kickoff = event.date ?? now
        let window = kickoff.addingTimeInterval(-earlyWindow)...kickoff.addingTimeInterval(lateWindow)

        var out: [ChannelMatch] = []
        for channel in channels {
            var score = 0
            var found: Programme?
            if let epgID = channel.epgID, let list = epg.programmes[epgID] ?? epg.programmes[epgID.lowercased()] {
                for programme in list where programme.end > window.lowerBound && programme.start < window.upperBound {
                    let text = " " + normalised([programme.title, programme.subtitle, programme.description].compactMap { $0 }.joined(separator: " ")) + " "
                    let named = teams.filter { text.contains(" \($0) ") }.count
                    guard named > 0 else { continue }
                    var s = named >= 2 ? 100 : 50
                    // Airing at kick-off beats a repeat or preview later on.
                    if programme.start <= kickoff.addingTimeInterval(15 * 60), programme.end > kickoff { s += 10 }
                    if s > score { score = s; found = programme }
                }
            }
            if !league.isEmpty, (" " + normalised(channel.name + " " + channel.group) + " ").contains(" \(league) ") { score += 20 }
            if score >= minimumScore { out.append(ChannelMatch(channel: channel, programme: found, score: score)) }
        }
        return out.sorted { ($1.score, $0.channel.number ?? Int.max, $0.channel.name) < ($0.score, $1.channel.number ?? Int.max, $1.channel.name) }
    }

    /// Lowercased, accents and punctuation folded away, club prefixes dropped ("FC Barcelona" and "Barcelona" agree).
    static func normalised(_ text: String) -> String {
        let folded = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
        let words = folded.unicodeScalars
            .map { CharacterSet.alphanumerics.contains($0) ? Character($0) : " " }
            .reduce(into: "") { $0.append($1) }
            .split(separator: " ")
            .map(String.init)
            .filter { !["fc", "afc", "cf", "sc", "ac", "the"].contains($0) }
        return words.joined(separator: " ")
    }
}
