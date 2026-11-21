import XCTest
@testable import FlowKit

final class PlayerRoutingTests: XCTestCase {
    // MARK: Where a stream starts

    func testStartPathTable() {
        typealias C = ContainerDetector.Container
        struct Row { let name: String; let container: C; let already: Bool; let engine: PlayerEngine; let debug: Bool; let expected: PlayerRouting.StartPath }
        let notice = PlayerRouting.builtInNotice
        let rows = [
            Row(name: "an MP4 plays in Apple's player", container: .native, already: false, engine: .automatic, debug: false, expected: .apple),
            Row(name: "a name that tells nothing plays in Apple's player", container: .unknown, already: false, engine: .automatic, debug: false, expected: .apple),
            Row(name: "an MKV is remuxed", container: .matroska, already: false, engine: .automatic, debug: false, expected: .remux),
            Row(name: "an AVI goes to the built-in decoder with a notice", container: .unsupported("AVI"), already: false, engine: .automatic, debug: false, expected: .builtIn(notice: notice)),
            Row(name: "the built-in setting takes an MP4 without a notice", container: .native, already: false, engine: .builtIn, debug: false, expected: .builtIn(notice: nil)),
            Row(name: "the built-in setting takes an MKV without a notice", container: .matroska, already: false, engine: .builtIn, debug: false, expected: .builtIn(notice: nil)),
            Row(name: "the built-in setting beats the AVI notice", container: .unsupported("AVI"), already: false, engine: .builtIn, debug: false, expected: .builtIn(notice: nil)),
            Row(name: "the debug switch takes an MP4", container: .native, already: false, engine: .automatic, debug: true, expected: .builtIn(notice: nil)),
            Row(name: "the debug switch takes an MKV", container: .matroska, already: false, engine: .automatic, debug: true, expected: .builtIn(notice: nil)),
            Row(name: "a stream already handed over stays in the built-in decoder", container: .native, already: true, engine: .automatic, debug: false, expected: .builtIn(notice: nil)),
            Row(name: "a remuxed stream already handed over is not remuxed again", container: .matroska, already: true, engine: .automatic, debug: false, expected: .builtIn(notice: nil)),
            Row(name: "an AVI already handed over shows no second notice", container: .unsupported("AVI"), already: true, engine: .automatic, debug: false, expected: .builtIn(notice: nil)),
        ]
        for row in rows {
            XCTAssertEqual(PlayerRouting.startPath(container: row.container, builtInAlready: row.already, engine: row.engine, debugForcesBuiltIn: row.debug), row.expected, row.name)
        }
    }

    func testOnlyMatroskaWithTheExternalSettingTriesAnotherApp() {
        XCTAssertTrue(PlayerRouting.triesExternalPlayer(container: .matroska, matroskaPlayback: .external))
        XCTAssertFalse(PlayerRouting.triesExternalPlayer(container: .matroska, matroskaPlayback: .remux))
        XCTAssertFalse(PlayerRouting.triesExternalPlayer(container: .native, matroskaPlayback: .external))
        XCTAssertFalse(PlayerRouting.triesExternalPlayer(container: .unknown, matroskaPlayback: .external))
        XCTAssertFalse(PlayerRouting.triesExternalPlayer(container: .unsupported("AVI"), matroskaPlayback: .external))
    }

    func testRealFilenamesRouteAsTheSettingsPromise() {
        // The detector and the routing together, from the names add-ons really send.
        func path(_ name: String, engine: PlayerEngine = .automatic) -> PlayerRouting.StartPath {
            let url = URL(string: "https://cdn.example.com/\(name)")!
            return PlayerRouting.startPath(container: ContainerDetector.container(url: url, filename: nil), builtInAlready: false, engine: engine, debugForcesBuiltIn: false)
        }
        XCTAssertEqual(path("Dune.2024.2160p.mkv"), .remux)
        XCTAssertEqual(path("Dune.2024.mp4"), .apple)
        XCTAssertEqual(path("Old.Film.avi"), .builtIn(notice: PlayerRouting.builtInNotice))
        XCTAssertEqual(path("stream/abcdef"), .apple, "an unknown name starts in Apple's player until its bytes say otherwise")
        XCTAssertEqual(path("Dune.2024.mkv", engine: .builtIn), .builtIn(notice: nil))
    }

    // MARK: After the remuxer has opened a file

    func testRemuxVerdictTable() {
        typealias R = PlayerRouting
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: "V_MPEGH/ISO/HEVC", deviceDecodesAV1: false, hasPlayableSoundtrack: true, skippedAudioCount: 0), .proceed)
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: "V_AV1", deviceDecodesAV1: true, hasPlayableSoundtrack: true, skippedAudioCount: 0), .proceed, "AV1 with a decoder stays on Apple's path")
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: "V_AV1", deviceDecodesAV1: false, hasPlayableSoundtrack: true, skippedAudioCount: 0), .builtIn, "AV1 with no decoder goes to the built-in one")
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: "V_MPEG4/ISO/AVC", deviceDecodesAV1: false, hasPlayableSoundtrack: true, skippedAudioCount: 0), .proceed, "only AV1 cares about the decoder")
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: nil, deviceDecodesAV1: false, hasPlayableSoundtrack: true, skippedAudioCount: 0), .proceed, "no video track is not AV1")
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: "V_MPEG4/ISO/AVC", deviceDecodesAV1: true, hasPlayableSoundtrack: false, skippedAudioCount: 2), .builtIn, "all audio undecodable")
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: "V_MPEG4/ISO/AVC", deviceDecodesAV1: true, hasPlayableSoundtrack: true, skippedAudioCount: 2), .proceed, "one skipped track beside a playable one")
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: "V_MPEG4/ISO/AVC", deviceDecodesAV1: true, hasPlayableSoundtrack: false, skippedAudioCount: 0), .proceed, "a silent file plays silent")
        XCTAssertEqual(R.afterRemuxOpened(videoCodecID: "V_AV1", deviceDecodesAV1: false, hasPlayableSoundtrack: false, skippedAudioCount: 1), .builtIn)
    }

    func testRemuxErrorsFallBackOnlyForUnsupportedVideo() {
        XCTAssertEqual(PlayerRouting.afterRemuxError(.unsupported("V_MS/VFW/FOURCC")), .builtIn)
        XCTAssertEqual(PlayerRouting.afterRemuxError(.notMatroska), .fail("This isn't a Matroska file."))
        XCTAssertEqual(PlayerRouting.afterRemuxError(.malformed("cluster")), .fail("The file looks damaged (cluster)."))
        XCTAssertEqual(PlayerRouting.couldntOpen("The request timed out."), "Couldn't open this file. The request timed out.")
    }

    // MARK: Apple's player fails an item

    private func failure(didStart: Bool = false, usesRemux: Bool = false, compatible: Bool = false, dolby: Bool = false, builtIn: Bool = false,
                         code: Int? = nil, canStart: Bool = true, recoveries: Int = 0, since: Double? = nil) -> PlayerRouting.ItemFailureDecision {
        PlayerRouting.onItemFailure(.init(didStart: didStart, usesRemux: usesRemux, remuxIsCompatible: compatible, remuxHasDolbyVisionOrAtmos: dolby, builtInAlreadyRunning: builtIn,
                                          appleErrorCode: code, canStartBuiltIn: canStart, recoveries: recoveries, secondsSinceLastRecovery: since))
    }

    func testFormatErrorsBeforePlaybackGoToTheBuiltInDecoder() {
        for code in [-11828, -11833, -11834, -11821, -11829, -11853] {
            XCTAssertEqual(failure(code: code).action, .switchToBuiltIn, "AVFoundation code \(code)")
        }
        XCTAssertEqual(failure(code: -11800).action, .showError, "an unknown failure is shown")
        XCTAssertEqual(failure(code: -11863).action, .showError, "content unavailable is not a format problem")
        XCTAssertEqual(failure(code: nil).action, .showError, "an error outside AVFoundation is shown")
    }

    func testRemuxedStreamsAlwaysTryTheBuiltInDecoderWhateverTheError() {
        XCTAssertEqual(failure(usesRemux: true, compatible: true, code: nil).action, .switchToBuiltIn)
        XCTAssertEqual(failure(usesRemux: true, compatible: true, code: -1).action, .switchToBuiltIn)
    }

    func testDolbyVisionAndAtmosGetOneCompatibleRemuxFirst() {
        XCTAssertEqual(failure(usesRemux: true, compatible: false, dolby: true).action, .reloadCompatibleRemux)
        XCTAssertEqual(failure(usesRemux: true, compatible: true, dolby: true).action, .switchToBuiltIn, "the compatible remux already failed")
        XCTAssertEqual(failure(usesRemux: true, compatible: false, dolby: false).action, .switchToBuiltIn, "nothing to strip")
        XCTAssertEqual(failure(usesRemux: false, compatible: false, dolby: true).action, .showError, "not remuxed: nothing to reload")
        XCTAssertEqual(failure(didStart: true, usesRemux: true, compatible: false, dolby: true).action, .reconnect, "after playback began it is a dropped stream")
    }

    func testTheBuiltInDecoderIsNotTriedTwice() {
        XCTAssertEqual(failure(usesRemux: true, compatible: true, builtIn: true).action, .showError)
        XCTAssertEqual(failure(builtIn: true, code: -11828).action, .showError)
    }

    func testNoBuiltInFallbackWithoutAPlayableLink() {
        XCTAssertEqual(failure(usesRemux: true, compatible: true, canStart: false).action, .showError)
    }

    func testAFormatErrorAfterPlaybackBeganIsAReconnectNotAFallback() {
        XCTAssertEqual(failure(didStart: true, code: -11828).action, .reconnect)
    }

    func testReconnectsAreLimitedToTwoUntilAQuietSpell() {
        XCTAssertEqual(failure(didStart: true, recoveries: 0), .init(action: .reconnect, recoveries: 1))
        XCTAssertEqual(failure(didStart: true, recoveries: 1), .init(action: .reconnect, recoveries: 2))
        XCTAssertEqual(failure(didStart: true, recoveries: 2), .init(action: .showError, recoveries: 2))
        XCTAssertEqual(failure(didStart: true, recoveries: 5), .init(action: .showError, recoveries: 5))
        // Drops far apart each get their own tries: more than ten minutes since the last one starts the count again.
        XCTAssertEqual(failure(didStart: true, recoveries: 2, since: 601), .init(action: .reconnect, recoveries: 1))
        XCTAssertEqual(failure(didStart: true, recoveries: 2, since: 600), .init(action: .showError, recoveries: 2), "exactly ten minutes is not yet a quiet spell")
        XCTAssertEqual(failure(didStart: true, recoveries: 2, since: 30), .init(action: .showError, recoveries: 2))
        XCTAssertEqual(failure(didStart: true, recoveries: 1, since: 5000), .init(action: .reconnect, recoveries: 1))
    }

    func testAFailureBeforePlaybackNeverReconnects() {
        XCTAssertEqual(failure(didStart: false, recoveries: 0), .init(action: .showError, recoveries: 0))
        XCTAssertEqual(failure(didStart: false, recoveries: 2, since: 9999), .init(action: .showError, recoveries: 0), "the quiet-spell reset happens even when the error is shown")
    }

    func testShouldRetryInBuiltInDirectly() {
        XCTAssertFalse(PlayerRouting.shouldRetryInBuiltIn(builtInAlreadyRunning: true, usesRemux: true, appleErrorCode: -11828))
        XCTAssertTrue(PlayerRouting.shouldRetryInBuiltIn(builtInAlreadyRunning: false, usesRemux: true, appleErrorCode: nil))
        XCTAssertTrue(PlayerRouting.shouldRetryInBuiltIn(builtInAlreadyRunning: false, usesRemux: false, appleErrorCode: -11853))
        XCTAssertFalse(PlayerRouting.shouldRetryInBuiltIn(builtInAlreadyRunning: false, usesRemux: false, appleErrorCode: -11852))
        XCTAssertFalse(PlayerRouting.shouldRetryInBuiltIn(builtInAlreadyRunning: false, usesRemux: false, appleErrorCode: nil))
    }

    func testBuiltInFailureReconnectsTwiceAndForgetsDropsAfterAQuietSpell() {
        XCTAssertEqual(PlayerRouting.onBuiltInFailure(didStart: true, recoveries: 0), .init(action: .reconnect, recoveries: 1))
        XCTAssertEqual(PlayerRouting.onBuiltInFailure(didStart: true, recoveries: 1), .init(action: .reconnect, recoveries: 2))
        XCTAssertEqual(PlayerRouting.onBuiltInFailure(didStart: true, recoveries: 2), .init(action: .showError, recoveries: 2))
        XCTAssertEqual(PlayerRouting.onBuiltInFailure(didStart: false, recoveries: 0), .init(action: .showError, recoveries: 0))
        // Drops close together use up the tries; a third drop long after the last starts them again, as on Apple's player.
        let quiet = PlayerRouting.reconnectForgetAfter
        XCTAssertEqual(PlayerRouting.onBuiltInFailure(didStart: true, recoveries: 2, secondsSinceLastRecovery: quiet - 1).action, .showError)
        XCTAssertEqual(PlayerRouting.onBuiltInFailure(didStart: true, recoveries: 2, secondsSinceLastRecovery: quiet + 1), .init(action: .reconnect, recoveries: 1))
        XCTAssertEqual(PlayerRouting.onBuiltInFailure(didStart: false, recoveries: 2, secondsSinceLastRecovery: quiet + 1), .init(action: .showError, recoveries: 0))
    }

    // MARK: Stalled starts

    func testOnlyRemuxedFilesOnThisDeviceAreWatchedForStalls() {
        XCTAssertTrue(PlayerRouting.watchesForStall(usesRemux: true, remuxesLocalFile: true))
        XCTAssertFalse(PlayerRouting.watchesForStall(usesRemux: true, remuxesLocalFile: false), "a slow link is left alone")
        XCTAssertFalse(PlayerRouting.watchesForStall(usesRemux: false, remuxesLocalFile: true))
        XCTAssertFalse(PlayerRouting.watchesForStall(usesRemux: false, remuxesLocalFile: false))
    }

    func testAStallIsOnlyActedOnWhileNothingElseHasHappened() {
        func stalled(closed: Bool = false, current: Bool = true, started: Bool = false, asking: Bool = false, connecting: Bool = true) -> Bool {
            PlayerRouting.isStillStalled(isClosed: closed, isCurrentItem: current, didStart: started, resumeQuestionShowing: asking, isConnecting: connecting)
        }
        XCTAssertTrue(stalled())
        XCTAssertFalse(stalled(closed: true))
        XCTAssertFalse(stalled(current: false), "a newer item replaced it")
        XCTAssertFalse(stalled(started: true))
        XCTAssertFalse(stalled(asking: true), "waiting for the viewer's answer is not a stall")
        XCTAssertFalse(stalled(connecting: false), "failed, playing or finished already")
    }

    func testAStallLoadsAgainOnceThenGivesUp() {
        XCTAssertEqual(PlayerRouting.afterStall(alreadyRetried: false), .loadAgain)
        XCTAssertEqual(PlayerRouting.afterStall(alreadyRetried: true), .giveUp)
        XCTAssertEqual(PlayerRouting.stallSeconds, 20)
        XCTAssertEqual(PlayerRouting.stallFailureDetail(itemStatus: 0), "No picture after 20 s twice (item status 0)")
        XCTAssertEqual(PlayerRouting.stallFailureMessage, "This file didn't start. Try again, or try another source.")
    }

    // MARK: Failing over to the next source

    func testSourceFailureTable() {
        typealias R = PlayerRouting
        XCTAssertEqual(R.afterSourceFailure(didStart: false, tryNextEnabled: true, alternativesLeft: 1), .tryNextSource)
        XCTAssertEqual(R.afterSourceFailure(didStart: false, tryNextEnabled: true, alternativesLeft: 5), .tryNextSource)
        XCTAssertEqual(R.afterSourceFailure(didStart: false, tryNextEnabled: true, alternativesLeft: 0), .showError, "no source left")
        XCTAssertEqual(R.afterSourceFailure(didStart: false, tryNextEnabled: false, alternativesLeft: 3), .showError, "the viewer turned fail-over off")
        XCTAssertEqual(R.afterSourceFailure(didStart: true, tryNextEnabled: true, alternativesLeft: 3), .showError, "something already played: say so")
        XCTAssertEqual(R.afterSourceFailure(didStart: true, tryNextEnabled: false, alternativesLeft: 0), .showError)
    }

    func testASlateMovesOnEvenAfterPlaybackBegan() {
        XCTAssertEqual(PlayerRouting.afterSlate(tryNextEnabled: true, alternativesLeft: 1), .tryNextSource)
        XCTAssertEqual(PlayerRouting.afterSlate(tryNextEnabled: true, alternativesLeft: 0), .showError)
        XCTAssertEqual(PlayerRouting.afterSlate(tryNextEnabled: false, alternativesLeft: 2), .showError)
    }

    func testTheErrorScreenOffersAnotherSourceWhileOneIsLeft() {
        XCTAssertTrue(PlayerRouting.offersAnotherSource(alternativesLeft: 1))
        XCTAssertFalse(PlayerRouting.offersAnotherSource(alternativesLeft: 0))
    }

    // MARK: Notices

    func testSourceNoticesNameWhatHappened() {
        XCTAssertEqual(PlayerNotices.tryingNextSource(provider: "Torrentio", resolutionLabel: "1080p"), "That source didn't work, so Marquee is trying Torrentio 1080p.")
        XCTAssertEqual(PlayerNotices.tryingNextSource(provider: "Torrentio", resolutionLabel: nil), "That source didn't work, so Marquee is trying Torrentio.")
        XCTAssertEqual(PlayerNotices.switchingSource(provider: "Torrentio", resolutionLabel: "2160p", qualityLabel: "BluRay"), "Switching to 2160p BluRay…")
        XCTAssertEqual(PlayerNotices.switchingSource(provider: "Torrentio", resolutionLabel: "2160p", qualityLabel: nil), "Switching to 2160p…")
        XCTAssertEqual(PlayerNotices.switchingSource(provider: "Torrentio", resolutionLabel: nil, qualityLabel: "WEB-DL"), "Switching to WEB-DL…")
        XCTAssertEqual(PlayerNotices.switchingSource(provider: "Torrentio", resolutionLabel: nil, qualityLabel: nil), "Switching to Torrentio…")
        XCTAssertEqual(PlayerNotices.reconnecting, "Connection lost. Reconnecting…")
    }

    func testSkippedAudioNoticePointsAtTheSettingOnlyWhenTheDecodersAreOff() {
        XCTAssertEqual(PlayerNotices.skippedAudio(reason: "DTS-HD MA 7.1", decodersAvailable: true, playing: "English AC3"), "DTS-HD MA 7.1 can't play on Apple devices. Playing English AC3 instead.")
        XCTAssertEqual(PlayerNotices.skippedAudio(reason: "TrueHD 7.1", decodersAvailable: false, playing: "English AAC"), "TrueHD 7.1: turn on Decode Audio Apple Can't Play in Settings. Playing English AAC instead.")
    }
}
