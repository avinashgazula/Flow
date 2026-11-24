import XCTest
@testable import FlowKit

/// Languages and track selection (testdata/contracts/language.json, track-selection.json).
extension Contracts {
    static func language(_ c: ContractCase) throws -> JSONValue {
        switch c.op {
        case "same":
            let pair = c.input.array ?? []
            return .bool(TrackSelection.matches(pair[0].string ?? "", pair[1].string ?? ""))
        case "name":
            return .string(LanguageName.display(c.input.string ?? ""))
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }

    static func trackSelection(_ c: ContractCase) throws -> JSONValue {
        let input = c.input
        guard c.op == "decide" else { throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")") }
        let audio = (input["audio"]?.array ?? []).map { TrackSelection.AudioTrack(id: $0["id"]?.int ?? 0, language: $0["language"]?.string ?? "", isCommentary: $0["commentary"]?.bool ?? false) }
        let subtitles = (input["subtitles"]?.array ?? []).map {
            TrackSelection.SubtitleTrack(id: $0["id"]?.int ?? 0, language: $0["language"]?.string ?? "", isForced: $0["forced"]?.bool ?? false, isSDH: $0["sdh"]?.bool ?? false,
                                         origin: $0["online"]?.bool == true ? .online : .embedded)
        }
        let audioLanguages = (input["audioLanguages"]?.array ?? []).compactMap { $0.string }
        // Settings hold one preferred audio language and one fallback.
        var playback = PlaybackSettings()
        playback.preferredAudioLanguage = audioLanguages.first
        playback.audioFallbackLanguage = audioLanguages.count > 1 ? audioLanguages[1] : nil
        var settings = SubtitleSettings()
        settings.preferredLanguages = (input["subtitleLanguages"]?.array ?? []).compactMap { $0.string }
        switch input["mode"]?.string {
        case "always": settings.autoSelect = .always
        case "forced": settings.autoSelect = .forcedOnly
        case "foreign": settings.autoSelect = .automatic
        default: settings.autoSelect = .never
        }
        settings.subtitleType = input["type"]?.string == "sdh" ? .sdh : .standard
        let anime = input["anime"]?.string
        playback.animeAudio = anime == "sub" ? .sub : anime == "dub" ? .dub : .noPreference
        var choice: ShowTrackChoice?
        if let picked = input["choice"]?.object, !picked.isEmpty {
            var value = ShowTrackChoice()
            value.audioLanguage = picked["audio"]?.string
            if picked["subtitle"]?.string == "off" { value.subtitlesOff = true } else { value.subtitleLanguage = picked["subtitle"]?.string }
            choice = value
        }
        let decision = TrackSelection.decide(audio: audio, subtitles: subtitles, playback: playback, subtitleSettings: settings, isAnime: anime != nil, showChoice: choice, originalLanguage: input["originalLanguage"]?.string)
        let subtitle: JSONValue
        switch decision.subtitle {
        case .off: subtitle = .object(["kind": .string("off")])
        case .track(let id): subtitle = .object(["kind": .string("track"), "id": .int(id)])
        case .search(let languages): subtitle = .object(["kind": .string("search"), "languages": .array(languages.map { .string($0) })])
        }
        return .object(["audio": decision.audio.map { .int($0) } ?? .null, "subtitle": subtitle])
    }
}
