#if DEBUG
import SwiftUI
import AVFoundation
import FlowKit

/// Puts the player through every sample stream and the scenarios around them (`-FlowPlayerCheck YES`,
/// debug builds, sample data). Each check waits on the player's real state and records PASS or FAIL
/// with what it saw, in `$FLOW_CHECK_FILE` (default: the temp directory's flow-player-check.log).
/// Each screen worth looking at writes "index:name" to `$FLOW_CHECK_FILE.step`, as the tour does,
/// so a script can screenshot it. scripts/player-check.sh runs it.
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

    static func run(_ model: AppModel) async {
        try? "".write(to: logURL, atomically: true, encoding: .utf8)
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        let dune = ScreenshotTour.item(DemoCatalog.title(693134)!)
        let movie = PlaybackRequest(item: dune)
        guard let sources = try? await DemoSourceProvider().sources(for: movie), !sources.isEmpty else {
            record(false, "setup", "no sample sources"); finish(); return
        }
        line("Sources: " + sources.map { "\($0.id)=\($0.filename ?? $0.providerName)" }.joined(separator: ", "))

        // FLOW_CHECK_ONLY=episodes,resume runs just those.
        let only = Set((ProcessInfo.processInfo.environment["FLOW_CHECK_ONLY"] ?? "").split(separator: ",").map(String.init))
        func wants(_ name: String) -> Bool { only.isEmpty || only.contains(name) }
        if wants("streams") { for source in sources { await checkStream(source, request: movie, model: model) } }
        if wants("switch") { await checkSwitchingSource(sources, request: movie, model: model) }
        if wants("intro") { await checkSkipIntro(sources[0], request: movie, model: model) }
        if wants("fallback") { await checkFallback(sources[0], request: movie, model: model) }
        if wants("failure") { await checkFailure(request: movie, model: model) }
        if wants("episodes") { await checkEpisodes(model: model) }
        if wants("resume") { await checkResumePrompt(sources[0], request: movie, model: model) }
        if wants("panels"), sources.count > 1 { await checkPanels(sources[1], request: movie, model: model) }
        model.activePlayback?.stop()
        finish()
    }

    // MARK: Per stream

    private static func checkStream(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        let name = source.filename ?? source.id
        section("Stream \(source.id): \(name)")
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

        session.player.pause()
        let paused = await value(timeout: 3) { session.isPlaying ? nil : true }
        record(paused == true, "pause", "rate \(session.player.rate)")
        session.player.playImmediately(atRate: 2)
        let fast = await value(timeout: 3) { session.player.rate == 2 ? true : nil }
        record(fast == true, "play at 2×", "rate \(session.player.rate)")
        session.player.rate = 1

        await checkTracks(session)
        let info = session.infoRows()
        record(!info.isEmpty, "info card has details", info.map { "\($0.label)=\($0.value)" }.joined(separator: "; "))
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
        session.showsInfo = true
        await screen("\(source.id)-info")
        session.showsInfo = false
        session.stop()
        _ = await value(timeout: 5) { model.activePlayback == nil ? true : nil }
    }

    /// Every audio and subtitle option the stream offers can be chosen, and subtitles turned off again.
    private static func checkTracks(_ session: PlaybackSession) async {
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

    // MARK: Scenarios

    private static func checkSwitchingSource(_ sources: [StreamSource], request: PlaybackRequest, model: AppModel) async {
        section("Switching source mid-film keeps the place")
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
        session.stop()
        _ = await value(timeout: 5) { model.activePlayback == nil ? true : nil }
    }

    private static func checkSkipIntro(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("Skip Intro")
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
        session.stop()
        _ = await value(timeout: 5) { model.activePlayback == nil ? true : nil }
    }

    private static func broken(_ id: String) -> StreamSource {
        StreamSource(id: id, category: .addons, providerID: "check", providerName: "Broken Source", title: "Broken", filename: "broken.m3u8",
                     location: .url(URL(string: "https://flow.invalid/broken/master.m3u8")!, headers: [:]))
    }

    private static func checkFallback(_ good: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("A source that won't start falls back to the next")
        model.settings.playback.tryNextSourceOnFailure = true
        model.startPlayback(broken("check-broken-1"), request: request, alternatives: [good])
        guard let session = await value(timeout: 3, { model.activePlayback }) else { record(false, "player opened", ""); return }
        let moved = await value(timeout: 45) { session.source.id == good.id && session.phase == .playing ? true : nil }
        record(moved == true, "moved on to the working source by itself", "now \(session.source.id), phase \(session.phase)")
        session.stop()
        _ = await value(timeout: 5) { model.activePlayback == nil ? true : nil }
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
        session.stop()
        _ = await value(timeout: 5) { model.activePlayback == nil ? true : nil }
    }

    private static func checkEpisodes(model: AppModel) async {
        section("Episodes: Up Next moves on by itself")
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
        session.stop()
        _ = await value(timeout: 5) { model.activePlayback == nil ? true : nil }
    }

    private static func checkResumePrompt(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("Resume")
        // The sample library's place in Dune is past the sample stream's end, so make one inside it.
        guard let first = await start(source, request: request, model: model, label: "saving a place") else { return }
        first.seek(to: 200)
        _ = await value(timeout: 10) { first.currentTime > 195 ? true : nil }
        first.stop()
        _ = await value(timeout: 8) { model.activePlayback == nil ? true : nil }
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
        model.settings.playback.askToResume = false
        session.stop()
        _ = await value(timeout: 5) { model.activePlayback == nil ? true : nil }
    }

    /// The panels that float over the picture, over the bright Dolby Vision sample, for looking at.
    private static func checkPanels(_ source: StreamSource, request: PlaybackRequest, model: AppModel) async {
        section("Panels over a bright picture")
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
        session.stop()
        _ = await value(timeout: 5) { model.activePlayback == nil ? true : nil }
    }

    // MARK: Helpers

    private static func start(_ source: StreamSource, request: PlaybackRequest, model: AppModel, label: String) async -> PlaybackSession? {
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

    /// Polls `probe` until it returns a value or `timeout` seconds pass.
    private static func value<T>(timeout: Double, _ probe: () -> T?) async -> T? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let v = probe() { return v }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return probe()
    }

    private static func screen(_ name: String) async {
        shot += 1
        try? "\(shot):\(name)".write(to: stepURL, atomically: true, encoding: .utf8)
        // Long enough for a simulator screenshot to land.
        try? await Task.sleep(nanoseconds: 2_500_000_000)
    }

    private static func section(_ title: String) { line("\n== \(title)") }

    private static func record(_ ok: Bool, _ check: String, _ detail: String) {
        if ok { passed += 1 } else { failed += 1 }
        line("  \(ok ? "PASS" : "FAIL")  \(check)\(detail.isEmpty ? "" : " — \(detail)")")
    }

    private static func line(_ text: String) {
        NSLog("FLOWCHECK %@", text)
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
