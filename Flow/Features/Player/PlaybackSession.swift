import SwiftUI
import AVFoundation
#if os(tvOS)
import AVKit
#endif
import Observation
import FlowKit

/// Owns one playback: the AVPlayer, loading state, scrobbling, skip segments, subtitles and Up Next.
@MainActor
@Observable
final class PlaybackSession: Identifiable {
    enum Phase: Equatable {
        case connecting(Double)
        case playing
        case failed(String)
        case finished
    }

    let id = UUID()
    private(set) var request: PlaybackRequest
    private(set) var source: StreamSource
    let player = AVPlayer()

    var phase: Phase = .connecting(0.05)
    var currentTime: Double = 0
    var duration: Double = 0
    var segments: [SkipSegment] = []
    var activeSegment: SkipSegment?
    var subtitle: SubtitleDocument?
    var subtitleTrack: SubtitleTrackInfo?
    var subtitleOffset: Double = 0
    var subtitleText: String?
    var upNext: PlaybackRequest?
    var upNextCountdown: Int?
    var logoPath: String?
    /// A short message over the video ("Playing English 5.1; DTS isn't supported").
    var notice: String?
    var chapters: [PlayerChapter] = []
    /// True when an MKV is being repackaged on the device for AVPlayer.
    private(set) var usesRemux = false
    /// Other sources for the same title, best first, for when this one won't start.
    private(set) var alternatives: [StreamSource]
    /// A saved position waiting for the viewer to choose Resume or Start Over.
    var resumePrompt: Double?
    /// Playing, but stalled waiting for data.
    var isBuffering = false
    var sleepTimer: SleepTimer? { didSet { scheduleSleep() } }
    /// Picture-based (Blu-ray PGS) subtitle tracks in a remuxed MKV, which Flow draws itself.
    var bitmapTracks: [PlayerTrack] = []
    private(set) var selectedBitmapTrack: Int?
    /// The picture subtitle on screen now, placed in normalised video coordinates.
    var bitmapSubtitle: BitmapOverlay?

    @ObservationIgnored private weak var model: AppModel?
    @ObservationIgnored private var resumeAt: Double?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var lastReport = Date.distantPast
    @ObservationIgnored private var skippedSegments = Set<Double>()
    @ObservationIgnored private var countdownTask: Task<Void, Never>?
    @ObservationIgnored private var didStart = false
    @ObservationIgnored private let sessionID = UUID().uuidString
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var hlsToken: String?
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    @ObservationIgnored private var sleepTask: Task<Void, Never>?
    @ObservationIgnored private let nowPlaying = NowPlaying()
    @ObservationIgnored private var interruptionObserver: NSObjectProtocol?
    @ObservationIgnored private var remuxer: MatroskaRemuxer?
    @ObservationIgnored private var bitmapTask: Task<Void, Never>?

    init(model: AppModel, request: PlaybackRequest, source: StreamSource, resumeAt: Double?, alternatives: [StreamSource] = []) {
        self.model = model
        self.alternatives = alternatives
        self.request = request
        self.source = source
        self.resumeAt = resumeAt
        self.subtitleOffset = model.settings.subtitles.defaultOffsetSeconds
        self.logoPath = request.item.logoPath
        configureAudioSession()
        observeInterruptions()
        load(source)
        Task { await loadExtras() }
    }

    /// After a call or Siri, pick up again if the system says to.
    private func observeInterruptions() {
        #if os(iOS) || os(tvOS)
        interruptionObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended,
                  let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt,
                  AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) else { return }
            MainActor.assumeIsolated { self?.player.play() }
        }
        #endif
    }

    private func beginNowPlaying() {
        guard let model else { return }
        let handlers = NowPlaying.Handlers(
            play: { [weak self] in self?.player.play() },
            pause: { [weak self] in self?.player.pause() },
            toggle: { [weak self] in self?.togglePlay() },
            skip: { [weak self] seconds in self?.seek(by: seconds) },
            seek: { [weak self] position in self?.player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) })
        nowPlaying.begin(title: request.episode?.title ?? request.item.title,
                         subtitle: request.episode != nil ? "\(request.item.title) · \(request.episode!.code)" : request.item.year.map(String.init),
                         artwork: request.item.smallBackdropURL ?? request.item.posterURL,
                         skipForward: model.settings.playback.seekForwardSeconds, skipBackward: model.settings.playback.seekBackwardSeconds,
                         handlers: handlers)
    }

    var title: String { request.item.title }
    var subtitleLine: String? {
        guard let ep = request.episode else { return request.item.year.map(String.init) }
        return "\(ep.code) · \(ep.title)"
    }

    // MARK: Loading

    private func configureAudioSession() {
        #if os(iOS) || os(tvOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
    }

    private func load(_ source: StreamSource) {
        guard let url = source.location.playableURL else {
            fail("This source can't be played directly.")
            return
        }
        loadTask?.cancel()
        teardownObservers()
        releaseRemux()
        player.replaceCurrentItem(with: nil)
        usesRemux = false
        chapters = []
        stopBitmapSubtitles()
        phase = .connecting(0.1)
        loadTask = Task { [weak self] in await self?.prepare(source, url: url) }
    }

    /// Picks the path for this stream: straight to AVPlayer, through the remuxer, or out to another app.
    private func prepare(_ source: StreamSource, url: URL) async {
        let headers = source.location.headers
        var container = ContainerDetector.container(url: url, filename: source.filename)
        // Debrid links carry no extension: look at the first bytes, and keep what was read for the remuxer.
        var probed: ByteSource?
        if container == .unknown {
            let reader = Self.byteSource(url, headers: headers)
            let probe = try? await reader.read(0..<16)
            container = probe.map(ContainerDetector.sniff) ?? .native
            probed = reader
        }
        guard !Task.isCancelled else { return }
        ScreenshotTour.log("prepare \(container) for \(url.lastPathComponent)")
        switch container {
        case .matroska:
            if model?.settings.playback.matroskaPlayback == .external, handOffToExternalPlayer(url) { return }
            await startRemux(url: url, headers: headers, reader: probed)
        case .unsupported(let name):
            fail("\(name) files can't play on Apple devices. Try another source, or open it in an app like VLC or Infuse.")
        case .native, .unknown:
            var options: [String: Any] = [:]
            if !headers.isEmpty { options["AVURLAssetHTTPHeaderFieldsKey"] = headers }
            attach(AVURLAsset(url: url, options: options))
        }
    }

    private static func byteSource(_ url: URL, headers: [String: String]) -> ByteSource {
        url.isFileURL ? FileByteSource(url: url) : HTTPByteSource(url: url, headers: headers)
    }

    private func startRemux(url: URL, headers: [String: String], reader: ByteSource? = nil) async {
        phase = .connecting(0.2)
        do {
            let remuxer = try await MatroskaRemuxer.open(reader ?? Self.byteSource(url, headers: headers), headerCache: .shared)
            guard !Task.isCancelled else { return }
            let skippedAudio = remuxer.skipped.filter { $0.track.kind == .audio }
            if !remuxer.hasPlayableSoundtrack, let first = skippedAudio.first {
                fail("This file's audio is \(first.reason), which Apple devices can't decode. Try another source, or open it in VLC or Infuse.")
                return
            }
            let (hls, token) = try LocalHLSServer.shared.register(remuxer)
            guard !Task.isCancelled else { LocalHLSServer.shared.unregister(token); return }
            hlsToken = token
            usesRemux = true
            self.remuxer = remuxer
            configureBitmapSubtitles(remuxer)
            chapters = remuxer.header.chapters.map { PlayerChapter(title: $0.title, start: Double($0.start) / 1e9) }
            if let first = skippedAudio.first(where: { !$0.track.isCommentary }), let playing = remuxer.audio.first {
                show(notice: "\(first.reason) isn't supported on Apple devices, so Flow is playing \(playing.label).")
            }
            phase = .connecting(0.35)
            attach(AVURLAsset(url: hls))
        } catch let error as MatroskaError {
            switch error {
            case .unsupported(let what):
                fail("This file uses \(what), which Apple devices can't play. Try another source, or open it in VLC or Infuse.")
            default:
                fail(error.localizedDescription)
            }
        } catch {
            fail("Couldn't open this file. \(error.localizedDescription)")
        }
    }

    private func attach(_ asset: AVURLAsset) {
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = usesRemux ? 20 : 10
        applyMetadata(to: item)
        applyChapters(to: item)
        player.replaceCurrentItem(with: item)
        // The remuxed stream lives on this device's loopback address, which an AirPlay receiver can't reach.
        player.allowsExternalPlayback = !usesRemux
        #if os(iOS) || os(tvOS)
        player.usesExternalPlaybackWhileExternalScreenIsActive = !usesRemux
        #endif

        observations.append(item.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in self?.itemStatusChanged(item) }
        })
        observations.append(item.observe(\.loadedTimeRanges, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in self?.bufferChanged(item) }
        })
        observations.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            Task { @MainActor in self?.timeControlChanged(player.timeControlStatus) }
        })
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time.seconds) }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.didFinish() }
        }
        beginNowPlaying()
        // With a saved position and "Ask Before Resuming", wait for the viewer's choice.
        if !(resumeAt != nil && model?.settings.playback.askToResume == true) { player.play() }
    }

    private func applyChapters(to item: AVPlayerItem) {
        #if os(tvOS)
        guard !chapters.isEmpty else { return }
        let groups = chapters.enumerated().map { index, chapter -> AVTimedMetadataGroup in
            let title = AVMutableMetadataItem()
            title.identifier = .commonIdentifierTitle
            title.value = chapter.title as NSString
            title.extendedLanguageTag = "und"
            let end = index + 1 < chapters.count ? chapters[index + 1].start : chapter.start + 1
            let range = CMTimeRange(start: CMTime(seconds: chapter.start, preferredTimescale: 600),
                                    end: CMTime(seconds: max(end, chapter.start + 1), preferredTimescale: 600))
            return AVTimedMetadataGroup(items: [title], timeRange: range)
        }
        item.navigationMarkerGroups = [AVNavigationMarkersGroup(title: nil, timedNavigationMarkers: groups)]
        #endif
    }

    // MARK: Resume and sleep

    /// The viewer chose where to begin.
    func answerResume(_ resume: Bool) {
        if resume, let position = resumePrompt {
            player.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600))
        }
        resumePrompt = nil
        player.play()
    }

    private func scheduleSleep() {
        sleepTask?.cancel()
        guard case .minutes(let minutes) = sleepTimer else { return }
        show(notice: "Flow will pause in \(minutes) minutes.")
        sleepTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
            guard !Task.isCancelled, let self else { return }
            self.player.pause()
            self.sleepTimer = nil
            self.show(notice: "Paused by the sleep timer.")
        }
    }

    // MARK: Failure and fallback

    /// Reports a problem, or quietly moves to the next source when nothing has played yet.
    private func fail(_ message: String) {
        ScreenshotTour.log("fail: \(message)")
        if !didStart, model?.settings.playback.tryNextSourceOnFailure == true, !alternatives.isEmpty {
            tryNextSource(reason: message)
            return
        }
        phase = .failed(message)
    }

    var canTryAnotherSource: Bool { !alternatives.isEmpty }

    /// Moves to the next source in the list (the user asked, or this one wouldn't start).
    func tryNextSource(reason: String? = nil) {
        guard !alternatives.isEmpty else { return }
        let next = alternatives.removeFirst()
        source = next
        show(notice: "That source didn't work, so Flow is trying \(next.providerName)\(next.traits.resolution == .unknown ? "" : " " + next.traits.resolution.label).")
        load(next)
    }

    /// Hands the current stream to the external player from Settings; false if none is set or installed.
    @discardableResult
    func handOffToExternalPlayer(_ url: URL? = nil) -> Bool {
        guard let model, let stream = url ?? source.location.playableURL else { return false }
        let player = model.settings.playback.externalPlayer
        guard player != .none, let launch = player.launchURL(for: stream) else { return false }
        model.openExternally(launch)
        close()
        return true
    }

    func show(notice text: String) {
        noticeTask?.cancel()
        notice = text
        noticeTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 7_000_000_000)
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }

    private func releaseRemux() {
        if let hlsToken { LocalHLSServer.shared.unregister(hlsToken) }
        hlsToken = nil
    }

    // MARK: Picture subtitles

    private func configureBitmapSubtitles(_ remuxer: MatroskaRemuxer) {
        bitmapTracks = remuxer.bitmapSubtitles.map { track in
            var title = track.label
            if track.source.isForced { title += " (Forced)" }
            if track.source.isHearingImpaired { title += " (SDH)" }
            return PlayerTrack(id: track.id, title: title)
        }
        guard let model, !remuxer.bitmapSubtitles.isEmpty else { return }
        // Forced captions in the soundtrack's language always show; full subtitles when the viewer
        // turned on automatic subtitles and there's no text track to use instead.
        let language = remuxer.audio.first?.language
        let forced = remuxer.bitmapSubtitles.first { $0.source.isForced && $0.language == language }
        let preferred = model.settings.subtitles.preferredLanguages
        let wanted = model.settings.subtitles.autoEnable && remuxer.subtitles.isEmpty
            ? remuxer.bitmapSubtitles.first { track in
                !track.source.isCommentary && preferred.contains { LanguageName.bcp47(track.language) == $0 || track.language.hasPrefix($0) }
            }
            : nil
        if let choice = wanted ?? forced { selectBitmapSubtitle(choice.id) }
    }

    func selectBitmapSubtitle(_ id: Int?) {
        selectedBitmapTrack = id
        bitmapSubtitle = nil
        bitmapTask?.cancel()
        guard let remuxer else { return }
        Task { await remuxer.selectBitmapSubtitle(id) }
        guard id != nil else { return }
        let videoSize = remuxer.video.map { CGSize(width: $0.source.width, height: $0.source.height) } ?? .zero
        bitmapTask = Task { [weak self] in
            var shown: Double?
            while !Task.isCancelled {
                guard let self else { return }
                let time = self.player.currentTime().seconds
                let cue = time.isFinite ? await remuxer.bitmapSubtitle(at: time) : nil
                if cue?.start != shown {
                    shown = cue?.start
                    self.bitmapSubtitle = cue.map { BitmapOverlay(cue: $0, videoSize: videoSize) }
                }
                try? await Task.sleep(nanoseconds: 150_000_000)
            }
        }
    }

    private func stopBitmapSubtitles() {
        bitmapTask?.cancel()
        bitmapTask = nil
        remuxer = nil
        bitmapTracks = []
        selectedBitmapTrack = nil
        bitmapSubtitle = nil
    }

    func seek(toChapter chapter: PlayerChapter) {
        player.seek(to: CMTime(seconds: chapter.start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func applyMetadata(to item: AVPlayerItem) {
        #if os(iOS) || os(tvOS)
        var metadata: [AVMetadataItem] = []
        func entry(_ id: AVMetadataIdentifier, _ value: String) {
            let m = AVMutableMetadataItem()
            m.identifier = id
            m.value = value as NSString
            m.extendedLanguageTag = "und"
            metadata.append(m)
        }
        entry(.commonIdentifierTitle, request.episode.map { "\(request.item.title) — \($0.title)" } ?? request.item.title)
        if let overview = request.episode?.overview ?? request.item.overview { entry(.commonIdentifierDescription, overview) }
        item.externalMetadata = metadata
        #endif
    }

    private func loadExtras() async {
        guard let model else { return }
        if logoPath == nil, let catalog = model.catalog { logoPath = await catalog.logo(for: request.item) }
        segments = await SkipSegmentResolver.resolve(source: source, providers: model.skipProviders(), request: request)
        if model.settings.subtitles.autoEnable { await autoLoadSubtitle() }
        upNext = await model.nextRequest(after: request)
    }

    private func autoLoadSubtitle() async {
        guard let model else { return }
        let tracks = await SubtitleSearch.search(model.subtitleProviders(), request: request, languages: model.settings.subtitles.preferredLanguages, hearingImpaired: model.settings.subtitles.hearingImpaired)
        if let first = tracks.first { await selectSubtitle(first) }
    }

    // MARK: Observers

    private func itemStatusChanged(_ item: AVPlayerItem) {
        ScreenshotTour.log("item status \(item.status.rawValue) error=\(item.error?.localizedDescription ?? "-")")
        switch item.status {
        case .readyToPlay:
            if case .connecting = phase { phase = .connecting(0.7) }
            let seconds = item.duration.seconds
            if seconds.isFinite { duration = seconds }
            if let resumeAt, !didStart {
                self.resumeAt = nil
                // A resume point from another cut or source can lie beyond this stream's end;
                // seeking there would "finish" instantly. Only resume when it's comfortably inside.
                if Self.shouldResume(at: resumeAt, duration: seconds) {
                    if model?.settings.playback.askToResume == true {
                        resumePrompt = resumeAt
                    } else {
                        player.seek(to: CMTime(seconds: resumeAt, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600))
                    }
                } else {
                    player.play()
                }
            }
        case .failed:
            fail(Self.describe(item.error))
        default: break
        }
    }

    private func bufferChanged(_ item: AVPlayerItem) {
        guard case .connecting(let p) = phase, let range = item.loadedTimeRanges.first?.timeRangeValue else { return }
        let buffered = min(1, range.duration.seconds / 8)
        phase = .connecting(max(p, 0.15 + buffered * 0.8))
    }

    private func timeControlChanged(_ status: AVPlayer.TimeControlStatus) {
        guard let model else { return }
        isBuffering = status == .waitingToPlayAtSpecifiedRate && didStart
        nowPlaying.update(elapsed: currentTime, duration: duration, rate: player.rate)
        switch status {
        case .playing:
            if case .connecting = phase { phase = .playing }
            if !didStart {
                didStart = true
                Task {
                    try? await model.tracker.scrobble(.start, request: request, percent: percent)
                    await report(.started)
                }
            }
        case .paused:
            guard didStart, phase == .playing else { return }
            let request = self.request, percent = self.percent
            Task {
                try? await model.tracker.scrobble(.pause, request: request, percent: percent)
                await report(.paused)
            }
        default: break
        }
    }

    private var percent: Double { duration > 0 ? currentTime / duration * 100 : 0 }

    private func tick(_ seconds: Double) {
        guard seconds.isFinite else { return }
        currentTime = seconds
        if duration <= 0, let d = player.currentItem?.duration.seconds, d.isFinite { duration = d }
        subtitleText = subtitle?.text(at: seconds, offset: subtitleOffset)
        updateSegment(seconds)
        if Date().timeIntervalSince(lastReport) > 10 {
            lastReport = Date()
            Task { await report(.progress) }
            nowPlaying.update(elapsed: seconds, duration: duration, rate: player.rate)
        }
        maybeStartUpNextCountdown()
    }

    private func updateSegment(_ time: Double) {
        guard let model else { return }
        let active = SkipSegmentResolver.active(segments, at: time)
        activeSegment = active
        guard let active, !skippedSegments.contains(active.start) else { return }
        let behaviour: SkipBehaviour
        switch active.kind {
        case .intro: behaviour = model.settings.playback.skipIntro
        case .recap: behaviour = model.settings.playback.skipRecap
        case .credits: behaviour = model.settings.playback.skipCredits
        case .preview, .commercial: behaviour = model.settings.playback.skipIntro
        }
        switch behaviour {
        case .off: activeSegment = nil
        case .automatic: skip(active)
        case .button: break
        }
    }

    func skip(_ segment: SkipSegment) {
        skippedSegments.insert(segment.start)
        activeSegment = nil
        if segment.kind == .credits, upNext != nil, segment.end >= duration - 5 {
            Task { await playUpNext() }
        } else {
            player.seek(to: CMTime(seconds: segment.end, preferredTimescale: 600))
        }
    }

    // MARK: Up Next

    private func maybeStartUpNextCountdown() {
        guard let model, model.settings.playback.autoPlayNextEpisode, upNext != nil, countdownTask == nil, duration > 60 else { return }
        let creditsStart = segments.first { $0.kind == .credits }?.start
        let threshold = creditsStart ?? (duration - Double(model.settings.playback.nextEpisodeCountdownSeconds) - 20)
        guard currentTime >= threshold else { return }
        let total = model.settings.playback.nextEpisodeCountdownSeconds
        countdownTask = Task { [weak self] in
            for remaining in stride(from: total, through: 1, by: -1) {
                guard let self, !Task.isCancelled else { return }
                self.upNextCountdown = remaining
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
            guard let self, !Task.isCancelled else { return }
            await self.playUpNext()
        }
    }

    func cancelUpNext() {
        countdownTask?.cancel()
        upNextCountdown = nil
        upNext = nil
    }

    func playUpNext() async {
        guard let model, let next = upNext else { return }
        countdownTask?.cancel()
        countdownTask = nil
        upNextCountdown = nil
        await finishCurrent(completed: true)
        if let source = await model.matchingSource(for: next, like: source) {
            request = next
            self.source = source
            alternatives = []
            upNext = nil
            didStart = false
            skippedSegments = []
            segments = []
            subtitle = nil
            subtitleText = nil
            currentTime = 0
            duration = 0
            load(source)
            Task { await loadExtras() }
        } else {
            close()
            model.sourcePickerRequest = next
        }
    }

    // MARK: Subtitles

    func selectSubtitle(_ track: SubtitleTrackInfo?) async {
        guard let model else { return }
        guard let track else { subtitle = nil; subtitleTrack = nil; subtitleText = nil; return }
        let provider = model.subtitleProviders().first { $0.name == track.provider }
        do {
            subtitle = try await provider?.download(track)
            subtitleTrack = track
        } catch {
            model.showToast("Couldn't load subtitles: \(error.localizedDescription)")
        }
    }

    // MARK: Finishing

    private func report(_ state: PlaybackReport.State) async {
        guard let model, source.category == .mediaServers, let server = model.mediaServers.first(where: { $0.config.id == source.providerID }) else { return }
        await server.report(PlaybackReport(state: state, source: source, positionSeconds: currentTime, durationSeconds: duration > 0 ? duration : nil, sessionID: sessionID))
    }

    /// Resume only when the position is known to be well before the end of this stream.
    nonisolated static func shouldResume(at position: Double, duration: Double) -> Bool {
        guard position > 0 else { return false }
        guard duration.isFinite, duration > 0 else { return true }
        return position < duration - 30
    }

    private func didFinish() async {
        // An item that ends without ever really playing (bad seek, broken stream) is an error,
        // not a finished viewing — never mark it watched.
        guard didStart, currentTime > 5 else {
            ScreenshotTour.log("didFinish ignored: started=\(didStart) time=\(currentTime)")
            fail("This stream ended unexpectedly.")
            return
        }
        phase = .finished
        if sleepTimer == .endOfItem {
            await finishCurrent(completed: true)
            close()
            return
        }
        if upNext != nil, model?.settings.playback.autoPlayNextEpisode == true {
            await playUpNext()
        } else {
            await finishCurrent(completed: true)
            close()
        }
    }

    private func finishCurrent(completed: Bool) async {
        guard let model, didStart else { return }
        let position = completed ? max(currentTime, duration) : currentTime
        let pct = duration > 0 ? min(100, position / duration * 100) : 0
        try? await model.tracker.scrobble(.stop, request: request, percent: pct)
        await report(.stopped)
        await model.recordPlayback(request: request, position: position, duration: duration, finished: completed)
        didStart = false
    }

    /// Stops playback, records progress, and dismisses the player.
    func stop() {
        let wasPlaying = didStart
        player.pause()
        Task {
            if wasPlaying { await finishCurrent(completed: false) }
            close()
        }
    }

    private func close(_ caller: String = #function) {
        ScreenshotTour.log("PlaybackSession.close from \(caller) phase=\(phase)")
        countdownTask?.cancel()
        loadTask?.cancel()
        noticeTask?.cancel()
        sleepTask?.cancel()
        nowPlaying.end()
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
        interruptionObserver = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        teardownObservers()
        releaseRemux()
        stopBitmapSubtitles()
        if model?.activePlayback?.id == id { model?.activePlayback = nil }
    }

    private func teardownObservers() {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
        observations.forEach { $0.invalidate() }
        observations = []
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
    }

    func retry() { load(source) }

    /// AVFoundation's errors are terse; say what probably happened.
    static func describe(_ error: Error?) -> String {
        guard let error = error as NSError? else { return "Playback failed." }
        let underlying = (error.userInfo[NSUnderlyingErrorKey] as? NSError)
        switch (error.domain, error.code, underlying?.code) {
        case (NSURLErrorDomain, NSURLErrorNotConnectedToInternet, _), (_, _, NSURLErrorNotConnectedToInternet):
            return "You're offline. Check your connection and try again."
        case (NSURLErrorDomain, NSURLErrorTimedOut, _), (_, _, NSURLErrorTimedOut):
            return "The server took too long to answer."
        case (AVFoundationErrorDomain, AVError.Code.fileFormatNotRecognized.rawValue, _), (AVFoundationErrorDomain, AVError.Code.decoderNotFound.rawValue, _):
            return "This video's format isn't supported on Apple devices."
        case (AVFoundationErrorDomain, AVError.Code.contentIsUnavailable.rawValue, _), (_, _, 404):
            return "This stream isn't available any more."
        default:
            return error.localizedDescription
        }
    }

    // MARK: Transport (shared by on-screen controls and the keyboard)

    var isPlaying: Bool { player.rate > 0 }

    func togglePlay() {
        if isPlaying { player.pause() } else { player.play() }
    }

    func seek(by seconds: Double) {
        let target = max(0, min(duration > 0 ? duration : .greatestFiniteMagnitude, currentTime + seconds))
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600))
    }
}

struct PlayerChapter: Hashable, Identifiable {
    let title: String
    /// Seconds.
    let start: Double
    var id: Double { start }
}

/// A decoded picture subtitle as images ready to draw, each with its rectangle on the subtitle canvas.
struct BitmapOverlay: Equatable {
    struct Piece: Equatable {
        let image: CGImage
        let rect: CGRect
        static func == (a: Piece, b: Piece) -> Bool { a.image === b.image && a.rect == b.rect }
    }

    let start: Double
    let canvas: CGSize
    let videoSize: CGSize
    let pieces: [Piece]

    init(cue: BitmapSubtitle, videoSize: CGSize) {
        start = cue.start
        canvas = CGSize(width: cue.canvasWidth, height: cue.canvasHeight)
        self.videoSize = videoSize
        pieces = cue.objects.compactMap { object in
            let bytes = cue.rgba(for: object)
            guard let provider = CGDataProvider(data: Data(bytes) as CFData),
                  let image = CGImage(width: object.width, height: object.height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: object.width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                      provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { return nil }
            return Piece(image: image, rect: CGRect(x: object.x, y: object.y, width: object.width, height: object.height))
        }
    }

    static func == (a: BitmapOverlay, b: BitmapOverlay) -> Bool { a.start == b.start && a.pieces == b.pieces }
}

/// A selectable track in Flow's own menus.
struct PlayerTrack: Hashable, Identifiable {
    let id: Int
    let title: String
}
