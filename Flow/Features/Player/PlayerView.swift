import SwiftUI
import AVKit
import Combine
import FlowKit

struct PlayerView: View {
    @Bindable var session: PlaybackSession
    @Environment(AppModel.self) private var model
    @State private var showSubtitles = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            surface
            SubtitleOverlay(text: session.subtitleText, settings: model.settings.subtitles)
                .allowsHitTesting(false)
            #if !os(tvOS)
            SkipAndUpNextOverlay(session: session)
            #endif
            switch session.phase {
            case .connecting(let progress):
                ConnectingView(session: session, progress: progress)
            case .failed(let message):
                PlaybackErrorView(message: message, retry: { session.retry() }, close: { session.stop() })
            default:
                EmptyView()
            }
        }
        .sheet(isPresented: $showSubtitles) {
            SubtitlePickerView(session: session).environment(model)
        }
        #if os(macOS)
        .frame(minWidth: 640, minHeight: 360)
        .onExitCommand { session.stop() }
        #endif
        #if os(iOS)
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        #endif
    }

    @ViewBuilder
    private var surface: some View {
        #if os(iOS)
        IOSPlayerControls(session: session, showSubtitles: $showSubtitles)
        #elseif os(tvOS)
        TVPlayerController(session: session) { showSubtitles = true }
            .ignoresSafeArea()
        #else
        MacPlayerView(player: session.player)
            .overlay(alignment: .topLeading) {
                HStack {
                    CircleButton(systemImage: "xmark") { session.stop() }
                    CircleButton(systemImage: "captions.bubble") { showSubtitles = true }
                }
                .padding(16)
            }
        #endif
    }
}

/// "CONNECTING… 15%" — the title's logo over its own artwork glow, until the first frame plays.
struct ConnectingView: View {
    let session: PlaybackSession
    let progress: Double

    var body: some View {
        ZStack {
            AmbientBackground(url: session.request.item.smallBackdropURL ?? session.request.item.posterURL, intensity: 0.8)
            VStack(spacing: Theme.Space.l) {
                Spacer()
                LogoOrTitle(logoPath: session.logoPath, title: session.title, maxHeight: Platform.isTV ? 220 : 120)
                    .frame(maxWidth: Platform.isTV ? 900 : 440)
                if let line = session.subtitleLine {
                    Text(line).font(Theme.Typeface.headline).foregroundStyle(Theme.Palette.textSecondary)
                }
                Spacer()
                VStack(spacing: Theme.Space.s) {
                    ProgressCapsule(value: progress, height: 3)
                        .animation(Theme.Motion.gentle, value: progress)
                    HStack {
                        Text("CONNECTING").kerning(2.4)
                        Spacer()
                        Text("\(Int(progress * 100))%").monospacedDigit().contentTransition(.numericText())
                    }
                    .font(Theme.Typeface.micro)
                    .foregroundStyle(Theme.Palette.textSecondary)
                    Text(session.source.providerName.uppercased())
                        .font(.system(size: 9 * Theme.scale, weight: .semibold))
                        .kerning(1.5)
                        .foregroundStyle(Theme.Palette.textTertiary)
                }
                .frame(maxWidth: Platform.isTV ? 1000 : 480)
                .padding(.bottom, Theme.Space.xxl)
            }
            .padding(.horizontal, Theme.Space.xl)
            #if !os(tvOS)
            VStack {
                HStack {
                    CircleButton(systemImage: "xmark") { session.stop() }
                    Spacer()
                }
                Spacer()
            }
            .padding(20)
            #endif
        }
        .transition(.opacity)
        #if os(tvOS)
        .onExitCommand { session.stop() }
        #endif
    }
}

struct PlaybackErrorView: View {
    let message: String
    let retry: () -> Void
    let close: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.9).ignoresSafeArea()
            ContentUnavailableView {
                Label("Couldn't Play", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                HStack {
                    Button("Close", action: close)
                    Button("Try Again", action: retry).buttonStyle(.borderedProminent)
                }
            }
        }
    }
}

struct SubtitleOverlay: View {
    let text: String?
    let settings: SubtitleSettings

    var body: some View {
        VStack {
            Spacer()
            if let text, !text.isEmpty {
                Text(text)
                    .font(.system(size: baseSize * settings.fontScale, weight: .semibold))
                    .foregroundStyle(settings.color.color)
                    .multilineTextAlignment(.center)
                    .shadow(color: settings.background == .shadow ? .black : .clear, radius: 2, x: 1, y: 1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(background, in: RoundedRectangle(cornerRadius: 6))
                    .padding(.bottom, Platform.isTV ? 90 : 48)
                    .padding(.horizontal, 40)
            }
        }
    }

    private var baseSize: CGFloat { Platform.isTV ? 44 : Platform.isPhone ? 20 : 28 }

    private var background: Color {
        switch settings.background {
        case .none, .shadow: return .clear
        case .translucent: return .black.opacity(0.55)
        case .solid: return .black
        }
    }
}

/// Skip Intro / Skip Credits button and the Up Next countdown card (iOS and macOS).
struct SkipAndUpNextOverlay: View {
    let session: PlaybackSession

    var body: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                if let countdown = session.upNextCountdown, let next = session.upNext?.episode {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Up Next").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text("\(next.code) · \(next.title)").font(.subheadline.weight(.semibold)).lineLimit(1)
                        HStack {
                            Button("Cancel") { session.cancelUpNext() }
                                .buttonStyle(.bordered)
                            Button("Play in \(countdown)") { Task { await session.playUpNext() } }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: 320, alignment: .leading)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
                } else if let segment = session.activeSegment {
                    Button {
                        session.skip(segment)
                    } label: {
                        Label(segment.kind.buttonTitle, systemImage: "forward.end.fill")
                            .font(.headline)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().stroke(.white.opacity(0.3)))
                }
            }
            .padding(.trailing, 28)
            .padding(.bottom, 110)
        }
        .animation(.easeInOut, value: session.activeSegment)
        .animation(.easeInOut, value: session.upNextCountdown)
    }
}

struct CircleButton: View {
    let systemImage: String
    var size: CGFloat = 44
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.38, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .flowGlass(Circle(), interactive: true)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

/// Apple TV–style scrubber: a hairline track that thickens while you drag.
struct Scrubber: View {
    let current: Double
    let duration: Double
    var buffered: Double = 0
    let onScrub: (Double?) -> Void
    let onCommit: (Double) -> Void

    @State private var dragging: Double?

    var body: some View {
        VStack(spacing: 8) {
            GeometryReader { proxy in
                let width = proxy.size.width
                let fraction = duration > 0 ? (dragging ?? current) / duration : 0
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.22))
                    Capsule().fill(.white.opacity(0.35)).frame(width: width * min(1, buffered))
                    Capsule().fill(.white).frame(width: max(0, width * min(1, fraction)))
                }
                .frame(height: dragging == nil ? 4 : 9)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let t = max(0, min(duration, value.location.x / max(width, 1) * duration))
                            dragging = t
                            onScrub(t)
                        }
                        .onEnded { _ in
                            if let t = dragging { onCommit(t) }
                            dragging = nil
                            onScrub(nil)
                        }
                )
                .animation(Theme.Motion.snappy, value: dragging == nil)
            }
            .frame(height: 22)
            HStack {
                Text(TimeFormat.clock(dragging ?? current))
                Spacer()
                Text("-" + TimeFormat.clock(max(0, duration - (dragging ?? current))))
            }
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .foregroundStyle(Theme.Palette.textSecondary)
        }
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue("\(TimeFormat.clock(current)) of \(TimeFormat.clock(duration))")
        .accessibilityAdjustableAction { direction in
            let step = 10.0
            onCommit(direction == .increment ? min(duration, current + step) : max(0, current - step))
        }
    }
}

#if os(iOS)
/// Flow's own iOS player chrome: tap to show/hide, scrubber, ±10s, AirPlay, PiP, subtitles, aspect.
struct IOSPlayerControls: View {
    let session: PlaybackSession
    @Binding var showSubtitles: Bool
    @Environment(AppModel.self) private var model
    @State private var visible = true
    @State private var scrubbing: Double?
    @State private var hideTask: Task<Void, Never>?
    @State private var fill = false
    @State private var pip: AVPictureInPictureController?
    @State private var isPlaying = true
    @State private var audioOptions: [AVMediaSelectionOption] = []
    @State private var legibleOptions: [AVMediaSelectionOption] = []
    @State private var speed = 1.0

    var body: some View {
        ZStack {
            PlayerLayerView(player: session.player, gravity: fill ? .resizeAspectFill : .resizeAspect) { layer in
                if AVPictureInPictureController.isPictureInPictureSupported(), pip == nil {
                    let controller = AVPictureInPictureController(playerLayer: layer)
                    controller?.canStartPictureInPictureAutomaticallyFromInline = model.settings.playback.pictureInPicture
                    DispatchQueue.main.async { pip = controller }
                }
            }
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture { toggle() }
            .gesture(MagnifyGesture().onEnded { value in fill = value.magnification > 1 })

            if visible {
                controls.transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: visible)
        .onAppear { scheduleHide() }
        .task(id: session.request.episode?.id ?? session.request.item.id) { await loadMediaOptions() }
        .onReceive(NotificationCenter.default.publisher(for: AVPlayer.rateDidChangeNotification, object: session.player)) { _ in
            isPlaying = session.player.rate > 0
        }
    }

    private var controls: some View {
        ZStack {
            LinearGradient(colors: [.black.opacity(0.65), .clear, .clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            VStack {
                HStack(spacing: 14) {
                    CircleButton(systemImage: "xmark") { session.stop() }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.title).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                        if let line = session.subtitleLine {
                            Text(line).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                        }
                    }
                    Spacer()
                    GlassGroup(spacing: 8) {
                        HStack(spacing: 8) {
                            if let pip {
                                CircleButton(systemImage: "pip.enter", size: 40) { pip.startPictureInPicture() }
                            }
                            RoutePicker()
                                .frame(width: 40, height: 40)
                                .flowGlass(Circle())
                            Menu {
                                if !audioOptions.isEmpty {
                                    Section("Audio") {
                                        ForEach(audioOptions, id: \.self) { option in
                                            Button(option.displayName) { select(option, characteristic: .audible) }
                                        }
                                    }
                                }
                                if !legibleOptions.isEmpty {
                                    Section("Embedded Subtitles") {
                                        Button("Off") { select(nil, characteristic: .legible) }
                                        ForEach(legibleOptions, id: \.self) { option in
                                            Button(option.displayName) { select(option, characteristic: .legible) }
                                        }
                                    }
                                }
                                Section("Speed") {
                                    ForEach([0.75, 1.0, 1.25, 1.5, 2.0], id: \.self) { rate in
                                        Button { setRate(rate) } label: {
                                            if speed == rate { Label(rateLabel(rate), systemImage: "checkmark") } else { Text(rateLabel(rate)) }
                                        }
                                    }
                                }
                                Button("Search Subtitles…", systemImage: "magnifyingglass") { showSubtitles = true }
                                Button(fill ? "Fit to Screen" : "Fill Screen", systemImage: fill ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") { fill.toggle() }
                            } label: {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 16, weight: .bold))
                                    .frame(width: 40, height: 40)
                                    .flowGlass(Circle(), interactive: true)
                            }
                            .foregroundStyle(.white)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)

                Spacer()

                GlassGroup(spacing: 28) {
                    HStack(spacing: 40) {
                        transportButton("gobackward.\(model.settings.playback.seekBackwardSeconds)", size: 60) {
                            seek(by: -Double(model.settings.playback.seekBackwardSeconds))
                        }
                        transportButton(isPlaying ? "pause.fill" : "play.fill", size: 84) { togglePlay() }
                        transportButton("goforward.\(model.settings.playback.seekForwardSeconds)", size: 60) {
                            seek(by: Double(model.settings.playback.seekForwardSeconds))
                        }
                    }
                }

                Spacer()

                Scrubber(current: session.currentTime, duration: session.duration, buffered: buffered,
                         onScrub: { value in
                             scrubbing = value
                             if value != nil { hideTask?.cancel() } else { scheduleHide() }
                         },
                         onCommit: { target in
                             session.player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
                         })
                    .padding(.horizontal, 24)
                    .padding(.bottom, 14)
            }
        }
    }

    private func transportButton(_ symbol: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: size, height: size)
                .flowGlass(Circle(), interactive: true)
        }
        .buttonStyle(.plain)
    }

    private var buffered: Double {
        guard session.duration > 0, let range = session.player.currentItem?.loadedTimeRanges.last?.timeRangeValue else { return 0 }
        return min(1, (range.start.seconds + range.duration.seconds) / session.duration)
    }

    private func setRate(_ rate: Double) {
        speed = rate
        session.player.defaultRate = Float(rate)
        if session.player.rate > 0 { session.player.rate = Float(rate) }
    }

    private func rateLabel(_ rate: Double) -> String {
        rate == 1 ? "Normal" : String(format: "%gx", rate)
    }

    private func toggle() {
        visible.toggle()
        if visible { scheduleHide() }
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if !Task.isCancelled, isPlaying, scrubbing == nil { visible = false }
        }
    }

    private func togglePlay() {
        if session.player.rate > 0 { session.player.pause() } else { session.player.playImmediately(atRate: Float(speed)) }
        scheduleHide()
    }

    private func seek(by seconds: Double) {
        let target = max(0, min(session.duration, session.currentTime + seconds))
        session.player.seek(to: CMTime(seconds: target, preferredTimescale: 600))
        scheduleHide()
    }

    private func loadMediaOptions() async {
        guard let asset = session.player.currentItem?.asset else { return }
        if let group = try? await asset.loadMediaSelectionGroup(for: .audible) { audioOptions = group.options }
        if let group = try? await asset.loadMediaSelectionGroup(for: .legible) { legibleOptions = group.options }
        if let preferred = model.settings.playback.preferredAudioLanguage,
           let match = audioOptions.first(where: { $0.extendedLanguageTag?.hasPrefix(preferred) == true || $0.locale?.language.languageCode?.identifier == preferred }) {
            select(match, characteristic: .audible)
        }
    }

    private func select(_ option: AVMediaSelectionOption?, characteristic: AVMediaCharacteristic) {
        guard let item = session.player.currentItem else { return }
        Task {
            guard let group = try? await item.asset.loadMediaSelectionGroup(for: characteristic) else { return }
            item.select(option, in: group)
        }
    }
}
#endif

enum TimeFormat {
    static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "0:00" }
        let s = Int(seconds)
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    static func remaining(_ seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        if minutes >= 60 { return "\(minutes / 60)h \(minutes % 60)m left" }
        return "\(max(1, minutes))m left"
    }

    static func runtime(_ minutes: Int) -> String {
        minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
    }
}
