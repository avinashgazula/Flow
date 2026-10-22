import Foundation

/// The timetable arithmetic behind a programme listing: when something would end if you pressed play
/// now, how long is left, and the plain words for both. The views only draw what this returns.
public enum Programme {
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

extension Programme {
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

extension Programme {
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
        Programme.versionLine(resolution: resolution, hdr: hdr, audioCodec: audioCodec, audioChannels: audioChannels,
                              sizeBytes: includeSize ? sizeBytes : nil)
    }
}

extension LastSource {
    /// What the last playback looked like: "2160p · Dolby Vision". Empty when nothing was known.
    public var versionLine: String { Programme.versionLine(resolution: resolution, hdr: hdr) }
}
