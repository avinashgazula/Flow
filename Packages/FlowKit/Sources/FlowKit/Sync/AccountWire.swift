import Foundation

/// An entry of the account's library as it travels: a JSON object, kept whole so a field a newer version adds rides
/// along untouched (docs/SYNC.md, "Keep what you don't understand").
public typealias AccountObject = [String: JSONValue]

/// Times on the wire: ISO 8601 in UTC with milliseconds (`2026-10-24T18:00:00.000Z`), worked out by hand from whole
/// milliseconds so every device writes the same text and the history split is the same everywhere.
public enum AccountTime {
    /// Whole milliseconds since 1970 for a wire time, or 0 when it can't be read (such an entry is dropped).
    public static func ms(_ text: String?) -> Int {
        guard let text else { return 0 }
        return parse(text) ?? FlowDate.parse(text).map { Int(($0.timeIntervalSince1970 * 1000).rounded()) } ?? 0
    }

    public static func ms(_ value: JSONValue?) -> Int {
        if case .string(let text)? = value { return ms(text) }
        return 0
    }

    public static func ms(_ date: Date) -> Int { Int((date.timeIntervalSince1970 * 1000).rounded()) }
    public static func date(ms: Int) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }
    public static func string(_ date: Date) -> String { string(ms: ms(date)) }

    private static func floorDiv(_ a: Int, _ b: Int) -> Int { a >= 0 ? a / b : -((-a + b - 1) / b) }

    /// Days since 1970 of a civil date (Howard Hinnant's algorithm).
    private static func daysFromCivil(_ year: Int, _ month: Int, _ day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = floorDiv(y, 400)
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    private static func civilFromDays(_ days: Int) -> (Int, Int, Int) {
        let z = days + 719_468
        let era = floorDiv(z, 146_097)
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }

    public static func string(ms: Int) -> String {
        let days = floorDiv(ms, 86_400_000)
        let rest = ms - days * 86_400_000
        let (year, month, day) = civilFromDays(days)
        let seconds = rest / 1000
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", year, month, day, seconds / 3600, seconds / 60 % 60, seconds % 60, rest % 1000)
    }

    /// `YYYY-MM`, the history value a play belongs to.
    public static func month(ms: Int) -> String { String(string(ms: ms).prefix(7)) }

    /// The fast path for what the apps and the website write; anything else goes to `FlowDate`.
    private static func parse(_ text: String) -> Int? {
        let b = Array(text.utf8)
        guard b.count >= 20 else { return nil }
        func digit(_ i: Int) -> Int? { (48...57).contains(b[i]) ? Int(b[i]) - 48 : nil }
        func number(_ start: Int, _ length: Int) -> Int? {
            var value = 0
            for i in start..<(start + length) {
                guard let d = digit(i) else { return nil }
                value = value * 10 + d
            }
            return value
        }
        guard b[4] == 45, b[7] == 45, b[10] == 84, b[13] == 58, b[16] == 58,
              let year = number(0, 4), let month = number(5, 2), let day = number(8, 2),
              let hour = number(11, 2), let minute = number(14, 2), let second = number(17, 2),
              (1...12).contains(month), (1...31).contains(day), hour < 24, minute < 60, second < 60 else { return nil }
        var i = 19
        var millis = 0
        if i < b.count, b[i] == 46 {
            i += 1
            var count = 0
            while i < b.count, let d = digit(i) {
                if count < 3 { millis = millis * 10 + d; count += 1 }
                i += 1
            }
            if count == 0 { return nil }
            while count < 3 { millis *= 10; count += 1 }
        }
        var offsetMinutes = 0
        if i < b.count {
            if b[i] == 90 {
                i += 1
            } else if (b[i] == 43 || b[i] == 45), i + 6 == b.count, b[i + 3] == 58, let oh = number(i + 1, 2), let om = number(i + 4, 2) {
                offsetMinutes = (b[i] == 43 ? 1 : -1) * (oh * 60 + om)
                i = b.count
            }
        }
        guard i == b.count else { return nil }
        let days = daysFromCivil(year, month, day)
        return (((days * 24 + hour) * 60 + minute - offsetMinutes) * 60 + second) * 1000 + millis
    }
}

/// What a Marquee Account stores for the library, and how two copies are merged (docs/SYNC.md, "What an account holds"
/// and "Merging"). A port of the website's `web/src/lib/account/wire.ts`, over plain JSON so a field this version
/// doesn't know survives. Pure, so every rule has a test.
///
/// A library is five kinds of document, each stored as its own encrypted value: `lists`, `progress`, `sources`,
/// `history-YYYY-MM` (a busy month split by size) and `items-0` to `items-f` (a display card per title, 16 shards).
public enum AccountWire {
    public static let settingsSection = "settings"
    public static let listsSection = "lists"
    public static let progressSection = "progress"
    public static let sourcesSection = "sources"

    /// How long a removal is remembered.
    public static let tombstoneDays = 90
    /// Characters a value may hold before a history month is split: base64 and the tag keep it under the Worker's 256 KB.
    public static let pageLimit = 160_000
    public static let maxProgress = 500
    public static let maxSources = 300

    /// What a library is, all of it, as a device holds it between syncs.
    public struct State: Codable, Equatable, Sendable {
        public var watchlist: [AccountObject] = []
        public var favourites: [AccountObject] = []
        public var ratings: [String: AccountObject] = [:]
        public var rewatches: [AccountObject] = []
        public var shuffle: [AccountObject] = []
        public var order: AccountObject?
        public var progress: [AccountObject] = []
        public var sources: [String: AccountObject] = [:]
        public var history: [AccountObject] = []
        /// Removals, as "<list>:<id>" to when. Lists: watchlist, favourites, ratings, rewatches, progress, history, sources.
        public var removed: [String: String] = [:]
        public var items: [String: AccountObject] = [:]
        /// Fields a newer version added to a document, by document name, carried through.
        public var extra: [String: AccountObject] = [:]

        public init() {}

        public var isEmpty: Bool { self == State() }
    }

    // MARK: Small helpers

    static func text(_ value: JSONValue?) -> String? {
        if case .string(let s)? = value { return s }
        return nil
    }

    static func integer(_ value: JSONValue?) -> Int? {
        guard case .number(let n)? = value, n.isFinite, n == n.rounded(), abs(n) < 9e15 else { return nil }
        return Int(n)
    }

    /// JavaScript orders strings by UTF-16 code unit; so do the other devices.
    static func less(_ a: String, _ b: String) -> Bool { a.utf16.lexicographicallyPrecedes(b.utf16) }

    public static func isKey(_ key: String) -> Bool {
        let parts = key.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0] == "movie" || parts[0] == "show", !parts[1].isEmpty else { return false }
        return parts[1].utf8.allSatisfy { (48...57).contains($0) }
    }

    static func episode(_ value: JSONValue?) -> (season: Int, episode: Int)? {
        guard case .object(let o)? = value, let s = integer(o["season"]), let e = integer(o["episode"]) else { return nil }
        return (s, e)
    }

    static func episodeObject(_ season: Int, _ episode: Int) -> JSONValue {
        .object(["season": .number(Double(season)), "episode": .number(Double(episode))])
    }

    // MARK: Canonical JSON

    /// JSON with keys in sorted order, no whitespace, and numbers and strings as `JSON.stringify` writes them, so equal
    /// values are equal text on every device.
    public static func canonical(_ value: JSONValue) -> String {
        var out = ""
        write(value, &out)
        return out
    }

    public static func canonical(_ object: AccountObject) -> String { canonical(.object(object)) }

    private static func write(_ value: JSONValue, _ out: inout String) {
        switch value {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let n): out += numberText(n)
        case .string(let s): writeString(s, &out)
        case .array(let items):
            out += "["
            for (index, item) in items.enumerated() {
                if index > 0 { out += "," }
                write(item, &out)
            }
            out += "]"
        case .object(let object):
            out += "{"
            for (index, key) in object.keys.sorted(by: less).enumerated() {
                if index > 0 { out += "," }
                writeString(key, &out)
                out += ":"
                write(object[key] ?? .null, &out)
            }
            out += "}"
        }
    }

    private static func numberText(_ n: Double) -> String {
        guard n.isFinite else { return "null" }
        if n == n.rounded(), abs(n) < 9e18 { return String(Int64(n)) }
        return "\(n)"
    }

    private static func writeString(_ s: String, _ out: inout String) {
        out += "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
            }
        }
        out += "\""
    }

    public static func parse(_ text: String) -> JSONValue? {
        try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    /// The canonical form of a value's text, or the text itself when it isn't JSON.
    public static func canonicalText(_ text: String) -> String { parse(text).map(canonical) ?? text }

    // MARK: Identities

    /// "S03E07", as the apps' `EpisodeRef.code`.
    public static func episodeCode(season: Int, episode: Int) -> String { String(format: "S%02dE%02d", season, episode) }

    static func code(_ value: JSONValue?) -> String? { episode(value).map { episodeCode(season: $0.season, episode: $0.episode) } }

    /// The apps' `PlaybackProgress.id`: the title, plus the episode code for a show.
    public static func progressID(_ entry: AccountObject) -> String {
        let key = text(entry["key"]) ?? ""
        return code(entry["episode"]).map { "\(key):\($0)" } ?? key
    }

    /// The apps' `HistoryEntry.id`: the title, the episode or "-", and the whole second it was watched.
    public static func historyID(_ entry: AccountObject) -> String {
        "\(text(entry["key"]) ?? ""):\(code(entry["episode"]) ?? "-"):\(AccountTime.ms(entry["watchedAt"]) / 1000)"
    }

    /// The month a history id belongs to, from the whole second at its end.
    static func monthOfID(_ id: String) -> String {
        guard let colon = id.lastIndex(of: ":"), let seconds = Int(id[id.index(after: colon)...]) else { return "1970-01" }
        return AccountTime.month(ms: seconds * 1000)
    }

    public static func removedKey(_ list: String, _ id: String) -> String { "\(list):\(id)" }

    // MARK: Merging

    /// One entry per id, the newest by `when`; a tie keeps the one whose text sorts last, so every device picks the same.
    static func newest(_ entries: [AccountObject], id: (AccountObject) -> String, when: (AccountObject) -> Int) -> [AccountObject] {
        var best: [String: AccountObject] = [:]
        for entry in entries {
            let key = id(entry)
            if let held = best[key] {
                let (a, b) = (when(entry), when(held))
                if a > b || (a == b && less(canonical(held), canonical(entry))) { best[key] = entry }
            } else {
                best[key] = entry
            }
        }
        return best.values.sorted { a, b in
            let (wa, wb) = (when(a), when(b))
            return wa != wb ? wa > wb : less(id(a), id(b))
        }
    }

    /// The later of two removal times for each entry.
    public static func mergeRemoved(_ a: [String: String], _ b: [String: String]) -> [String: String] {
        var out = a
        for (key, time) in b where out[key] == nil || AccountTime.ms(time) > AccountTime.ms(out[key]) { out[key] = time }
        return out
    }

    /// Whether `id` on `list` was removed at or after `when`: an entry made after its removal is a new one and stays.
    static func gone(_ removed: [String: String], _ list: String, _ id: String, _ when: Int) -> Bool {
        guard let time = removed[removedKey(list, id)] else { return false }
        return AccountTime.ms(time) >= when
    }

    /// Removals older than 90 days are forgotten.
    public static func pruneRemoved(_ removed: [String: String], now: Int) -> [String: String] {
        removed.filter { now - AccountTime.ms($0.value) < tombstoneDays * 86_400_000 }
    }

    private static func mergeEpisodes(_ a: JSONValue?, _ b: JSONValue?) -> JSONValue {
        var seen: [String: (Int, Int)] = [:]
        for list in [a, b] {
            guard case .array(let items)? = list else { continue }
            for item in items {
                guard let e = episode(item) else { continue }
                let code = episodeCode(season: e.season, episode: e.episode)
                if seen[code] == nil { seen[code] = (e.season, e.episode) }
            }
        }
        let sorted = seen.values.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }
        return .array(sorted.map { episodeObject($0.0, $0.1) })
    }

    /// Two rewatches of one show: the same round (same start) unions the episodes ticked; otherwise the later start wins.
    static func mergeRewatch(_ a: AccountObject, _ b: AccountObject) -> AccountObject {
        if AccountTime.ms(a["startedAt"]) != AccountTime.ms(b["startedAt"]) {
            return AccountTime.ms(a["startedAt"]) > AccountTime.ms(b["startedAt"]) ? a : b
        }
        let aTime = AccountTime.ms(a["updatedAt"] ?? a["startedAt"]), bTime = AccountTime.ms(b["updatedAt"] ?? b["startedAt"])
        let later = bTime > aTime ? b : a
        let updatedAt = AccountTime.ms(a["updatedAt"]) >= AccountTime.ms(b["updatedAt"]) ? a["updatedAt"] : b["updatedAt"]
        var out = later
        out["watched"] = mergeEpisodes(a["watched"], b["watched"])
        if let updatedAt { out["updatedAt"] = updatedAt }
        return out
    }

    /// `local` and `remote` merged. The order of the arguments doesn't matter, except that a card both have is kept as `local` has it.
    public static func merge(_ local: State, _ remote: State, now: Int) -> State {
        let removed = pruneRemoved(mergeRemoved(local.removed, remote.removed), now: now)
        func keep(_ entries: [AccountObject], _ list: String, id: (AccountObject) -> String, when: (AccountObject) -> Int) -> [AccountObject] {
            newest(entries, id: id, when: when).filter { !gone(removed, list, id($0), when($0)) }
        }
        let keyOf: (AccountObject) -> String = { text($0["key"]) ?? "" }

        var ratings: [String: AccountObject] = [:]
        for key in Set(local.ratings.keys).union(remote.ratings.keys) {
            let l = local.ratings[key], r = remote.ratings[key]
            let best: AccountObject
            if let l, let r {
                let (lt, rt) = (AccountTime.ms(l["ratedAt"]), AccountTime.ms(r["ratedAt"]))
                best = rt > lt || (rt == lt && less(canonical(l), canonical(r))) ? r : l
            } else {
                best = (l ?? r)!
            }
            if !gone(removed, "ratings", key, AccountTime.ms(best["ratedAt"])) { ratings[key] = best }
        }

        var rewatchByKey: [String: AccountObject] = [:]
        for entry in local.rewatches + remote.rewatches {
            let key = keyOf(entry)
            rewatchByKey[key] = rewatchByKey[key].map { mergeRewatch($0, entry) } ?? entry
        }
        let rewatches = rewatchByKey.values
            .filter { !gone(removed, "rewatches", keyOf($0), max(AccountTime.ms($0["startedAt"]), AccountTime.ms($0["updatedAt"]))) }
            .sorted { less(keyOf($0), keyOf($1)) }

        var shuffleByKey: [String: AccountObject] = [:]
        for entry in local.shuffle + remote.shuffle {
            let key = keyOf(entry)
            if var held = shuffleByKey[key] {
                let played = mergeEpisodes(held["played"], entry["played"])
                held.merge(entry) { _, new in new }
                held["played"] = played
                shuffleByKey[key] = held
            } else {
                shuffleByKey[key] = entry
            }
        }

        var sourceEntries: [AccountObject] = []
        for (key, entry) in local.sources.sorted(by: { less($0.key, $1.key) }) + remote.sources.sorted(by: { less($0.key, $1.key) }) {
            var withKey = entry
            withKey["key"] = .string(key)
            sourceEntries.append(withKey)
        }
        var sources: [String: AccountObject] = [:]
        for var entry in newest(sourceEntries, id: keyOf, when: { AccountTime.ms($0["date"]) })
            .filter({ !gone(removed, "sources", keyOf($0), AccountTime.ms($0["date"])) }).prefix(maxSources) {
            let key = keyOf(entry)
            entry["key"] = nil
            sources[key] = entry
        }

        let order = [local.order, remote.order].compactMap { $0 }.sorted { a, b in
            let (ta, tb) = (AccountTime.ms(a["updatedAt"]), AccountTime.ms(b["updatedAt"]))
            return ta != tb ? ta > tb : less(canonical(b), canonical(a))
        }.first

        var merged = State()
        merged.watchlist = keep(local.watchlist + remote.watchlist, "watchlist", id: keyOf, when: { AccountTime.ms($0["addedAt"]) })
        merged.favourites = keep(local.favourites + remote.favourites, "favourites", id: keyOf, when: { AccountTime.ms($0["addedAt"]) })
        merged.ratings = ratings
        merged.rewatches = rewatches
        merged.shuffle = shuffleByKey.values.sorted { less(keyOf($0), keyOf($1)) }
        merged.order = order
        merged.progress = Array(keep(local.progress + remote.progress, "progress", id: progressID, when: { AccountTime.ms($0["updatedAt"]) }).prefix(maxProgress))
        merged.sources = sources
        merged.history = keep(local.history + remote.history, "history", id: historyID, when: { AccountTime.ms($0["watchedAt"]) })
        merged.removed = removed
        merged.items = remote.items.merging(local.items) { _, mine in mine }
        merged.extra = remote.extra.merging(local.extra) { _, mine in mine }
        merged.items = pruneItems(merged)
        return merged
    }

    /// Every title key anything in the library mentions.
    public static func referencedKeys(_ state: State) -> Set<String> {
        var keys = Set<String>()
        for list in [state.watchlist, state.favourites, state.rewatches, state.shuffle, state.progress, state.history] {
            for entry in list { if let key = text(entry["key"]) { keys.insert(key) } }
        }
        keys.formUnion(state.ratings.keys)
        keys.formUnion(state.sources.keys)
        return keys
    }

    /// Cards for titles the library no longer mentions are dropped.
    private static func pruneItems(_ state: State) -> [String: AccountObject] {
        let used = referencedKeys(state)
        return state.items.filter { used.contains($0.key) }
    }

    // MARK: Documents

    public static func isHistorySection(_ name: String) -> Bool {
        guard name.hasPrefix("history-") else { return false }
        let parts = name.dropFirst("history-".count).split(separator: "-", omittingEmptySubsequences: false)
        func digits(_ part: Substring, _ count: Int?) -> Bool {
            !part.isEmpty && (count == nil || part.count == count) && part.utf8.allSatisfy { (48...57).contains($0) }
        }
        switch parts.count {
        case 2: return digits(parts[0], 4) && digits(parts[1], 2)
        case 3: return digits(parts[0], 4) && digits(parts[1], 2) && digits(parts[2], nil)
        default: return false
        }
    }

    public static func isItemsSection(_ name: String) -> Bool {
        guard name.hasPrefix("items-"), name.count == "items-".count + 1, let last = name.utf8.last else { return false }
        return (48...57).contains(last) || (97...102).contains(last)
    }

    /// The library's sections, as named in the account's list of values (settings is the other one).
    public static func isLibrarySection(_ name: String) -> Bool {
        name == listsSection || name == progressSection || name == sourcesSection || isHistorySection(name) || isItemsSection(name)
    }

    /// Which items shard holds a title's card: its TMDB id modulo 16, as one hex digit.
    public static func itemsShard(_ key: String) -> String {
        let id = key.split(separator: ":").last.flatMap { Int($0) } ?? 0
        return "items-" + String(id % 16, radix: 16)
    }

    public enum Parsed<T> {
        case value(T)
        /// `newer` is a document of a version this one doesn't read; otherwise it was unreadable.
        case failed(newer: Bool)
    }

    private static func versioned(_ text: String) -> Parsed<AccountObject> {
        guard case .object(let data)? = parse(text), case .number(let v)? = data["v"] else { return .failed(newer: false) }
        return v > 1 ? .failed(newer: true) : .value(data)
    }

    private static func objects(_ value: JSONValue?, where ok: (AccountObject) -> Bool) -> [AccountObject] {
        guard case .array(let items)? = value else { return [] }
        return items.compactMap { item in
            if case .object(let o) = item, ok(o) { return o }
            return nil
        }
    }

    private static func removedOf(_ value: JSONValue?) -> [String: String] {
        guard case .object(let o)? = value else { return [:] }
        return o.compactMapValues { text($0) }
    }

    private static func rest(_ data: AccountObject, known: [String]) -> AccountObject {
        data.filter { !known.contains($0.key) && $0.key != "v" }
    }

    private static func hasKey(_ o: AccountObject) -> Bool { text(o["key"]).map(isKey) == true }

    private static func fixEpisodes(_ entry: AccountObject, _ field: String) -> AccountObject {
        var out = entry
        if case .array(let items)? = entry[field] { out[field] = .array(items.filter { episode($0) != nil }) } else { out[field] = .array([]) }
        return out
    }

    /// The documents, read into a state. A value that can't be read is reported by name and left out.
    public static func read(_ plain: [String: String]) -> (state: State, unreadable: [String], newer: [String]) {
        var state = State()
        var unreadable: [String] = [], newer: [String] = []
        func note(_ name: String, _ isNewer: Bool) { if isNewer { newer.append(name) } else { unreadable.append(name) } }

        for name in plain.keys.sorted() {
            let body = plain[name] ?? ""
            guard name == listsSection || name == progressSection || name == sourcesSection || isHistorySection(name) || isItemsSection(name) else { continue }
            guard case .value(let data) = versioned(body) else {
                if case .failed(let isNewer) = versioned(body) { note(name, isNewer) }
                continue
            }
            switch name {
            case listsSection:
                state.watchlist = objects(data["watchlist"]) { hasKey($0) && AccountTime.ms($0["addedAt"]) > 0 }
                state.favourites = objects(data["favourites"]) { hasKey($0) && AccountTime.ms($0["addedAt"]) > 0 }
                if case .object(let ratings)? = data["ratings"] {
                    for (key, value) in ratings {
                        if isKey(key), case .object(let r) = value, case .number? = r["value"], AccountTime.ms(r["ratedAt"]) > 0 { state.ratings[key] = r }
                    }
                }
                state.rewatches = objects(data["rewatches"]) { hasKey($0) && AccountTime.ms($0["startedAt"]) > 0 }.map { fixEpisodes($0, "watched") }
                state.shuffle = objects(data["shuffle"]) { hasKey($0) }.map { fixEpisodes($0, "played") }
                if case .object(let order)? = data["order"], case .array(let keys)? = order["keys"], AccountTime.ms(order["updatedAt"]) > 0 {
                    var kept = order
                    kept["keys"] = .array(keys.filter { text($0) != nil })
                    state.order = kept
                }
                let known = ["watchlist", "favourites", "ratings", "rewatches", "shuffle", "order", "removed"]
                let extra = rest(data, known: known)
                if !extra.isEmpty { state.extra[name] = extra }
            case progressSection:
                state.progress = objects(data["entries"]) { o in
                    guard hasKey(o), AccountTime.ms(o["updatedAt"]) > 0, case .number? = o["percent"] else { return false }
                    return o["episode"] == nil || episode(o["episode"]) != nil
                }
                let extra = rest(data, known: ["entries", "removed"])
                if !extra.isEmpty { state.extra[name] = extra }
            case sourcesSection:
                if case .object(let entries)? = data["entries"] {
                    for (key, value) in entries {
                        if isKey(key), case .object(let s) = value, text(s["providerID"]) != nil, AccountTime.ms(s["date"]) > 0 { state.sources[key] = s }
                    }
                }
                let extra = rest(data, known: ["entries", "removed"])
                if !extra.isEmpty { state.extra[name] = extra }
            case _ where isItemsSection(name):
                if case .object(let cards)? = data["items"] {
                    for (key, value) in cards {
                        if isKey(key), case .object(let card) = value, text(card["title"]) != nil { state.items[key] = card }
                    }
                }
            default:
                state.history += objects(data["entries"]) { o in
                    guard hasKey(o), AccountTime.ms(o["watchedAt"]) > 0 else { return false }
                    return o["episode"] == nil || episode(o["episode"]) != nil
                }
            }
            if !isItemsSection(name) { state.removed = mergeRemoved(state.removed, removedOf(data["removed"])) }
        }
        return (state, unreadable, newer)
    }

    // MARK: Writing

    private static func removedFor(_ removed: [String: String], _ lists: [String]) -> [String: String] {
        removed.filter { entry in lists.contains { entry.key.hasPrefix($0 + ":") } }
    }

    private static func removedValue(_ removed: [String: String]) -> JSONValue { .object(removed.mapValues { .string($0) }) }

    /// A document: what an older reading carried that this version doesn't know, then the version, then the fields.
    private static func document(_ state: State, _ name: String, _ body: AccountObject) -> String {
        var out = state.extra[name] ?? [:]
        out["v"] = .number(1)
        out.merge(body) { _, new in new }
        return canonical(out)
    }

    /// The library's values as text, by section name. Empty ones are left out, so a new account writes only what it has.
    public static func write(_ state: State, now: Int) -> [String: String] {
        var out: [String: String] = [:]
        let removed = pruneRemoved(state.removed, now: now)
        let listsRemoved = removedFor(removed, ["watchlist", "favourites", "ratings", "rewatches"])
        let listsEmpty = state.watchlist.isEmpty && state.favourites.isEmpty && state.ratings.isEmpty && state.rewatches.isEmpty
            && state.shuffle.isEmpty && state.order == nil && listsRemoved.isEmpty
        if !listsEmpty {
            out[listsSection] = document(state, listsSection, [
                "watchlist": .array(state.watchlist.map { .object($0) }),
                "favourites": .array(state.favourites.map { .object($0) }),
                "ratings": .object(state.ratings.mapValues { .object($0) }),
                "rewatches": .array(state.rewatches.map { .object($0) }),
                "shuffle": .array(state.shuffle.map { .object($0) }),
                "order": state.order.map { JSONValue.object($0) } ?? JSONValue.null,
                "removed": removedValue(listsRemoved),
            ])
        }
        let progressRemoved = removedFor(removed, ["progress"])
        if !state.progress.isEmpty || !progressRemoved.isEmpty {
            out[progressSection] = document(state, progressSection, [
                "entries": .array(state.progress.prefix(maxProgress).map { .object($0) }),
                "removed": removedValue(progressRemoved),
            ])
        }
        let sourcesRemoved = removedFor(removed, ["sources"])
        if !state.sources.isEmpty || !sourcesRemoved.isEmpty {
            out[sourcesSection] = document(state, sourcesSection, [
                "entries": .object(state.sources.mapValues { .object($0) }),
                "removed": removedValue(sourcesRemoved),
            ])
        }
        out.merge(splitHistory(state.history, removed: removedFor(removed, ["history"]))) { _, new in new }
        var shards: [String: [String: JSONValue]] = [:]
        for (key, card) in pruneItems(state) { shards[itemsShard(key), default: [:]][key] = .object(card) }
        for (name, items) in shards { out[name] = canonical(.object(["v": .number(1), "items": .object(items)])) }
        return out
    }

    /// History by month, a month split into numbered pages when it would pass the size limit. Entries are ordered by id, so
    /// the same history is the same text everywhere. Removals go with their month (docs/SYNC.md, "Splitting a busy month").
    public static func splitHistory(_ entries: [AccountObject], removed: [String: String], limit: Int = pageLimit) -> [String: String] {
        var months: [String: (entries: [AccountObject], removed: [String: String])] = [:]
        for entry in entries { months[AccountTime.month(ms: AccountTime.ms(entry["watchedAt"])), default: ([], [:])].entries.append(entry) }
        for (key, time) in removed { months[monthOfID(String(key.dropFirst("history:".count))), default: ([], [:])].removed[key] = time }

        var out: [String: String] = [:]
        for (month, bucket) in months {
            let sorted = bucket.entries.sorted { less(historyID($0), historyID($1)) }
            var pages: [[AccountObject]] = [[]]
            var size = canonical(removedValue(bucket.removed)).utf16.count + 40
            for entry in sorted {
                let length = canonical(entry).utf16.count + 1
                if size + length > limit, !pages[pages.count - 1].isEmpty {
                    pages.append([])
                    size = 40
                }
                pages[pages.count - 1].append(entry)
                size += length
            }
            for (index, page) in pages.enumerated() {
                var body: AccountObject = ["v": .number(1), "month": .string(month), "entries": .array(page.map { .object($0) })]
                if index == 0 { body["removed"] = removedValue(bucket.removed) }
                out["history-\(month)" + (index > 0 ? "-\(index + 1)" : "")] = canonical(body)
            }
        }
        return out
    }

    /// Whether two sets of values say the same thing, whatever order their keys came in.
    public static func sameValues(_ a: [String: String], _ b: [String: String]) -> Bool {
        guard Set(a.keys) == Set(b.keys) else { return false }
        return a.allSatisfy { name, text in
            guard let other = b[name], let x = parse(text), let y = parse(other) else { return false }
            return canonical(x) == canonical(y)
        }
    }
}
