import Foundation

/// Decides which audio track plays and which subtitle shows, from what a file carries and the
/// viewer's Settings. Pure, so the rules are testable without a player.
public enum TrackSelection {
    public struct AudioTrack: Hashable, Sendable {
        public var id: Int
        /// ISO 639 or BCP 47.
        public var language: String
        /// Commentaries and audio description: never what plays unprompted.
        public var isCommentary: Bool
        public var isDefault: Bool

        public init(id: Int, language: String, isCommentary: Bool = false, isDefault: Bool = false) {
            self.id = id
            self.language = language
            self.isCommentary = isCommentary
            self.isDefault = isDefault
        }
    }

    public struct SubtitleTrack: Hashable, Sendable {
        public enum Origin: Hashable, Sendable {
            /// Inside the file or stream.
            case embedded
            /// From a subtitle search.
            case online
        }

        public var id: Int
        public var language: String
        public var isForced: Bool
        /// Subtitles for the deaf and hard of hearing (sound cues included).
        public var isSDH: Bool
        public var origin: Origin

        public init(id: Int, language: String, isForced: Bool = false, isSDH: Bool = false, origin: Origin = .embedded) {
            self.id = id
            self.language = language
            self.isForced = isForced
            self.isSDH = isSDH
            self.origin = origin
        }
    }

    public enum SubtitleDecision: Hashable, Sendable {
        case off
        case track(Int)
        /// Subtitles are wanted but the file has none in these languages (best first): look online.
        case search([String])
    }

    public struct Decision: Hashable, Sendable {
        /// Nil when the file has no audio track to choose from.
        public var audio: Int?
        public var subtitle: SubtitleDecision
    }

    /// TMDb's Animation genre.
    static let animationGenreID = 16

    /// Anime is Japanese animation: TMDb's Animation genre with Japanese as the original language.
    public static func isAnime(genreIDs: [Int], originalLanguage: String?) -> Bool {
        guard genreIDs.contains(animationGenreID), let language = originalLanguage else { return false }
        return primaryLanguage(language) == "ja"
    }

    // MARK: Decision

    /// `showChoice` is what the viewer picked earlier in this show (nil for films or when remembering is off).
    /// `deviceLanguage` stands in when no audio language is set, so a multi-language release whose
    /// default track is a dub doesn't start in the wrong language.
    public static func decide(audio: [AudioTrack], subtitles: [SubtitleTrack], playback: PlaybackSettings, subtitleSettings: SubtitleSettings,
                              isAnime: Bool, showChoice: ShowTrackChoice? = nil, deviceLanguage: String? = nil) -> Decision {
        let audioOrder = audioLanguages(playback: playback, isAnime: isAnime, showChoice: showChoice, deviceLanguage: deviceLanguage)
        let chosen = chooseAudio(audio, languages: audioOrder)
        let languages = subtitleLanguages(subtitleSettings, showChoice: showChoice)
        let type = subtitleSettings.subtitleType

        // What the viewer picked for this show beats every setting.
        if let showChoice {
            if showChoice.subtitlesOff { return Decision(audio: chosen?.id, subtitle: .off) }
            if showChoice.subtitleLanguage != nil {
                return Decision(audio: chosen?.id, subtitle: full(subtitles, languages: languages, type: type))
            }
        }

        var mode = subtitleSettings.autoSelect
        if isAnime {
            switch playback.animeAudio {
            case .sub: mode = .always
            case .dub: mode = .never
            case .noPreference: break
            }
        }
        guard !languages.isEmpty else { return Decision(audio: chosen?.id, subtitle: .off) }

        let subtitle: SubtitleDecision
        switch mode {
        case .never:
            subtitle = .off
        case .always:
            subtitle = full(subtitles, languages: languages, type: type)
        case .forcedOnly:
            subtitle = forced(subtitles, languages: languages, type: type)
        case .automatic:
            // An unlabelled soundtrack counts as foreign: missing subtitles hurt more than extra ones.
            if let chosen, matches(chosen.language, languages[0]) {
                subtitle = forced(subtitles, languages: [languages[0]], type: type)
            } else {
                subtitle = full(subtitles, languages: languages, type: type)
            }
        }
        return Decision(audio: chosen?.id, subtitle: subtitle)
    }

    /// Audio languages in the order they're tried: this show's, Japanese for anime Sub, then the
    /// viewer's language and fallback.
    public static func audioLanguages(playback: PlaybackSettings, isAnime: Bool, showChoice: ShowTrackChoice? = nil, deviceLanguage: String? = nil) -> [String] {
        var order: [String] = []
        if let language = showChoice?.audioLanguage { order.append(language) }
        if isAnime, playback.animeAudio == .sub { order.append("ja") }
        if let preferred = playback.preferredAudioLanguage ?? deviceLanguage { order.append(preferred) }
        if let fallback = playback.audioFallbackLanguage { order.append(fallback) }
        return order.filter { !$0.isEmpty }
    }

    /// This show's subtitle language first, then the viewer's, first language before the fallback.
    public static func subtitleLanguages(_ settings: SubtitleSettings, showChoice: ShowTrackChoice? = nil) -> [String] {
        let general = settings.preferredLanguages.filter { !$0.isEmpty }
        guard let language = showChoice?.subtitleLanguage else { return general }
        return [language] + general.filter { !matches($0, language) }
    }

    // MARK: Audio

    /// The first language in `languages` the file has (a default track of it before others), then the
    /// file's default, then any track; commentaries only when nothing else is there.
    static func chooseAudio(_ tracks: [AudioTrack], languages: [String]) -> AudioTrack? {
        let main = tracks.filter { !$0.isCommentary }
        for language in languages {
            let candidates = main.filter { matches($0.language, language) }
            if let best = candidates.first(where: \.isDefault) ?? candidates.first { return best }
        }
        return main.first(where: \.isDefault) ?? main.first ?? tracks.first
    }

    // MARK: Subtitles

    /// A full (not forced) subtitle: in the file before online, first language before the next.
    /// Nothing there means a search.
    static func full(_ tracks: [SubtitleTrack], languages: [String], type: SubtitleTypePreference) -> SubtitleDecision {
        let full = tracks.filter { !$0.isForced }
        for origin in [SubtitleTrack.Origin.embedded, .online] {
            for language in languages {
                if let best = pick(full.filter { $0.origin == origin && matches($0.language, language) }, type: type) { return .track(best.id) }
            }
        }
        return .search(languages)
    }

    /// A forced subtitle from the file, for foreign-language scenes in a soundtrack the viewer understands.
    static func forced(_ tracks: [SubtitleTrack], languages: [String], type: SubtitleTypePreference) -> SubtitleDecision {
        let forced = tracks.filter { $0.isForced && $0.origin == .embedded }
        for language in languages {
            if let best = pick(forced.filter { matches($0.language, language) }, type: type) { return .track(best.id) }
        }
        return .off
    }

    /// Among tracks of one language, the viewer's kind (SDH or standard); otherwise the first.
    private static func pick(_ candidates: [SubtitleTrack], type: SubtitleTypePreference) -> SubtitleTrack? {
        let wantsSDH = type == .sdh
        return candidates.first { $0.isSDH == wantsSDH } ?? candidates.first
    }

    // MARK: Languages

    /// "eng", "en-US" and "en" all name English; region and script are ignored.
    static func primaryLanguage(_ tag: String) -> String {
        let normalised = LanguageName.bcp47(tag.replacingOccurrences(of: "_", with: "-"))
        return String(normalised.split(separator: "-").first ?? "").lowercased()
    }

    public static func matches(_ tag: String, _ language: String) -> Bool {
        let a = primaryLanguage(tag)
        return !a.isEmpty && a != "und" && a == primaryLanguage(language)
    }
}
