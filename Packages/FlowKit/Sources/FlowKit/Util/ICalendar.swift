import Foundation

/// One event in a `.ics` file.
public struct ICalendarEvent: Equatable, Sendable {
    /// Stable for the same episode or film, so adding the file twice updates the events instead of repeating them.
    public var uid: String
    public var title: String
    /// An all-day event, as the calendar day "2026-10-27". TMDb gives only the day an episode or a film comes out.
    public var day: String?
    /// Or a real moment. `end` is an hour later when it is left out.
    public var start: Date?
    public var end: Date?
    public var notes: String?
    public var url: URL?

    public init(uid: String, title: String, day: String? = nil, start: Date? = nil, end: Date? = nil, notes: String? = nil, url: URL? = nil) {
        self.uid = uid
        self.title = title
        self.day = day
        self.start = start
        self.end = end
        self.notes = notes
        self.url = url
    }
}

/// An iCalendar file (RFC 5545), as the website writes for its "Add to Calendar": the same layout, escaping and folding,
/// so a file from either opens the same way. Pure, so the dates and the escaping are tested.
public enum ICalendar {
    /// One calendar with these events, as the text of a `.ics` file. Events without a usable date are left out.
    /// `now` stamps when the file was made.
    public static func build(_ events: [ICalendarEvent], now: Date = Date()) -> String {
        var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flow//Upcoming//EN", "CALSCALE:GREGORIAN"]
        for event in events {
            var body: [String] = []
            if let day = event.day {
                guard let start = dateValue(day), let end = nextDay(day) else { continue }
                body += ["DTSTART;VALUE=DATE:\(start)", "DTEND;VALUE=DATE:\(end)", "TRANSP:TRANSPARENT"]
            } else if let start = event.start {
                var end = start.addingTimeInterval(3600)
                if let given = event.end, given > start { end = given }
                body += ["DTSTART:\(utcStamp(start))", "DTEND:\(utcStamp(end))"]
            } else { continue }
            lines += ["BEGIN:VEVENT", "UID:\(event.uid)", "DTSTAMP:\(utcStamp(now))"]
            lines += body
            lines.append("SUMMARY:\(escape(event.title))")
            if let notes = event.notes, !notes.isEmpty { lines.append("DESCRIPTION:\(escape(notes))") }
            if let url = event.url { lines.append("URL:\(url.absoluteString)") }
            lines.append("END:VEVENT")
        }
        lines.append("END:VCALENDAR")
        return lines.map(fold).joined(separator: "\r\n") + "\r\n"
    }

    /// A UID from an entry's id: letters and digits only, so every calendar app takes it as it is.
    public static func uid(for id: String) -> String {
        var out = ""
        var pendingDash = false
        for scalar in id.unicodeScalars {
            let plain = (scalar.value >= 48 && scalar.value <= 57) || (scalar.value >= 65 && scalar.value <= 90) || (scalar.value >= 97 && scalar.value <= 122)
            if plain {
                if pendingDash, !out.isEmpty { out.append("-") }
                pendingDash = false
                out.unicodeScalars.append(scalar)
            } else {
                pendingDash = true
            }
        }
        return "\(out)@flow-app"
    }

    /// "2026-10-27" for a bare air day: midnight UTC, the way TMDb gives it. Nil for a date with a time in it.
    public static func bareDay(_ date: Date) -> String? {
        guard AirDateFormatting.isBareDay(date) else { return nil }
        let c = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// "20261027T193000Z": a moment in UTC, as a calendar reads it wherever the viewer is.
    static func utcStamp(_ date: Date) -> String {
        let c = utc.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        return String(format: "%04d%02d%02dT%02d%02d%02dZ", c.year ?? 0, c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0, c.second ?? 0)
    }

    /// "2026-10-27" as "20261027". Anything else is not a day.
    static func dateValue(_ day: String) -> String? {
        guard let (y, m, d) = parts(day) else { return nil }
        return String(format: "%04d%02d%02d", y, m, d)
    }

    /// The day after, by calendar arithmetic in UTC, so a daylight-saving change can't skip or repeat a day. An all-day
    /// event ends on the day after its last day.
    static func nextDay(_ day: String) -> String? {
        guard let (y, m, d) = parts(day), let date = utc.date(from: DateComponents(year: y, month: m, day: d)),
              let next = utc.date(byAdding: .day, value: 1, to: date) else { return nil }
        let c = utc.dateComponents([.year, .month, .day], from: next)
        return String(format: "%04d%02d%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// A text value: backslash, semicolon, comma and line breaks are escaped.
    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: ";", with: "\\;")
            .replacingOccurrences(of: ",", with: "\\,")
            .replacingOccurrences(of: "\r\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\n")
            .replacingOccurrences(of: "\n", with: "\\n")
    }

    /// Lines are folded at 75 octets, the rest on the next line after a space. A character is never split.
    static func fold(_ line: String) -> String {
        var out: [String] = []
        var current = ""
        var bytes = 0
        for ch in line {
            let size = String(ch).utf8.count
            // The continuation lines start with a space, which counts toward their 75.
            let limit = out.isEmpty ? 75 : 74
            if bytes + size > limit {
                out.append(current)
                current = ""
                bytes = 0
            }
            current.append(ch)
            bytes += size
        }
        out.append(current)
        return out.enumerated().map { $0.offset == 0 ? $0.element : " " + $0.element }.joined(separator: "\r\n")
    }

    private static func parts(_ day: String) -> (Int, Int, Int)? {
        let pieces = day.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 3, pieces[0].count == 4, pieces[1].count == 2, pieces[2].count == 2,
              pieces.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } }),
              let y = Int(pieces[0]), let m = Int(pieces[1]), let d = Int(pieces[2]) else { return nil }
        return (y, m, d)
    }

    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return calendar
    }()
}
