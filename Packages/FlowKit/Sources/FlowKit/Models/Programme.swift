import Foundation

/// The timetable arithmetic behind a programme listing: when something would end if you pressed play
/// now, how long is left, and the plain words for both. The views only draw what this returns.
public enum Reel {
    // MARK: Time left

    /// Minutes of a title still to watch. From the resume point when it is known, otherwise what is left
    /// of the runtime by percentage, otherwise the whole runtime. Never below one while something is left.
    public static func minutesLeft(progress: PlaybackProgress?, runtimeMinutes: Int?) -> Int? {
        if let seconds = progress?.remainingSeconds { return max(1, Int((seconds / 60).rounded(.up))) }
        guard let runtime = runtimeMinutes, runtime > 0 else { return nil }
        if let percent = progress?.percent, percent > 0, percent < 100 {
            return max(1, Int((Double(runtime) * (1 - percent / 100)).rounded()))
        }
        return runtime
    }

    /// How much of a title is watched, 0...1, as the perforations show it. A resume point's position and duration
    /// decide it when both are known, so the perforations always agree with the time left; the stored percentage
    /// only stands in when they aren't (a tracker that gives a percentage and nothing else).
    public static func watchedFraction(_ progress: PlaybackProgress?) -> Double {
        guard let progress else { return 0 }
        if let duration = progress.durationSeconds, duration > 0, let position = progress.positionSeconds {
            return min(1, max(0, position / duration))
        }
        return min(1, max(0, progress.percent / 100))
    }

    /// When it would be over if started at `now`.
    public static func endDate(from now: Date, minutesLeft: Int) -> Date {
        now.addingTimeInterval(Double(minutesLeft) * 60)
    }

    // MARK: Words for durations

    /// "47 min", "2 h", "2 h 47 min".
    public static func duration(minutes: Int) -> String {
        let minutes = max(0, minutes)
        let hours = minutes / 60, rest = minutes % 60
        if hours == 0 { return "\(rest) min" }
        return rest == 0 ? "\(hours) h" : "\(hours) h \(rest) min"
    }

    /// "18 min left", "1 h 44 min left".
    public static func left(minutes: Int) -> String { "\(duration(minutes: minutes)) left" }

    /// Edge print's short form of a length: "47m", "2h", "2h47". Edge print uppercases it.
    public static func compactDuration(minutes: Int) -> String {
        let minutes = max(0, minutes)
        let hours = minutes / 60, rest = minutes % 60
        if hours == 0 { return "\(rest)m" }
        return rest == 0 ? "\(hours)h" : "\(hours)h\(String(format: "%02d", rest))"
    }

    /// The same for what is left: "18m left", "1h44 left".
    public static func compactLeft(minutes: Int) -> String { compactDuration(minutes: minutes) + " left" }

    /// A length of time for VoiceOver: "18 minutes", "1 hour 44 minutes".
    public static func spokenDuration(minutes: Int) -> String {
        let minutes = max(0, minutes)
        let hours = minutes / 60, rest = minutes % 60
        var parts: [String] = []
        if hours > 0 { parts.append(hours == 1 ? "1 hour" : "\(hours) hours") }
        if rest > 0 || hours == 0 { parts.append(rest == 1 ? "1 minute" : "\(rest) minutes") }
        return parts.joined(separator: " ")
    }

    /// The same for VoiceOver: "18 minutes left", "1 hour 44 minutes left".
    public static func spokenLeft(minutes: Int) -> String { spokenDuration(minutes: minutes) + " left" }

    // MARK: Clock times

    /// The viewer's own clock: "21:48" or "9:48 PM".
    public static func clock(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    // MARK: Air dates

    /// An air date as a short day for a time column, with "airs" or "aired" to put beneath it.
    /// Within a week it is the weekday and date ("Tue 12"); further off it is the date ("12 Oct") and the
    /// label gains the year when that isn't this one ("aired 2011"). Bare days (TMDb's midnight UTC) are
    /// read in UTC so they never slip to the evening before.
    public static func airColumn(for date: Date, now: Date = Date(), locale: Locale = .current) -> (day: String, label: String) {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .current
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = utc.timeZone
        let near = abs(date.timeIntervalSince(now)) < 6 * 86400
        formatter.setLocalizedDateFormatFromTemplate(near ? "EEEd" : "dMMM")
        var label = date >= utc.startOfDay(for: now) ? "airs" : "aired"
        let year = utc.component(.year, from: date)
        if year != utc.component(.year, from: now) { label += " \(year)" }
        return (formatter.string(from: date), label)
    }

    /// An air date for edge print: "airs Tue 12", "aired 12 Oct 2011".
    public static func airPrint(for date: Date, now: Date = Date(), locale: Locale = .current) -> String {
        let column = airColumn(for: date, now: now, locale: locale)
        let words = column.label.split(separator: " ").map(String.init)
        return ([words.first ?? "aired", column.day] + words.dropFirst()).joined(separator: " ")
    }

    // MARK: Greeting

    /// Which part of the day Home is named for.
    public enum DayPart: Equatable, Sendable {
        case morning, afternoon, evening

        public init(hour: Int) {
            switch hour {
            case 5..<12: self = .morning
            case 12..<17: self = .afternoon
            default: self = .evening
            }
        }

        public init(date: Date, calendar: Calendar = .current) {
            self.init(hour: calendar.component(.hour, from: date))
        }

        /// The large title: "This Morning", "This Afternoon", "Tonight".
        public var title: String {
            switch self {
            case .morning: return "This Morning"
            case .afternoon: return "This Afternoon"
            case .evening: return "Tonight"
            }
        }
    }

    /// "Thursday 22 October", in the viewer's language and order.
    public static func dateLine(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("EEEEdMMMM")
        return formatter.string(from: date)
    }

    // MARK: Spoken listing

    /// "Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:48 PM". Empty parts are left out.
    public static func spokenListing(title: String, episode: EpisodeRef? = nil, minutesLeft: Int? = nil, endsAt: Date? = nil,
                                     extra: [String] = [], locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        var parts = [title]
        if let episode { parts.append("season \(episode.season) episode \(episode.episode)") }
        parts += extra
        if let minutesLeft { parts.append(spokenLeft(minutes: minutesLeft)) }
        if let endsAt { parts.append("ends \(clock(endsAt, locale: locale, timeZone: timeZone))") }
        return parts.joined(separator: ", ")
    }
}

// MARK: - The version line

extension Reel {
    /// A resolution as a listing writes it: "2160p", "1080p", "SD". Nil when it isn't known.
    public static func resolutionLabel(_ resolution: VideoResolution) -> String? {
        switch resolution {
        case .unknown: return nil
        case .sd: return "SD"
        case .hd720: return "720p"
        case .hd1080: return "1080p"
        case .uhd1440: return "1440p"
        case .uhd4k: return "2160p"
        }
    }

    /// A picture-format badge in words: "DV" is Dolby Vision, the rest read as they are.
    public static func hdrName(_ badge: String) -> String { badge == "DV" ? "Dolby Vision" : badge }

    /// The version that would play, as plain text: "2160p · Dolby Vision · TrueHD 7.1 · 18.20 GB".
    /// No badges and no colour; whatever isn't known is left out.
    public static func versionLine(resolution: VideoResolution = .unknown, hdr: [String] = [], audioCodec: String? = nil,
                                   audioChannels: String? = nil, sizeBytes: Int64? = nil) -> String {
        var parts: [String] = []
        if let label = resolutionLabel(resolution) { parts.append(label) }
        parts += hdr.map(hdrName)
        let audio = [audioCodec, audioChannels].compactMap { $0 }.joined(separator: " ")
        if !audio.isEmpty { parts.append(audio) }
        if let sizeBytes { parts.append(StreamParser.formatBytes(sizeBytes)) }
        return parts.joined(separator: " · ")
    }
}

/// What a frame's edge strip says, like the printed edge of 35mm stock: the perforations fill with how far
/// you've watched, the print gives the facts that decide what to watch. The time left (or NEW) is the key
/// fact; the end time is worked out from the clock, so it is right whenever it is drawn.
public struct EdgePrint: Equatable, Sendable {
    public struct Segment: Equatable, Sendable {
        public var text: String
        /// The fact the eye should land on: drawn in the stock yellow.
        public var isKey: Bool

        public init(_ text: String, isKey: Bool = false) {
            self.text = text
            self.isKey = isKey
        }
    }

    /// 0...1: how much of the strip's perforations are filled. Nil draws no perforations (a poster, a new item).
    public var progress: Double?
    /// Before the key fact: "S3 E7", "2024".
    public var lead: [String]
    /// "18 min left", "NEW EP".
    public var key: String?
    /// Minutes from now to the end; adds "ends 21:30".
    public var endsInMinutes: Int?
    /// After: the format ("2160p", "DV", "TrueHD 7.1").
    public var tail: [String]

    public init(progress: Double? = nil, lead: [String] = [], key: String? = nil, endsInMinutes: Int? = nil, tail: [String] = []) {
        self.progress = progress
        self.lead = lead
        self.key = key
        self.endsInMinutes = endsInMinutes
        self.tail = tail
    }

    /// The print in order, with the end time as of `now`.
    public func segments(now: Date = Date(), locale: Locale = .current, timeZone: TimeZone = .current) -> [Segment] {
        var out = lead.filter { !$0.isEmpty }.map { Segment($0) }
        if let key, !key.isEmpty { out.append(Segment(key, isKey: true)) }
        if let endsInMinutes {
            let end = Reel.endDate(from: now, minutesLeft: endsInMinutes)
            out.append(Segment("ends " + Reel.clock(end, locale: locale, timeZone: timeZone)))
        }
        out += tail.filter { !$0.isEmpty }.map { Segment($0) }
        return out
    }

    /// The print without its `count` least important facts, for a strip too narrow for all of it: a fact that
    /// doesn't fit goes whole, never cut to "ENDS 8:4…". The time left matters most, then the end time, the
    /// format, then the episode or year; among equals the later one goes first. The web ranks them the same way.
    public func segments(droppingLeast count: Int, now: Date = Date(), locale: Locale = .current,
                         timeZone: TimeZone = .current) -> [Segment] {
        let all = segments(now: now, locale: locale, timeZone: timeZone)
        guard count > 0 else { return all }
        let leadCount = lead.filter { !$0.isEmpty }.count
        let endsIndex = endsInMinutes == nil ? nil : leadCount + ((key ?? "").isEmpty ? 0 : 1)
        func rank(_ index: Int) -> Int {
            if all[index].isKey { return 0 }
            if index == endsIndex { return 1 }
            return index < leadCount ? 3 : 2
        }
        let leastFirst = all.indices.sorted { (rank($0), $0) > (rank($1), $1) }
        let dropped = Set(leastFirst.prefix(count))
        return all.indices.filter { !dropped.contains($0) }.map { all[$0] }
    }

    /// How many of `count` perforations are filled for `progress`. Any progress at all fills at least one,
    /// so a title just started doesn't look unwatched.
    public static func filledPerforations(progress: Double, of count: Int) -> Int {
        guard count > 0, progress > 0.005 else { return 0 }
        return min(count, max(1, Int((min(1, progress) * Double(count)).rounded(.down))))
    }
}

extension EdgePrint {
    /// The print under a catalogue poster, the same on every shelf and grid: the runtime (or "Series") and the
    /// rating, with no perforations because nothing is being watched. What the viewer has seen replaces the runtime
    /// as plain print, never a badge on the artwork: "WATCHED" for a finished title, "3/10 EP" for a show part way.
    public static func poster(runtimeMinutes: Int?, isSeries: Bool, rating: Double?, watched: Bool = false,
                              episodesWatched: Int? = nil, episodesAired: Int? = nil, onServer: Bool = false) -> EdgePrint {
        var lead: [String] = []
        var tail: [String] = []
        if watched {
            lead.append("Watched")
        } else {
            if let watchedCount = episodesWatched, let aired = episodesAired, watchedCount > 0, aired > 0 {
                lead.append("\(watchedCount)/\(aired) ep")
            } else if let runtimeMinutes, runtimeMinutes > 0 {
                lead.append(Reel.compactDuration(minutes: runtimeMinutes))
            } else if isSeries {
                lead.append("Series")
            }
            if let rating, rating > 0 { tail.append(String(format: "%.1f", rating)) }
        }
        // After the rating: it says where to find the title, not what it is.
        if onServer { tail.append("Server") }
        return EdgePrint(lead: lead, tail: tail)
    }
}

extension EdgePrint {
    /// The print under a calendar still: the episode ("S01E05", or "Film"), what is special about it ("Season
    /// Premiere"), and the day when the row isn't already under one. A new episode you can play now carries its label
    /// as the key fact; one you've seen says "WATCHED" in plain print instead.
    public static func calendar(episodeCode: String?, label: String?, day: String? = nil, hasAired: Bool, watched: Bool = false) -> EdgePrint {
        var lead = [episodeCode ?? "Film"]
        var key: String?
        var tail: [String] = []
        if watched {
            lead.append("Watched")
        } else if hasAired {
            key = label
        } else if let label {
            tail.append(label)
        }
        if let day { tail.append(day) }
        return EdgePrint(lead: lead, key: key, tail: tail)
    }
}

extension Reel {
    /// The format as edge print: "2160p", "DV", "TrueHD 7.1". Badges stay short here; the film-can label spells them out.
    public static func edgeFormat(resolution: VideoResolution = .unknown, hdr: [String] = [], audioCodec: String? = nil, audioChannels: String? = nil) -> [String] {
        var parts: [String] = []
        if let label = resolutionLabel(resolution) { parts.append(label) }
        parts += hdr
        let audio = [audioCodec, audioChannels].compactMap { $0 }.joined(separator: " ")
        if !audio.isEmpty { parts.append(audio) }
        return parts
    }
}

/// A plain sentence about how a version will play on this device, when there is something to say.
public struct VersionNote: Equatable, Sendable {
    public var text: String
    /// True for what may go wrong (it is drawn in the warning colour); false for what is merely done for you.
    public var isWarning: Bool

    public init(text: String, isWarning: Bool) {
        self.text = text
        self.isWarning = isWarning
    }
}

extension Reel {
    /// What the page says under the best version: that this device can't decode the video, so it may stutter,
    /// or that the audio is converted to play here. Nil when it just plays.
    public static func versionNote(for traits: StreamTraits, decodesAV1: Bool, convertsLosslessAudio: Bool) -> VersionNote? {
        if traits.videoCodec?.uppercased() == "AV1", !decodesAV1 {
            return VersionNote(text: "This device has no AV1 decoder, so it may stutter.", isWarning: true)
        }
        if convertsLosslessAudio, let audio = traits.audioCodec?.uppercased(), audio.hasPrefix("TRUEHD") || audio.hasPrefix("DTS") {
            return VersionNote(text: "Audio is converted to play on this device.", isWarning: false)
        }
        return nil
    }
}

extension StreamTraits {
    /// "2160p · Dolby Vision · TrueHD 7.1", with the size after it when asked.
    public func versionLine(includeSize: Bool = false) -> String {
        Reel.versionLine(resolution: resolution, hdr: hdr, audioCodec: audioCodec, audioChannels: audioChannels,
                              sizeBytes: includeSize ? sizeBytes : nil)
    }
}

extension LastSource {
    /// What the last playback looked like: "2160p · Dolby Vision". Empty when nothing was known.
    public var versionLine: String { Reel.versionLine(resolution: resolution, hdr: hdr) }

    /// The same as edge print: ["2160p", "DV"].
    public var edgeFormat: [String] { Reel.edgeFormat(resolution: resolution, hdr: hdr) }
}
