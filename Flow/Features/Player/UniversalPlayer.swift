import Foundation
import QuartzCore
import Observation
import FlowKit
import Libmpv
#if os(iOS) || os(tvOS)
import UIKit
#else
import AppKit
#endif

// The built-in player: libmpv (FFmpeg inside) drawing on a Metal layer, for what Apple's player can't
// play (AVI, WMV, FLV, DVD and Ogg files; MPEG-2, VC-1, Xvid, VP8, VP9 and 10-bit H.264; audio AVPlayer
// can't decode). `PlaybackSession` drives it through the same calls it makes of AVPlayer.
//
// The setup follows MPVKit's own demo apps: gpu-next on Vulkan on MoltenVK, `wid` set to the layer.

/// mpv's picture goes on this layer. The two overrides are the demo's: MoltenVK sets the drawable size
/// to 1x1 to finish a presentation (flicker, and it can stay that small), and the extended dynamic range
/// switch only takes effect from the main thread.
final class MPVMetalLayer: CAMetalLayer {
    override var drawableSize: CGSize {
        get { super.drawableSize }
        set {
            if Int(newValue.width) > 1 && Int(newValue.height) > 1 { super.drawableSize = newValue }
        }
    }

    #if !os(tvOS)
    override var wantsExtendedDynamicRangeContent: Bool {
        get { super.wantsExtendedDynamicRangeContent }
        set {
            if Thread.isMainThread {
                super.wantsExtendedDynamicRangeContent = newValue
            } else {
                DispatchQueue.main.sync { super.wantsExtendedDynamicRangeContent = newValue }
            }
        }
    }
    #endif
}

/// An audio or subtitle track in the file, as mpv lists it.
struct UniversalTrack: Hashable, Identifiable, Sendable {
    let id: Int
    let title: String
    let language: String
    let isDefault: Bool
    let isForced: Bool
    let isSDH: Bool
    let isExternal: Bool
    let isSelected: Bool
}

/// What mpv's event thread reports. Plain values, so they can cross to the main thread.
enum UniversalEvent: Sendable {
    case idle
    case ignored
    case number(String, Double)
    case flag(String, Bool)
    case text(String, String)
    case unset(String)
    case tracks(audio: [UniversalTrack], subtitles: [UniversalTrack])
    case chapters([PlayerChapter])
    case loaded
    case restarted
    case ended(failure: String?)
    case log(String)
}

/// The mpv handle and the lock that keeps it alive while a thread uses it. mpv's client API is thread
/// safe, but destroying the handle under a thread that is still reading events is not.
private final class MPVHandle: @unchecked Sendable {
    private let condition = NSCondition()
    private var raw: OpaquePointer?
    private var users = 0
    let queue = DispatchQueue(label: "app.flow.mpv.events", qos: .userInitiated)
    var onWake: (@Sendable () -> Void)?

    init(_ raw: OpaquePointer) { self.raw = raw }

    /// Runs `body` with the handle, or returns nil once it has been taken for destruction. The lock is held
    /// only to count the user, never during `body`: a property read on the event thread waits for mpv's
    /// video thread, which can be waiting for the main thread, and the main thread must never queue behind it.
    @discardableResult
    func with<T>(_ body: (OpaquePointer) -> T) -> T? {
        condition.lock()
        guard let raw else { condition.unlock(); return nil }
        users += 1
        condition.unlock()
        defer {
            condition.lock()
            users -= 1
            condition.broadcast()
            condition.unlock()
        }
        return body(raw)
    }

    /// Stops new use of the handle and returns it; `destroy` waits for the calls still inside it.
    func take() -> OpaquePointer? {
        condition.lock()
        defer { condition.unlock() }
        let taken = raw
        raw = nil
        return taken
    }

    /// Waits for calls in flight, then destroys. Call away from the main thread: both steps can block.
    func destroy(_ taken: OpaquePointer) {
        condition.lock()
        while users > 0 { condition.wait() }
        condition.unlock()
        mpv_terminate_destroy(taken)
    }
}

@MainActor
@Observable
final class UniversalPlayer {
    /// The playhead, in seconds; updated with every frame, so views read it on their own clock instead of observing it.
    @ObservationIgnored private(set) var timePosition: Double = 0
    private(set) var duration: Double = 0
    /// Paused, or not yet started: the file loads paused, and the session starts it once it has chosen the tracks.
    private(set) var isPaused = true
    /// Stopped to fill the cache.
    private(set) var isBuffering = false
    /// True while nothing is being shown or heard (loading, seeking, buffering, paused).
    private(set) var isCoreIdle = true
    /// Seconds of the file read ahead of the playhead.
    private(set) var bufferedAhead: Double = 0
    private(set) var audioTracks: [UniversalTrack] = []
    private(set) var subtitleTracks: [UniversalTrack] = []
    private(set) var selectedAudio: Int?
    private(set) var selectedSubtitle: Int?
    private(set) var chapters: [PlayerChapter] = []
    private(set) var videoSize: CGSize = .zero
    /// mpv's own description of the file and how it is playing, for the details panel.
    private(set) var info: [String: String] = [:]
    private(set) var speed: Double = 1
    /// The reason a start failed or playback broke, in words for the error screen.
    private(set) var lastProblem: String?

    let layer = MPVMetalLayer()

    @ObservationIgnored var onLoaded: (() -> Void)?
    @ObservationIgnored var onTime: ((Double) -> Void)?
    @ObservationIgnored var onTransport: (() -> Void)?
    @ObservationIgnored var onEnded: (() -> Void)?
    @ObservationIgnored var onFailed: ((String) -> Void)?
    @ObservationIgnored var onTracks: (() -> Void)?
    @ObservationIgnored var onSeekFinished: (() -> Void)?

    private let handle: MPVHandle
    @ObservationIgnored private var isShutDown = false
    @ObservationIgnored private var lastTick = Date.distantPast
    @ObservationIgnored private var level: Double = 1
    @ObservationIgnored private var boostDB = 0
    @ObservationIgnored private var logTail: [String] = []
    @ObservationIgnored private var lifecycleObservers: [NSObjectProtocol] = []

    /// Creates the player and starts opening `url`, paused. Nil if libmpv can't be created.
    init?(url: URL, headers: [String: String], startAt: Double?, audioLanguages: [String], subtitleLanguages: [String],
          subtitles: SubtitleSettings, boostDB: Int) {
        guard let created = mpv_create() else { return nil }
        handle = MPVHandle(created)
        self.boostDB = boostDB
        layer.backgroundColor = CGColor(gray: 0, alpha: 1)
        layer.framebufferOnly = true
        // A non-empty frame before the view lays it out, so the video output starts with a real size.
        #if os(macOS)
        layer.frame = CGRect(x: 0, y: 0, width: 1280, height: 720)
        layer.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
        #elseif os(iOS)
        layer.frame = CGRect(origin: .zero, size: UIScreen.main.bounds.size)
        layer.contentsScale = UIScreen.main.nativeScale
        #else
        layer.frame = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        layer.contentsScale = 2
        #endif

        func option(_ name: String, _ value: String) {
            let status = mpv_set_option_string(created, name, value)
            if status < 0 { ScreenshotTour.log("mpv option \(name)=\(value): \(String(cString: mpv_error_string(status)))") }
        }
        // The picture: libplacebo's renderer through MoltenVK on the layer, VideoToolbox decoding where it can.
        var wid = Int64(Int(bitPattern: Unmanaged.passUnretained(layer).toOpaque()))
        let widStatus = mpv_set_option(created, "wid", MPV_FORMAT_INT64, &wid)
        if widStatus < 0 { ScreenshotTour.log("mpv wid: \(String(cString: mpv_error_string(widStatus)))") }
        option("vo", "gpu-next")
        option("gpu-api", "vulkan")
        option("gpu-context", "moltenvk")
        option("hwdec", "videotoolbox")
        option("video-rotate", "no")
        option("target-colorspace-hint", "no")
        // Apple's glass controls and Flow's own panels do the interface; mpv's would only get in the way.
        option("osd-level", "0")
        option("input-default-bindings", "no")
        option("input-vo-keyboard", "no")
        option("input-media-keys", "no")
        option("sub-auto", "no")
        option("load-scripts", "no")
        // Sound: the session's AVAudioSession category stays; channels follow the route, no passthrough.
        #if os(macOS)
        option("ao", "coreaudio")
        #else
        option("ao", "audiounit")
        #endif
        option("audio-channels", "auto-safe")
        option("audio-fallback-to-null", "yes")
        option("volume-max", "400")
        option("volume", String(MPVOptions.volumePercent(boostDB: boostDB)))
        if !audioLanguages.isEmpty { option("alang", audioLanguages.joined(separator: ",")) }
        if !subtitleLanguages.isEmpty { option("slang", subtitleLanguages.joined(separator: ",")) }
        // Subtitles are chosen by the session's rules once the tracks are known; none until then.
        option("sid", "no")
        // The network: a cache that rides out a slow moment, and reconnects when a link drops.
        option("cache", "yes")
        option("demuxer-max-bytes", "150MiB")
        option("demuxer-max-back-bytes", "50MiB")
        option("demuxer-readahead-secs", "45")
        option("cache-pause-wait", "3")
        option("network-timeout", "30")
        option("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5")
        option("user-agent", "Marquee/1.0 (\(Platform.deviceKind)) AppleCoreMedia/1.0.0")
        if !headers.isEmpty, !url.isFileURL { option("http-header-fields", MPVOptions.headerFields(headers)) }
        if let startAt, startAt > 1 { option("start", String(format: "%.3f", startAt)) }
        option("pause", "yes")
        // Only errors and warnings, for the error screen and the tour's log.
        mpv_request_log_messages(created, "warn")

        guard mpv_initialize(created) >= 0 else {
            let failed = handle
            failed.take().map { raw in DispatchQueue.global(qos: .utility).async { failed.destroy(raw) } }
            return nil
        }
        // Subtitles' look, now that the options exist (they are properties, so also changeable later).
        for (name, value) in MPVOptions.subtitleOptions(subtitles) { mpv_set_property_string(created, name, value) }

        let observed: [(String, mpv_format)] = [
            ("time-pos", MPV_FORMAT_DOUBLE), ("duration", MPV_FORMAT_DOUBLE), ("pause", MPV_FORMAT_FLAG),
            ("paused-for-cache", MPV_FORMAT_FLAG), ("core-idle", MPV_FORMAT_FLAG), ("demuxer-cache-duration", MPV_FORMAT_DOUBLE),
            ("dwidth", MPV_FORMAT_INT64), ("dheight", MPV_FORMAT_INT64),
            ("track-list", MPV_FORMAT_NONE), ("chapter-list", MPV_FORMAT_NONE),
            ("video-format", MPV_FORMAT_STRING), ("hwdec-current", MPV_FORMAT_STRING), ("file-format", MPV_FORMAT_STRING),
            ("audio-codec-name", MPV_FORMAT_STRING), ("video-params/colormatrix", MPV_FORMAT_STRING),
            ("video-params/gamma", MPV_FORMAT_STRING), ("current-vo", MPV_FORMAT_STRING), ("vo-configured", MPV_FORMAT_FLAG),
            ("estimated-vf-fps", MPV_FORMAT_DOUBLE), ("frame-drop-count", MPV_FORMAT_INT64), ("audio-params/hr-channels", MPV_FORMAT_STRING),
        ]
        for (name, format) in observed { mpv_observe_property(created, 0, name, format) }

        // The wakeup callback runs on an mpv thread and may not call back into mpv: it only schedules a drain.
        let handle = self.handle
        handle.onWake = { [weak self] in self?.drain() }
        mpv_set_wakeup_callback(created, { context in
            guard let context else { return }
            Unmanaged<MPVHandle>.fromOpaque(context).takeUnretainedValue().queue.async {
                Unmanaged<MPVHandle>.fromOpaque(context).takeUnretainedValue().onWake?()
            }
        }, Unmanaged.passUnretained(handle).toOpaque())

        observeLifecycle()
        command(["loadfile", url.absoluteString, "replace"])
    }

    deinit {
        // The session shuts the player down; this only matters if one is dropped without it.
        let handle = self.handle
        if let raw = handle.take() {
            mpv_set_wakeup_callback(raw, nil, nil)
            DispatchQueue.global(qos: .utility).async { handle.destroy(raw) }
        }
    }

    // MARK: Events

    /// Reads what mpv has queued. Runs on the event queue; each event is handed to the main thread in order.
    private nonisolated func drain() {
        while true {
            guard let event = handle.with({ Self.read($0) }) else { return }
            if case .idle = event { return }
            if case .ignored = event { continue }
            DispatchQueue.main.async { [weak self] in
                MainActor.assumeIsolated { self?.receive(event) }
            }
        }
    }

    private nonisolated static func read(_ h: OpaquePointer) -> UniversalEvent {
        guard let event = mpv_wait_event(h, 0) else { return .idle }
        switch event.pointee.event_id {
        case MPV_EVENT_NONE:
            return .idle
        case MPV_EVENT_PROPERTY_CHANGE:
            guard let raw = event.pointee.data else { return .ignored }
            let property = raw.assumingMemoryBound(to: mpv_event_property.self).pointee
            let name = String(cString: property.name)
            switch name {
            case "track-list": return readTracks(h)
            case "chapter-list": return .chapters(chapterList(h))
            default: break
            }
            guard let data = property.data else { return .unset(name) }
            switch property.format {
            case MPV_FORMAT_DOUBLE: return .number(name, data.assumingMemoryBound(to: Double.self).pointee)
            case MPV_FORMAT_INT64: return .number(name, Double(data.assumingMemoryBound(to: Int64.self).pointee))
            case MPV_FORMAT_FLAG: return .flag(name, data.assumingMemoryBound(to: Int32.self).pointee != 0)
            case MPV_FORMAT_STRING:
                guard let text = data.assumingMemoryBound(to: UnsafePointer<CChar>?.self).pointee else { return .unset(name) }
                return .text(name, String(cString: text))
            default: return .unset(name)
            }
        case MPV_EVENT_FILE_LOADED:
            return .loaded
        case MPV_EVENT_PLAYBACK_RESTART:
            return .restarted
        case MPV_EVENT_END_FILE:
            guard let raw = event.pointee.data else { return .ended(failure: nil) }
            let end = raw.assumingMemoryBound(to: mpv_event_end_file.self).pointee
            if end.reason == MPV_END_FILE_REASON_ERROR {
                return .ended(failure: String(cString: mpv_error_string(end.error)))
            }
            // A stop (replaced or closed) isn't the film finishing.
            return end.reason == MPV_END_FILE_REASON_EOF ? .ended(failure: nil) : .ignored
        case MPV_EVENT_LOG_MESSAGE:
            guard let raw = event.pointee.data else { return .ignored }
            let message = raw.assumingMemoryBound(to: mpv_event_log_message.self).pointee
            return .log("[\(String(cString: message.prefix))] \(String(cString: message.level)): \(String(cString: message.text))")
        default:
            return .ignored
        }
    }

    private nonisolated static func string(_ h: OpaquePointer, _ name: String) -> String? {
        guard let raw = mpv_get_property_string(h, name) else { return nil }
        defer { mpv_free(raw) }
        return String(cString: raw)
    }

    private nonisolated static func int(_ h: OpaquePointer, _ name: String) -> Int? {
        var value: Int64 = 0
        return mpv_get_property(h, name, MPV_FORMAT_INT64, &value) >= 0 ? Int(value) : nil
    }

    private nonisolated static func number(_ h: OpaquePointer, _ name: String) -> Double? {
        var value = 0.0
        return mpv_get_property(h, name, MPV_FORMAT_DOUBLE, &value) >= 0 ? value : nil
    }

    private nonisolated static func readTracks(_ h: OpaquePointer) -> UniversalEvent {
        var audio: [UniversalTrack] = [], subtitles: [UniversalTrack] = []
        for index in 0..<max(0, int(h, "track-list/count") ?? 0) {
            let base = "track-list/\(index)/"
            guard let kind = string(h, base + "type"), kind == "audio" || kind == "sub", let id = int(h, base + "id") else { continue }
            let language = string(h, base + "lang") ?? ""
            let name = string(h, base + "title") ?? ""
            let codec = string(h, base + "codec") ?? ""
            let forced = string(h, base + "forced") == "yes"
            let sdh = string(h, base + "hearing-impaired") == "yes"
            var parts: [String] = []
            parts.append(language.isEmpty ? "Track \(id)" : LanguageName.display(language))
            // A title that only repeats the language adds nothing.
            if kind == "sub", !name.isEmpty, name.caseInsensitiveCompare(parts[0]) != .orderedSame, name.caseInsensitiveCompare(language) != .orderedSame { parts.append(name) }
            if kind == "audio" {
                let codecLabel = codecName(codec)
                let channels = MPVOptions.channelLabel(int(h, base + "demux-channel-count") ?? 0)
                var detail = codecLabel
                if !channels.isEmpty { detail += detail.isEmpty ? channels : " " + channels }
                if !detail.isEmpty { parts.append(detail) }
                // The file's own title when it says more than the codec and layout already do ("Director's Commentary").
                let lowered = name.lowercased()
                let repeats = ["dts", "ac3", "aac", "truehd", "atmos", "flac", "opus", "mp3", "stereo", "mono", "5.1", "7.1", "surround", "dolby"].contains { lowered.contains($0) }
                if !name.isEmpty, !repeats, name.caseInsensitiveCompare(language) != .orderedSame { parts.insert(name, at: 1) }
            } else {
                if forced { parts.append("Forced") }
                if sdh { parts.append("SDH") }
            }
            let track = UniversalTrack(id: id, title: parts.joined(separator: " · "), language: language,
                                       isDefault: string(h, base + "default") == "yes", isForced: forced, isSDH: sdh,
                                       isExternal: string(h, base + "external") == "yes", isSelected: string(h, base + "selected") == "yes")
            if kind == "audio" { audio.append(track) } else { subtitles.append(track) }
        }
        return .tracks(audio: audio, subtitles: subtitles)
    }

    private nonisolated static func chapterList(_ h: OpaquePointer) -> [PlayerChapter] {
        (0..<max(0, int(h, "chapter-list/count") ?? 0)).compactMap { index in
            guard let start = number(h, "chapter-list/\(index)/time") else { return nil }
            let title = string(h, "chapter-list/\(index)/title") ?? ""
            return PlayerChapter(title: title.isEmpty ? "Chapter \(index + 1)" : title, start: start)
        }
    }

    /// A codec's name as a viewer knows it.
    private nonisolated static func codecName(_ codec: String) -> String {
        switch codec.lowercased() {
        case "ac3": return "Dolby Digital"
        case "eac3": return "Dolby Digital Plus"
        case "truehd": return "Dolby TrueHD"
        case "dts": return "DTS"
        case "aac": return "AAC"
        case "mp3": return "MP3"
        case "mp2": return "MP2"
        case "opus": return "Opus"
        case "vorbis": return "Vorbis"
        case "flac": return "FLAC"
        case "wmav2", "wmapro": return "WMA"
        case let other where other.hasPrefix("pcm"): return "PCM"
        case let other: return other.uppercased()
        }
    }

    private func receive(_ event: UniversalEvent) {
        guard !isShutDown else { return }
        switch event {
        case .number("time-pos", let seconds):
            timePosition = seconds
            if Date().timeIntervalSince(lastTick) >= 0.25 {
                lastTick = Date()
                onTime?(seconds)
            }
        case .number("duration", let seconds): duration = seconds
        case .number("demuxer-cache-duration", let seconds): bufferedAhead = seconds
        case .number("dwidth", let width): videoSize.width = width
        case .number("dheight", let height): videoSize.height = height
        case .flag("pause", let paused):
            isPaused = paused
            onTransport?()
        case .flag("paused-for-cache", let waiting):
            isBuffering = waiting
            onTransport?()
        case .flag("core-idle", let idle):
            isCoreIdle = idle
            onTransport?()
        case .flag(let name, let value): info[name] = value ? "yes" : "no"
        case .number(let name, let value) where name == "estimated-vf-fps" || name == "frame-drop-count": info[name] = String(format: "%.1f", value)
        case .text(let name, let value): info[name] = value
        case .unset(let name):
            if name == "time-pos" { timePosition = 0 }
            info[name] = nil
        case .tracks(let audio, let subtitles):
            audioTracks = audio
            subtitleTracks = subtitles
            selectedAudio = audio.first(where: \.isSelected)?.id
            selectedSubtitle = subtitles.first(where: \.isSelected)?.id
            onTracks?()
        case .chapters(let list): chapters = list
        case .loaded:
            onLoaded?()
        case .restarted:
            onSeekFinished?()
        case .ended(let failure):
            if let failure {
                let detail = logTail.suffix(3).joined(separator: " ")
                ScreenshotTour.log("mpv failed: \(failure) \(detail)")
                lastProblem = failure
                onFailed?(failure)
            } else {
                onEnded?()
            }
        case .log(let line):
            logTail.append(line.trimmingCharacters(in: .whitespacesAndNewlines))
            if logTail.count > 12 { logTail.removeFirst() }
            ScreenshotTour.log("mpv \(line.trimmingCharacters(in: .whitespacesAndNewlines))")
        default: break
        }
    }

    // MARK: Control

    /// Commands and property changes go out asynchronously: the main thread never waits on mpv, whose
    /// video thread can be waiting on the main thread (the layer's extended-range switch).
    private func command(_ arguments: [String]) {
        var cArguments: [UnsafePointer<CChar>?] = arguments.map { UnsafePointer<CChar>(strdup($0)) }
        cArguments.append(nil)
        defer { for pointer in cArguments { free(UnsafeMutablePointer(mutating: pointer)) } }
        handle.with { _ = mpv_command_async($0, 0, &cArguments) }
    }

    private func set(_ name: String, _ value: String) {
        handle.with { h in
            value.withCString { text in
                var pointer: UnsafePointer<CChar>? = text
                _ = mpv_set_property_async(h, 0, name, MPV_FORMAT_STRING, &pointer)
            }
        }
    }

    private func set(_ name: String, _ value: Double) {
        var number = value
        handle.with { _ = mpv_set_property_async($0, 0, name, MPV_FORMAT_DOUBLE, &number) }
    }

    private func set(_ name: String, flag: Bool) {
        var value: Int32 = flag ? 1 : 0
        handle.with { _ = mpv_set_property_async($0, 0, name, MPV_FORMAT_FLAG, &value) }
    }

    func play() {
        isPaused = false
        set("pause", flag: false)
    }

    func pause() {
        isPaused = true
        set("pause", flag: true)
    }

    /// `exact` decodes forward to the frame; otherwise the nearest keyframe before it, which is much quicker.
    func seek(to seconds: Double, exact: Bool) {
        command(["seek", String(format: "%.3f", max(0, seconds)), exact ? "absolute+exact" : "absolute+keyframes"])
    }

    func setSpeed(_ rate: Double) {
        speed = rate
        set("speed", rate)
    }

    /// 0...1 of the file's own level (the sleep timer's fade); the boost sets the ceiling.
    func setLevel(_ value: Double) {
        level = min(max(value, 0), 1)
        set("volume", MPVOptions.volumePercent(boostDB: boostDB, level: level))
    }

    var currentLevel: Double { level }

    func setBoost(_ dB: Int) {
        boostDB = dB
        set("volume", MPVOptions.volumePercent(boostDB: dB, level: level))
    }

    func selectAudio(_ id: Int) {
        selectedAudio = id
        set("aid", String(id))
    }

    /// Nil turns the file's own subtitles off.
    func selectSubtitle(_ id: Int?) {
        selectedSubtitle = id
        set("sid", id.map(String.init) ?? "no")
    }

    /// Seconds later (positive) or earlier the subtitles mpv draws appear.
    func setSubtitleDelay(_ seconds: Double) { set("sub-delay", seconds) }

    func applySubtitleStyle(_ settings: SubtitleSettings) {
        for (name, value) in MPVOptions.subtitleOptions(settings) { set(name, value) }
    }

    /// Fills the screen, cropping the picture, instead of fitting it.
    func setFill(_ fill: Bool) { set("panscan", fill ? 1 : 0) }

    // MARK: Lifecycle

    /// A backgrounded app may not use the GPU, so the picture is switched off until it returns; sound carries on.
    private func observeLifecycle() {
        #if os(iOS) || os(tvOS)
        let center = NotificationCenter.default
        lifecycleObservers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.set("vid", "no") }
        })
        lifecycleObservers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.set("vid", "auto") }
        })
        #endif
    }

    /// Stops mpv and releases it. Destroying the handle can block while the video output closes, so it
    /// happens away from the main thread.
    func shutdown() {
        guard !isShutDown else { return }
        isShutDown = true
        for observer in lifecycleObservers { NotificationCenter.default.removeObserver(observer) }
        lifecycleObservers = []
        onLoaded = nil; onTime = nil; onTransport = nil; onEnded = nil; onFailed = nil; onTracks = nil; onSeekFinished = nil
        let handle = self.handle
        guard let raw = handle.take() else { return }
        mpv_set_wakeup_callback(raw, nil, nil)
        let keepAlive = layer
        DispatchQueue.global(qos: .utility).async {
            handle.destroy(raw)
            // The layer and the wakeup context outlive the handle they were given to.
            withExtendedLifetime((handle, keepAlive)) {}
        }
    }
}
