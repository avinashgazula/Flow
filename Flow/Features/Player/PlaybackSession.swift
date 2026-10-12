import SwiftUI
import AVFoundation
import CoreMedia
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
    /// Seconds the subtitle is delayed by (negative shows it earlier), as `SubtitleDocument.text(at:offset:)` takes it.
    var subtitleOffset: Double = 0
    var upNext: PlaybackRequest?
    var upNextCountdown: Int?
    /// Counts player items, so views holding an item's tracks know to read them again.
    private(set) var itemGeneration = 0
    /// Every playable source found for this title, the current one included, for switching mid-film.
    private(set) var sources: [StreamSource]
    /// The rest of this episode's season, for the player's episode list.
    private(set) var seasonEpisodes: [Episode] = []
    /// Films like this one ("Because You Watched"), offered as its credits roll and when it ends.
    var suggestions: [MediaItem] = []
    /// The film after this one in its collection, when it's out; leads the suggestions.
    var nextInCollection: MediaItem?
    var showsSuggestions = false
    var logoPath: String?
    /// A short message over the video ("Playing English 5.1; DTS isn't supported").
    var notice: String?
    var chapters: [PlayerChapter] = []
    /// The technical details panel (iPhone, iPad and Mac; Apple TV shows them in its info panel).
    var showsInfo = false
    /// The X-Ray panel beside the picture (iPhone, iPad, Mac); Apple TV has it as a tab in its info panel.
    var showsXRay = false
    /// Shazam for the song that's playing, and the songs found so far.
    let songs = SongRecognizer()
    /// Several episodes have played back to back untouched: asks before starting another.
    private(set) var asksStillWatching = false
    @ObservationIgnored private var stillWatching = StillWatching()
    /// Downloaded episodes that just finished, handed to Smart Downloads once the player has let go of
    /// their files: the countdown moves on during the credits, still reading from the file.
    @ObservationIgnored private var finishedDownloads: [PlaybackRequest] = []
    @ObservationIgnored private var replayTask: Task<Void, Never>?
    /// True while "What did they say?" has subtitles on, so the choice isn't remembered as the viewer's.
    @ObservationIgnored private var replayingWithSubtitles = false
    @ObservationIgnored private var audibleGroup: AVMediaSelectionGroup?
    @ObservationIgnored private var chapterSegments: [SkipSegment] = []
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
    #if os(iOS)
    /// Scrubbing previews for remuxed MKVs.
    @ObservationIgnored private(set) var scrubPreviewer: ScrubPreviewer?
    /// Set by the screenshot tour to show a scrubbing preview without a finger on the screen.
    var tourScrubPreview: Double?
    /// Set by the screenshot tour to open a player panel: "options" or "advanced".
    var tourPanel: String?
    #endif
    /// Lets the screenshot tour show "Are You Still Watching?" without sitting through episodes.
    func tourAskStillWatching(_ ask: Bool) { asksStillWatching = ask }

    @ObservationIgnored private weak var model: AppModel?
    @ObservationIgnored private var resumeAt: Double?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var selectionObserver: NSObjectProtocol?
    @ObservationIgnored private var readyAt: Date?
    @ObservationIgnored private var lastReport = Date.distantPast
    @ObservationIgnored private var skippedSegments = Set<Double>()
    /// A film's scenes during or after its credits, and whether the viewer has been told.
    @ObservationIgnored private var creditsScenes: CreditsScenes?
    @ObservationIgnored private var creditsAlertShown = false
    @ObservationIgnored private var suggestionsOffered = false
    @ObservationIgnored private var countdownTask: Task<Void, Never>?
    @ObservationIgnored private var didStart = false
    /// Where to pick up after reloading a stream that failed mid-playback.
    @ObservationIgnored private var recoverAt: Double?
    @ObservationIgnored private var recoveries = 0
    @ObservationIgnored private var lastRecovery: Date?
    /// Set by `close()`: whatever was still waiting on the network must not bring the player back.
    @ObservationIgnored private var isClosed = false
    @ObservationIgnored private var isStopping = false
    /// Set while `switchEpisode` runs, so the up-next countdown, a skipped credits segment and the
    /// item's own end can't each start the same switch.
    @ObservationIgnored private var switchingEpisode = false
    /// The pending reconnect after a stream dropped mid-film.
    @ObservationIgnored private var recoveryTask: Task<Void, Never>?
    /// The skip segments, suggestions and Up Next lookups for the episode on screen.
    @ObservationIgnored private var extrasTask: Task<Void, Never>?
    /// Where the last skip is heading, so quick repeated skips add up instead of each counting from `currentTime`, which is up to half a second old.
    @ObservationIgnored private var pendingSeek: (target: Double, at: Date)?
    /// The viewer's audio and subtitle picks when a dropped stream reloads, so reconnecting doesn't undo them.
    @ObservationIgnored private var keptTracks: KeptTracks?
    /// The stream's own tracks are chosen for the current item (`applyTrackSelection` got that far).
    @ObservationIgnored private var tracksApplied = false
    /// The viewer picked a subtitle themselves, which a search still running for the automatic choice must not override.
    @ObservationIgnored private var subtitleChosenByViewer = false
    @ObservationIgnored private var legibleGroup: AVMediaSelectionGroup?

    private struct KeptTracks {
        var audio: String?
        var legible: String?
        var bitmap: Int?
    }
    @ObservationIgnored private let sessionID = UUID().uuidString
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var hlsToken: String?
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    @ObservationIgnored private var sleepTask: Task<Void, Never>?
    @ObservationIgnored private let nowPlaying = NowPlaying()
    @ObservationIgnored private var interruptionObserver: NSObjectProtocol?
    @ObservationIgnored private var remuxer: MatroskaRemuxer?
    /// Remux without Dolby Vision and Atmos signalling: set after the player turns the full version down.
    @ObservationIgnored private var remuxCompatible = false
    /// The loading screen's progress bar (Settings → Playback → Loading Screen).
    var showsLoadingProgress: Bool { model?.settings.playback.showLoadingProgress ?? true }
    /// The player's own error, for the error screen's details (domain and code say more than its wording).
    var failureDetail: String?
    @ObservationIgnored private var bitmapTask: Task<Void, Never>?
    /// Choosing the audio and subtitle tracks once the stream's are known.
    @ObservationIgnored private var trackTask: Task<Void, Never>?
    /// Japanese animation (see `TrackSelection.isAnime`); only looked up when Anime Audio is set.
    @ObservationIgnored private var isAnime = false
    /// Anime or not, by title, so each episode doesn't ask TMDb again.
    private static var animeTitles: [String: Bool] = [:]
    /// Picture subtitle ids sit above the stream's own options in `TrackSelection`'s numbering.
    private static let bitmapTrackBase = 10_000

    init(model: AppModel, request: PlaybackRequest, source: StreamSource, resumeAt: Double?, alternatives: [StreamSource] = []) {
        self.model = model
        self.alternatives = alternatives
        self.sources = ([source] + alternatives).filter { $0.location.playableURL != nil }
        self.request = request
        self.source = source
        self.resumeAt = resumeAt
        self.subtitleOffset = model.settings.subtitles.defaultOffsetSeconds
        self.logoPath = request.item.logoPath
        configureAudioSession()
        observeInterruptions()
        load(source)
        extrasTask = Task { [weak self] in await self?.loadExtras() }
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
                         artwork: request.item.smallBackdropURL ?? request.item.tmdbPosterURL,
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
        guard !isClosed else { return }
        guard let url = source.location.playableURL else {
            fail("This source can't be played directly.")
            return
        }
        loadTask?.cancel()
        recoveryTask?.cancel()
        // An analysis of the old stream's soundtrack says nothing about the new one's.
        autoSyncTask?.cancel()
        isAutoSyncing = false
        teardownObservers()
        releaseRemux()
        player.replaceCurrentItem(with: nil)
        releaseFinishedDownloads()
        usesRemux = false
        chapters = []
        chapterSegments = []
        readyAt = nil
        tracksApplied = false
        audibleGroup = nil
        legibleGroup = nil
        stopBitmapSubtitles()
        failureDetail = nil
        phase = .connecting(0.1)
        loadTask = Task { [weak self] in await self?.prepare(source, url: url) }
        trackTask?.cancel()
        trackTask = Task { [weak self] in await self?.applyTrackSelection() }
    }

    /// Picks the path for this stream: straight to AVPlayer, through the remuxer, or out to another app.
    private func prepare(_ source: StreamSource, url: URL) async {
        await resolveAnime()
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
            let languages = audioLanguages
            let remuxer = try await MatroskaRemuxer.open(reader ?? Self.byteSource(url, headers: headers),
                                                         preferredAudioLanguage: languages.first, fallbackAudioLanguages: Array(languages.dropFirst()),
                                                         headerCache: .shared, compatible: remuxCompatible,
                                                         dolbyVision: model?.settings.playback.neverUseDolbyVision != true,
                                                         convertProfile7: model?.settings.playback.convertDolbyVisionProfile7 ?? true)
            guard !Task.isCancelled else { return }
            if remuxer.video?.source.codecID == "V_AV1", !Platform.decodesAV1 {
                fail("This video is AV1, which this \(Platform.deviceKind) can't decode. Try another source.")
                return
            }
            let skippedAudio = remuxer.skipped.filter { $0.track.kind == .audio }
            if !remuxer.hasPlayableSoundtrack, let first = skippedAudio.first {
                fail("This file's audio is \(first.reason), which Apple devices can't decode. Try another source, or open it in VLC or Infuse.")
                return
            }
            if let boost = model?.settings.playback.volumeBoostDB, boost > 0 { await remuxer.setLoudnessBoost(boost) }
            let (hls, token) = try LocalHLSServer.shared.register(remuxer)
            guard !Task.isCancelled else { LocalHLSServer.shared.unregister(token); return }
            hlsToken = token
            usesRemux = true
            self.remuxer = remuxer
            #if os(iOS)
            scrubPreviewer = ScrubPreviewer(remuxer: remuxer)
            #endif
            configureBitmapSubtitles(remuxer)
            chapters = remuxer.header.chapters.map { PlayerChapter(title: $0.title, start: Double($0.start) / 1e9) }
            // Chapters named "Opening" or "Ending" stand in when no skip service knows this episode.
            chapterSegments = SkipSegmentResolver.fromChapters(chapters.map { ($0.title, $0.start) }, duration: remuxer.duration)
            if segments.isEmpty { segments = chapterSegments }
            if let first = skippedAudio.first(where: { !$0.track.isCommentary }), let playing = remuxer.audio.first {
                show(notice: "\(first.reason) can't play on Apple devices. Playing \(playing.label) instead.")
            }
            phase = .connecting(0.35)
            attach(AVURLAsset(url: hls))
        } catch let error as MatroskaError {
            // A load that was replaced while this one opened must not report its failure over the new one.
            guard !Task.isCancelled else { return }
            switch error {
            case .unsupported(let what):
                fail("This file uses \(what), which Apple devices can't play. Try another source, or open it in VLC or Infuse.")
            default:
                fail(error.localizedDescription)
            }
        } catch {
            guard !Task.isCancelled else { return }
            fail("Couldn't open this file. \(error.localizedDescription)")
        }
    }

    private func attach(_ asset: AVURLAsset) {
        itemGeneration += 1
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = usesRemux ? 20 : 10
        applyMetadata(to: item)
        applyChapters(to: item)
        applyLanguagePreferences()
        if let settings = model?.settings.subtitles { item.textStyleRules = Self.textStyleRules(settings) }
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
        selectionObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.mediaSelectionDidChangeNotification, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.mediaSelectionChanged(item) }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.didFinish() }
        }
        beginNowPlaying()
        // With a saved position and "Ask Before Resuming", wait for the viewer's choice.
        if !(resumeAt != nil && model?.settings.playback.askToResume == true) { player.play() }
    }

    /// The viewer's audio languages, for streams that carry several (HLS renditions, multi-track MP4s and
    /// remuxed MKVs). The subtitle is chosen once the stream's tracks are known (`applyTrackSelection`).
    private func applyLanguagePreferences() {
        let languages = audioLanguages
        guard !languages.isEmpty else { return }
        player.setMediaSelectionCriteria(AVPlayerMediaSelectionCriteria(preferredLanguages: languages, preferredMediaCharacteristics: nil),
                                         forMediaCharacteristic: .audible)
    }

    // MARK: Remembered tracks

    /// Shows remember the languages picked while watching them; films don't.
    private var showKey: String? {
        guard request.episode != nil, model?.settings.playback.rememberTracksPerShow == true else { return nil }
        return request.item.id
    }

    private var showChoice: ShowTrackChoice? { showKey.flatMap { model?.settings.playback.showTracks[$0] } }

    /// The show's choice, then Settings, then the device's language: a multi-language release often marks
    /// its dub as the default track, and an English speaker shouldn't land in French.
    private var audioLanguages: [String] {
        guard let model else { return [] }
        return TrackSelection.audioLanguages(playback: model.settings.playback, isAnime: isAnime, showChoice: showChoice,
                                             deviceLanguage: Locale.current.language.languageCode?.identifier)
    }

    private func resolveAnime() async {
        guard let model, model.settings.playback.animeAudio != .noPreference else { isAnime = false; return }
        let item = request.item
        if let known = Self.animeTitles[item.id] { isAnime = known; return }
        var genres = item.genres.map(\.id)
        var language = item.originalLanguage
        // A poster from a library or a search can lack these; the detail page's data is usually cached already.
        if genres.isEmpty || language == nil, let id = item.ids.tmdb, let detail = try? await model.catalog?.details(item.type, id: id) {
            genres = detail.item.genres.map(\.id)
            language = detail.item.originalLanguage
        }
        isAnime = TrackSelection.isAnime(genreIDs: genres, originalLanguage: language)
        if !genres.isEmpty, language != nil { Self.animeTitles[item.id] = isAnime }
    }

    private func remember(_ update: (inout ShowTrackChoice) -> Void) {
        guard let model, let key = showKey, didStart else { return }
        var choice = model.settings.playback.showTracks[key] ?? ShowTrackChoice()
        update(&choice)
        guard model.settings.playback.showTracks[key] != choice else { return }
        model.settings.playback.showTracks[key] = choice
    }

    /// Track changes from any menu (Flow's, or the system player's on Apple TV and Mac). Ignores
    /// the automatic choices AVPlayer makes while the stream starts.
    private func mediaSelectionChanged(_ item: AVPlayerItem) {
        guard didStart, let readyAt, Date().timeIntervalSince(readyAt) > 3, item === player.currentItem, !replayingWithSubtitles else { return }
        Task { [weak self] in
            let audible = try? await item.asset.loadMediaSelectionGroup(for: .audible)
            let legible = try? await item.asset.loadMediaSelectionGroup(for: .legible)
            guard let self, self.player.currentItem === item else { return }
            let audio = audible.flatMap { item.currentMediaSelection.selectedMediaOption(in: $0) }?.extendedLanguageTag
            var subtitle: AVMediaSelectionOption?
            if let legible { subtitle = item.currentMediaSelection.selectedMediaOption(in: legible) }
            if subtitle?.hasMediaCharacteristic(.containsOnlyForcedSubtitles) == true { subtitle = nil }
            let hasBitmap = self.selectedBitmapTrack != nil
            let hasDownloaded = self.subtitleTrack != nil
            self.remember { choice in
                if let audio { choice.audioLanguage = audio }
                guard legible != nil else { return }
                if let subtitle {
                    choice.subtitleLanguage = subtitle.extendedLanguageTag
                    choice.subtitlesOff = false
                } else if !hasBitmap, !hasDownloaded {
                    choice.subtitleLanguage = nil
                    choice.subtitlesOff = true
                }
            }
        }
    }

    /// The viewer's subtitle font, size, colour, edge and background for subtitles inside the stream
    /// (WebVTT and MKV text tracks), matching the ones Flow draws. Untouched defaults leave the system
    /// caption style alone.
    static func textStyleRules(_ s: SubtitleSettings) -> [AVTextStyleRule]? {
        var attributes: [String: Any] = [:]
        if s.fontScale != 1 { attributes[kCMTextMarkupAttribute_RelativeFontSize as String] = s.fontScale * 100 }
        let rgb: [Double]? = switch s.color {
        case .white: nil
        case .yellow: [1, 0.84, 0.04]
        case .cyan: [0.35, 0.78, 0.98]
        case .green: [0.2, 0.78, 0.35]
        }
        if let rgb { attributes[kCMTextMarkupAttribute_ForegroundColorARGB as String] = [1] + rgb }
        // Captions have generic families for serif and monospaced; the other two ask for a family by name.
        switch s.font {
        case .system: break
        case .serif: attributes[kCMTextMarkupAttribute_GenericFontFamilyName as String] = kCMTextMarkupGenericFontName_Serif as String
        case .monospaced: attributes[kCMTextMarkupAttribute_GenericFontFamilyName as String] = kCMTextMarkupGenericFontName_Monospace as String
        case .rounded: attributes[kCMTextMarkupAttribute_FontFamilyName as String] = "Arial Rounded MT Bold"
        case .condensed: attributes[kCMTextMarkupAttribute_FontFamilyName as String] = "Avenir Next Condensed"
        }
        if s.weight == .bold || s.weight == .heavy { attributes[kCMTextMarkupAttribute_BoldStyle as String] = true }
        let edge: CFString? = switch s.edgeStyle {
        case .dropShadow: nil
        case .none: kCMTextMarkupCharacterEdgeStyle_None
        case .raised: kCMTextMarkupCharacterEdgeStyle_Raised
        case .depressed: kCMTextMarkupCharacterEdgeStyle_Depressed
        case .outline: kCMTextMarkupCharacterEdgeStyle_Uniform
        }
        if let edge { attributes[kCMTextMarkupAttribute_CharacterEdgeStyle as String] = edge as String }
        if s.background.drawsBox {
            attributes[kCMTextMarkupAttribute_CharacterBackgroundColorARGB as String] = [min(max(s.backgroundOpacity, 0), 1), 0, 0, 0]
        }
        guard !attributes.isEmpty, let rule = AVTextStyleRule(textMarkupAttributes: attributes) else { return nil }
        return [rule]
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
            // The last half minute fades out rather than cutting off mid-line.
            let fade = 30.0
            try? await Task.sleep(nanoseconds: UInt64((Double(minutes) * 60 - fade) * 1_000_000_000))
            guard !Task.isCancelled, let self else { return }
            let volume = self.player.volume
            for step in 1...30 {
                try? await Task.sleep(nanoseconds: UInt64(fade / 30 * 1_000_000_000))
                guard !Task.isCancelled else { self.player.volume = volume; return }
                self.player.volume = volume * Float(30 - step) / 30
            }
            self.player.pause()
            self.player.volume = volume
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
        remuxCompatible = false
        keptTracks = nil
        show(notice: "That source didn't work, so Flow is trying \(next.providerName)\(next.traits.resolution == .unknown ? "" : " " + next.traits.resolution.label).")
        load(next)
    }

    /// Hands the current stream to the external player from Settings; false if none is set or installed.
    @discardableResult
    func handOffToExternalPlayer(_ url: URL? = nil) -> Bool {
        guard let model, let stream = url ?? source.location.playableURL else { return false }
        let player = model.settings.playback.externalPlayer
        guard player != .none, Platform.externalPlayers.contains(player),
              let launch = player.launchURL(for: stream, position: currentTime > 30 ? currentTime : resumeAt, filename: source.filename) else { return false }
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
        #if os(iOS)
        scrubPreviewer = nil
        #endif
    }

    // MARK: Picture subtitles

    /// Lists the disc subtitles for the menu; `applyTrackSelection` decides whether one shows.
    private func configureBitmapSubtitles(_ remuxer: MatroskaRemuxer) {
        bitmapTracks = remuxer.bitmapSubtitles.map { track in
            var title = track.label
            if track.source.isForced, !title.localizedCaseInsensitiveContains("forced") { title += " (Forced)" }
            if track.source.isHearingImpaired { title += " (SDH)" }
            return PlayerTrack(id: track.id, title: title)
        }
    }

    /// The viewer's choice from a menu: shown, and remembered for the show.
    func selectBitmapSubtitle(_ id: Int?) {
        subtitleChosenByViewer = true
        showBitmapSubtitle(id)
        let language = remuxer?.bitmapSubtitles.first { $0.id == id }?.language
        remember { choice in
            choice.subtitleLanguage = language.map(LanguageName.bcp47)
            choice.subtitlesOff = language == nil
        }
    }

    private func showBitmapSubtitle(_ id: Int?) {
        selectedBitmapTrack = id
        bitmapSubtitle = nil
        bitmapTask?.cancel()
        guard let remuxer else { return }
        Task { await remuxer.selectBitmapSubtitle(id) }
        guard id != nil else { return }
        // Display shape, not coded size: DVD video is anamorphic (720×480 shown at 16:9).
        var videoSize = CGSize.zero
        var pixelAspect: CGFloat = 1
        if let v = remuxer.video?.source, v.width > 0, v.height > 0 {
            videoSize = CGSize(width: v.width, height: v.height)
            if let dw = v.displayWidth, let dh = v.displayHeight, dw > 0, dh > 0 {
                videoSize.width = CGFloat(v.height) * CGFloat(dw) / CGFloat(dh)
                pixelAspect = videoSize.width / CGFloat(v.width)
            }
        }
        let displaySize = videoSize, displayAspect = pixelAspect
        bitmapTask = Task { [weak self] in
            var shown: Double?
            while !Task.isCancelled {
                guard let self else { return }
                let time = self.player.currentTime().seconds
                let cue = time.isFinite ? await remuxer.bitmapSubtitle(at: time) : nil
                if cue?.start != shown {
                    shown = cue?.start
                    self.bitmapSubtitle = cue.map { BitmapOverlay(cue: $0, videoSize: displaySize, pixelAspect: displayAspect) }
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
        seek(to: chapter.start)
    }

    func seek(to seconds: Double) {
        noteInteraction()
        player.seek(to: CMTime(seconds: max(0, seconds), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
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
        let loading = request
        /// Another episode or closing makes what this one was still looking up moot.
        func isStale() -> Bool { Task.isCancelled || isClosed || request != loading }
        if logoPath == nil, let catalog = model.catalog { logoPath = await catalog.logo(for: loading.item) }
        let resolved = await SkipSegmentResolver.resolve(source: source, providers: model.skipProviders(), request: loading)
        guard !isStale() else { return }
        segments = resolved.isEmpty ? chapterSegments : resolved
        let playback = model.settings.playback
        if loading.episode == nil, loading.item.type == .movie, playback.postCreditsAlert || playback.becauseYouWatched, let id = loading.item.ids.tmdb,
           let detail = try? await model.catalog?.details(.movie, id: id) {
            guard !isStale() else { return }
            if playback.postCreditsAlert { creditsScenes = detail.creditsScenes }
            if playback.becauseYouWatched {
                var seen: Set<String> = [loading.item.id]
                if let collection = detail.collection, let parts = try? await model.catalog?.collection(collection.id),
                   let next = parts.part(after: detail.item), !model.isWatched(next) {
                    nextInCollection = next
                }
                suggestions = ([nextInCollection].compactMap { $0 } + detail.recommendations + detail.similar)
                    .filter { $0.backdropPath != nil && !model.isWatched($0) && seen.insert($0.id).inserted }
                    .prefix(8).map { $0 }
            }
        }
        if let episode = loading.episode, let showID = loading.item.ids.tmdb, seasonEpisodes.first?.season != episode.season {
            let season = (try? await model.catalog?.tmdb.season(showID: showID, season: episode.season)) ?? []
            guard !isStale() else { return }
            seasonEpisodes = season
        }
        let next = await model.nextRequest(after: loading)
        guard !isStale() else { return }
        upNext = next
    }

    /// Picks the audio and subtitle from the tracks the stream carries (`TrackSelection` has the rules).
    /// Subtitles that come with the stream beat a search: they're timed to this exact cut, so Flow
    /// looks online only when the rules ask for one the stream lacks.
    private func applyTrackSelection() async {
        guard let model else { return }
        // Opening an MKV takes a few seconds, so wait until the stream's tracks are known.
        var waited = 0
        while player.currentItem?.status != .readyToPlay, waited < 120 {
            switch phase { case .failed, .finished: return; default: break }
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            waited += 1
        }
        guard let item = player.currentItem, item.status == .readyToPlay else { return }
        let audible = try? await item.asset.loadMediaSelectionGroup(for: .audible)
        let legible = try? await item.asset.loadMediaSelectionGroup(for: .legible)
        guard !Task.isCancelled, item === player.currentItem else { return }

        let audioTracks = (audible?.options ?? []).enumerated().map { index, option in
            TrackSelection.AudioTrack(id: index, language: option.extendedLanguageTag ?? "und",
                                      // The rendition's name, not `displayName` (an HLS track's is only its language).
                                      isCommentary: option.hasMediaCharacteristic(.describesVideoForAccessibility) || option.title.localizedCaseInsensitiveContains("comment"),
                                      isDefault: option == audible?.defaultOption)
        }
        var subtitleTracks = (legible?.options ?? []).enumerated().map { index, option in
            TrackSelection.SubtitleTrack(id: index, language: option.extendedLanguageTag ?? "und",
                                         isForced: option.hasMediaCharacteristic(.containsOnlyForcedSubtitles),
                                         isSDH: option.hasMediaCharacteristic(.describesMusicAndSoundForAccessibility) || option.hasMediaCharacteristic(.transcribesSpokenDialogForAccessibility))
        }
        for track in remuxer?.bitmapSubtitles ?? [] where !track.source.isCommentary {
            subtitleTracks.append(TrackSelection.SubtitleTrack(id: Self.bitmapTrackBase + track.id, language: track.language,
                                                               isForced: track.source.isForced, isSDH: track.source.isHearingImpaired))
        }
        let decision = TrackSelection.decide(audio: audioTracks, subtitles: subtitleTracks, playback: model.settings.playback, subtitleSettings: model.settings.subtitles,
                                             isAnime: isAnime, showChoice: showChoice, deviceLanguage: Locale.current.language.languageCode?.identifier)

        // The same stream reloading after a drop: the viewer's own picks stand, not the rules' choice.
        if let kept = keptTracks {
            keptTracks = nil
            restore(kept, in: item, audible: audible, legible: legible)
            tracksApplied = true
            itemGeneration += 1
            return
        }
        if let audible, let id = decision.audio, audible.options.indices.contains(id),
           item.currentMediaSelection.selectedMediaOption(in: audible) != audible.options[id] {
            item.select(audible.options[id], in: audible)
        }
        tracksApplied = true
        // A downloaded subtitle stays through a source switch.
        guard subtitle == nil else { return }
        func clearStreamSubtitle() {
            if let legible, legible.allowsEmptySelection { item.select(nil, in: legible) }
        }
        switch decision.subtitle {
        case .off:
            clearStreamSubtitle()
            if selectedBitmapTrack != nil { showBitmapSubtitle(nil) }
        case .track(let id) where id >= Self.bitmapTrackBase:
            clearStreamSubtitle()
            showBitmapSubtitle(id - Self.bitmapTrackBase)
        case .track(let id):
            if selectedBitmapTrack != nil { showBitmapSubtitle(nil) }
            if let legible, legible.options.indices.contains(id) { item.select(legible.options[id], in: legible) }
        case .search(let languages):
            clearStreamSubtitle()
            subtitleChosenByViewer = false
            // Tell the menus the tracks changed before the search, which can take a while.
            itemGeneration += 1
            let tracks = await SubtitleSearch.search(model.subtitleProviders(), request: request, languages: languages,
                                                     hearingImpaired: model.settings.subtitles.subtitleType == .sdh)
            // Everything was switched off before the search, so whatever shows now is the viewer's own pick.
            let embeddedShowing = legible.flatMap { item.currentMediaSelection.selectedMediaOption(in: $0) } != nil
            guard !Task.isCancelled, item === player.currentItem, !subtitleChosenByViewer, subtitle == nil, selectedBitmapTrack == nil,
                  !embeddedShowing, let first = tracks.first else { return }
            await selectSubtitle(first, automatic: true)
            return
        }
        itemGeneration += 1
    }

    /// Puts back the audio and subtitle the viewer had on, by the rendition names the playlist gave them.
    private func restore(_ kept: KeptTracks, in item: AVPlayerItem, audible: AVMediaSelectionGroup?, legible: AVMediaSelectionGroup?) {
        if let audible, let name = kept.audio, let option = audible.options.first(where: { $0.title == name }) {
            item.select(option, in: audible)
        }
        if let legible {
            if let name = kept.legible, let option = legible.options.first(where: { $0.title == name }) {
                item.select(option, in: legible)
            } else if kept.legible == nil, legible.allowsEmptySelection {
                // Off (or a downloaded or picture subtitle instead): the stream's own stays off.
                item.select(nil, in: legible)
            }
        }
        if let bitmap = kept.bitmap { showBitmapSubtitle(bitmap) }
    }

    // MARK: Observers

    private func itemStatusChanged(_ item: AVPlayerItem) {
        // A report queued by an item that has since been replaced says nothing about the one playing now.
        guard item === player.currentItem else { return }
        ScreenshotTour.log("item status \(item.status.rawValue) error=\(item.error?.localizedDescription ?? "-")")
        switch item.status {
        case .readyToPlay:
            Task { [weak self] in
                let audible = try? await item.asset.loadMediaSelectionGroup(for: .audible)
                let legible = try? await item.asset.loadMediaSelectionGroup(for: .legible)
                guard let self, self.player.currentItem === item else { return }
                self.audibleGroup = audible
                self.legibleGroup = legible
            }
            if readyAt == nil { readyAt = Date() }
            if case .connecting = phase { phase = .connecting(0.7) }
            let seconds = item.duration.seconds
            if seconds.isFinite { duration = seconds }
            if let recoverAt {
                self.recoverAt = nil
                player.seek(to: CMTime(seconds: recoverAt, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600))
            }
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
            failureDetail = Self.detail(item.error)
            ScreenshotTour.log("item failed: \(failureDetail ?? "")")
            // Some devices turn down a stream's Dolby Vision or Atmos signalling; the HDR10 picture and
            // 5.1 bed underneath still play, so try that once before giving up.
            if !didStart, usesRemux, !remuxCompatible, let remuxer,
               remuxer.video?.source.dolbyVision != nil || remuxer.audio.contains(where: \.isAtmos) {
                remuxCompatible = true
                load(source)
                return
            }
            // A dropped connection mid-film: reconnect where it stopped, a couple of times, before giving up.
            // Drops far apart in a long film are separate bad moments, not a dead stream: each gets its own tries.
            if let lastRecovery, Date().timeIntervalSince(lastRecovery) > 600 { recoveries = 0 }
            if didStart, recoveries < 2 {
                recoveries += 1
                lastRecovery = Date()
                show(notice: "Connection lost. Reconnecting…")
                recoveryTask?.cancel()
                recoveryTask = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    // Closed, or the viewer switched source, in the meantime.
                    guard !Task.isCancelled else { return }
                    self?.retry()
                }
                return
            }
            fail(Self.describe(item.error))
        default: break
        }
    }

    private func bufferChanged(_ item: AVPlayerItem) {
        guard item === player.currentItem, case .connecting(let p) = phase, let range = item.loadedTimeRanges.first?.timeRangeValue else { return }
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
            // Stopping pauses first and then reports its own stop; a pause report would only race it.
            guard didStart, phase == .playing, !isStopping else { return }
            // Someone's there, unless it's the episode ending or the still-watching question itself.
            if !asksStillWatching { stillWatching.notePause(at: currentTime, duration: duration) }
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
        if !playedLongEnough, seconds >= 60 { playedLongEnough = true }
        if duration <= 0, let d = player.currentItem?.duration.seconds, d.isFinite { duration = d }
        updateSegment(seconds)
        alertCreditsScenes(seconds)
        offerSuggestions(seconds)
        if Date().timeIntervalSince(lastReport) > 10 {
            lastReport = Date()
            Task { await report(.progress) }
            nowPlaying.update(elapsed: seconds, duration: duration, rate: player.rate)
        }
        maybeStartUpNextCountdown()
    }

    /// As a film's credits begin (from its credits segment, or its last six percent), says to stay
    /// when there's a scene during or after them.
    private func alertCreditsScenes(_ time: Double) {
        guard !creditsAlertShown, let alert = creditsScenes?.alert, duration > 3600 * 0.5 else { return }
        let creditsStart = segments.first { $0.kind == .credits }?.start ?? duration * 0.94
        guard time >= creditsStart, time < duration - 10 else { return }
        creditsAlertShown = true
        show(notice: alert)
    }

    /// Shows "Because You Watched" as a film's credits begin, unless there's a scene to stay for.
    private func offerSuggestions(_ time: Double) {
        guard !suggestions.isEmpty, creditsScenes?.any != true, duration > 3600 * 0.5, phase == .playing else { return }
        let creditsStart = segments.first { $0.kind == .credits }?.start ?? max(duration * 0.96, duration - 180)
        if time < creditsStart {
            // Seeking back out of the credits takes the card away, and lets it come back.
            showsSuggestions = false
            suggestionsOffered = false
        } else if !suggestionsOffered, time < duration - 5 {
            suggestionsOffered = true
            showsSuggestions = true
        }
    }

    /// Stops the credits and goes straight to the end screen's suggestions (tvOS offers this from the transport bar).
    func endWithSuggestions() {
        guard !suggestions.isEmpty, phase == .playing else { return }
        player.pause()
        countdownTask?.cancel()
        phase = .finished
        showsSuggestions = true
        Task { await finishCurrent(completed: false) }
    }

    /// Hides the suggestions; over the end screen, that closes the player.
    func dismissSuggestions() {
        showsSuggestions = false
        if phase == .finished { close() }
    }

    /// Leaves the player for a suggested film's page.
    func openSuggestion(_ item: MediaItem) {
        let model = model
        showsSuggestions = false
        if phase == .finished { close() } else { stop() }
        model?.navigate(to: .detail(item))
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
        // Credits hiding a scene are never skipped by themselves.
        case .credits: behaviour = creditsScenes?.any == true && model.settings.playback.skipCredits == .automatic ? .button : model.settings.playback.skipCredits
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
        // "End of episode" means this one: let the credits run out instead of starting the next.
        if segment.kind == .credits, upNext != nil, sleepTimer != .endOfItem, segment.end >= duration - 5 {
            Task { await playUpNext() }
        } else {
            player.seek(to: CMTime(seconds: segment.end, preferredTimescale: 600))
        }
    }

    // MARK: Up Next

    private func maybeStartUpNextCountdown() {
        guard let model, model.settings.playback.autoPlayNextEpisode, upNext != nil, sleepTimer != .endOfItem, !switchingEpisode, countdownTask == nil, duration > 60 else { return }
        // Count down as the credits start, or, when the viewer would rather see them, so it ends as the episode does.
        let creditsStart = model.settings.playback.upNextWaitsForEnd ? nil : segments.first { $0.kind == .credits }?.start
        let tail = model.settings.playback.upNextWaitsForEnd ? 1 : 20
        let threshold = creditsStart ?? (duration - Double(model.settings.playback.nextEpisodeCountdownSeconds) - Double(tail))
        guard currentTime >= threshold else { return }
        let total = model.settings.playback.nextEpisodeCountdownSeconds
        countdownTask = Task { [weak self] in
            for remaining in stride(from: total, through: 1, by: -1) {
                guard let self, !Task.isCancelled else { return }
                self.upNextCountdown = remaining
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
            guard let self, !Task.isCancelled else { return }
            await self.advanceAutomatically()
        }
    }

    /// Moves on to the next episode by itself, unless enough have played untouched that someone may have nodded off.
    private func advanceAutomatically() async {
        if stillWatching.shouldAsk(limit: model?.settings.playback.stillWatchingAfterEpisodes ?? 0) {
            asksStillWatching = true
            upNextCountdown = nil
            player.pause()
            return
        }
        stillWatching.noteAutomaticAdvance()
        await playUpNext()
    }

    /// "Continue Watching" on the still-watching question.
    func confirmStillWatching() {
        asksStillWatching = false
        stillWatching.noteInteraction()
        Task { await playUpNext() }
    }

    /// Anything the viewer does: a tap, a skip, a seek. Resets the count of episodes played untouched.
    func noteInteraction() {
        stillWatching.noteInteraction()
    }

    // MARK: What did they say?

    /// "What did they say?": ten seconds back, with subtitles on until the moment it was asked.
    func replayWithSubtitles() {
        noteInteraction()
        let until = currentTime
        seek(to: until - 10)
        guard subtitle == nil, selectedBitmapTrack == nil, let item = player.currentItem else { return }
        // Forced subtitles (signs, foreign lines) don't count as subtitles being on; full ones do,
        // and then the seek alone is enough. Without this, disc subtitles were added on top.
        let current = legibleGroup.flatMap { item.currentMediaSelection.selectedMediaOption(in: $0) }
        if let current, !current.hasMediaCharacteristic(.containsOnlyForcedSubtitles) { return }
        let preferred = model.map { TrackSelection.subtitleLanguages($0.settings.subtitles) } ?? []
        let options = legibleGroup?.options.filter { !$0.hasMediaCharacteristic(.containsOnlyForcedSubtitles) } ?? []
        let pick = options.first { option in
            preferred.contains { option.extendedLanguageTag?.hasPrefix(LanguageName.bcp47($0)) == true }
        } ?? options.first
        if let group = legibleGroup, let pick {
            replayingWithSubtitles = true
            item.select(pick, in: group)
            revertReplay(at: until) { [weak self] in
                guard let self, self.player.currentItem === item,
                      item.currentMediaSelection.selectedMediaOption(in: group) == pick,
                      current != nil || group.allowsEmptySelection else { return }
                item.select(current, in: group)
            }
        } else if let first = bitmapTracks.first {
            showBitmapSubtitle(first.id)
            revertReplay(at: until) { [weak self] in
                guard let self, self.selectedBitmapTrack == first.id else { return }
                self.showBitmapSubtitle(nil)
            }
        } else {
            show(notice: "This video has no subtitles to show.")
        }
    }

    /// Turns the replay's subtitles off again once playback is a moment past where it was asked.
    private func revertReplay(at time: Double, revert: @escaping () -> Void) {
        replayTask?.cancel()
        replayTask = Task { [weak self] in
            // Twenty seconds at most, in case the viewer paused or jumped elsewhere.
            for _ in 0..<80 {
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard let self, !Task.isCancelled else { return }
                if self.currentTime >= time + 1 { break }
            }
            guard let self, !Task.isCancelled else { return }
            revert()
            // The selection change is reported a beat later; let it pass before remembering again.
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            self.replayingWithSubtitles = false
        }
    }

    func cancelUpNext() {
        countdownTask?.cancel()
        upNextCountdown = nil
        upNext = nil
    }

    func playUpNext() async {
        guard let next = upNext else { return }
        await switchEpisode(to: next, finished: true)
    }

    /// Plays another episode of this show from the player's episode list.
    func play(episode: Episode) async {
        guard episode.id != request.episode?.id else { return }
        await switchEpisode(to: PlaybackRequest(item: request.item, episode: episode, libraryProviderID: request.libraryProviderID), finished: false)
    }

    /// How many dB louder Dolby soundtracks can play here: the headroom their mix leaves. Zero when
    /// the stream isn't remuxed by Flow or has no Dolby audio, where boost can't apply.
    var volumeBoostHeadroom: Int {
        guard usesRemux, let remuxer else { return 0 }
        return remuxer.audio.compactMap(\.loudnessHeadroom).max() ?? 0
    }

    /// Sets the volume boost (remembered for next time) and reloads the stream where it is, so it's heard at once.
    func setVolumeBoost(_ dB: Int) {
        guard let model, model.settings.playback.volumeBoostDB != dB else { return }
        model.settings.playback.volumeBoostDB = dB
        guard usesRemux, let remuxer, let asset = player.currentItem?.asset as? AVURLAsset else { return }
        Task { [weak self] in
            await remuxer.setLoudnessBoost(dB)
            guard let self, !self.isClosed else { return }
            // Segments already buffered carry the old level; a fresh item at the same moment refetches them.
            let wasPlaying = self.isPlaying
            let chosen = await Self.selectedOptionNames(self.player.currentItem)
            // Another source or episode took over while the boost was applied; it loads with the new level itself.
            guard !self.isClosed, self.player.currentItem?.asset === asset else { return }
            self.recoverAt = self.currentTime
            // The new item's automatic track choices aren't the viewer's.
            self.readyAt = nil
            self.teardownObservers()
            self.attach(AVURLAsset(url: asset.url))
            if !wasPlaying { self.player.pause() }
            // Keep the audio and subtitle tracks the viewer picked.
            guard let item = self.player.currentItem else { return }
            for (characteristic, name) in chosen {
                guard let group = try? await item.asset.loadMediaSelectionGroup(for: characteristic), item === self.player.currentItem else { continue }
                if let name {
                    if let option = group.options.first(where: { $0.title == name }) { item.select(option, in: group) }
                } else if group.allowsEmptySelection {
                    // Subtitles were off: the new item mustn't pick some on by itself.
                    item.select(nil, in: group)
                }
            }
        }
    }

    /// The rendition names of what's selected (nil when a group has nothing on). Names, not `displayName`:
    /// an HLS stream's several English soundtracks all display as "English".
    private static func selectedOptionNames(_ item: AVPlayerItem?) async -> [(AVMediaCharacteristic, String?)] {
        guard let item else { return [] }
        var names: [(AVMediaCharacteristic, String?)] = []
        for characteristic in [AVMediaCharacteristic.audible, .legible] {
            if let group = try? await item.asset.loadMediaSelectionGroup(for: characteristic) {
                names.append((characteristic, item.currentMediaSelection.selectedMediaOption(in: group)?.title))
            }
        }
        return names
    }

    /// Switches to another source of the same title, carrying on from the same moment.
    func switchSource(to next: StreamSource) {
        guard next.id != source.id else { return }
        if didStart, currentTime > 1 { recoverAt = currentTime }
        alternatives = sources.filter { $0.id != next.id }
        source = next
        remuxCompatible = false
        recoveries = 0
        keptTracks = nil
        show(notice: "Switching to \(next.providerName)…")
        load(next)
    }

    /// Records this episode and moves to `next` on a source like the current one, or back to the picker.
    private func switchEpisode(to next: PlaybackRequest, finished: Bool) async {
        guard let model, !switchingEpisode, !isClosed else { return }
        switchingEpisode = true
        defer { switchingEpisode = false }
        var next = next
        // Up Next and the episode list build their requests from the show alone.
        next.libraryProviderID = next.libraryProviderID ?? request.libraryProviderID
        countdownTask?.cancel()
        countdownTask = nil
        upNextCountdown = nil
        await finishCurrent(completed: finished)
        guard !isClosed else { return }
        if let source = await model.matchingSource(for: next, like: source) {
            // The viewer left while a source was being found.
            guard !isClosed else { return }
            extrasTask?.cancel()
            request = next
            self.source = source
            alternatives = []
            sources = [source]
            remuxCompatible = false
            upNext = nil
            didStart = false
            skippedSegments = []
            segments = []
            activeSegment = nil
            // Nothing of the last episode carries over: its subtitle and its timing belong to its own file.
            subtitle = nil
            subtitleTrack = nil
            subtitleOffset = model.settings.subtitles.defaultOffsetSeconds
            resumePrompt = nil
            resumeAt = nil
            keptTracks = nil
            currentTime = 0
            playedLongEnough = false
            recoverAt = nil
            recoveries = 0
            duration = 0
            load(source)
            extrasTask = Task { [weak self] in await self?.loadExtras() }
        } else {
            close()
            model.sourcePickerRequest = next
        }
    }

    // MARK: Details

    struct InfoRow: Identifiable, Hashable {
        let label: String
        let value: String
        var id: String { label }
    }

    /// What's playing and how: for the curious, and for working out why a file misbehaves.
    func infoRows() -> [InfoRow] {
        var rows = [InfoRow(label: "Source", value: source.providerName)]
        if let file = source.filename ?? source.location.playableURL?.lastPathComponent, !file.isEmpty {
            rows.append(InfoRow(label: "File", value: file))
        }
        let item = player.currentItem
        if usesRemux, let remuxer {
            rows.append(InfoRow(label: "Playback", value: "MKV, remuxed on this device"))
            if let video = remuxer.videoSummary { rows.append(InfoRow(label: "Video", value: video)) }
        } else {
            let isHLS = source.location.playableURL?.pathExtension.lowercased() == "m3u8"
            rows.append(InfoRow(label: "Playback", value: isHLS ? "HLS stream" : "Direct"))
            if let size = item?.presentationSize, size.width > 0 {
                rows.append(InfoRow(label: "Video", value: "\(Int(size.width))×\(Int(size.height))"))
            }
        }
        if let item, let group = audibleGroup, let option = item.currentMediaSelection.selectedMediaOption(in: group) {
            rows.append(InfoRow(label: "Audio", value: option.title))
        }
        if let remuxer, !remuxer.decodedSummary.isEmpty {
            rows.append(InfoRow(label: "Decoded", value: remuxer.decodedSummary.joined(separator: ", ") + " → lossless FLAC, on this device"))
        }
        if let remuxer, !remuxer.skippedSummary.isEmpty {
            rows.append(InfoRow(label: "Not Playable", value: remuxer.skippedSummary.joined(separator: ", ")))
        }
        if let event = item?.accessLog()?.events.last {
            if event.indicatedBitrate > 0 {
                rows.append(InfoRow(label: "Bitrate", value: Self.megabits(event.indicatedBitrate)))
            }
            // A remuxed stream arrives over loopback, where throughput means nothing.
            if !usesRemux, event.observedBitrate > 0 {
                rows.append(InfoRow(label: "Throughput", value: Self.megabits(event.observedBitrate)))
            }
            if event.numberOfDroppedVideoFrames > 0 {
                rows.append(InfoRow(label: "Dropped Frames", value: "\(event.numberOfDroppedVideoFrames)"))
            }
        }
        if let range = item?.loadedTimeRanges.map(\.timeRangeValue).first(where: { $0.containsTime(player.currentTime()) }) {
            let ahead = max(0, range.end.seconds - player.currentTime().seconds)
            rows.append(InfoRow(label: "Buffered", value: String(format: "%.0f s ahead", ahead)))
        }
        return rows
    }

    private static func megabits(_ bitsPerSecond: Double) -> String {
        String(format: bitsPerSecond >= 10_000_000 ? "%.0f Mb/s" : "%.1f Mb/s", bitsPerSecond / 1_000_000)
    }

    // MARK: Subtitles

    /// `automatic` is Flow's own choice from the rules; otherwise the viewer's.
    func selectSubtitle(_ track: SubtitleTrackInfo?, automatic: Bool = false) async {
        guard let model else { return }
        if !automatic { subtitleChosenByViewer = true }
        guard let track else {
            subtitle = nil; subtitleTrack = nil
            if selectedBitmapTrack == nil { remember { $0.subtitleLanguage = nil; $0.subtitlesOff = true } }
            return
        }
        remember { $0.subtitleLanguage = LanguageName.bcp47(track.language); $0.subtitlesOff = false }
        let provider = model.subtitleProviders().first { $0.name == track.provider }
        let loading = request
        do {
            guard let document = try await provider?.download(track) else { return }
            // The viewer moved to another episode, or left, while it downloaded.
            guard !isClosed, request == loading else { return }
            subtitle = document
            subtitleTrack = track
            // A delay worked out for the last file doesn't fit this one.
            subtitleOffset = model.settings.subtitles.defaultOffsetSeconds
            await turnOffStreamSubtitles()
        } catch {
            model.showToast("Couldn't load subtitles: \(error.localizedDescription)")
        }
    }

    /// Only one kind of subtitle shows at a time: a downloaded one replaces the stream's own and the disc's pictures.
    private func turnOffStreamSubtitles() async {
        if selectedBitmapTrack != nil { showBitmapSubtitle(nil) }
        guard let item = player.currentItem, let group = try? await item.asset.loadMediaSelectionGroup(for: .legible),
              item === player.currentItem, group.allowsEmptySelection,
              item.currentMediaSelection.selectedMediaOption(in: group) != nil else { return }
        item.select(nil, in: group)
        // The options panel reads the selection again.
        itemGeneration += 1
    }

    // MARK: Subtitle auto-sync

    /// True while the soundtrack is being analysed.
    private(set) var isAutoSyncing = false
    /// Set once a minute has played, so the action doesn't appear before there's dialogue to listen to.
    private(set) var playedLongEnough = false
    @ObservationIgnored private var autoSyncTask: Task<Void, Never>?

    /// Subtitles Flow loaded itself, on a film Flow remuxes (so it can read the audio), once a minute has played.
    var canAutoSync: Bool {
        (model?.settings.subtitles.autoSync ?? false) && usesRemux && remuxer != nil && subtitle != nil && playedLongEnough
    }

    /// Listens to about three minutes of the soundtrack around the playhead and moves the subtitles to fit.
    func autoSyncSubtitles() {
        guard canAutoSync, !isAutoSyncing, let remuxer, let subtitle else { return }
        // The rendition being heard, by the name the HLS playlist gave it.
        var track = remuxer.audio.first { !$0.source.isCommentary } ?? remuxer.audio.first
        if let group = audibleGroup, let option = player.currentItem?.currentMediaSelection.selectedMediaOption(in: group),
           let playing = remuxer.audio.first(where: { $0.label == option.title }) {
            track = playing
        }
        // Reading a decoded track's segments out of turn would reset the decoder the player is
        // listening through; another track has the same timing and is safe to read.
        if track?.isDecodedOnDevice == true, let other = remuxer.audio.first(where: { !$0.isDecodedOnDevice && !$0.source.isCommentary }) {
            track = other
        }
        guard let track, !track.isDecodedOnDevice else {
            show(notice: "Auto-sync can't read this soundtrack yet.")
            return
        }
        let position = currentTime, previous = subtitleOffset, loaded = subtitleTrack?.id
        isAutoSyncing = true
        show(notice: "Syncing subtitles…")
        autoSyncTask = Task { [weak self] in
            let outcome = await SubtitleAutoSync.analyse(remuxer: remuxer, track: track, around: position, subtitle: subtitle)
            guard let self, !Task.isCancelled else { return }
            isAutoSyncing = false
            // Picking other subtitles meanwhile makes the answer moot.
            guard subtitleTrack?.id == loaded else { return }
            switch outcome {
            case .matched(let offset, _):
                let change = offset - previous
                subtitleOffset = offset
                show(notice: abs(change) < 0.05 ? "Subtitles already line up"
                     : String(format: "Subtitles moved %.1f s %@", abs(change), change > 0 ? "later" : "earlier"))
            case .noMatch:
                show(notice: "Couldn't find a confident match")
            case .unreadable:
                show(notice: "Couldn't read this soundtrack")
            }
        }
    }

    // MARK: Finishing

    private func report(_ state: PlaybackReport.State) async {
        guard let model, !model.settings.mediaServers.trackOnlyWithTracker, source.category == .mediaServers, let server = model.mediaServers.first(where: { $0.config.id == source.providerID }) else { return }
        await server.report(PlaybackReport(state: state, source: source, positionSeconds: currentTime, durationSeconds: duration > 0 ? duration : nil, sessionID: sessionID))
    }

    /// Resume only when the position is known to be well before the end of this stream.
    nonisolated static func shouldResume(at position: Double, duration: Double) -> Bool {
        guard position > 0 else { return false }
        guard duration.isFinite, duration > 0 else { return true }
        return position < duration - 30
    }

    private func didFinish() async {
        // The countdown or a skipped credits segment is already moving on to the next episode (the stream
        // can end while it looks for a source); a second switch would record this episode twice.
        guard !isClosed, !switchingEpisode else { return }
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
            await advanceAutomatically()
        } else if upNext == nil, !suggestions.isEmpty {
            // End on "Because You Watched" rather than dropping back to where the film was started.
            await finishCurrent(completed: true)
            showsSuggestions = true
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
        if completed, request.episode != nil { finishedDownloads.append(request) }
        didStart = false
    }

    /// Stops playback, records progress, and dismisses the player.
    func stop() {
        guard !isClosed, !isStopping else { return }
        isStopping = true
        let wasPlaying = didStart
        player.pause()
        Task {
            if wasPlaying { await finishCurrent(completed: false) }
            close()
        }
    }

    private func close(_ caller: String = #function) {
        ScreenshotTour.log("PlaybackSession.close from \(caller) phase=\(phase)")
        isClosed = true
        countdownTask?.cancel()
        loadTask?.cancel()
        recoveryTask?.cancel()
        extrasTask?.cancel()
        trackTask?.cancel()
        noticeTask?.cancel()
        sleepTask?.cancel()
        autoSyncTask?.cancel()
        nowPlaying.end()
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
        interruptionObserver = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        teardownObservers()
        releaseRemux()
        stopBitmapSubtitles()
        releaseFinishedDownloads()
        if model?.activePlayback?.id == id { model?.activePlayback = nil }
    }

    /// Smart Downloads may delete these files, so only once nothing plays from them any more.
    private func releaseFinishedDownloads() {
        guard let model, !finishedDownloads.isEmpty else { return }
        let finished = finishedDownloads
        finishedDownloads = []
        Task { for request in finished { await model.downloadedEpisodeFinished(request) } }
    }

    private func teardownObservers() {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
        observations.forEach { $0.invalidate() }
        observations = []
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        if let selectionObserver { NotificationCenter.default.removeObserver(selectionObserver) }
        selectionObserver = nil
    }

    /// Reloads the stream, continuing from the current position if playback had started.
    func retry() {
        guard !isClosed else { return }
        if didStart, currentTime > 1 {
            recoverAt = currentTime
            // Reloading the same stream mustn't undo the audio and subtitle the viewer picked.
            if tracksApplied, let item = player.currentItem, audibleGroup != nil || legibleGroup != nil {
                keptTracks = KeptTracks(audio: audibleGroup.flatMap { item.currentMediaSelection.selectedMediaOption(in: $0) }?.title,
                                        legible: legibleGroup.flatMap { item.currentMediaSelection.selectedMediaOption(in: $0) }?.title,
                                        bitmap: selectedBitmapTrack)
            }
        }
        load(source)
    }

    /// "AVFoundationErrorDomain −11829 · CoreMediaErrorDomain −12927": what to quote when reporting a stream that won't play.
    static func detail(_ error: Error?) -> String? {
        guard let error = error as NSError? else { return nil }
        var parts = ["\(error.domain) \(error.code)"]
        if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
            parts.append("\(underlying.domain) \(underlying.code)")
        }
        return parts.joined(separator: " · ")
    }

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

    /// Twelve-odd seconds of the soundtrack from the playhead, as an MP4, when Flow is remuxing the file itself.
    func soundtrackClip() async -> [UInt8]? {
        guard let remuxer else { return nil }
        return try? await remuxer.audioClip(at: currentTime)
    }

    /// The stream's address, when AVFoundation can read its soundtrack directly: a plain file, not HLS.
    var directSoundtrack: (url: URL, headers: [String: String])? {
        guard !usesRemux, let url = source.location.playableURL else { return nil }
        let address = url.absoluteString.lowercased()
        guard !address.contains(".m3u8"), !address.contains("/hls/"), url.pathExtension.lowercased() != "m3u" else { return nil }
        return (url, source.location.headers)
    }

    func togglePlay() {
        guard phase != .finished else { return }
        noteInteraction()
        if isPlaying { player.pause() } else { player.play() }
    }

    func seek(by seconds: Double) {
        noteInteraction()
        // A skip tapped again before the first one lands starts from where that was heading.
        let base = pendingSeek.flatMap { Date().timeIntervalSince($0.at) < 2 ? $0.target : nil } ?? currentTime
        let target = max(0, min(duration > 0 ? duration : .greatestFiniteMagnitude, base + seconds))
        pendingSeek = (target, Date())
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
    /// The video's display size.
    let videoSize: CGSize
    /// Display width over coded width: above 1 for anamorphic video, whose subtitle canvas is
    /// stretched sideways along with the picture.
    let pixelAspect: CGFloat
    let pieces: [Piece]

    init(cue: BitmapSubtitle, videoSize: CGSize, pixelAspect: CGFloat = 1) {
        start = cue.start
        canvas = CGSize(width: cue.canvasWidth, height: cue.canvasHeight)
        self.videoSize = videoSize
        self.pixelAspect = pixelAspect
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

extension AVMediaSelectionOption {
    /// The rendition's own name ("English (DTS 5.1)"). For HLS, `displayName` is only the language,
    /// so several English tracks would read alike.
    var title: String {
        AVMetadataItem.metadataItems(from: commonMetadata, filteredByIdentifier: .commonIdentifierTitle).first?.stringValue ?? displayName
    }
}
