import SwiftUI
import AVFoundation
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

    init(model: AppModel, request: PlaybackRequest, source: StreamSource, resumeAt: Double?) {
        self.model = model
        self.request = request
        self.source = source
        self.resumeAt = resumeAt
        self.subtitleOffset = model.settings.subtitles.defaultOffsetSeconds
        self.logoPath = request.item.logoPath
        configureAudioSession()
        load(source)
        Task { await loadExtras() }
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
            phase = .failed("This source can't be played directly.")
            return
        }
        teardownObservers()
        phase = .connecting(0.15)
        var options: [String: Any] = [:]
        let headers = source.location.headers
        if !headers.isEmpty { options["AVURLAssetHTTPHeaderFieldsKey"] = headers }
        let asset = AVURLAsset(url: url, options: options)
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = 10
        applyMetadata(to: item)
        player.replaceCurrentItem(with: item)
        player.allowsExternalPlayback = true
        #if os(iOS) || os(tvOS)
        player.usesExternalPlaybackWhileExternalScreenIsActive = true
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
        player.play()
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
        switch item.status {
        case .readyToPlay:
            if case .connecting = phase { phase = .connecting(0.7) }
            let seconds = item.duration.seconds
            if seconds.isFinite { duration = seconds }
            if let resumeAt, !didStart {
                player.seek(to: CMTime(seconds: resumeAt, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600))
                self.resumeAt = nil
            }
        case .failed:
            phase = .failed(item.error?.localizedDescription ?? "Playback failed.")
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

    private func didFinish() async {
        phase = .finished
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

    private func close() {
        countdownTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        teardownObservers()
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
}
