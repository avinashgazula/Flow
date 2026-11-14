#if DEBUG
import SwiftUI
import AVFoundation
import FlowKit

/// Puts the player through every sample stream and the scenarios around them (`-FlowPlayerCheck YES`,
/// debug builds, sample data). Each check waits on the player's real state and records PASS or FAIL
/// with what it saw, in `$FLOW_CHECK_FILE` (default: the temp directory's flow-player-check.log).
/// Each screen worth looking at writes "index:name" to `$FLOW_CHECK_FILE.step`, as the tour does,
/// so a script can screenshot it. scripts/player-check.sh runs it, and CI gates on it.
///
/// Every scenario has a time limit, so a player that hangs is a FAIL line and not a stuck run. Scenarios that
/// play Apple's public sample streams need the network: they are marked "[network]", get one retry, and a second
/// failure says so in its reason.
@MainActor
enum PlayerCheck {
    static var isRequested: Bool { UserDefaults.standard.bool(forKey: "FlowPlayerCheck") }

    private static var logURL: URL {
        ProcessInfo.processInfo.environment["FLOW_CHECK_FILE"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("flow-player-check.log")
    }
    private static var stepURL: URL { logURL.appendingPathExtension("step") }
    private static var passed = 0
    private static var failed = 0
    private static var shot = 0
    /// While the first attempt of a network scenario runs, its lines wait here: they are written only if it passes.
    private static var held: [String]?
    /// The retry of a network scenario is running: a failure in it is not put down to a flaky first try.
    private static var retrying = false
    private static var activeModel: AppModel?

    private final class Done { var value = false }

    static func run(_ model: AppModel) async {
        try? "".write(to: logURL, atomically: true, encoding: .utf8)
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        activeModel = model
        let dune = ScreenshotTour.item(DemoCatalog.title(693134)!)
        let movie = PlaybackRequest(item: dune)
        guard let sources = try? await DemoSourceProvider().sources(for: movie), !sources.isEmpty else {
            record(false, "setup", "no sample sources"); finish(); return
        }
        line("Sources: " + sources.map { "\($0.id)=\($0.filename ?? $0.providerName)" }.joined(separator: ", "))

        // FLOW_CHECK_ONLY=episodes,resume runs just those.
        let only = Set((ProcessInfo.processInfo.environment["FLOW_CHECK_ONLY"] ?? "").split(separator: ",").map(String.init))
        func wants(_ name: String) -> Bool { only.isEmpty || only.contains(name) }
        if wants("streams") {
            for source in sources {
                await scenario("stream \(source.id)", network: isNetwork(source), timeout: 150) { await checkStream(source, request: movie, model: model) }
            }
        }
        if wants("avi") { await scenario("avi", timeout: 60) { await checkAVI(sources, request: movie, model: model) } }
        if wants("audio") { await scenario("audio", timeout: 120) { await checkDecodedAudio(sources, request: movie, model: model) } }
        if wants("apple") { await scenario("apple", timeout: 120) { await checkApple(sources, request: movie, model: model) } }
        if wants("universal") { await scenario("universal", timeout: 150) { await checkUniversal(sources, request: movie, model: model) } }
        if wants("engines") { await scenario("engines", timeout: 180) { await checkEngineSwitch(sources, request: movie, model: model) } }
        if wants("staleresume") { await scenario("staleresume", timeout: 120) { await checkStaleResume(sources, request: movie, model: model) } }
        if wants("close") { await scenario("close", timeout: 120) { await checkCloseMidLoad(sources, request: movie, model: model) } }
        if wants("missing") { await scenario("missing", timeout: 150) { await checkMissingFile(sources, request: movie, model: model) } }
        if wants("switch") { await scenario("switch", network: true, timeout: 120) { await checkSwitchingSource(sources, request: movie, model: model) } }
        if wants("intro") { await scenario("intro", network: true, timeout: 90) { await checkSkipIntro(sources[0], request: movie, model: model) } }
        if wants("fallback") { await scenario("fallback", network: true, timeout: 120) { await checkFallback(sources[0], request: movie, model: model) } }
        if wants("failure") { await scenario("failure", timeout: 120) { await checkFailure(request: movie, model: model) } }
        if wants("episodes") { await scenario("episodes", network: true, timeout: 240) { await checkEpisodes(model: model) } }
        if wants("resume") { await scenario("resume", network: true, timeout: 120) { await checkResumePrompt(sources[0], request: movie, model: model) } }
        if wants("resumeinside") { await scenario("resumeinside", network: true, timeout: 240) { await checkResumeInside(sources[0], request: movie, model: model) } }
        if wants("panels"), sources.count > 1 { await scenario("panels", network: true, timeout: 90) { await checkPanels(sources[1], request: movie, model: model) } }
        model.activePlayback?.stop()
        finish()
    }

    // MARK: Scenario runner

    /// Apple's own sample streams are the only thing the check fetches from outside the app.
    private static func isNetwork(_ source: StreamSource) -> Bool {
        source.location.playableURL.map { !$0.isFileURL } ?? false
    }

    private static func tag(_ source: StreamSource) -> String { isNetwork(source) ? " [network]" : "" }

    /// Runs one scenario with a time limit. A network scenario that fails is run once more, and only a second failure counts.
    private static func scenario(_ name: String, network: Bool = false, timeout: Double, _ body: @escaping @MainActor () async -> Void) async {
        let before = (passed: passed, failed: failed)
        if network { held = [] }
        await guarded(name, timeout: timeout, body)
        guard network else { return }
        let lines = held ?? []
        held = nil
        if failed == before.failed {
            for text in lines { write(text) }
            return
        }
        let failures = lines.filter { $0.hasPrefix("  FAIL  ") }.map { String($0.dropFirst(8)) }.joined(separator: "; ")
        passed = before.passed
        failed = before.failed
        line("  RETRY  \(name) [network]: the first attempt failed, so it ran once more. First attempt: \(failures)")
        retrying = true
        await guarded(name, timeout: timeout, body)
        retrying = false
    }

    /// Gives up on `body` after `timeout` seconds: the hang is the failure, and the player is closed so the next scenario starts clean.
    private static func guarded(_ name: String, timeout: Double, _ body: @escaping @MainActor () async -> Void) async {
        if let leftover = activeModel?.activePlayback {
            leftover.stop()
            _ = await value(timeout: 8) { activeModel?.activePlayback == nil ? true : nil }
        }
        PlaybackSession.forcedUniversal = false
        let done = Done()
        let task = Task { @MainActor in
            await body()
            done.value = true
        }
        let deadline = Date().addingTimeInterval(timeout)
        while !done.value, Date() < deadline { try? await Task.sleep(nanoseconds: 250_000_000) }
        guard !done.value else { return }
        task.cancel()
        record(false, "\(name) finishes in time", "hung, gave up after \(Int(timeout)) s")
        PlaybackSession.forcedUniversal = false
        activeModel?.activePlayback?.stop()
        _ = await value(timeout: 8) { activeModel?.activePlayback == nil ? true : nil }
    }

    // MARK: Per stream

    private static func checkStream(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        let name = source.filename ?? source.id
        section("Stream \(source.id): \(name)\(tag(source))")
        guard let session = await start(source, request: request, model: model, label: name) else { return }

        let duration = await value(timeout: 15) { session.duration > 0 ? session.duration : nil }
        record(duration != nil, "duration known", duration.map { "\(Int($0)) s" } ?? "still 0 after 15 s")

        let t0 = session.currentTime
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        let advanced = session.currentTime - t0
        record(advanced >= 2, "time advances while playing", String(format: "%.1f s in 4 s", advanced))
        await screen("\(source.id)-playing")

        if let duration, duration > 60 {
            let target = min(duration * 0.5, duration - 30)
            session.seek(to: target)
            let landed = await value(timeout: 10) { abs(session.currentTime - target) < 6 ? session.currentTime : nil }
            record(landed != nil, "seek to the middle", landed.map { String(format: "asked %.0f, at %.0f", target, $0) } ?? String(format: "asked %.0f, still at %.0f", target, session.currentTime))
            session.seek(by: -10)
            let back = await value(timeout: 6) { session.currentTime < target - 4 ? session.currentTime : nil }
            record(back != nil, "skip back 10 s", back.map { String(format: "at %.0f", $0) } ?? String(format: "still at %.0f", session.currentTime))
        }

        session.pausePlayback()
        let paused = await value(timeout: 3) { session.isPlaying ? nil : true }
        record(paused == true, "pause", "rate \(session.playbackRate)")
        session.playImmediately(rate: 2)
        let fast = await value(timeout: 3) { session.playbackRate == 2 ? true : nil }
        record(fast == true, "play at 2×", "rate \(session.playbackRate)")
        session.setRateNow(1)

        await checkTracks(session)
        let info = session.infoRows()
        record(!info.isEmpty, "info card has details", info.map { "\($0.label)=\($0.value)" }.joined(separator: "; "))
        if source.id == DemoSourceProvider.aviSampleID {
            record(session.universal != nil, "an Xvid AVI plays in the built-in decoder by itself", "universal=\(session.universal != nil)")
        }
        if source.id == DemoSourceProvider.matroskaSampleID {
            record(session.usesRemux, "MKV is remuxed on device", "usesRemux=\(session.usesRemux)")
            record(!session.chapters.isEmpty, "MKV chapters read", "\(session.chapters.count) chapters")
            record(!session.bitmapTracks.isEmpty, "MKV picture subtitles (PGS) found", session.bitmapTracks.map(\.title).joined(separator: ", "))
            if let first = session.bitmapTracks.first {
                session.selectBitmapSubtitle(first.id)
                record(session.selectedBitmapTrack == first.id, "PGS subtitle can be turned on", first.title)
                await screen("mkv-pgs")
                session.selectBitmapSubtitle(nil)
            }
        }
        if source.id == DemoSourceProvider.audioSampleID {
            // Opus, Vorbis and PCM can't be played by AVPlayer as they are; the "audio" scenario checks each track plays.
            record(session.usesRemux, "MKV with Opus, Vorbis and PCM is remuxed on device", "usesRemux=\(session.usesRemux)")
        }
        session.showsInfo = true
        await screen("\(source.id)-info")
        session.showsInfo = false
        await closePlayer(session, model)
    }

    // MARK: Samples that only play on one engine

    /// The Xvid AVI: nothing on Apple's path opens it, so it has to reach playing in the built-in player without being asked.
    private static func checkAVI(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("Xvid AVI starts in the built-in player")
        guard let avi = sources.first(where: { $0.id == DemoSourceProvider.aviSampleID }) else { record(false, "setup", "no bundled AVI"); return }
        PlaybackSession.forcedUniversal = false
        guard let session = await start(avi, request: request, model: model, label: "Xvid AVI") else { return }
        record(session.universal != nil, "goes to the built-in player by itself", "universal=\(session.universal != nil), reason \(session.universalReason ?? "none")")
        let duration = await value(timeout: 10) { session.duration > 0 ? session.duration : nil }
        record(duration.map { abs($0 - 6) < 1 } ?? false, "length is the file's six seconds", duration.map { String(format: "%.1f s", $0) } ?? "still 0")
        let t0 = session.playbackTime
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        record(session.playbackTime - t0 >= 1, "time advances while playing", String(format: "%.1f s in 1.5 s", session.playbackTime - t0))
        await screen("avi-playing")
        let ended = await value(timeout: 20) { session.phase == .finished || model.activePlayback == nil ? true : nil }
        record(ended != nil, "plays to the end", "phase \(session.phase)")
        await closePlayer(session, model)
    }

    /// Opus, Vorbis and PCM: Apple's player can't decode any of them, so each comes out of the remuxer as a FLAC rendition,
    /// and every one of them must carry playback on after the viewer switches to it.
    private static func checkDecodedAudio(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("Opus, Vorbis and PCM audio carries playback after a switch")
        guard let sample = sources.first(where: { $0.id == DemoSourceProvider.audioSampleID }) else { record(false, "setup", "no bundled audio sample"); return }
        PlaybackSession.forcedUniversal = false
        guard let session = await start(sample, request: request, model: model, label: "audio sample") else { return }
        guard let item = session.player.currentItem, let group = try? await item.asset.loadMediaSelectionGroup(for: .audible), !group.options.isEmpty else {
            record(false, "the audio tracks are offered", session.universal != nil ? "the built-in player has the file, not the remuxer" : "no audio selection group")
            await closePlayer(session, model)
            return
        }
        record(session.usesRemux, "remuxed on the device", "usesRemux=\(session.usesRemux)")
        record(group.options.count >= 3, "three audio tracks are offered", group.options.map(\.displayName).joined(separator: ", "))
        for option in group.options {
            item.select(option, in: group)
            session.seek(to: 1)
            session.player.play()
            // A switch re-seeks and rebuilds buffers, so the player can pause for a moment: let the seek land (the old track
            // plays on until it does), then give the new track time to carry playback two seconds on. A track that
            // can't be decoded never gets there.
            let seekLanded = await value(timeout: 8) { session.seekTarget == nil ? true : nil }
            let landed = session.currentTime
            var waited = 0.0
            while waited < 25, session.currentTime < landed + 2 {
                try? await Task.sleep(nanoseconds: 250_000_000)
                waited += 0.25
            }
            let moved = session.currentTime - landed
            let why = session.player.reasonForWaitingToPlay?.rawValue ?? "-"
            record(seekLanded != nil && moved >= 2, "\(option.displayName) carries playback two seconds on",
                   String(format: "moved %.1f s from %.1f within %.1f s", moved, landed, waited) + (moved >= 2 ? "" : ", waiting: \(why)"))
        }
        await closePlayer(session, model)
    }

    /// An MKV through the remuxer and Apple's player: pause, seek (exact and keyframe), speed, tracks and the end.
    private static func checkApple(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("Apple's player, on an MKV the remuxer repackages")
        guard let sample = sources.first(where: { $0.id == DemoSourceProvider.matroskaSampleID }) else { record(false, "setup", "no bundled MKV"); return }
        let engine = model.settings.playback.playerEngine
        model.settings.playback.playerEngine = .automatic
        defer { model.settings.playback.playerEngine = engine }
        guard let session = await start(sample, request: request, model: model, label: "MKV in Apple's player") else { return }
        record(session.usesRemux && session.universal == nil, "plays through the remuxer in Apple's player", "usesRemux=\(session.usesRemux), universal=\(session.universal != nil)")
        let duration = await value(timeout: 15) { session.duration > 0 ? session.duration : nil }
        record(duration.map { abs($0 - 12) < 1.5 } ?? false, "length is the file's twelve seconds", duration.map { String(format: "%.1f s", $0) } ?? "still 0")

        session.pausePlayback()
        let stopped = await value(timeout: 3) { session.isPlaying ? nil : true }
        let pausedAt = session.playbackTime
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        let drift = abs(session.playbackTime - pausedAt)
        record(stopped == true && drift < 0.3, "pause holds the picture still", String(format: "moved %.2f s in 1.5 s", drift))
        session.resumePlayback()
        let carried = await value(timeout: 8) { session.playbackTime > pausedAt + 1 ? true : nil }
        record(carried != nil, "resume carries on from the same place", String(format: "paused at %.1f, now %.1f", pausedAt, session.playbackTime))

        // After a remuxed start, a seek must land where it was asked to: the segments' timestamps start at zero but not every player agrees.
        session.seek(to: 8, exact: true)
        let exact = await value(timeout: 10) { abs(session.currentTime - 8) <= 1 ? session.currentTime : nil }
        record(exact != nil, "an exact seek lands within a second", String(format: "asked 8, at %.1f", session.currentTime))
        session.seek(to: 4)
        let near = await value(timeout: 10) { abs(session.currentTime - 4) <= 3.5 ? session.currentTime : nil }
        record(near != nil, "a keyframe seek lands within its three second tolerance", String(format: "asked 4, at %.1f", session.currentTime))

        await rewind(session)
        session.playImmediately(rate: 2)
        let s0 = session.playbackTime
        let w0 = Date()
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        let rate = (session.playbackTime - s0) / Date().timeIntervalSince(w0)
        record(rate >= 1.5, "2× speed moves the picture twice as fast", String(format: "%.1f× over 2 s", rate))
        session.setRateNow(1)

        await checkTracks(session)

        if let duration, duration > 4 {
            session.seek(to: duration - 3, exact: true)
            session.resumePlayback()
            let ended = await value(timeout: 20) { session.phase == .finished || model.activePlayback == nil ? true : nil }
            record(ended != nil, "plays to the end", "phase \(session.phase)")
        }
        await closePlayer(session, model)
    }

    /// The bundled MKV through the built-in decoder: it plays, seeks, switches audio and subtitles, changes speed, pauses and ends.
    private static func checkUniversal(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("Built-in decoder")
        guard let sample = sources.first(where: { $0.id == DemoSourceProvider.matroskaSampleID }) else { record(false, "setup", "no bundled MKV"); return }
        PlaybackSession.forcedUniversal = true
        defer { PlaybackSession.forcedUniversal = false }
        guard let session = await start(sample, request: request, model: model, label: "built-in decoder") else { return }
        guard let universal = session.universal else {
            record(false, "the built-in decoder has the stream", "usesRemux=\(session.usesRemux)")
            await closePlayer(session, model)
            return
        }
        record(true, "the built-in decoder has the stream", "usesRemux=\(session.usesRemux)")
        let duration = await value(timeout: 15) { session.duration > 0 ? session.duration : nil }
        record(duration.map { abs($0 - 12) < 1.5 } ?? false, "length is the file's twelve seconds", duration.map { "\(Int($0)) s" } ?? "still 0")
        let t0 = session.playbackTime
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        record(session.playbackTime - t0 >= 1.2, "time advances while playing", String(format: "%.1f s in 2 s", session.playbackTime - t0))
        // Paused for the checks that don't need motion: the clip is only twelve seconds long.
        session.pausePlayback()
        await screen("universal-playing")
        await checkUniversalTracks(session, universal)
        if let duration, duration > 8 {
            session.seek(to: duration * 0.5, exact: true)
            let landed = await value(timeout: 10) { abs(session.currentTime - duration * 0.5) < 1 ? session.currentTime : nil }
            record(landed != nil, "an exact seek lands within a second", String(format: "asked %.1f, at %.1f", duration * 0.5, session.currentTime))
        }

        await rewind(session)
        session.setPlaybackSpeed(2)
        let s0 = session.playbackTime
        let w0 = Date()
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        let rate = (session.playbackTime - s0) / Date().timeIntervalSince(w0)
        record(rate >= 1.5, "2× speed moves the picture twice as fast", String(format: "%.1f× over 2 s", rate))
        session.setPlaybackSpeed(1)

        session.pausePlayback()
        let stopped = await value(timeout: 3) { session.isPlaying ? nil : true }
        let pausedAt = session.playbackTime
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        let drift = abs(session.playbackTime - pausedAt)
        record(stopped == true && drift < 0.3, "pause holds the picture still", String(format: "moved %.2f s in 1.5 s", drift))
        session.resumePlayback()
        let carried = await value(timeout: 8) { session.playbackTime > pausedAt + 1 ? true : nil }
        record(carried != nil, "resume carries on from the same place", String(format: "paused at %.1f, now %.1f", pausedAt, session.playbackTime))

        if let duration, duration > 4 {
            session.seek(to: duration - 3, exact: true)
            session.resumePlayback()
            let ended = await value(timeout: 20) { session.phase == .finished || model.activePlayback == nil ? true : nil }
            record(ended != nil, "plays to the end", "phase \(session.phase)")
        }
        await closePlayer(session, model)
    }

    /// Every audio and subtitle track the built-in player lists can be chosen, and what mpv reports as selected says so
    /// (the player's own flags are set the moment a track is asked for, which proves nothing).
    private static func checkUniversalTracks(_ session: PlaybackSession, _ universal: UniversalPlayer) async {
        line("  audio: " + universal.audioTracks.map(\.title).joined(separator: ", "))
        line("  subtitles: " + universal.subtitleTracks.map(\.title).joined(separator: ", "))
        record(universal.audioTracks.count >= 3, "the file's three audio tracks are listed", "\(universal.audioTracks.count)")
        for track in universal.audioTracks {
            session.chooseUniversalAudio(track.id)
            let heard: Bool? = await value(timeout: 5) { () -> Bool? in
                universal.audioTracks.first(where: { $0.id == track.id })?.isSelected == true ? true : nil
            }
            record(heard == true, "audio track \(track.id) (\(track.title)) can be chosen", "selected in mpv: \(universal.selectedAudio.map(String.init) ?? "none")")
        }
        record(universal.subtitleTracks.count >= 2, "the file's subtitles are listed", "\(universal.subtitleTracks.count)")
        for track in universal.subtitleTracks {
            session.chooseUniversalSubtitle(track.id)
            let shown: Bool? = await value(timeout: 5) { () -> Bool? in
                universal.subtitleTracks.first(where: { $0.id == track.id })?.isSelected == true ? true : nil
            }
            record(shown == true, "subtitle track \(track.id) (\(track.title)) can be chosen", "selected in mpv: \(universal.selectedSubtitle.map(String.init) ?? "none")")
        }
        session.chooseUniversalSubtitle(nil)
        let off: Bool? = await value(timeout: 5) { () -> Bool? in universal.subtitleTracks.contains(where: \.isSelected) ? nil : true }
        record(off == true, "subtitles can be turned off", "selected in mpv: \(universal.selectedSubtitle.map(String.init) ?? "none")")
    }

    /// Every audio and subtitle option the stream offers can be chosen, and subtitles turned off again.
    private static func checkTracks(_ session: PlaybackSession) async {
        if let universal = session.universal {
            line("  audio: " + universal.audioTracks.map(\.title).joined(separator: ", "))
            line("  subtitles: " + universal.subtitleTracks.map(\.title).joined(separator: ", "))
            for track in universal.audioTracks {
                session.chooseUniversalAudio(track.id)
                let heard: Bool? = await value(timeout: 5) { () -> Bool? in
                    universal.audioTracks.first(where: { $0.id == track.id })?.isSelected == true ? true : nil
                }
                record(heard == true, "audio track \(track.id) can be chosen", track.title)
            }
            return
        }
        guard let item = session.player.currentItem else { record(false, "tracks", "no item"); return }
        let audio = try? await item.asset.loadMediaSelectionGroup(for: .audible)
        let legible = try? await item.asset.loadMediaSelectionGroup(for: .legible)
        let audioNames = audio?.options.map(\.displayName) ?? []
        let legibleNames = legible?.options.map(\.displayName) ?? []
        line("  audio: \(audioNames.isEmpty ? "none" : audioNames.joined(separator: ", "))")
        line("  subtitles: \(legibleNames.isEmpty ? "none" : legibleNames.joined(separator: ", "))")
        for (group, kind) in [(audio, "audio"), (legible, "subtitle")] {
            guard let group, group.options.count > 0 else { continue }
            var ok = 0
            for option in group.options {
                item.select(option, in: group)
                if await value(timeout: 3, { item.currentMediaSelection.selectedMediaOption(in: group) == option ? true : nil }) == true { ok += 1 }
            }
            record(ok == group.options.count, "every \(kind) track can be chosen", "\(ok) of \(group.options.count)")
            if kind == "subtitle", group.allowsEmptySelection {
                item.select(nil, in: group)
                let off = await value(timeout: 3) { item.currentMediaSelection.selectedMediaOption(in: group) == nil ? true : nil }
                record(off == true, "subtitles can be turned off", "")
            }
        }
    }

    // MARK: Switching and closing

    /// A stream moving between Apple's player and the built-in player, in both directions, by the source and by the Settings choice.
    private static func checkEngineSwitch(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("Switching between Apple's player and the built-in player")
        guard let mkv = sources.first(where: { $0.id == DemoSourceProvider.matroskaSampleID }),
              let avi = sources.first(where: { $0.id == DemoSourceProvider.aviSampleID }),
              let audio = sources.first(where: { $0.id == DemoSourceProvider.audioSampleID }) else { record(false, "setup", "a bundled sample is missing"); return }
        let engine = model.settings.playback.playerEngine
        model.settings.playback.playerEngine = .automatic
        defer { model.settings.playback.playerEngine = engine }
        guard let session = await start(mkv, request: request, model: model, label: "MKV in Apple's player") else { return }
        record(session.universal == nil && session.usesRemux, "starts in Apple's player", "universal=\(session.universal != nil), usesRemux=\(session.usesRemux)")
        // (what happens, the setting, the source to switch to, whether the built-in player should have it)
        let hops: [(String, PlayerEngine, StreamSource, Bool)] = [
            ("an AVI moves from Apple's player to the built-in player", .automatic, avi, true),
            ("Always Built-in Decoder takes the MKV Apple's player had", .builtIn, mkv, true),
            ("Automatic gives the Opus, Vorbis and PCM file to Apple's player", .automatic, audio, false),
            ("Automatic gives the MKV to Apple's player", .automatic, mkv, false),
            ("Always Built-in Decoder takes the Opus, Vorbis and PCM file", .builtIn, audio, true),
            ("Automatic gives the MKV back to Apple's player", .automatic, mkv, false),
            ("an AVI moves to the built-in player again", .automatic, avi, true),
        ]
        for (what, setting, target, wantsBuiltIn) in hops {
            // The clips are short: start each hop near their beginning.
            await rewind(session)
            model.settings.playback.playerEngine = setting
            session.switchSource(to: target)
            let ready = await value(timeout: 40) { session.source.id == target.id && session.phase == .playing && session.isPlaying ? true : nil }
            let t0 = session.playbackTime
            let moved = await value(timeout: 10) { session.playbackTime > t0 + 1 ? true : nil }
            let builtIn = session.universal != nil
            record(ready == true && moved != nil && builtIn == wantsBuiltIn, what,
                   "builtIn=\(builtIn) (wanted \(wantsBuiltIn)), phase \(session.phase), at \(String(format: "%.1f", session.playbackTime))")
        }
        await closePlayer(session, model)
    }

    /// Closing the player at any moment of loading, on either engine, leaves nothing behind that stops the next one starting.
    private static func checkCloseMidLoad(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("Closing while the file is still loading")
        guard let sample = sources.first(where: { $0.id == DemoSourceProvider.matroskaSampleID }) else { record(false, "setup", "no bundled MKV"); return }
        defer { PlaybackSession.forcedUniversal = false }
        for (engine, forced) in [("Apple's player", false), ("built-in player", true)] {
            PlaybackSession.forcedUniversal = forced
            for delay in [0.0, 0.15, 0.6, 1.5, 3.0] {
                model.startPlayback(sample, request: request)
                guard let session = model.activePlayback else { record(false, "\(engine): the player opened", ""); continue }
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                let phase = "\(session.phase)"
                session.stop()
                let closed = await value(timeout: 8) { model.activePlayback == nil ? true : nil }
                record(closed == true, "\(engine): closing \(Int(delay * 1000)) ms after opening", "was \(phase)")
            }
        }
        PlaybackSession.forcedUniversal = false
        // Alive and not wedged: a fresh player still starts.
        guard let session = await start(sample, request: request, model: model, label: "after closing mid-load") else { return }
        await closePlayer(session, model)
    }

    // MARK: Resume points

    /// A saved place that lies beyond the file's end (another cut, a shorter source) must be ignored, on both engines. The
    /// built-in player once learned the file's length only after "file loaded", saw an unknown length, took the place and
    /// stopped at a resume prompt.
    private static func checkStaleResume(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("A saved place past the end of the file is ignored")
        guard let sample = sources.first(where: { $0.id == DemoSourceProvider.matroskaSampleID }), let key = request.item.key else { record(false, "setup", "no bundled MKV"); return }
        let ask = model.settings.playback.askToResume
        model.settings.playback.askToResume = true
        defer {
            model.settings.playback.askToResume = ask
            PlaybackSession.forcedUniversal = false
            model.progress.removeAll { $0.key == key }
        }
        for (engine, forced) in [("Apple's player", false), ("built-in player", true)] {
            PlaybackSession.forcedUniversal = forced
            model.progress.removeAll { $0.key == key }
            model.progress.insert(PlaybackProgress(key: key, percent: 25, positionSeconds: 500, durationSeconds: 2000), at: 0)
            model.startPlayback(sample, request: request)
            guard let session = await value(timeout: 3, { model.activePlayback }) else { record(false, "\(engine): the player opened", ""); continue }
            let playing = await value(timeout: 40) { session.phase == .playing && session.isPlaying && session.currentTime > 0.5 ? true : nil }
            // A place wrongly taken shows up a moment later, as a prompt or a seek to the end.
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            record(playing == true && session.resumePrompt == nil, "\(engine): plays without asking about a place 500 s into a 12 s file",
                   "phase \(session.phase), prompt \(session.resumePrompt.map { "\(Int($0)) s" } ?? "none")")
            record(session.currentTime < 11 && session.phase != .finished, "\(engine): starts from the beginning", String(format: "at %.1f", session.currentTime))
            record((session.universal != nil) == forced, "\(engine): the file is in the expected engine", "universal=\(session.universal != nil)")
            await closePlayer(session, model)
        }
    }

    /// A saved place inside the file resumes there, with and without the question, on both engines; Apple's long sample stream is the file.
    private static func checkResumeInside(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("A saved place inside the file resumes there [network]")
        guard let key = request.item.key else { record(false, "setup", "no media key"); return }
        let ask = model.settings.playback.askToResume
        defer {
            model.settings.playback.askToResume = ask
            PlaybackSession.forcedUniversal = false
            model.progress.removeAll { $0.key == key }
        }
        for (engine, forced) in [("Apple's player", false), ("built-in player", true)] {
            PlaybackSession.forcedUniversal = forced
            // Without the question: straight to the place.
            model.settings.playback.askToResume = false
            model.progress.removeAll { $0.key == key }
            model.progress.insert(PlaybackProgress(key: key, percent: 33, positionSeconds: 200, durationSeconds: 600), at: 0)
            model.startPlayback(source, request: request)
            guard let session = await value(timeout: 3, { model.activePlayback }) else { record(false, "\(engine): the player opened", ""); continue }
            let there = await value(timeout: 60) { session.phase == .playing && session.currentTime > 195 && session.currentTime < 270 ? session.currentTime : nil }
            record(there != nil && session.resumePrompt == nil, "\(engine): resumes at 3:20 without asking",
                   there.map { String(format: "at %.0f", $0) } ?? "phase \(session.phase), at \(Int(session.currentTime)) s")
            record((session.universal != nil) == forced, "\(engine): the stream is in the expected engine", "universal=\(session.universal != nil)")
            await closePlayer(session, model)

            // With the question: it names the place, and Start from the Beginning really starts there.
            model.settings.playback.askToResume = true
            model.progress.removeAll { $0.key == key }
            model.progress.insert(PlaybackProgress(key: key, percent: 33, positionSeconds: 200, durationSeconds: 600), at: 0)
            model.startPlayback(source, request: request)
            guard let asked = await value(timeout: 3, { model.activePlayback }) else { record(false, "\(engine): the player opened", ""); continue }
            let prompt = await value(timeout: 45) { asked.resumePrompt }
            record(prompt.map { abs($0 - 200) < 1 } ?? false, "\(engine): asks before resuming at 3:20", prompt.map { TimeFormat.clock($0) } ?? "no prompt, phase \(asked.phase)")
            if prompt != nil {
                asked.answerResume(false)
                let began = await value(timeout: 30) { asked.phase == .playing && asked.isPlaying && asked.currentTime < 30 ? asked.currentTime : nil }
                record(began != nil, "\(engine): Start from the Beginning plays from the start", String(format: "at %.0f", asked.currentTime))
            }
            await closePlayer(asked, model)
        }
    }

    // MARK: Scenarios

    private static func checkSwitchingSource(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("Switching source mid-film keeps the place [network]")
        guard sources.count > 2, let session = await start(sources[0], request: request, model: model, label: "first source") else { return }
        session.seek(to: 60)
        _ = await value(timeout: 10) { session.currentTime > 55 ? true : nil }
        let before = session.currentTime
        session.switchSource(to: sources[2])
        let playing = await value(timeout: 30) { session.source.id == sources[2].id && session.phase == .playing && session.currentTime > 1 ? true : nil }
        record(playing == true, "the other source plays", "phase \(session.phase)")
        let kept = await value(timeout: 10) { session.currentTime >= before - 8 ? session.currentTime : nil }
        record(kept != nil, "position kept across the switch", String(format: "was %.0f, now %.0f", before, session.currentTime))
        await screen("switched-source")
        await closePlayer(session, model)
    }

    private static func checkSkipIntro(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("Skip Intro [network]")
        guard let segment = source.segments.first(where: { $0.kind == .intro }) else { line("  (no intro on this source)"); return }
        guard let session = await start(source, request: request, model: model, label: "intro source") else { return }
        session.seek(to: segment.start + 1)
        let shown = await value(timeout: 10) { session.activeSegment?.kind == .intro ? true : nil }
        record(shown == true, "Skip Intro offered during the intro", "segment \(Int(segment.start))–\(Int(segment.end)) s")
        await screen("skip-intro")
        if let active = session.activeSegment {
            session.skip(active)
            let past = await value(timeout: 8) { session.currentTime >= segment.end - 1 ? session.currentTime : nil }
            record(past != nil, "skipping lands after the intro", String(format: "at %.0f", session.currentTime))
        }
        await closePlayer(session, model)
    }

    private static func broken(_ id: String) -> StreamSource {
        StreamSource(id: id, category: .addons, providerID: "check", providerName: "Broken Source", title: "Broken", filename: "broken.m3u8",
                     location: .url(URL(string: "https://flow.invalid/broken/master.m3u8")!, headers: [:]))
    }

    /// A file that was there when the sources were listed and isn't any more.
    private static func missing(_ id: String) -> StreamSource {
        StreamSource(id: id, category: .addons, providerID: "check", providerName: "Missing File", title: "Missing", filename: "missing.mkv",
                     location: .url(URL(fileURLWithPath: "/nonexistent/flow-player-check/missing.mkv"), headers: [:]))
    }

    private static func checkFallback(_ good: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("A source that won't start falls back to the next [network]")
        let failover = model.settings.playback.tryNextSourceOnFailure
        defer { model.settings.playback.tryNextSourceOnFailure = failover }
        model.settings.playback.tryNextSourceOnFailure = true
        model.startPlayback(broken("check-broken-1"), request: request, alternatives: [good])
        guard let session = await value(timeout: 3, { model.activePlayback }) else { record(false, "player opened", ""); return }
        let moved = await value(timeout: 45) { session.source.id == good.id && session.phase == .playing ? true : nil }
        record(moved == true, "moved on to the working source by itself", "now \(session.source.id), phase \(session.phase)")
        await closePlayer(session, model)
    }

    private static func checkFailure(request: PlaybackRequest, model: AppModel) async {
        section("A source that can't play shows the error screen")
        model.startPlayback(broken("check-broken-2"), request: request, alternatives: [])
        guard let session = await value(timeout: 3, { model.activePlayback }) else { record(false, "player opened", ""); return }
        let message = await value(timeout: 45) { if case .failed(let m) = session.phase { return m }; return nil }
        record(message != nil, "error screen shown", message ?? "phase \(session.phase)")
        if let message {
            let jargon = ["NSURL", "Domain", "error -", "(null)", "Optional("].contains { message.contains($0) }
            record(!jargon, "error reads in plain words", message + (session.failureDetail.map { " | detail: \($0)" } ?? ""))
        }
        await screen("error")
        await closePlayer(session, model)
    }

    /// The error screen shows Try Another Source only when there is another to try, and that button plays it.
    private static func checkMissingFile(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("A file that is gone shows the error screen with Try Another Source")
        guard let good = sources.first(where: { $0.id == DemoSourceProvider.matroskaSampleID }) else { record(false, "setup", "no bundled MKV"); return }
        let failover = model.settings.playback.tryNextSourceOnFailure
        // With fail-over on the player moves on by itself and the error screen never shows.
        model.settings.playback.tryNextSourceOnFailure = false
        defer {
            model.settings.playback.tryNextSourceOnFailure = failover
            PlaybackSession.forcedUniversal = false
        }
        for (engine, forced) in [("Apple's player", false), ("built-in player", true)] {
            PlaybackSession.forcedUniversal = forced
            model.startPlayback(missing("check-missing-1"), request: request, alternatives: [good])
            guard let session = await value(timeout: 3, { model.activePlayback }) else { record(false, "\(engine): the player opened", ""); continue }
            let message = await value(timeout: 45) { if case .failed(let m) = session.phase { return m }; return nil }
            record(message != nil, "\(engine): the error screen shows", message ?? "phase \(session.phase)")
            if let message {
                let jargon = ["NSURL", "Domain", "error -", "(null)", "Optional("].contains { message.contains($0) }
                record(!jargon, "\(engine): the error reads in plain words", message)
            }
            record(session.canTryAnotherSource, "\(engine): Try Another Source is offered", "canTryAnotherSource=\(session.canTryAnotherSource)")
            await screen("missing-file-\(forced ? "builtin" : "apple")")
            PlaybackSession.forcedUniversal = false
            session.tryNextSource()
            let moved = await value(timeout: 40) { session.source.id == good.id && session.phase == .playing && session.isPlaying ? true : nil }
            record(moved == true, "\(engine): Try Another Source plays the next source", "now \(session.source.id), phase \(session.phase)")
            await closePlayer(session, model)

            // Nothing else to try: no button.
            PlaybackSession.forcedUniversal = forced
            model.startPlayback(missing("check-missing-2"), request: request, alternatives: [])
            guard let alone = await value(timeout: 3, { model.activePlayback }) else { record(false, "\(engine): the player opened", ""); continue }
            let gone: Bool? = await value(timeout: 45) { () -> Bool? in if case .failed = alone.phase { return true }; return nil }
            record(gone != nil && !alone.canTryAnotherSource, "\(engine): with no other source there is no Try Another Source", "phase \(alone.phase), canTryAnotherSource=\(alone.canTryAnotherSource)")
            await closePlayer(alone, model)
        }
    }

    private static func checkEpisodes(model: AppModel) async {
        section("Episodes: Up Next moves on by itself [network]")
        let show = ScreenshotTour.item(DemoCatalog.title(1396)!)
        guard let catalog = model.catalog, let episodes = try? await catalog.tmdb.season(showID: 1396, season: 1), episodes.count > 1 else {
            record(false, "season loaded", ""); return
        }
        let request = PlaybackRequest(item: show, episode: episodes[0])
        guard let source = try? await DemoSourceProvider().sources(for: request).first,
              let session = await start(source, request: request, model: model, label: episodes[0].code) else { return }
        let next = await value(timeout: 20) { session.upNext }
        record(next?.episode?.number == episodes[0].number + 1, "Up Next is the next episode", next?.episode?.code ?? "none")
        model.settings.playback.upNextWaitsForEnd = false
        if session.duration > 120 {
            session.seek(to: session.duration - 50)
            let countdown = await value(timeout: 45) { session.upNextCountdown }
            record(countdown != nil, "countdown appears near the end", countdown.map { "\($0) s" } ?? String(format: "none, at %.0f of %.0f", session.currentTime, session.duration))
            await screen("up-next")
            var lastState = ""
            let advanced = await value(timeout: 90) { () -> Bool? in
                let state = "\(session.request.episode?.code ?? "") \(session.phase) t=\(Int(session.currentTime)) countdown=\(session.upNextCountdown.map(String.init) ?? "-") stillWatching=\(session.asksStillWatching) closed=\(model.activePlayback == nil)"
                if state != lastState { line("    · \(state)"); lastState = state }
                return session.request.episode?.number == episodes[0].number + 1 && session.phase == .playing ? true : nil
            }
            record(advanced == true, "plays the next episode", session.request.episode?.code ?? "")
        }
        await closePlayer(session, model)
    }

    private static func checkResumePrompt(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("Resume [network]")
        let ask = model.settings.playback.askToResume
        defer { model.settings.playback.askToResume = ask }
        // The sample library's place in Dune is past the sample stream's end, so make one inside it.
        guard let first = await start(source, request: request, model: model, label: "saving a place") else { return }
        first.seek(to: 200)
        _ = await value(timeout: 10) { first.currentTime > 195 ? true : nil }
        await closePlayer(first, model)
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        model.settings.playback.askToResume = true
        model.startPlayback(source, request: request)
        guard let session = await value(timeout: 3, { model.activePlayback }) else { record(false, "player opened", ""); return }
        let prompt = await value(timeout: 20) { session.resumePrompt }
        record(prompt != nil, "Ask Before Resuming offers the saved place", prompt.map { TimeFormat.clock($0) } ?? "no prompt")
        await screen("resume-prompt")
        if prompt != nil {
            session.answerResume(true)
            let resumed = await value(timeout: 15) { session.phase == .playing && session.currentTime > 190 ? session.currentTime : nil }
            record(resumed != nil, "Resume starts from there", String(format: "at %.0f", session.currentTime))
        }
        await closePlayer(session, model)
    }

    /// The panels that float over the picture, over the bright Dolby Vision sample, for looking at.
    private static func checkPanels(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("Panels over a bright picture [network]")
        guard let session = await start(source, request: request, model: model, label: "panels") else { return }
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        session.showsInfo = true
        await screen("panel-info")
        session.showsInfo = false
        session.showsXRay = true
        let xray = await value(timeout: 5) { session.showsXRay ? true : nil }
        record(xray == true, "X-Ray opens", "")
        await screen("panel-xray")
        session.showsXRay = false
        #if os(iOS)
        session.tourPanel = "options"
        await screen("panel-options")
        session.tourPanel = nil
        #endif
        session.show(notice: "Switching to 1080p BluRay…")
        await screen("panel-notice")
        await closePlayer(session, model)
    }

    // MARK: Helpers

    /// Starts `source` and waits for the first picture. A saved place is answered "no": these checks want the start.
    private static func start(_ source: StreamSource, request: PlaybackRequest, model: AppModel, label: String) async -> PlaybackSession? {
        guard !Task.isCancelled else { return nil }
        let began = Date()
        model.startPlayback(source, request: request)
        guard let session = await value(timeout: 3, { model.activePlayback }) else { record(false, "player opened", label); return nil }
        let playing = await value(timeout: 40) { () -> Bool? in
            // A saved place would start mid-film behind a question; these checks want the start.
            if session.resumePrompt != nil { session.answerResume(false) }
            if case .failed = session.phase { return false }
            return session.phase == .playing && session.isPlaying ? true : nil
        }
        let seconds = Date().timeIntervalSince(began)
        if playing == true {
            record(true, "starts playing", String(format: "%.1f s to first frame", seconds))
            return session
        }
        record(false, "starts playing", "phase \(session.phase) after \(Int(seconds)) s")
        await screen("failed-\(source.id)")
        session.stop()
        return nil
    }

    /// Closes the player the way the viewer does and waits for it to be gone.
    private static func closePlayer(_ session: PlaybackSession, _ model: AppModel) async {
        session.stop()
        _ = await value(timeout: 8) { model.activePlayback == nil ? true : nil }
    }

    /// Back to a second into a short clip and playing, so what follows has room to run before the clip ends.
    private static func rewind(_ session: PlaybackSession, to seconds: Double = 1) async {
        session.seek(to: seconds, exact: true)
        session.resumePlayback()
        _ = await value(timeout: 8) { abs(session.currentTime - seconds) < 1.5 && session.isPlaying ? true : nil }
    }

    /// Polls `probe` until it returns a value or `timeout` seconds pass. A scenario that was given up on stops waiting at once.
    private static func value<T>(timeout: Double, _ probe: () -> T?) async -> T? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let v = probe() { return v }
            if Task.isCancelled { return nil }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return probe()
    }

    private static func screen(_ name: String) async {
        guard !Task.isCancelled else { return }
        shot += 1
        try? "\(shot):\(name)".write(to: stepURL, atomically: true, encoding: .utf8)
        // Long enough for a simulator screenshot to land.
        try? await Task.sleep(nanoseconds: 2_500_000_000)
    }

    private static func section(_ title: String) { line("\n== \(title)") }

    private static func record(_ ok: Bool, _ check: String, _ detail: String) {
        // A scenario that was given up on may still be unwinding: what it says now is noise.
        guard !Task.isCancelled else { return }
        if ok { passed += 1 } else { failed += 1 }
        let note = !ok && retrying ? " (network sample: failed on the retry too)" : ""
        let text = detail.isEmpty ? "" : " — \(detail)"
        line("  \(ok ? "PASS" : "FAIL")  \(check)\(text)\(note)")
    }

    private static func line(_ text: String) {
        guard !Task.isCancelled else { return }
        NSLog("FLOWCHECK %@", text)
        if held != nil { held?.append(text); return }
        write(text)
    }

    private static func write(_ text: String) {
        guard let handle = try? FileHandle(forWritingTo: logURL) else { try? (text + "\n").write(to: logURL, atomically: true, encoding: .utf8); return }
        handle.seekToEndOfFile()
        handle.write(Data((text + "\n").utf8))
        try? handle.close()
    }

    private static func finish() {
        line("\nRESULT \(passed) passed, \(failed) failed")
        try? "done".write(to: stepURL, atomically: true, encoding: .utf8)
    }
}
#endif
