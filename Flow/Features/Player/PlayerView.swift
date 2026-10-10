import SwiftUI
import AVKit
import Combine
import FlowKit

struct PlayerView: View {
    @Bindable var session: PlaybackSession
    @Environment(AppModel.self) private var model
    @State private var showSubtitles = false
    @FocusState private var keyboardFocus: Bool

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            surface
            #if os(macOS)
            // On iPhone and iPad subtitles sit between the video and Flow's controls; on tvOS in the
            // player's content overlay, beneath its transport bar.
            SubtitleLayer(session: session, settings: model.settings.subtitles)
            #endif
            #if !os(tvOS)
            if session.showsInfo, session.phase == .playing {
                PlaybackInfoPanel(session: session)
                    .onTapGesture { session.showsInfo = false }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(.top, Platform.isPhone ? 64 : 76)
                    // Clear of the Dynamic Island, which sits on a landscape iPhone's leading edge.
                    .padding(.leading, Platform.isPhone ? 64 : 20)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .topLeading)))
                    .zIndex(4)
            }
            SkipAndUpNextOverlay(session: session)
            if session.isBuffering && session.phase == .playing {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                    .padding(22)
                    .flowGlass(Circle())
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
            #endif
            switch session.phase {
            case .connecting(let progress):
                ConnectingView(session: session, progress: progress)
            case .failed(let message):
                PlaybackErrorView(message: message, detail: session.failureDetail,
                                  canTryAnother: session.canTryAnotherSource,
                                  externalPlayer: externalPlayerName,
                                  retry: { session.retry() },
                                  tryAnother: { session.tryNextSource() },
                                  openExternally: { session.handOffToExternalPlayer() },
                                  close: { session.stop() })
            case .finished where session.showsSuggestions:
                SuggestionsEndScreen(session: session)
                    .transition(.opacity)
                    .zIndex(6)
            default:
                EmptyView()
            }
            if let notice = session.notice {
                PlayerNotice(text: notice)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, Platform.isTV ? 60 : 64)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(5)
            }
        }
        .animation(Theme.Motion.gentle, value: session.notice)
        .animation(Theme.Motion.gentle, value: session.showsSuggestions)
        .animation(Theme.Motion.snappy, value: session.showsInfo)
        .sheet(isPresented: $showSubtitles) {
            SubtitlePickerView(session: session).environment(model)
        }
        #if os(macOS)
        .frame(minWidth: 640, minHeight: 360)
        .onExitCommand { session.stop() }
        #endif
        #if !os(tvOS)
        .focusable()
        .focusEffectDisabled()
        .focused($keyboardFocus)
        .onAppear { keyboardFocus = true }
        .onKeyPress(.space) { session.togglePlay(); return .handled }
        .onKeyPress(.leftArrow) { session.seek(by: -Double(model.settings.playback.seekBackwardSeconds)); return .handled }
        .onKeyPress(.rightArrow) { session.seek(by: Double(model.settings.playback.seekForwardSeconds)); return .handled }
        .onKeyPress(.escape) { session.stop(); return .handled }
        #if os(macOS)
        .onKeyPress(characters: CharacterSet(charactersIn: "fF")) { _ in
            NSApp.keyWindow?.toggleFullScreen(nil)
            return .handled
        }
        #endif
        .onKeyPress(characters: CharacterSet(charactersIn: "sS")) { _ in
            if let segment = session.activeSegment { session.skip(segment); return .handled }
            return .ignored
        }
        #endif
        #if os(iOS)
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .onAppear { OrientationLock.landscape() }
        .onDisappear { OrientationLock.restore() }
        #endif
    }

    private var externalPlayerName: String? {
        let player = model.settings.playback.externalPlayer
        return player != .none && Platform.externalPlayers.contains(player) ? player.title : nil
    }

    @ViewBuilder
    private var surface: some View {
        #if os(iOS)
        IOSPlayerControls(session: session, showSubtitles: $showSubtitles)
        #elseif os(tvOS)
        TVPlayerController(session: session, subtitleSettings: model.settings.subtitles) { showSubtitles = true }
            .ignoresSafeArea()
        #else
        MacPlayerView(player: session.player)
            .overlay(alignment: .topTrailing) {
                // Top right, clear of the window's traffic lights.
                HStack {
                    if !session.chapters.isEmpty {
                        Menu {
                            ForEach(session.chapters) { chapter in
                                Button(chapter.title.isEmpty ? TimeFormat.clock(chapter.start) : chapter.title) { session.seek(toChapter: chapter) }
                            }
                        } label: {
                            Image(systemName: "list.bullet")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(width: 44, height: 44)
                                .flowGlass(Circle(), interactive: true)
                        }
                        .menuStyle(.borderlessButton)
                        .menuIndicator(.hidden)
                        .fixedSize()
                    }
                    if !session.bitmapTracks.isEmpty {
                        Menu {
                            Picker("Subtitles", selection: Binding(get: { session.selectedBitmapTrack }, set: { session.selectBitmapSubtitle($0) })) {
                                Text("Off").tag(Int?.none)
                                ForEach(session.bitmapTracks) { Text($0.title).tag(Int?.some($0.id)) }
                            }
                            .pickerStyle(.inline)
                        } label: {
                            Image(systemName: session.selectedBitmapTrack == nil ? "captions.bubble" : "captions.bubble.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(width: 44, height: 44)
                                .flowGlass(Circle(), interactive: true)
                        }
                        .menuStyle(.borderlessButton)
                        .menuIndicator(.hidden)
                        .fixedSize()
                    }
                    CircleButton(systemImage: session.showsInfo ? "info.circle.fill" : "info.circle") { session.showsInfo.toggle() }
                    CircleButton(systemImage: "magnifyingglass") { showSubtitles = true }
                    CircleButton(systemImage: "xmark") { session.stop() }
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
    @State private var slow = false

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
                if let position = session.resumePrompt {
                    VStack(spacing: Theme.Space.s) {
                        Button { session.answerResume(true) } label: {
                            Label("Resume from \(TimeFormat.clock(position))", systemImage: "play.fill")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        Button { session.answerResume(false) } label: {
                            Label("Start from the Beginning", systemImage: "arrow.counterclockwise")
                        }
                        .buttonStyle(GlassButtonStyle())
                    }
                    .padding(.bottom, Theme.Space.xxl)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                } else {
                VStack(spacing: Theme.Space.s) {
                    if slow {
                        VStack(spacing: Theme.Space.xs) {
                            Text("This is taking longer than usual.")
                                .font(Theme.Typeface.caption)
                                .foregroundStyle(Theme.Palette.textSecondary)
                            if session.canTryAnotherSource {
                                Button("Try Another Source") { session.tryNextSource() }
                                    .buttonStyle(GlassButtonStyle())
                            }
                        }
                        .padding(.bottom, Theme.Space.m)
                        .transition(.opacity)
                    }
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
            }
            .padding(.horizontal, Theme.Space.xl)
            .animation(Theme.Motion.gentle, value: session.resumePrompt)
            .animation(Theme.Motion.gentle, value: slow)
            #if !os(tvOS)
            VStack {
                HStack {
                    #if os(macOS)
                    Spacer()
                    #endif
                    CircleButton(systemImage: "xmark") { session.stop() }
                    #if !os(macOS)
                    Spacer()
                    #endif
                }
                Spacer()
            }
            .padding(20)
            #endif
        }
        .transition(.opacity)
        .task {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            slow = true
        }
        #if os(tvOS)
        .onExitCommand { session.stop() }
        #endif
    }
}

struct PlaybackErrorView: View {
    let message: String
    /// The player's error domain and code, small and selectable, for reporting.
    var detail: String?
    var canTryAnother = false
    var externalPlayer: String?
    let retry: () -> Void
    var tryAnother: () -> Void = {}
    var openExternally: () -> Void = {}
    let close: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.92).ignoresSafeArea()
            VStack(spacing: Theme.Space.m) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 34 * Theme.scale, weight: .semibold))
                    .foregroundStyle(.yellow)
                Text("Couldn't Play").font(Theme.Typeface.title)
                Text(message)
                    .font(Theme.Typeface.body)
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 460 * Theme.scale)
                if let detail {
                    Text(detail)
                        .font(.system(.caption2).monospaced())
                        .foregroundStyle(Theme.Palette.textTertiary)
                        #if !os(tvOS)
                        .textSelection(.enabled)
                        #endif
                }
                VStack(spacing: Theme.Space.s) {
                    if canTryAnother {
                        Button("Try Another Source", action: tryAnother).buttonStyle(PrimaryButtonStyle())
                    }
                    if let externalPlayer {
                        Button("Open in \(externalPlayer)", action: openExternally).buttonStyle(GlassButtonStyle())
                    }
                    HStack(spacing: Theme.Space.s) {
                        Button("Try Again", action: retry).buttonStyle(GlassButtonStyle())
                        Button("Close", action: close).buttonStyle(GlassButtonStyle())
                    }
                }
                .padding(.top, Theme.Space.s)
            }
            .padding(Theme.Space.xl)
        }
    }
}

/// A brief, quiet message over the picture.
struct PlayerNotice: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(.footnote, weight: .semibold))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .frame(maxWidth: 520 * Theme.scale)
            .flowGlass(Capsule())
            .padding(.horizontal, 24)
            .allowsHitTesting(false)
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
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                if let countdown = session.upNextCountdown, let next = session.upNext {
                    UpNextCard(next: next, countdown: countdown, total: model.settings.playback.nextEpisodeCountdownSeconds,
                               play: { Task { await session.playUpNext() } },
                               cancel: { session.cancelUpNext() })
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                } else if session.showsSuggestions, session.phase == .playing {
                    SuggestionsCard(session: session)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                } else if let segment = session.activeSegment {
                    Button {
                        session.skip(segment)
                    } label: {
                        HStack(spacing: 8) {
                            Text(segment.kind.buttonTitle)
                            Image(systemName: "forward.end.fill").font(.system(size: 12, weight: .bold))
                        }
                        .font(.system(.subheadline, weight: .semibold))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .contentShape(Capsule())
                        .flowGlass(Capsule(), interactive: true)
                    }
                    .buttonStyle(.plain)
                    .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
            .padding(.trailing, Platform.isPhone ? 24 : 36)
            .padding(.bottom, Platform.isPhone ? 96 : 120)
        }
        .animation(Theme.Motion.gentle, value: session.activeSegment)
        .animation(Theme.Motion.gentle, value: session.upNextCountdown)
        .animation(Theme.Motion.gentle, value: session.showsSuggestions)
    }
}

/// The next episode's still with a ring that drains as the countdown runs; tap it to play now.
struct UpNextCard: View {
    let next: PlaybackRequest
    let countdown: Int
    let total: Int
    let play: () -> Void
    let cancel: () -> Void

    private var fraction: Double { total > 0 ? Double(countdown) / Double(total) : 0 }

    var body: some View {
        HStack(spacing: 14) {
            Button(action: play) {
                RemoteImage(url: TMDBImage.url(next.episode?.stillPath, size: .still) ?? next.item.smallBackdropURL, maxPixel: 400, fallbackTitle: next.item.title)
                    .frame(width: 136, height: 76.5)
                    .overlay(Color.black.opacity(0.28))
                    .overlay {
                        ZStack {
                            Circle().stroke(.white.opacity(0.25), lineWidth: 2.5)
                            Circle()
                                .trim(from: 0, to: fraction)
                                .stroke(.white, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                                .animation(.linear(duration: 1), value: fraction)
                            Image(systemName: "play.fill").font(.system(size: 13, weight: .bold))
                        }
                        .frame(width: 38, height: 38)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(CardButtonStyle())
            .accessibilityLabel("Play next episode now")

            VStack(alignment: .leading, spacing: 3) {
                Text("UP NEXT · \(countdown)s")
                    .font(Theme.Typeface.micro).kerning(1)
                    .foregroundStyle(Theme.Palette.textTertiary)
                    .contentTransition(.numericText(countsDown: true))
                Text(next.episode?.title ?? next.item.title)
                    .font(.system(.subheadline, weight: .semibold))
                    .lineLimit(2)
                if let ep = next.episode {
                    Text("Season \(ep.season), Episode \(ep.number)")
                        .font(.system(.caption))
                        .foregroundStyle(Theme.Palette.textSecondary)
                }
                Button("Cancel", action: cancel)
                    .font(.system(.caption, weight: .semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(.top, 4)
            }
            .frame(width: 168, alignment: .leading)
        }
        .padding(10)
        .padding(.trailing, 6)
        .flowGlass(RoundedRectangle(cornerRadius: 22, style: .continuous))
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

#if !os(tvOS)
/// Apple TV–style scrubber: a hairline track that thickens while you drag.
struct Scrubber: View {
    let current: Double
    let duration: Double
    var buffered: Double = 0
    /// A picture of the frame at `previewTime`, shown above the track while scrubbing.
    var preview: CGImage? = nil
    var previewTime: Double? = nil
    /// Intro, recap and credits spans, marked on the track so you can see what a skip button will jump over.
    var segments: [SkipSegment] = []
    /// Chapter start times in seconds, drawn as notches in the track.
    var chapters: [Double] = []
    let onScrub: (Double?) -> Void
    let onCommit: (Double) -> Void

    @State private var dragging: Double?

    /// Segments that sit inside the runtime and have a length; anything else is bad metadata.
    private var markedSegments: [SkipSegment] {
        guard duration > 0 else { return [] }
        return segments.filter { $0.end > $0.start && $0.start >= 0 && $0.end <= duration }
    }

    /// Chapter starts worth a notch. A film with dozens of chapters would turn the track into a comb.
    private var chapterNotches: [Double] {
        guard duration > 0, chapters.count <= 40 else { return [] }
        return chapters.filter { $0 > 0 && $0 < duration }
    }

    /// Content you skip is bright; things that merely might be skippable (trailers, ad breaks) are fainter.
    private static func opacity(of kind: SkipSegmentKind) -> Double {
        switch kind {
        case .intro, .recap, .credits: 0.9
        case .preview, .commercial: 0.5
        }
    }

    var body: some View {
        VStack(spacing: 8) {
            GeometryReader { proxy in
                let width = proxy.size.width
                let fraction = duration > 0 ? (dragging ?? current) / duration : 0
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.22))
                    Capsule().fill(.white.opacity(0.35)).frame(width: width * min(1, buffered))
                    Capsule().fill(.white).frame(width: max(0, width * min(1, fraction)))
                    // Above the played fill, not under it: yellow stays visible once you have watched
                    // past a segment, and it is the one colour on the track that never reads as progress.
                    ZStack(alignment: .leading) {
                        Color.clear
                        ForEach(Array(markedSegments.enumerated()), id: \.offset) { _, segment in
                            Rectangle()
                                .fill(Color(red: 1, green: 0.8, blue: 0.2).opacity(Self.opacity(of: segment.kind)))
                                .frame(width: width * (segment.end - segment.start) / duration)
                                .offset(x: width * segment.start / duration)
                        }
                        ForEach(Array(chapterNotches.enumerated()), id: \.offset) { _, start in
                            Rectangle()
                                .fill(.black.opacity(0.6))
                                .frame(width: 2)
                                .offset(x: width * start / duration - 1)
                        }
                    }
                    .clipShape(Capsule())
                    .allowsHitTesting(false)
                }
                .frame(height: dragging == nil ? 4 : 9)
                .frame(maxHeight: .infinity)
                .overlay(alignment: .topLeading) {
                    if let preview, let time = dragging ?? previewTime, duration > 0 {
                        let card = ScrubPreviewCard.size(for: preview)
                        let x = min(max(width * min(1, time / duration), card.width / 2), width - card.width / 2)
                        ScrubPreviewCard(image: preview, time: time)
                            .offset(x: x - card.width / 2, y: -(card.height + 14))
                            .allowsHitTesting(false)
                            .transition(.opacity.combined(with: .scale(scale: 0.92, anchor: .bottom)))
                    }
                }
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

/// The frame under the finger while scrubbing: a small picture with its time.
struct ScrubPreviewCard: View {
    let image: CGImage
    let time: Double

    private static var width: CGFloat { Platform.isPhone ? 168 : 220 }
    private var width: CGFloat { Self.width }

    /// The card's size: the picture plus the time beneath it.
    static func size(for image: CGImage) -> CGSize {
        CGSize(width: width, height: width * CGFloat(image.height) / CGFloat(max(image.width, 1)) + 6 + 18)
    }

    var body: some View {
        VStack(spacing: 6) {
            // An explicit size: the card lives in the scrubber track's overlay, which only offers the
            // track's own height, so a resizable picture would shrink to nothing.
            Image(decorative: image, scale: 1)
                .resizable()
                .frame(width: width, height: width * CGFloat(image.height) / CGFloat(max(image.width, 1)))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.white.opacity(0.35), lineWidth: 1))
                .shadow(color: .black.opacity(0.5), radius: 14, y: 6)
            Text(TimeFormat.clock(time))
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.6), radius: 3)
                .frame(height: 18)
        }
        .fixedSize()
    }
}

#endif

#if os(iOS)
/// Flow's own iOS player chrome: tap to show/hide, scrubber, ±10s, AirPlay, PiP, subtitles, aspect.
struct IOSPlayerControls: View {
    let session: PlaybackSession
    @Binding var showSubtitles: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var volume = SystemVolume()
    @State private var visible = true
    @State private var scrubbing: Double?
    @State private var hideTask: Task<Void, Never>?
    @State private var fill = false
    @State private var pip: AVPictureInPictureController?
    @State private var isPlaying = true
    @State private var audioOptions: [AVMediaSelectionOption] = []
    @State private var legibleOptions: [AVMediaSelectionOption] = []
    @State private var audioGroup: AVMediaSelectionGroup?
    @State private var legibleGroup: AVMediaSelectionGroup?
    @State private var speed = 1.0
    @State private var seekFlash: SeekFlash?
    @State private var preview: CGImage?
    @State private var previewTime: Double?
    @State private var previewTask: Task<Void, Never>?

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
            .overlay {
                // Double-tap either side to skip, single tap to show or hide the controls.
                GeometryReader { proxy in
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { location in
                            let forward = location.x > proxy.size.width / 2
                            let step = Double(forward ? model.settings.playback.seekForwardSeconds : -model.settings.playback.seekBackwardSeconds)
                            seek(by: step)
                            withAnimation(Theme.Motion.snappy) { seekFlash = SeekFlash(forward: forward, seconds: abs(Int(step))) }
                        }
                        .onTapGesture { toggle() }
                }
                .ignoresSafeArea()
            }
            .gesture(MagnifyGesture().onEnded { value in fill = value.magnification > 1 })

            if let flash = seekFlash {
                SeekFlashView(flash: flash)
                    .id(flash.id)
                    .transition(.opacity)
                    .task(id: flash.id) {
                        try? await Task.sleep(nanoseconds: 650_000_000)
                        withAnimation(Theme.Motion.fade) { if seekFlash?.id == flash.id { seekFlash = nil } }
                    }
            }

            SubtitleLayer(session: session, settings: model.settings.subtitles, lifted: visible)

            if visible {
                controls.transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: visible)
        .onAppear { scheduleHide() }
        .task(id: session.request.episode?.id ?? session.request.item.id) { await loadMediaOptions() }
        .onChange(of: session.tourScrubPreview) { _, time in
            hideTask?.cancel()
            visible = true
            updatePreview(time)
        }
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
                        Text(session.title).font(.system(size: 16, weight: .semibold)).lineLimit(2).minimumScaleFactor(0.8)
                        if let line = session.subtitleLine {
                            Text(line).font(.system(.caption, weight: .medium)).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                        }
                    }
                    Spacer()
                    // iPhone in portrait has no room beside the title; landscape and iPad do.
                    if !Platform.isPhone || verticalSizeClass == .compact {
                        VolumePill(volume: volume) { editing in
                            if editing { hideTask?.cancel() } else { scheduleHide() }
                        }
                    }
                    GlassGroup(spacing: 8) {
                        HStack(spacing: 8) {
                            if let pip {
                                CircleButton(systemImage: "pip.enter", size: 40) { pip.startPictureInPicture() }
                            }
                            RoutePicker()
                                .frame(width: 40, height: 40)
                                .flowGlass(Circle())
                            Menu {
                                if !session.bitmapTracks.isEmpty {
                                    Section("Subtitles") {
                                        Button { session.selectBitmapSubtitle(nil) } label: {
                                            if session.selectedBitmapTrack == nil { Label("Off", systemImage: "checkmark") } else { Text("Off") }
                                        }
                                        ForEach(session.bitmapTracks) { track in
                                            Button { session.selectBitmapSubtitle(track.id) } label: {
                                                if session.selectedBitmapTrack == track.id { Label(track.title, systemImage: "checkmark") } else { Text(track.title) }
                                            }
                                        }
                                    }
                                }
                                if !audioOptions.isEmpty {
                                    Section("Audio") {
                                        ForEach(audioOptions, id: \.self) { option in
                                            Button { select(option, characteristic: .audible) } label: {
                                                checked(option.title, selected(in: audioGroup) == option)
                                            }
                                        }
                                    }
                                }
                                if !legibleOptions.isEmpty {
                                    Section("Embedded Subtitles") {
                                        Button { select(nil, characteristic: .legible) } label: {
                                            checked("Off", selected(in: legibleGroup) == nil)
                                        }
                                        ForEach(legibleOptions, id: \.self) { option in
                                            Button { select(option, characteristic: .legible) } label: {
                                                checked(option.title, selected(in: legibleGroup) == option)
                                            }
                                        }
                                    }
                                }
                                if !session.chapters.isEmpty {
                                    Section("Chapters") {
                                        ForEach(session.chapters) { chapter in
                                            Button { session.seek(toChapter: chapter) } label: {
                                                Text(chapter.title.isEmpty ? "Chapter" : chapter.title)
                                                Text(TimeFormat.clock(chapter.start))
                                            }
                                        }
                                    }
                                }
                                Menu {
                                    ForEach(SleepTimer.choices) { choice in
                                        Button { session.sleepTimer = choice } label: {
                                            if session.sleepTimer == choice { Label(choice.title, systemImage: "checkmark") } else { Text(choice.title) }
                                        }
                                    }
                                    if session.sleepTimer != nil {
                                        Button("Turn Off", role: .destructive) { session.sleepTimer = nil }
                                    }
                                } label: {
                                    Label("Sleep Timer", systemImage: session.sleepTimer == nil ? "moon.zzz" : "moon.zzz.fill")
                                }
                                Section("Speed") {
                                    ForEach([0.75, 1.0, 1.25, 1.5, 2.0], id: \.self) { rate in
                                        Button { setRate(rate) } label: {
                                            if speed == rate { Label(rateLabel(rate), systemImage: "checkmark") } else { Text(rateLabel(rate)) }
                                        }
                                    }
                                }
                                Button("Search Subtitles…", systemImage: "magnifyingglass") { showSubtitles = true }
                                Button(session.showsInfo ? "Hide Playback Info" : "Playback Info", systemImage: "info.circle") { session.showsInfo.toggle() }
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
                         preview: preview, previewTime: previewTime,
                         segments: session.segments, chapters: session.chapters.map(\.start),
                         onScrub: { value in
                             scrubbing = value
                             if value != nil { hideTask?.cancel() } else { scheduleHide() }
                             updatePreview(value)
                         },
                         onCommit: { target in
                             session.player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
                         })
                    .padding(.horizontal, 24)
                    .padding(.bottom, 14)
            }
        }
    }

    /// Fetches the scrubbing preview for `time`, keeping the last picture until the new one is ready.
    private func updatePreview(_ time: Double?) {
        previewTask?.cancel()
        guard let time, let previewer = session.scrubPreviewer else {
            withAnimation(Theme.Motion.snappy) { preview = nil }
            previewTime = nil
            return
        }
        previewTime = time
        previewTask = Task {
            try? await Task.sleep(nanoseconds: 50_000_000)
            guard !Task.isCancelled, let image = await previewer.image(at: time), !Task.isCancelled else { return }
            withAnimation(Theme.Motion.snappy) { preview = image }
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
        if let group = try? await asset.loadMediaSelectionGroup(for: .audible) { audioGroup = group; audioOptions = group.options }
        if let group = try? await asset.loadMediaSelectionGroup(for: .legible) { legibleGroup = group; legibleOptions = group.options }
        if let preferred = model.settings.playback.preferredAudioLanguage,
           let match = audioOptions.first(where: { $0.extendedLanguageTag?.hasPrefix(preferred) == true || $0.locale?.language.languageCode?.identifier == preferred }) {
            select(match, characteristic: .audible)
        }
    }

    private func selected(in group: AVMediaSelectionGroup?) -> AVMediaSelectionOption? {
        guard let group, let item = session.player.currentItem else { return nil }
        return item.currentMediaSelection.selectedMediaOption(in: group)
    }

    @ViewBuilder
    private func checked(_ title: String, _ isOn: Bool) -> some View {
        if isOn { Label(title, systemImage: "checkmark") } else { Text(title) }
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

#if os(iOS)
struct SeekFlash: Equatable {
    let id = UUID()
    let forward: Bool
    let seconds: Int
}

/// The soft glow and chevrons that confirm a double-tap skip, on the side that was tapped.
struct SeekFlashView: View {
    let flash: SeekFlash

    var body: some View {
        HStack {
            if flash.forward { Spacer() }
            VStack(spacing: 6) {
                Image(systemName: flash.forward ? "chevron.forward.2" : "chevron.backward.2")
                    .font(.system(size: 22, weight: .bold))
                Text("\(flash.seconds) seconds")
                    .font(.system(.caption, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(width: 150, height: 150)
            .background(Circle().fill(.white.opacity(0.12)).blur(radius: 6))
            .padding(.horizontal, 48)
            if !flash.forward { Spacer() }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
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

#if os(iOS)
/// iPhone plays video in landscape, then hands the device back the way it was.
enum OrientationLock {
    static func landscape() {
        guard Platform.isPhone, let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { _ in }
    }

    static func restore() {
        guard Platform.isPhone, let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
    }
}
#endif

/// Draws a Blu-ray picture subtitle where the disc placed it. The subtitle canvas is mapped onto
/// the aspect-fit video rectangle, width-aligned and centred, so captions authored in the
/// letterbox of a cropped encode still land there.
/// Technical details, refreshed every second.
struct PlaybackInfoPanel: View {
    let session: PlaybackSession
    /// The glass card for iPhone, iPad and Mac; plain rows inside Apple TV's info panel.
    var card = true

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: Platform.isTV ? 12 : 6) {
                ForEach(session.infoRows()) { row in
                    GridRow {
                        Text(row.label)
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .gridColumnAlignment(.trailing)
                        Text(row.value)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .truncationMode(.middle)
                    }
                }
            }
            .font(.system(size: Platform.isTV ? 24 : 12, weight: .medium).monospacedDigit())
            .padding(card ? 16 : 40)
            .frame(maxWidth: card ? 380 : .infinity, alignment: .leading)
            .modifier(InfoCard(enabled: card))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Playback Info")
    }

    private struct InfoCard: ViewModifier {
        let enabled: Bool
        func body(content: Content) -> some View {
            if enabled {
                content.flowGlass(RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                content
            }
        }
    }
}

/// Downloaded text subtitles and picture subtitles from the file, above the video and below the controls.
struct SubtitleLayer: View {
    let session: PlaybackSession
    let settings: SubtitleSettings
    /// Raised clear of the scrubber while the controls show, as in Apple's TV app.
    var lifted = false

    var body: some View {
        ZStack {
            SubtitleOverlay(text: session.subtitleText, settings: settings)
            if let bitmap = session.bitmapSubtitle {
                BitmapSubtitleView(overlay: bitmap)
            }
        }
        .offset(y: lifted ? -72 : 0)
        .animation(Theme.Motion.snappy, value: lifted)
        .allowsHitTesting(false)
    }
}

struct BitmapSubtitleView: View {
    let overlay: BitmapOverlay

    var body: some View {
        GeometryReader { proxy in
            let video = Self.fit(overlay.videoSize == .zero ? overlay.canvas : overlay.videoSize, in: proxy.size)
            // The canvas spans the picture's width; a cropped picture (2.40:1 inside a 16:9 canvas)
            // keeps the canvas centred on it.
            let scaleX = overlay.canvas.width > 0 ? video.width / overlay.canvas.width : 1
            let scaleY = scaleX / max(overlay.pixelAspect, 0.1)
            let originY = video.midY - overlay.canvas.height * scaleY / 2
            ForEach(Array(overlay.pieces.enumerated()), id: \.offset) { _, piece in
                Image(decorative: piece.image, scale: 1)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: piece.rect.width * scaleX, height: piece.rect.height * scaleY)
                    .position(x: video.minX + piece.rect.midX * scaleX, y: originY + piece.rect.midY * scaleY)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func fit(_ video: CGSize, in container: CGSize) -> CGRect {
        guard video.width > 0, video.height > 0 else { return CGRect(origin: .zero, size: container) }
        let scale = min(container.width / video.width, container.height / video.height)
        let size = CGSize(width: video.width * scale, height: video.height * scale)
        return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2, width: size.width, height: size.height)
    }
}
