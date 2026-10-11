import Foundation

/// X-Ray: who's in the scene, worked out from what's being said.
///
/// Streaming services tag every scene by hand or with face recognition. Flow has the cast list and
/// the subtitles instead, and characters are named in dialogue far more often than you'd think:
/// "Jesse, get in", "Hank's on his way", "WALT: Say my name". Matching the last few minutes of lines
/// against the characters' names gives a good guess at who's around right now.
public enum XRay {
    /// How far back the dialogue is read, in seconds.
    public static let window: Double = 180

    /// The cast members whose characters were named in `lines`, most-mentioned first (ties keep billing order).
    public static func mentioned(in lines: [String], cast: [CastMember]) -> [CastMember] {
        let names = cast.map { CharacterNames(member: $0) }
        // A word two characters share ("White" for Walter and Skyler) says nothing about which one.
        var owners: [String: Set<Int>] = [:]
        for name in names {
            for token in name.tokens { owners[token, default: []].insert(name.member.id) }
        }
        let words = lines.flatMap(Self.words)
        // Punctuation as spaces, so " walter white " is found in "Walter White."
        let lowered = " " + String(lines.joined(separator: " ").lowercased().map { $0.isLetter || $0 == "'" ? $0 : " " }) + " "

        var scores: [Int: Int] = [:]
        for name in names {
            var score = 0
            // A full name ("Walter White") is the strongest sign.
            for full in name.fullNames where full.contains(" ") {
                score += 2 * lowered.components(separatedBy: " \(full) ").count - 2
            }
            for word in words {
                guard name.tokens.contains(word.key), owners[word.key]?.count == 1 else { continue }
                // An everyday word ("Will", "Hope") counts only mid-sentence, where its capital means a name.
                if Self.everydayWords.contains(word.key) && word.startsSentence { continue }
                score += 1
            }
            if score > 0 { scores[name.member.id, default: 0] += score }
        }
        var seen = Set<Int>()
        return cast
            .filter { scores[$0.id] != nil && seen.insert($0.id).inserted }
            .sorted { (scores[$0.id] ?? 0, -$0.order) > (scores[$1.id] ?? 0, -$1.order) }
    }

    // MARK: Words in the dialogue

    struct Word {
        /// Lowercased, without a trailing possessive.
        var key: String
        var startsSentence: Bool
    }

    /// Capitalised words only: names are proper nouns. ALL-CAPS speaker labels ("JESSE:") count too.
    static func words(in line: String) -> [Word] {
        var result: [Word] = []
        var sentenceStart = true
        var current = ""
        func flush(endsSentence: Bool) {
            defer { current = ""; if endsSentence { sentenceStart = true } }
            guard let first = current.first else { return }
            if first.isUppercase {
                var key = current.lowercased()
                for suffix in ["'s", "’s", "s'"] where key.hasSuffix(suffix) { key.removeLast(suffix.count); break }
                if key.count >= 3 { result.append(Word(key: key, startsSentence: sentenceStart)) }
            }
            sentenceStart = false
        }
        for character in line {
            if character.isLetter || character == "'" || character == "’" {
                current.append(character)
            } else {
                flush(endsSentence: ".!?:-\n♪[]()".contains(character))
            }
        }
        flush(endsSentence: true)
        return result
    }

    // MARK: Character names

    struct CharacterNames {
        let member: CastMember
        /// Whole names, lowercased: "walter white", "heisenberg".
        let fullNames: [String]
        /// The words that can stand for the character on their own: "walter", "white", "heisenberg".
        let tokens: Set<String>

        init(member: CastMember) {
            self.member = member
            // "Walter White / Heisenberg (voice)": every alias, without the notes in brackets.
            let cleaned = member.role.replacingOccurrences(of: #"\([^)]*\)"#, with: " ", options: .regularExpression)
            let aliases = cleaned.components(separatedBy: CharacterSet(charactersIn: "/;|"))
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty && !XRay.notCharacters.contains($0.lowercased()) && !$0.contains(where: \.isNumber) }
            var full: [String] = []
            var tokens = Set<String>()
            for alias in aliases {
                let words = alias.lowercased()
                    .components(separatedBy: CharacterSet.letters.union(CharacterSet(charactersIn: "'")).inverted)
                    .filter { !$0.isEmpty }
                let meaningful = words.filter { $0.count >= 3 && !XRay.titles.contains($0) && !XRay.roleWords.contains($0) }
                // "Police Officer", "Man in Bar": a description, not a name anyone says.
                guard !meaningful.isEmpty else { continue }
                full.append(words.joined(separator: " "))
                tokens.formUnion(meaningful)
            }
            fullNames = full
            self.tokens = tokens
        }
    }

    /// Credits that aren't characters at all.
    static let notCharacters: Set<String> = ["self", "himself", "herself", "themselves", "narrator", "host", "voice", "various", "additional voices"]

    /// Forms of address: "Mr. White" is White, "Dr. House" is House.
    static let titles: Set<String> = ["mr", "mrs", "ms", "miss", "dr", "sir", "lady", "lord", "the", "and", "of", "von", "van", "der", "del", "jr", "sr",
                                      "captain", "detective", "agent", "officer", "professor", "doctor", "uncle", "aunt", "father", "mother",
                                      "sergeant", "lieutenant", "general", "colonel", "major", "king", "queen", "prince", "princess", "judge", "nurse"]

    /// Words in generic credits ("Waitress", "Man in Bar", "Young Jesse") that aren't names.
    static let roleWords: Set<String> = ["man", "woman", "boy", "girl", "guy", "kid", "young", "old", "older", "younger", "little", "big",
                                         "police", "cop", "guard", "waiter", "waitress", "bartender", "driver", "reporter", "anchor", "student",
                                         "teacher", "patient", "customer", "clerk", "soldier", "thug", "henchman", "member", "worker", "friend",
                                         "neighbor", "neighbour", "stranger", "passenger", "pilot", "receptionist", "secretary", "assistant",
                                         "bar", "club", "store", "shop", "restaurant", "hospital", "school", "office", "street", "news", "tv"]

    /// Names that are also common words: counted only where the capital can't just be a sentence start.
    static let everydayWords: Set<String> = ["will", "may", "mark", "rose", "grace", "hope", "faith", "joy", "summer", "dawn", "june", "april",
                                             "art", "bill", "sue", "pat", "max", "ray", "jack", "frank", "carol", "chance", "chase", "hunter",
                                             "angel", "honey", "baby", "buddy", "sunny", "rich", "lucky", "earl", "dean", "drew", "gene", "faye",
                                             "rob", "nick", "penny", "holly", "ivy", "lily", "daisy", "amber", "ruby", "crystal", "storm", "sky"]
}

extension SubtitleDocument {
    /// The text of every cue that started between `from` and `to` (playback time, with `offset` applied as in `text(at:)`).
    public func lines(from: Double, to: Double, offset: Double = 0) -> [String] {
        let start = from - offset, end = to - offset
        var lo = 0, hi = cues.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if cues[mid].start < start { lo = mid + 1 } else { hi = mid }
        }
        var result: [String] = []
        var i = lo
        while i < cues.count, cues[i].start <= end {
            result.append(cues[i].text)
            i += 1
        }
        return result
    }
}
