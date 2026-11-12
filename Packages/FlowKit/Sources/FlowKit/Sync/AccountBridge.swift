import Foundation

/// The watchlist's own arrangement and when it was made: `flow.watchlistOrder` on the device, `order` on the wire.
public struct AccountOrder: Equatable, Codable, Sendable {
    public var keys: [MediaKey]
    public var updatedAt: Date

    public init(keys: [MediaKey], updatedAt: Date) {
        self.keys = keys
        self.updatedAt = updatedAt
    }
}

/// Between the apps' library (`LocalLibrary`, the remembered sources and the watchlist's order) and the account's wire
/// form (docs/SYNC.md, "Shared shapes" and the mapping under each section). The wire is a string key and ISO times, so
/// these are hand-written DTOs and not the models' own Codable.
public enum AccountBridge {
    // MARK: Apps to wire

    private static func time(_ date: Date) -> JSONValue { .string(AccountTime.string(date)) }

    private static func episodes(_ list: [EpisodeRef]) -> JSONValue {
        .array(list.map { AccountWire.episodeObject($0.season, $0.episode) })
    }

    /// The small display card of a title: the apps' `MediaItem` cache as the wire has it.
    public static func card(_ item: MediaItem) -> AccountObject {
        var card: AccountObject = ["title": .string(item.title)]
        if let date = item.releaseDate {
            let day = FlowDate.day(date)
            card["date"] = .string(day)
            if let year = Int(day.prefix(4)) { card["year"] = .number(Double(year)) }
        }
        if let poster = item.posterPath { card["poster"] = .string(poster) }
        if let backdrop = item.backdropPath { card["backdrop"] = .string(backdrop) }
        if let rating = item.voteAverage, rating > 0 { card["rating"] = .number(rating) }
        if !item.genres.isEmpty { card["genres"] = .array(item.genres.map { .number(Double($0.id)) }) }
        if let language = item.originalLanguage { card["originalLanguage"] = .string(language) }
        return card
    }

    /// A title from its card, for one this device has no details of. Details load when it is opened.
    public static func item(key: MediaKey, card: AccountObject) -> MediaItem {
        var date: Date?
        if let text = AccountWire.text(card["date"]) { date = FlowDate.parse(text) }
        if date == nil, let year = AccountWire.integer(card["year"]) { date = FlowDate.parse(String(format: "%04d-01-01", year)) }
        var genres: [Genre] = []
        if case .array(let ids)? = card["genres"] {
            genres = ids.compactMap { AccountWire.integer($0) }.map { Genre(id: $0, name: TMDBGenres.name(for: $0, type: key.type)) }
        }
        var rating: Double?
        if case .number(let n)? = card["rating"] { rating = n }
        return MediaItem(type: key.type, ids: ExternalIDs(tmdb: key.tmdbID), title: AccountWire.text(card["title"]) ?? "Untitled",
                         posterPath: AccountWire.text(card["poster"]), backdropPath: AccountWire.text(card["backdrop"]), releaseDate: date,
                         genres: genres, voteAverage: rating, originalLanguage: AccountWire.text(card["originalLanguage"]))
    }

    public static func sourceEntry(_ source: LastSource) -> AccountObject {
        var entry: AccountObject = [
            "providerID": .string(source.providerID),
            "resolution": .number(Double(source.resolution.rawValue)),
            "quality": .string(source.quality.rawValue),
            "hdr": .array(source.hdr.map { .string($0) }),
            "date": time(source.date),
        ]
        if let filename = source.filename { entry["filename"] = .string(filename) }
        if let group = source.bingeGroup { entry["bingeGroup"] = .string(group) }
        if let release = source.releaseGroup { entry["releaseGroup"] = .string(release) }
        return entry
    }

    /// What this device holds, in the wire's shape. Everything in it is this device's own claim; merging with what the
    /// account holds happens in `AccountWire.merge`.
    public static func state(library: LocalLibrary, sources: [String: LastSource], order: AccountOrder?) -> AccountWire.State {
        var state = AccountWire.State()
        func listEntry(_ e: ListEntry) -> AccountObject { ["key": .string(e.key.description), "addedAt": time(e.addedAt)] }
        state.watchlist = library.watchlist.map(listEntry)
        state.favourites = library.favourites.map(listEntry)
        for (key, rating) in library.ratings where AccountWire.isKey(key) {
            state.ratings[key] = ["value": .number(Double(rating.value)), "ratedAt": time(rating.ratedAt)]
        }
        state.rewatches = library.rewatches.map { r in
            ["key": .string(r.key.description), "startedAt": time(r.startedAt), "updatedAt": time(r.updatedAt), "watched": episodes(r.watched.sorted())]
        }
        state.shuffle = library.shuffle.map { ["key": .string($0.key.description), "played": episodes($0.played)] }
        if let order {
            state.order = ["keys": .array(order.keys.map { .string($0.description) }), "updatedAt": time(order.updatedAt)]
        }
        state.progress = library.progress.map { p in
            var entry: AccountObject = ["key": .string(p.key.description), "percent": .number(p.percent), "updatedAt": time(p.updatedAt)]
            if let e = p.episode { entry["episode"] = AccountWire.episodeObject(e.season, e.episode) }
            if let position = p.positionSeconds { entry["positionSeconds"] = .number(position) }
            if let duration = p.durationSeconds { entry["durationSeconds"] = .number(duration) }
            return entry
        }
        for (key, source) in sources where AccountWire.isKey(key) { state.sources[key] = sourceEntry(source) }
        state.history = library.history.map { h in
            var entry: AccountObject = ["key": .string(h.key.description), "watchedAt": time(h.watchedAt)]
            if let e = h.episode { entry["episode"] = AccountWire.episodeObject(e.season, e.episode) }
            return entry
        }
        for (key, date) in library.removed { state.removed[key] = AccountTime.string(date) }
        for key in AccountWire.referencedKeys(state) {
            if let item = library.items[key] { state.items[key] = card(item) }
        }
        return state
    }

    // MARK: Wire to apps

    private static func ref(_ value: JSONValue?) -> EpisodeRef? {
        AccountWire.episode(value).map { EpisodeRef(season: $0.season, episode: $0.episode) }
    }

    private static func refs(_ value: JSONValue?) -> [EpisodeRef] {
        guard case .array(let items)? = value else { return [] }
        return items.compactMap(ref)
    }

    private static func mediaKey(_ entry: AccountObject) -> MediaKey? { AccountWire.text(entry["key"]).flatMap { MediaKey(string: $0) } }

    private static func date(_ value: JSONValue?) -> Date { AccountTime.date(ms: AccountTime.ms(value)) }

    public static func source(_ entry: AccountObject) -> LastSource? {
        guard let provider = AccountWire.text(entry["providerID"]) else { return nil }
        var hdr: [String] = []
        if case .array(let items)? = entry["hdr"] { hdr = items.compactMap { AccountWire.text($0) } }
        return LastSource(
            providerID: provider, filename: AccountWire.text(entry["filename"]), bingeGroup: AccountWire.text(entry["bingeGroup"]),
            releaseGroup: AccountWire.text(entry["releaseGroup"]),
            resolution: AccountWire.integer(entry["resolution"]).flatMap { VideoResolution(rawValue: $0) } ?? .unknown,
            quality: AccountWire.text(entry["quality"]).flatMap { ReleaseQuality(rawValue: $0) } ?? .unknown,
            hdr: hdr, date: date(entry["date"])
        )
    }

    /// A merged account state as the apps hold it. Entries the device already has, to the millisecond, are kept as they are, so
    /// what only this device knows of them (a tracker's id for a resume point) isn't lost.
    public static func apply(_ state: AccountWire.State, to library: LocalLibrary, sources: [String: LastSource] = [:]) -> (library: LocalLibrary, sources: [String: LastSource], order: AccountOrder?) {
        var out = library

        func listEntries(_ entries: [AccountObject], existing: [ListEntry]) -> [ListEntry] {
            let had = Dictionary(existing.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            let made: [ListEntry] = entries.compactMap { entry in
                guard let key = mediaKey(entry) else { return nil }
                let added = date(entry["addedAt"])
                if let old = had[key.description], AccountTime.ms(old.addedAt) == AccountTime.ms(added) { return old }
                return ListEntry(key: key, addedAt: added)
            }
            return made.sorted { $0.addedAt != $1.addedAt ? $0.addedAt > $1.addedAt : $0.id < $1.id }
        }
        out.watchlist = listEntries(state.watchlist, existing: library.watchlist)
        out.favourites = listEntries(state.favourites, existing: library.favourites)

        out.ratings = [:]
        for (rawKey, entry) in state.ratings {
            guard MediaKey(string: rawKey) != nil, case .number(let value)? = entry["value"] else { continue }
            let ratedAt = date(entry["ratedAt"])
            if let old = library.ratings[rawKey], Double(old.value) == value, AccountTime.ms(old.ratedAt) == AccountTime.ms(ratedAt) {
                out.ratings[rawKey] = old
            } else {
                out.ratings[rawKey] = LocalLibrary.Rating(value: min(10, max(1, Int(value.rounded()))), ratedAt: ratedAt)
            }
        }

        out.rewatches = state.rewatches.compactMap { entry in
            guard let key = mediaKey(entry) else { return nil }
            let started = date(entry["startedAt"])
            let updated = entry["updatedAt"] == nil ? started : date(entry["updatedAt"])
            return Rewatch(key: key, startedAt: started, watched: Set(refs(entry["watched"])), updatedAt: updated)
        }
        out.shuffle = state.shuffle.compactMap { entry in mediaKey(entry).map { ShuffleRecord(key: $0, played: refs(entry["played"])) } }

        let hadProgress = Dictionary(library.progress.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        out.progress = state.progress.compactMap { entry in
            guard let key = mediaKey(entry), case .number(let percent)? = entry["percent"] else { return nil }
            let episode = ref(entry["episode"])
            let updated = date(entry["updatedAt"])
            var position: Double?, duration: Double?
            if case .number(let n)? = entry["positionSeconds"] { position = n }
            if case .number(let n)? = entry["durationSeconds"] { duration = n }
            let made = PlaybackProgress(key: key, episode: episode, percent: percent, positionSeconds: position, durationSeconds: duration, updatedAt: updated)
            if let old = hadProgress[made.id], AccountTime.ms(old.updatedAt) == AccountTime.ms(updated), old.positionSeconds == position, old.durationSeconds == duration, old.percent == percent {
                return old
            }
            return made
        }
        out.progress.sort { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.id < $1.id }

        let hadHistory = Dictionary(library.history.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        out.history = state.history.compactMap { entry in
            guard let key = mediaKey(entry) else { return nil }
            let watched = date(entry["watchedAt"])
            let made = HistoryEntry(key: key, episode: ref(entry["episode"]), watchedAt: watched)
            if let old = hadHistory[made.id], AccountTime.ms(old.watchedAt) == AccountTime.ms(watched) { return old }
            return made
        }
        out.history.sort { $0.watchedAt != $1.watchedAt ? $0.watchedAt > $1.watchedAt : $0.id < $1.id }

        // Details this device already has stay; a title it only knows from a card is made from the card.
        for (rawKey, card) in state.items {
            guard let key = MediaKey(string: rawKey), out.items[rawKey] == nil else { continue }
            out.items[rawKey] = item(key: key, card: card)
        }
        out.removed = state.removed.mapValues { date(JSONValue.string($0)) }

        var newSources: [String: LastSource] = [:]
        for (rawKey, entry) in state.sources {
            guard MediaKey(string: rawKey) != nil, let made = source(entry) else { continue }
            if let old = sources[rawKey], AccountTime.ms(old.date) == AccountTime.ms(made.date), old.providerID == made.providerID { newSources[rawKey] = old } else { newSources[rawKey] = made }
        }

        var order: AccountOrder?
        if let wire = state.order, case .array(let keys)? = wire["keys"] {
            order = AccountOrder(keys: keys.compactMap { AccountWire.text($0).flatMap { MediaKey(string: $0) } }, updatedAt: date(wire["updatedAt"]))
        }
        return (out, newSources, order)
    }
}

extension LocalLibrary {
    /// Whether nothing but resume points (and the details and removals that ride with them) differs from `other`. A resume
    /// point ticks every few seconds while something plays, so a Marquee Account writes those about once a minute, and
    /// everything else about three seconds after the change.
    public func onlyResumePointsDiffer(from other: LocalLibrary) -> Bool {
        history == other.history && watchlist == other.watchlist && favourites == other.favourites
            && rewatches == other.rewatches && shuffle == other.shuffle && ratings == other.ratings
    }
}
