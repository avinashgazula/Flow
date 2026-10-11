import XCTest
@testable import FlowKit

final class TrackSelectionTests: XCTestCase {
    // Audio ids: 0 English (default), 1 Japanese, 2 English commentary, 3 French.
    let audio = [
        TrackSelection.AudioTrack(id: 0, language: "eng", isDefault: true),
        TrackSelection.AudioTrack(id: 1, language: "jpn"),
        TrackSelection.AudioTrack(id: 2, language: "eng", isCommentary: true),
        TrackSelection.AudioTrack(id: 3, language: "fre"),
    ]

    func sub(_ id: Int, _ language: String, forced: Bool = false, sdh: Bool = false, online: Bool = false) -> TrackSelection.SubtitleTrack {
        TrackSelection.SubtitleTrack(id: id, language: language, isForced: forced, isSDH: sdh, origin: online ? .online : .embedded)
    }

    func decide(audio: [TrackSelection.AudioTrack]? = nil, subtitles: [TrackSelection.SubtitleTrack] = [], anime: Bool = false, show: ShowTrackChoice? = nil,
                device: String? = nil, _ configure: (inout PlaybackSettings, inout SubtitleSettings) -> Void = { _, _ in }) -> TrackSelection.Decision {
        var playback = PlaybackSettings()
        var subtitleSettings = SubtitleSettings()
        configure(&playback, &subtitleSettings)
        return TrackSelection.decide(audio: audio ?? self.audio, subtitles: subtitles, playback: playback, subtitleSettings: subtitleSettings,
                                     isAnime: anime, showChoice: show, deviceLanguage: device)
    }

    // MARK: Audio

    func testPreferredLanguageBeatsFileDefault() {
        XCTAssertEqual(decide { p, _ in p.preferredAudioLanguage = "fr" }.audio, 3)
        XCTAssertEqual(decide { p, _ in p.preferredAudioLanguage = "ja" }.audio, 1)
    }

    func testFallbackLanguageWhenPreferredMissing() {
        let result = decide { p, _ in p.preferredAudioLanguage = "de"; p.audioFallbackLanguage = "ja" }
        XCTAssertEqual(result.audio, 1)
    }

    func testFileDefaultThenFirstNonCommentary() {
        XCTAssertEqual(decide { p, _ in p.preferredAudioLanguage = "de" }.audio, 0)
        let noDefault = [TrackSelection.AudioTrack(id: 5, language: "eng", isCommentary: true), TrackSelection.AudioTrack(id: 6, language: "fre")]
        XCTAssertEqual(decide(audio: noDefault) { p, _ in p.preferredAudioLanguage = "de" }.audio, 6)
    }

    func testCommentaryIsNeverChosenWhenAnotherTrackExists() {
        let tracks = [TrackSelection.AudioTrack(id: 0, language: "eng", isCommentary: true, isDefault: true), TrackSelection.AudioTrack(id: 1, language: "eng")]
        XCTAssertEqual(decide(audio: tracks) { p, _ in p.preferredAudioLanguage = "en" }.audio, 1)
        let onlyCommentary = [TrackSelection.AudioTrack(id: 4, language: "eng", isCommentary: true)]
        XCTAssertEqual(decide(audio: onlyCommentary).audio, 4)
        XCTAssertNil(decide(audio: []).audio)
    }

    func testDeviceLanguageStandsInWhenNoneIsSet() {
        XCTAssertEqual(decide(device: "fr").audio, 3)
        XCTAssertEqual(decide(device: "fr") { p, _ in p.preferredAudioLanguage = "ja" }.audio, 1)
    }

    func testShowChoiceBeatsSettings() {
        let show = ShowTrackChoice(audioLanguage: "ja")
        XCTAssertEqual(decide(show: show) { p, _ in p.preferredAudioLanguage = "fr" }.audio, 1)
        // A remembered language the file lacks falls back to Settings.
        XCTAssertEqual(decide(show: ShowTrackChoice(audioLanguage: "de")) { p, _ in p.preferredAudioLanguage = "fr" }.audio, 3)
    }

    func testRegionAndThreeLetterCodesMatch() {
        XCTAssertTrue(TrackSelection.matches("eng", "en"))
        XCTAssertTrue(TrackSelection.matches("en-US", "en"))
        XCTAssertTrue(TrackSelection.matches("pt_BR", "pt-PT"))
        XCTAssertTrue(TrackSelection.matches("jpn", "ja-JP"))
        XCTAssertFalse(TrackSelection.matches("en", "fr"))
        XCTAssertFalse(TrackSelection.matches("und", "und"))
    }

    func testAnimeAudio() {
        let japanese = decide(anime: true) { p, _ in p.preferredAudioLanguage = "en"; p.animeAudio = .sub }
        XCTAssertEqual(japanese.audio, 1)
        let dub = decide(anime: true) { p, _ in p.preferredAudioLanguage = "fr"; p.animeAudio = .dub }
        XCTAssertEqual(dub.audio, 3)
        // Without the preference, or for non-anime, the usual rules apply.
        XCTAssertEqual(decide(anime: true) { p, _ in p.preferredAudioLanguage = "fr" }.audio, 3)
        XCTAssertEqual(decide(anime: false) { p, _ in p.preferredAudioLanguage = "fr"; p.animeAudio = .sub }.audio, 3)
    }

    func testAnimeSubFallsBackWhenThereIsNoJapaneseAudio() {
        let tracks = [TrackSelection.AudioTrack(id: 0, language: "eng", isDefault: true)]
        XCTAssertEqual(decide(audio: tracks, anime: true) { p, _ in p.animeAudio = .sub }.audio, 0)
    }

    func testShowChoiceBeatsAnimeAudio() {
        let result = decide(anime: true, show: ShowTrackChoice(audioLanguage: "fr")) { p, _ in p.animeAudio = .sub }
        XCTAssertEqual(result.audio, 3)
    }

    // MARK: Anime detection

    func testIsAnime() {
        XCTAssertTrue(TrackSelection.isAnime(genreIDs: [16, 35], originalLanguage: "ja"))
        XCTAssertTrue(TrackSelection.isAnime(genreIDs: [16], originalLanguage: "ja-JP"))
        XCTAssertFalse(TrackSelection.isAnime(genreIDs: [16], originalLanguage: "en"))
        XCTAssertFalse(TrackSelection.isAnime(genreIDs: [18], originalLanguage: "ja"))
        XCTAssertFalse(TrackSelection.isAnime(genreIDs: [16], originalLanguage: nil))
    }

    // MARK: Subtitles: Automatic

    func testAutomaticTurnsSubtitlesOnForForeignAudio() {
        let subtitles = [sub(10, "fre"), sub(11, "eng")]
        // Japanese audio, English subtitles.
        let result = decide(subtitles: subtitles) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["en"] }
        XCTAssertEqual(result.audio, 1)
        XCTAssertEqual(result.subtitle, .track(11))
    }

    func testAutomaticShowsOnlyForcedWhenAudioIsInFirstSubtitleLanguage() {
        let subtitles = [sub(10, "eng"), sub(11, "eng", forced: true), sub(12, "fre", forced: true)]
        let result = decide(subtitles: subtitles) { p, s in p.preferredAudioLanguage = "en"; s.preferredLanguages = ["en"] }
        XCTAssertEqual(result.subtitle, .track(11))
        // No forced track in the file: nothing, and no search.
        XCTAssertEqual(decide(subtitles: [sub(10, "eng")]) { p, s in p.preferredAudioLanguage = "en"; s.preferredLanguages = ["en"] }.subtitle, .off)
    }

    func testAutomaticForcedIgnoresOnlineTracks() {
        let result = decide(subtitles: [sub(20, "eng", forced: true, online: true)]) { p, s in p.preferredAudioLanguage = "en"; s.preferredLanguages = ["en"] }
        XCTAssertEqual(result.subtitle, .off)
    }

    func testAutomaticUsesFirstLanguageBeforeSecond() {
        let subtitles = [sub(10, "spa"), sub(11, "fre")]
        let result = decide(subtitles: subtitles) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["fr", "es"] }
        XCTAssertEqual(result.subtitle, .track(11))
        let onlySecond = decide(subtitles: [sub(10, "spa")]) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["fr", "es"] }
        XCTAssertEqual(onlySecond.subtitle, .track(10))
    }

    func testEmbeddedBeatsOnline() {
        let subtitles = [sub(20, "eng", online: true), sub(10, "eng")]
        let result = decide(subtitles: subtitles) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["en"] }
        XCTAssertEqual(result.subtitle, .track(10))
        let onlineOnly = decide(subtitles: [sub(20, "eng", online: true)]) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["en"] }
        XCTAssertEqual(onlineOnly.subtitle, .track(20))
    }

    func testSearchWhenTheFileHasNoSubtitleInTheViewersLanguages() {
        let result = decide(subtitles: [sub(10, "fre")]) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["en", "es"] }
        XCTAssertEqual(result.subtitle, .search(["en", "es"]))
    }

    func testForcedTracksAreNotChosenAsFullSubtitles() {
        let result = decide(subtitles: [sub(10, "eng", forced: true)]) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["en"] }
        XCTAssertEqual(result.subtitle, .search(["en"]))
    }

    func testUnlabelledAudioCountsAsForeign() {
        let tracks = [TrackSelection.AudioTrack(id: 0, language: "und", isDefault: true)]
        let result = decide(audio: tracks, subtitles: [sub(10, "eng")]) { _, s in s.preferredLanguages = ["en"] }
        XCTAssertEqual(result.subtitle, .track(10))
    }

    func testNoSubtitleLanguagesMeansOff() {
        XCTAssertEqual(decide(subtitles: [sub(10, "eng")]) { _, s in s.preferredLanguages = [] }.subtitle, .off)
    }

    // MARK: Subtitles: other modes

    func testAlwaysTurnsSubtitlesOnEvenForMatchingAudio() {
        let subtitles = [sub(10, "eng"), sub(11, "eng", forced: true)]
        let result = decide(subtitles: subtitles) { p, s in p.preferredAudioLanguage = "en"; s.autoSelect = .always; s.preferredLanguages = ["en"] }
        XCTAssertEqual(result.subtitle, .track(10))
        let fallback = decide(subtitles: [sub(10, "spa")]) { p, s in p.preferredAudioLanguage = "en"; s.autoSelect = .always; s.preferredLanguages = ["en", "es"] }
        XCTAssertEqual(fallback.subtitle, .track(10))
        let none = decide { p, s in p.preferredAudioLanguage = "en"; s.autoSelect = .always; s.preferredLanguages = ["en"] }
        XCTAssertEqual(none.subtitle, .search(["en"]))
    }

    func testForcedOnly() {
        let subtitles = [sub(10, "eng"), sub(11, "eng", forced: true)]
        let result = decide(subtitles: subtitles) { p, s in p.preferredAudioLanguage = "ja"; s.autoSelect = .forcedOnly; s.preferredLanguages = ["en"] }
        XCTAssertEqual(result.subtitle, .track(11))
        XCTAssertEqual(decide(subtitles: [sub(10, "eng")]) { _, s in s.autoSelect = .forcedOnly; s.preferredLanguages = ["en"] }.subtitle, .off)
    }

    func testNever() {
        let subtitles = [sub(10, "eng"), sub(11, "eng", forced: true)]
        XCTAssertEqual(decide(subtitles: subtitles) { p, s in p.preferredAudioLanguage = "ja"; s.autoSelect = .never; s.preferredLanguages = ["en"] }.subtitle, .off)
    }

    // MARK: Subtitle type

    func testSubtitleTypePrefersSDHOrStandardAmongTheSameLanguage() {
        let subtitles = [sub(10, "eng"), sub(11, "eng", sdh: true)]
        let sdh = decide(subtitles: subtitles) { _, s in s.autoSelect = .always; s.subtitleType = .sdh }
        XCTAssertEqual(sdh.subtitle, .track(11))
        let standard = decide(subtitles: Array(subtitles.reversed())) { _, s in s.autoSelect = .always; s.subtitleType = .standard }
        XCTAssertEqual(standard.subtitle, .track(10))
        // The preferred kind is only a preference: a lone SDH track still shows.
        XCTAssertEqual(decide(subtitles: [sub(11, "eng", sdh: true)]) { _, s in s.autoSelect = .always; s.subtitleType = .standard }.subtitle, .track(11))
    }

    func testSubtitleTypeNeverOutranksLanguage() {
        let subtitles = [sub(10, "spa", sdh: true), sub(11, "eng")]
        let result = decide(subtitles: subtitles) { _, s in s.autoSelect = .always; s.subtitleType = .sdh; s.preferredLanguages = ["en", "es"] }
        XCTAssertEqual(result.subtitle, .track(11))
    }

    // MARK: Anime subtitles

    func testAnimeSubForcesSubtitlesOn() {
        // English audio would normally need no subtitles, and Never would turn them off.
        let result = decide(subtitles: [sub(10, "eng")], anime: true) { p, s in
            p.animeAudio = .sub; p.preferredAudioLanguage = "en"; s.autoSelect = .never; s.preferredLanguages = ["en"]
        }
        XCTAssertEqual(result.audio, 1)
        XCTAssertEqual(result.subtitle, .track(10))
    }

    func testAnimeDubForcesSubtitlesOff() {
        let result = decide(subtitles: [sub(10, "eng")], anime: true) { p, s in
            p.animeAudio = .dub; p.preferredAudioLanguage = "fr"; s.autoSelect = .always; s.preferredLanguages = ["en"]
        }
        XCTAssertEqual(result.audio, 3)
        XCTAssertEqual(result.subtitle, .off)
    }

    func testAnimeSettingIgnoredForOtherTitles() {
        let result = decide(subtitles: [sub(10, "eng")], anime: false) { p, s in
            p.animeAudio = .dub; p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["en"]
        }
        XCTAssertEqual(result.subtitle, .track(10))
    }

    // MARK: Per-show choice

    func testShowSubtitleChoice() {
        let subtitles = [sub(10, "eng"), sub(11, "spa")]
        let spanish = decide(subtitles: subtitles, show: ShowTrackChoice(subtitleLanguage: "es")) { p, s in
            p.preferredAudioLanguage = "en"; s.autoSelect = .never; s.preferredLanguages = ["en"]
        }
        XCTAssertEqual(spanish.subtitle, .track(11))
        let missing = decide(subtitles: [sub(10, "eng")], show: ShowTrackChoice(subtitleLanguage: "es")) { _, s in s.preferredLanguages = ["en"] }
        XCTAssertEqual(missing.subtitle, .track(10))
        let search = decide(show: ShowTrackChoice(subtitleLanguage: "es")) { _, s in s.preferredLanguages = ["en"] }
        XCTAssertEqual(search.subtitle, .search(["es", "en"]))
    }

    func testShowChoiceOffBeatsEverything() {
        let result = decide(subtitles: [sub(10, "eng")], anime: true, show: ShowTrackChoice(subtitlesOff: true)) { p, s in
            p.animeAudio = .sub; s.autoSelect = .always
        }
        XCTAssertEqual(result.subtitle, .off)
    }

    func testEmptyShowChoiceChangesNothing() {
        let a = decide(subtitles: [sub(10, "eng")], show: ShowTrackChoice()) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["en"] }
        let b = decide(subtitles: [sub(10, "eng")]) { p, s in p.preferredAudioLanguage = "ja"; s.preferredLanguages = ["en"] }
        XCTAssertEqual(a, b)
    }

    // MARK: Ordering helpers

    func testAudioLanguagesOrder() {
        var playback = PlaybackSettings()
        playback.preferredAudioLanguage = "en"
        playback.audioFallbackLanguage = "fr"
        playback.animeAudio = .sub
        XCTAssertEqual(TrackSelection.audioLanguages(playback: playback, isAnime: true, showChoice: ShowTrackChoice(audioLanguage: "es")), ["es", "ja", "en", "fr"])
        XCTAssertEqual(TrackSelection.audioLanguages(playback: playback, isAnime: false), ["en", "fr"])
        XCTAssertEqual(TrackSelection.audioLanguages(playback: PlaybackSettings(), isAnime: false, deviceLanguage: "de"), ["de"])
    }

    func testSubtitleLanguagesPutTheShowsFirst() {
        var settings = SubtitleSettings()
        settings.preferredLanguages = ["en", "es"]
        XCTAssertEqual(TrackSelection.subtitleLanguages(settings, showChoice: ShowTrackChoice(subtitleLanguage: "es")), ["es", "en"])
        XCTAssertEqual(TrackSelection.subtitleLanguages(settings), ["en", "es"])
    }

    // MARK: Migration

    func testLegacySwitchesMigrate() {
        var settings = AppSettings()
        settings.subtitles.autoEnable = true
        settings.subtitles.hearingImpaired = true
        let migrated = settings.migrated()
        XCTAssertEqual(migrated.subtitles.autoSelect, .always)
        XCTAssertEqual(migrated.subtitles.subtitleType, .sdh)
        XCTAssertFalse(migrated.subtitles.autoEnable)
        XCTAssertFalse(migrated.subtitles.hearingImpaired)
        // Migrating again leaves a later change alone.
        var changed = migrated
        changed.subtitles.autoSelect = .never
        XCTAssertEqual(changed.migrated().subtitles.autoSelect, .never)
    }

    func testMigrationLeavesCurrentSettingsAlone() {
        var settings = AppSettings()
        settings.subtitles.autoSelect = .forcedOnly
        XCTAssertEqual(settings.migrated(), settings)
    }

    func testOldSavedSettingsMigrateThroughTheCodec() throws {
        let json = #"{"subtitles":{"autoEnable":true}}"#
        let decoded = try SettingsCodec.decode(AppSettings.self, from: Data(json.utf8), defaults: AppSettings()).migrated()
        XCTAssertEqual(decoded.subtitles.autoSelect, .always)
    }
}
