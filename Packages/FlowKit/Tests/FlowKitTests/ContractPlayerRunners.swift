import XCTest
@testable import FlowKit

/// Slates, Still Watching, the watchlist's order and calendar files (testdata/contracts/source-slate.json,
/// playback-still-watching.json, watchlist-order.json, calendar-ics.json).
extension Contracts {
    static func sourceSlate(_ c: ContractCase) throws -> JSONValue {
        let input = c.input
        switch c.op {
        case "isSlateURL":
            return .bool(URL(string: input.string ?? "").map(StreamSlate.isSlateURL) ?? false)
        case "isTooShort":
            return .bool(StreamSlate.isTooShort(duration: input["duration"]?.double ?? 0, expectedRuntimeMinutes: input["runtime"]?.int))
        case "isTooSmall":
            return .bool(StreamSlate.isTooSmall(bytes: input["bytes"]?.int.map { Int64($0) }, listedBytes: input["listed"]?.int.map { Int64($0) }))
        case "detect":
            return .bool(StreamSlate.detect(finalURL: input["finalURL"]?.string.flatMap { URL(string: $0) }, duration: input["duration"]?.double, bytes: input["bytes"]?.int.map { Int64($0) },
                                            listedBytes: input["listed"]?.int.map { Int64($0) }, expectedRuntimeMinutes: input["runtime"]?.int))
        case "bindsLinks":
            return .bool(URL(string: input.string ?? "").map(StreamSlate.bindsLinksToConnection) ?? false)
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }

    static func stillWatching(_ c: ContractCase) throws -> JSONValue {
        var state = StillWatching()
        let limit = c.input["limit"]?.int ?? 0
        for event in c.input["events"]?.array ?? [] {
            let parts = event.array ?? []
            switch parts.first?.string {
            case "interaction": state.noteInteraction()
            case "advance": state.noteAutomaticAdvance()
            case "pause": state.notePause(at: parts[1].double ?? 0, duration: parts[2].double ?? 0)
            default: throw ContractUnavailable(reason: "unknown event")
            }
        }
        return .object(["count": .int(state.unattendedEpisodes), "ask": .bool(state.shouldAsk(limit: limit))])
    }

    static func watchlistOrder(_ c: ContractCase) throws -> JSONValue {
        func keys(_ value: JSONValue?) -> [MediaKey] { (value?.array ?? []).compactMap { $0.string.flatMap { MediaKey(string: $0) } } }
        func out(_ keys: [MediaKey]) -> JSONValue { .array(keys.map { .string($0.description) }) }
        let input = c.input
        switch c.op {
        case "applying": return out(WatchlistOrder.applying(keys(input["saved"]), to: keys(input["keys"])))
        case "moving":
            let target = input["target"]?.string.flatMap { MediaKey(string: $0) }
            return out(WatchlistOrder.moving(keys(input["moving"]), before: target, in: keys(input["keys"])))
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }

    static func calendarICS(_ c: ContractCase) throws -> JSONValue {
        func moment(_ text: String?) -> Date? { text.map { AccountTime.date(ms: AccountTime.ms($0)) } }
        let input = c.input
        switch c.op {
        case "isBareDay":
            guard let date = FlowDate.parse(input.string ?? "") else { throw ContractUnavailable(reason: "unreadable time") }
            return .bool(AirDateFormatting.isBareDay(date))
        case "build":
            let events = (input["events"]?.array ?? []).map { e in
                ICalendarEvent(uid: e["uid"]?.string ?? "", title: e["title"]?.string ?? "", day: e["day"]?.string, start: moment(e["start"]?.string), end: moment(e["end"]?.string),
                               notes: e["notes"]?.string, url: e["url"]?.string.flatMap { URL(string: $0) })
            }
            return .string(ICalendar.build(events, now: moment(input["now"]?.string) ?? Date(timeIntervalSince1970: 0)))
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }
}

extension Contracts {
    static func homeRelease(_ c: ContractCase) throws -> JSONValue {
        func day(_ text: String?) throws -> Date {
            guard let text, let date = FlowDate.parse(text) else { throw ContractUnavailable(reason: "unreadable day") }
            return date
        }
        func name(_ date: Date?) -> JSONValue {
            guard let date else { return .null }
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withFullDate]
            f.timeZone = TimeZone(identifier: "UTC")
            return .string(f.string(from: date))
        }
        guard c.op == "status" else { throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")") }
        let releases = try (c.input["releases"]?.array ?? []).map { r in
            MovieRelease(country: r["country"]?.string ?? "", type: MovieReleaseType(rawValue: r["type"]?.int ?? 0) ?? .theatrical, date: try day(r["date"]?.string), certification: nil)
        }
        switch HomeRelease.status(releases: releases, region: c.input["region"]?.string, now: try day(c.input["now"]?.string)) {
        case .unknown: return .object(["status": .string("unknown")])
        case .available: return .object(["status": .string("available")])
        case .inCinemas(let since, let digitalOn): return .object(["status": .string("inCinemas"), "since": name(since), "digitalOn": name(digitalOn)])
        case .upcoming(let on): return .object(["status": .string("upcoming"), "on": name(on)])
        }
    }
}
