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
            if session.showsXRay, session.phase == .playing {
                XRayPanel(session: session) { session.showsXRay = false }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    // Between the top buttons and the title row; the safe area keeps it off the Dynamic Island.
                    .padding(.top, Platform.isPhone ? 62 : 76)
                    .padding(.bottom, Platform.isPhone ? 96 : 110)
                    .padding(.leading, Platform.isPhone ? 16 : 28)
                    .transition(.opacity.combined(with: .move(edge: .leading)))
                    .zIndex(4)
            }
            if session.showsInfo, session.phase == .playing {
                PlaybackInfoPanel(session: session)
                    .onTapGesture { session.showsInfo = false }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(.top, Platform.isPhone ? 62 : 76)
                    .padding(.leading, Platform.isPhone ? 16 : 28)
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
            #if !os(tvOS)
            // On Apple TV it sits in the player's content overlay instead, beneath the transport bar
            // and its Continue Watching button (TVPlayerController).
            if session.asksStillWatching {
                StillWatchingPrompt(session: session)
                    .transition(.opacity)
                    .zIndex(7)
            }
            #endif
            SongCard(recognizer: session.songs)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(.top, Platform.isTV ? 60 : (Platform.isPhone ? 62 : 76))
                .padding(.trailing, Platform.isTV ? 80 : (Platform.isPhone ? 16 : 28))
                #if os(tvOS)
                // Above the system player, never in the way of its focus.
                .allowsHitTesting(false)
                #endif
                .zIndex(5)
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
        .animation(Theme.Motion.gentle, value: session.showsXRay)
        .animation(Theme.Motion.gentle, value: session.asksStillWatching)
        // One panel on the leading side at a time.
        .onChange(of: session.showsXRay) { _, shows in if shows { session.showsInfo = false } }
        .onChange(of: session.showsInfo) { _, shows in if shows { session.showsXRay = false } }
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
        .onAppear { if model.settings.playback.autoRotate { OrientationLock.landscape() } }
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
        TVPlayerController(session: session, model: model, subtitleSettings: model.settings.subtitles) { showSubtitles = true }
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
                        }
                        .menuStyle(.borderlessButton)
                        .menuIndicator(.hidden)
                        .fixedSize()
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                        .flowGlass(Circle(), interactive: true)
                        .accessibilityLabel("Chapters")
                        .help("Chapters")
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
                        }
                        .menuStyle(.borderlessButton)
                        .menuIndicator(.hidden)
                        .fixedSize()
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                        .flowGlass(Circle(), interactive: true)
                        .accessibilityLabel("Disc Subtitles")
                        .help("Disc Subtitles")
                    }
                    MacPlayerMenu(session: session)
                    CircleButton(systemImage: "person.crop.rectangle.stack", label: "X-Ray") { session.showsXRay.toggle() }
                    CircleButton(systemImage: session.showsInfo ? "info.circle.fill" : "info.circle", label: "Playback Info") { session.showsInfo.toggle() }
                    CircleButton(systemImage: "magnifyingglass", label: "Search Subtitles") { showSubtitles = true }
                    CircleButton(systemImage: "xmark", label: "Close Player") { session.stop() }
                }
                .padding(16)
            }
        #endif
    }
}

/// "CONNECTING… 15%" — the title's logo over its own artwork glow, until the first frame plays.
/// While the stream starts: the title's own backdrop, dimmed, its logo, and a slim line for progress.
/// Nothing shouts; it's the opening of a film, not a loading screen.
struct ConnectingView: View {
    let session: PlaybackSession
    let progress: Double
    @State private var slow = false
    @State private var drift = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var backdrop: URL? {
        let item = session.request.item
        return TMDBImage.url(item.backdropPath, size: .original) ?? item.smallBackdropURL ?? item.tmdbPosterURL
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            RemoteImage(url: backdrop, maxPixel: Platform.isTV ? 1920 : 1280)
                // A slow push in, like a camera settling on the first shot.
                .scaleEffect(drift ? 1.06 : 1)
                .animation(reduceMotion ? nil : .easeOut(duration: 24), value: drift)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .ignoresSafeArea()
                .opacity(0.42)
                .accessibilityHidden(true)
            LinearGradient(colors: [.black.opacity(0.35), .clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(spacing: Theme.Space.m) {
                Spacer()
                LogoOrTitle(logoPath: session.logoPath, title: session.title, maxHeight: Platform.isTV ? 200 : 104)
                    .frame(maxWidth: Platform.isTV ? 820 : 380)
                if let line = session.subtitleLine {
                    Text(line).font(Theme.Typeface.body).foregroundStyle(Theme.Palette.textSecondary)
                }
                if session.resumePrompt == nil {
                    loadingLine.padding(.top, Theme.Space.s)
                }
                Spacer()
                if let position = session.resumePrompt {
                    // One width for both, each on one line: Apple TV wrapped "Resume from 3:20" in two.
                    VStack(spacing: Theme.Space.s) {
                        Button { session.answerResume(true) } label: {
                            Label("Resume from \(TimeFormat.clock(position))", systemImage: "play.fill")
                                .lineLimit(1)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        Button { session.answerResume(false) } label: {
                            Label("Start from the Beginning", systemImage: "arrow.counterclockwise")
                                .lineLimit(1)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(GlassButtonStyle())
                    }
                    .frame(width: 330 * Theme.scale)
                    .padding(.bottom, Theme.Space.xxl)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                } else {
                    VStack(spacing: Theme.Space.s) {
                        if slow {
                            Text("This is taking longer than usual.")
                                .font(Theme.Typeface.caption)
                                .foregroundStyle(Theme.Palette.textSecondary)
                            if session.canTryAnotherSource {
                                Button("Try Another Source") { session.tryNextSource() }
                                    .buttonStyle(GlassButtonStyle())
                            }
                        }
                        Text("From \(session.source.providerName)")
                            .font(Theme.Typeface.caption)
                            .foregroundStyle(Theme.Palette.textTertiary)
                    }
                    .padding(.bottom, Theme.Space.xl)
                    .transition(.opacity)
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
                    CircleButton(systemImage: "xmark", label: "Close Player") { session.stop() }
                    #if !os(macOS)
                    Spacer()
                    #endif
                }
                Spacer()
            }
            .padding(Platform.isPhone ? 16 : 20)
            #endif
        }
        .transition(.opacity)
        .onAppear { drift = true }
        .task {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            slow = true
        }
        #if os(tvOS)
        .onExitCommand { session.stop() }
        #endif
    }

    /// A short hairline that fills as the stream buffers, or a small spinner when progress isn't shown.
    @ViewBuilder
    private var loadingLine: some View {
        if session.showsLoadingProgress {
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.18))
                Capsule().fill(.white.opacity(0.9))
                    .frame(width: max(6, 160 * Theme.scale * min(1, max(0, progress))))
                    .animation(Theme.Motion.gentle, value: progress)
            }
            .frame(width: 160 * Theme.scale, height: 3)
            .accessibilityElement()
            .accessibilityLabel("Loading")
            .accessibilityValue("\(Int(progress * 100)) percent")
        } else {
            ProgressView().tint(.white).accessibilityLabel("Loading")
        }
    }
}

struct PlaybackErrorView: View {
    let message: String
    /// The player's error domain and code, small and selectable, for reporting.
    var detail: String?
    var canTryAnother = false
    var tryAnotherTitle = "Try Another Source"
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
                        Button(tryAnotherTitle, action: tryAnother).buttonStyle(PrimaryButtonStyle())
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
            .flowGlass(Capsule(), tint: Theme.Palette.overPicture)
            .padding(.horizontal, 24)
            .allowsHitTesting(false)
    }
}

/// Flow's own subtitles: the viewer's font, colour, edge and background, or, with "Keep original ASS
/// styling", the colour, weight, size and placement an ASS/SSA author gave each line.
struct SubtitleOverlay: View {
    let text: String?
    let settings: SubtitleSettings
    /// The cues on screen, for ASS styling. Only drawn (instead of `text`) when `keepASSStyling` is on.
    var cues: [SubtitleCue] = []

    private struct Line {
        let text: String
        let style: SubtitleCueStyle?
    }

    /// Lines that share an alignment stack together; the others sit in their own corner.
    private struct Block: Identifiable {
        let alignment: Int
        let lines: [Line]
        var id: Int { alignment }
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if blocks.isEmpty {
                    if let text, !text.isEmpty {
                        block([Line(text: text, style: nil)], in: proxy.size)
                    }
                } else {
                    ForEach(blocks) { block($0.lines, in: proxy.size) }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    private var blocks: [Block] {
        guard settings.keepASSStyling else { return [] }
        let styled = cues.filter { $0.style != nil }
        guard !styled.isEmpty else { return [] }
        let grouped = Dictionary(grouping: styled) { $0.style?.alignment ?? 2 }
        return grouped.keys.sorted().map { key in
            Block(alignment: key, lines: grouped[key, default: []].map { Line(text: $0.text, style: $0.style) })
        }
    }

    /// One alignment's lines, placed by the author's margins or, without them, where the viewer's
    /// own subtitles sit.
    private func block(_ lines: [Line], in size: CGSize) -> some View {
        let style = lines.first?.style
        let placement = style?.placement
        let vertical = placement?.vertical ?? .bottom
        let horizontal = placement?.horizontal ?? .centre
        let boxed = settings.background.drawsBox
        let textAlignment: TextAlignment = horizontal == .left ? .leading : horizontal == .right ? .trailing : .center
        return VStack(alignment: horizontal == .left ? .leading : horizontal == .right ? .trailing : .center, spacing: boxed ? 3 : 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                ForEach(Array(line.text.split(separator: "\n", omittingEmptySubsequences: true).enumerated()), id: \.offset) { _, part in
                    row(String(part), style: line.style, height: size.height, alignment: textAlignment)
                }
            }
        }
        .padding(.top, vertical == .top ? verticalMargin(style, size: size, top: true) : 0)
        .padding(.bottom, vertical == .bottom ? verticalMargin(style, size: size, top: false) : 0)
        .padding(.leading, sideMargin(style?.marginL, width: size.width))
        .padding(.trailing, sideMargin(style?.marginR, width: size.width))
        .frame(maxWidth: .infinity, maxHeight: .infinity,
               alignment: Alignment(horizontal: horizontal == .left ? .leading : horizontal == .right ? .trailing : .center,
                                    vertical: vertical == .top ? .top : vertical == .bottom ? .bottom : .center))
    }

    /// The author's margin when they gave one; otherwise the usual spot, raised by the viewer's setting.
    private func verticalMargin(_ style: SubtitleCueStyle?, size: CGSize, top: Bool) -> CGFloat {
        if let margin = style?.marginV, margin > 0 { return margin * size.height }
        if top { return Platform.isTV ? 60 : 24 }
        return (Platform.isTV ? 90 : 48) + size.height * min(max(settings.verticalPosition, 0), 0.4)
    }

    private func sideMargin(_ fraction: Double?, width: CGFloat) -> CGFloat {
        if let fraction, fraction > 0 { return fraction * width }
        return 40
    }

    private func row(_ text: String, style: SubtitleCueStyle?, height: CGFloat, alignment: TextAlignment) -> some View {
        let size = fontSize(style, height: height)
        let color = style?.colour != nil ? Color(red: style?.red ?? 1, green: style?.green ?? 1, blue: style?.blue ?? 1) : settings.color.color
        let weight: Font.Weight = style?.bold.map { $0 ? .bold : .regular } ?? settings.weight.fontWeight
        return glyphs(text, font: font(size: size, weight: weight, italic: style?.italic == true), color: color, size: size, alignment: alignment)
            .padding(.horizontal, 10)
            .padding(.vertical, settings.background.drawsBox ? 3 : 0)
            .background(settings.background.drawsBox ? Color.black.opacity(min(max(settings.backgroundOpacity, 0), 1)) : .clear,
                        in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    /// ASS sizes measure the whole line, a little more than the em SwiftUI sizes by, so the author's
    /// fraction of the picture height is trimmed to match.
    private func fontSize(_ style: SubtitleCueStyle?, height: CGFloat) -> CGFloat {
        if let scale = style?.scale, height > 0 { return max(scale * height * 0.85, 10) }
        return baseSize * settings.fontScale
    }

    private func font(size: CGFloat, weight: Font.Weight, italic: Bool) -> Font {
        var font: Font
        switch settings.font {
        case .system, .condensed: font = .system(size: size, weight: weight, design: .default)
        case .rounded: font = .system(size: size, weight: weight, design: .rounded)
        case .serif: font = .system(size: size, weight: weight, design: .serif)
        case .monospaced: font = .system(size: size, weight: weight, design: .monospaced)
        }
        if settings.font == .condensed { font = font.width(.condensed) }
        return italic ? font.italic() : font
    }

    /// The text with its edge: shadows for the soft and relief looks, eight dark copies around it for an outline.
    @ViewBuilder
    private func glyphs(_ text: String, font: Font, color: Color, size: CGFloat, alignment: TextAlignment) -> some View {
        let base = Text(text).font(font).multilineTextAlignment(alignment)
        switch settings.edgeStyle {
        case .none:
            base.foregroundStyle(color)
        case .dropShadow:
            base.foregroundStyle(color)
                .shadow(color: .black.opacity(0.85), radius: 2.5, x: 1, y: 1.5)
        case .raised:
            base.foregroundStyle(color)
                .shadow(color: .black.opacity(0.85), radius: 0, x: 1, y: 1)
                .shadow(color: .white.opacity(0.6), radius: 0, x: -1, y: -1)
        case .depressed:
            base.foregroundStyle(color)
                .shadow(color: .white.opacity(0.6), radius: 0, x: 1, y: 1)
                .shadow(color: .black.opacity(0.85), radius: 0, x: -1, y: -1)
        case .outline:
            let width = max(1, size * 0.06)
            ZStack {
                ForEach(0..<8, id: \.self) { step in
                    let angle = Double(step) * .pi / 4
                    base.foregroundStyle(.black)
                        .offset(x: CGFloat(cos(angle)) * width, y: CGFloat(sin(angle)) * width)
                }
                base.foregroundStyle(color)
            }
        }
    }

    private var baseSize: CGFloat { Platform.isTV ? 44 : Platform.isPhone ? 20 : 28 }
}

extension SubtitleWeight {
    var fontWeight: Font.Weight {
        switch self {
        case .regular: return .regular
        case .medium: return .medium
        case .semibold: return .semibold
        case .bold: return .bold
        case .heavy: return .heavy
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
                // An open options or episodes panel takes this corner; nothing floats over it.
                if session.panelOpen {
                    EmptyView()
                } else if let countdown = session.upNextCountdown, let next = session.upNext {
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
                        .flowGlass(Capsule(), interactive: true, tint: Theme.Palette.overPicture)
                    }
                    .buttonStyle(.plain)
                    .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
            .padding(.trailing, Platform.isPhone ? 24 : 36)
            .padding(.bottom, Platform.isPhone ? 96 : 120)
        }
        .animation(Theme.Motion.gentle, value: session.activeSegment)
        .animation(Theme.Motion.gentle, value: session.panelOpen)
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
                    .foregroundStyle(Theme.Palette.textSecondary)
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
        // It sits on the picture with no scrim; clear glass let its grey text vanish into a bright frame.
        .flowGlass(RoundedRectangle(cornerRadius: 22, style: .continuous), tint: Theme.Palette.overPicture)
    }
}

struct CircleButton: View {
    let systemImage: String
    /// What VoiceOver says, and the Mac's tooltip: an icon alone reads as its symbol's name.
    let label: String
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
        .accessibilityLabel(label)
        #if os(macOS)
        .help(label)
        #endif
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
    /// X-Ray opened itself on pause, so it closes itself on play.
    @State private var xrayFromPause = false
    /// A finger held on the picture: double speed until it lifts.
    @State private var boosting = false
    @State private var heldBack = false
    @State private var audioOptions: [AVMediaSelectionOption] = []
    @State private var legibleOptions: [AVMediaSelectionOption] = []
    @State private var audioGroup: AVMediaSelectionGroup?
    @State private var legibleGroup: AVMediaSelectionGroup?
    @State private var speed = 1.0
    @State private var audioChoice: AVMediaSelectionOption?
    @State private var legibleChoice: AVMediaSelectionOption?
    @State private var showsOptions = false
    @State private var showsEpisodes = false
    @State private var showsChapters = false
    @State private var showsAdvanced = false
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
                        // Hold for double speed, as long as the finger stays down.
                        .onLongPressGesture(minimumDuration: 0.45, maximumDistance: 40) {
                            guard session.player.rate > 0 else { return }
                            session.noteInteraction()
                            boosting = true
                            session.player.rate = 2
                        } onPressingChanged: { pressing in
                            guard !pressing, boosting else { return }
                            boosting = false
                            session.player.rate = Float(speed)
                        }
                }
                .ignoresSafeArea()
            }
            .overlay(alignment: .top) {
                if boosting {
                    Label("2×", systemImage: "forward.fill")
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .flowGlass(Capsule(), tint: Theme.Palette.overPicture)
                        .padding(.top, 20)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                        .accessibilityLabel("Playing at double speed")
                }
            }
            .animation(Theme.Motion.snappy, value: boosting)
            .sensoryFeedback(.impact(weight: .light), trigger: seekFlash?.id) { _, new in new != nil }
            .sensoryFeedback(.impact(weight: .medium), trigger: boosting) { _, new in new }
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
                // Picture subtitles are placed on the video, which fills the screen.
                .ignoresSafeArea()

            // The still-watching question stands alone: nothing else of the player shows through it.
            if visible, !session.asksStillWatching {
                controls.transition(.opacity)
            }

            PlayerOptionsPanel(session: session, media: mediaOptions, isPresented: $showsOptions, fill: $fill,
                               showSearch: { showSubtitles = true }, showAdvanced: { showsAdvanced = true })
            if hasEpisodes {
                EpisodeShelf(session: session, isPresented: $showsEpisodes)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: visible)
        .onAppear { scheduleHide() }
        // The controls stay up while a panel or the sheet is open, then go back to timing out.
        .onChange(of: overlayOpen) { _, open in
            session.panelOpen = showsOptions || showsEpisodes || showsChapters
            if open { hideTask?.cancel(); visible = true } else { scheduleHide() }
        }
        .sheet(isPresented: $showsAdvanced) {
            AdvancedPlayerOptions(session: session, media: mediaOptions, showSearch: {
                // Let this sheet finish dismissing before the search sheet comes up.
                Task {
                    try? await Task.sleep(nanoseconds: 450_000_000)
                    showSubtitles = true
                }
            })
            .environment(model)
        }
        // Again whenever a stream becomes ready (a remuxed MKV has no item for its first seconds, and a
        // source or episode switch brings new tracks).
        .task(id: "\(session.itemGeneration)-\(session.phase == .playing)") { await loadMediaOptions() }
        .onChange(of: session.tourPanel) { _, panel in
            visible = true
            showsOptions = panel == "options"
            showsAdvanced = panel == "advanced"
        }
        .onChange(of: session.tourScrubPreview) { _, time in
            hideTask?.cancel()
            visible = true
            updatePreview(time)
        }
        .onReceive(NotificationCenter.default.publisher(for: AVPlayer.rateDidChangeNotification, object: session.player)) { _ in
            isPlaying = session.player.rate > 0
        }
        .onChange(of: isPlaying) { _, playing in
            if playing {
                if xrayFromPause { session.showsXRay = false }
                xrayFromPause = false
            } else if model.settings.playback.xrayWhenPaused, session.phase == .playing, scrubbing == nil,
                      !session.showsXRay, !session.showsInfo, !ScreenshotTour.isRequested {
                xrayFromPause = true
                session.showsXRay = true
            }
        }
    }

    /// Laid out like Apple's own players: what you leave by top left, sound top right, the title and
    /// scrubber along the bottom with the panels' buttons at its end, the transport in the middle.
    private var controls: some View {
        ZStack {
            LinearGradient(stops: [.init(color: .black.opacity(0.55), location: 0), .init(color: .clear, location: 0.22),
                                   .init(color: .clear, location: 0.55), .init(color: .black.opacity(0.8), location: 1)],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            VStack(spacing: 0) {
                HStack(alignment: .center) {
                    PlayerCluster {
                        ClusterButton(systemImage: "xmark", label: "Close Player") { session.stop() }
                        if let pip {
                            ClusterButton(systemImage: "pip.enter", label: "Picture in Picture") { pip.startPictureInPicture() }
                        }
                        ClusterButton(systemImage: session.showsInfo ? "info.circle.fill" : "info.circle", label: "Playback Info") { session.showsInfo.toggle() }
                        RoutePicker()
                            .frame(width: 44, height: 44)
                            .accessibilityLabel("AirPlay")
                    }
                    Spacer(minLength: 12)
                    // iPhone in portrait has no room for it; the side buttons do the job there.
                    if !Platform.isPhone || verticalSizeClass == .compact {
                        VolumePill(volume: volume) { editing in
                            if editing { hideTask?.cancel() } else { scheduleHide() }
                        }
                    }
                }
                .padding(.top, 8)

                Spacer()

                GlassGroup(spacing: 28) {
                    HStack(spacing: Platform.isPhone ? 36 : 48) {
                        transportButton("gobackward.\(model.settings.playback.seekBackwardSeconds)", label: "Back \(model.settings.playback.seekBackwardSeconds) Seconds", size: 60) {
                            // The lift that ends a hold also reads as a tap: the replay has already gone back.
                            if heldBack { heldBack = false; return }
                            seek(by: -Double(model.settings.playback.seekBackwardSeconds))
                        }
                        // Held: "What did they say?" — back ten seconds with subtitles on.
                        .simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                            heldBack = true
                            session.replayWithSubtitles()
                            scheduleHide()
                        })
                        // A finger that slides off before lifting sends no tap, so clear the flag on the lift
                        // itself (a turn later, after any tap from the same lift), or the next tap is lost.
                        .simultaneousGesture(DragGesture(minimumDistance: 0).onEnded { _ in
                            DispatchQueue.main.async { heldBack = false }
                        })
                        .accessibilityAction(named: "What Did They Say?") { session.replayWithSubtitles() }
                        transportButton(isPlaying ? "pause.fill" : "play.fill", label: isPlaying ? "Pause" : "Play", size: 84) { togglePlay() }
                        transportButton("goforward.\(model.settings.playback.seekForwardSeconds)", label: "Forward \(model.settings.playback.seekForwardSeconds) Seconds", size: 60) {
                            seek(by: Double(model.settings.playback.seekForwardSeconds))
                        }
                    }
                }
                // A landscape iPhone has no room for both: with a panel open on the left, the buttons move right.
                .offset(x: Platform.isPhone && (session.showsInfo || session.showsXRay) ? 150 : 0)
                .animation(Theme.Motion.gentle, value: session.showsInfo || session.showsXRay)
                .opacity(showsChapters ? 0 : 1)

                Spacer()

                if showsChapters {
                    ChapterStrip(session: session) { withAnimation(Theme.Motion.snappy) { showsChapters = false } }
                        .padding(.bottom, 14)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                HStack(alignment: .bottom, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(session.title)
                            .font(.system(size: Platform.isPhone ? 17 : 20, weight: .semibold))
                            .lineLimit(1)
                        if let line = session.subtitleLine {
                            Text(line)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Theme.Palette.textSecondary)
                                .lineLimit(1)
                        }
                    }
                    .shadow(color: .black.opacity(0.5), radius: 6)
                    Spacer(minLength: 8)
                    PlayerCluster {
                        if hasEpisodes || !session.chapters.isEmpty {
                            ClusterButton(systemImage: "square.grid.2x2", label: hasEpisodes ? "Episodes" : "Chapters",
                                          active: showsEpisodes || showsChapters, action: toggleBrowse)
                        }
                        ClusterButton(systemImage: "person.crop.rectangle.stack", label: "X-Ray", active: session.showsXRay) {
                            xrayFromPause = false
                            session.showsXRay.toggle()
                        }
                        ClusterButton(systemImage: "gearshape.fill", label: "Options", active: showsOptions, action: toggleOptions)
                    }
                }

                Scrubber(current: session.displayTime, duration: session.duration, buffered: buffered,
                         preview: preview, previewTime: previewTime,
                         segments: session.segments, chapters: session.chapters.map(\.start),
                         onScrub: { value in
                             scrubbing = value
                             if value != nil { hideTask?.cancel() } else { scheduleHide() }
                             updatePreview(value)
                             // Without preview pictures, the picture itself follows the finger.
                             if let value, session.scrubPreviewer == nil { session.previewSeek(to: value) }
                         },
                         onCommit: { target in session.seek(to: target) })
                    .padding(.top, 12)
                    .padding(.bottom, 4)
            }
            .padding(.horizontal, Platform.isPhone ? 16 : 28)
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

    private func transportButton(_ symbol: String, label: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: size, height: size)
                .flowGlass(Circle(), interactive: true)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
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

    /// What the options panel and Advanced Options read and change.
    private var mediaOptions: PlayerMediaOptions {
        PlayerMediaOptions(audio: audioOptions, audioSelection: audioChoice,
                           legible: legibleOptions, legibleSelection: legibleChoice, speed: speed,
                           selectAudio: { select($0, characteristic: .audible) },
                           selectLegible: { select($0, characteristic: .legible) },
                           setSpeed: setRate)
    }

    private var hasEpisodes: Bool { session.request.episode != nil && !session.seasonEpisodes.isEmpty }
    private var overlayOpen: Bool { showsOptions || showsEpisodes || showsChapters || showsAdvanced }

    private func toggleOptions() {
        audioChoice = selected(in: audioGroup)
        legibleChoice = selected(in: legibleGroup)
        withAnimation(Theme.Motion.snappy) {
            showsEpisodes = false
            showsChapters = false
            showsOptions.toggle()
        }
    }

    /// The grid button: a show's episodes, or a film's chapters.
    private func toggleBrowse() {
        withAnimation(Theme.Motion.snappy) {
            showsOptions = false
            if hasEpisodes { showsEpisodes.toggle() } else { showsChapters.toggle() }
        }
    }

    private func toggle() {
        session.noteInteraction()
        visible.toggle()
        if visible { scheduleHide() }
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if !Task.isCancelled, isPlaying, scrubbing == nil, !overlayOpen { visible = false }
        }
    }

    private func togglePlay() {
        if session.player.rate > 0 { session.player.pause() } else { session.player.playImmediately(atRate: Float(speed)) }
        scheduleHide()
    }

    private func seek(by seconds: Double) {
        // The session adds quick repeated skips up, and doesn't clamp to a duration that isn't known yet.
        session.seek(by: seconds)
        scheduleHide()
    }

    private func loadMediaOptions() async {
        guard let asset = session.player.currentItem?.asset else {
            // Between streams (a source or episode switch) the last one's tracks mustn't stay on offer.
            audioGroup = nil; audioOptions = []; audioChoice = nil
            legibleGroup = nil; legibleOptions = []; legibleChoice = nil
            return
        }
        let audio = try? await asset.loadMediaSelectionGroup(for: .audible)
        let legible = try? await asset.loadMediaSelectionGroup(for: .legible)
        // Replaced while the groups loaded: they belong to a stream that's gone.
        guard !Task.isCancelled, session.player.currentItem?.asset === asset else { return }
        audioGroup = audio
        audioOptions = audio?.options ?? []
        legibleGroup = legible
        legibleOptions = legible?.options ?? []
        audioChoice = selected(in: audioGroup)
        legibleChoice = selected(in: legibleGroup)
    }

    private func selected(in group: AVMediaSelectionGroup?) -> AVMediaSelectionOption? {
        guard let group, let item = session.player.currentItem else { return nil }
        return item.currentMediaSelection.selectedMediaOption(in: group)
    }

    private func select(_ option: AVMediaSelectionOption?, characteristic: AVMediaCharacteristic) {
        guard let item = session.player.currentItem else { return }
        // Shown at once; the group loads asynchronously.
        if characteristic == .audible { audioChoice = option } else if characteristic == .legible { legibleChoice = option }
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
/// Turns an iPhone to landscape for the player and back afterwards.
///
/// Asking for landscape alone isn't enough: while the app still allows portrait, iOS turns back to
/// match how the phone is held, then forward again as the request lands, so the picture flips a few
/// times. The app's allowed orientations (FlowAppDelegate) narrow to landscape first, and widen
/// again only when the player closes.
enum OrientationLock {
    /// What the app allows right now; FlowAppDelegate hands this to iOS.
    static var allowed: UIInterfaceOrientationMask = .allButUpsideDown

    static func landscape() {
        guard Platform.isPhone, allowed != .landscape else { return }
        apply(allowed: .landscape, request: .landscape)
    }

    static func restore() {
        guard Platform.isPhone, allowed != .allButUpsideDown else { return }
        apply(allowed: .allButUpsideDown, request: .portrait)
    }

    private static func apply(allowed mask: UIInterfaceOrientationMask, request: UIInterfaceOrientationMask) {
        allowed = mask
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
        for window in scene.windows {
            window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: request)) { _ in }
    }
}

/// Only here to tell iOS which orientations the app allows at the moment (see OrientationLock).
final class FlowAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        Platform.isPhone ? OrientationLock.allowed : .all
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
                content.flowGlass(RoundedRectangle(cornerRadius: 18, style: .continuous), tint: Theme.Palette.overPicture)
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
            // Hidden under the still-watching question, which stands alone.
            if !session.asksStillWatching {
                if let subtitle = session.subtitle {
                    // Its own clock, a tenth of a second: the session's half-second tick would show lines late.
                    TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                        let now = session.player.currentTime().seconds
                        let time = now.isFinite ? now : session.currentTime
                        SubtitleOverlay(text: subtitle.text(at: time, offset: session.subtitleOffset), settings: settings,
                                        cues: settings.keepASSStyling ? subtitle.cues(at: time, offset: session.subtitleOffset) : [])
                    }
                }
                if let bitmap = session.bitmapSubtitle {
                    BitmapSubtitleView(overlay: bitmap)
                }
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

/// After several episodes in a row with nobody touching anything: carry on, or call it a night.
struct StillWatchingPrompt: View {
    let session: PlaybackSession

    var body: some View {
        ZStack {
            Color.black.opacity(0.72).ignoresSafeArea()
            VStack(spacing: Theme.Space.m) {
                Image(systemName: "moon.zzz.fill")
                    .font(.system(size: 34 * Theme.scale, weight: .semibold))
                    .foregroundStyle(Theme.Palette.textSecondary)
                Text("Are You Still Watching?").font(Theme.Typeface.title)
                if let next = session.upNext?.episode {
                    Text("Next: \(next.code) · \(next.title)")
                        .font(Theme.Typeface.body)
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(1)
                }
                #if os(tvOS)
                // Apple TV answers from the player's own button (Keep Watching), or Menu to stop.
                Text("Choose Keep Watching, or press Menu to stop.")
                    .font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary)
                #else
                VStack(spacing: Theme.Space.s) {
                    Button { session.confirmStillWatching() } label: {
                        Label("Continue Watching", systemImage: "play.fill").frame(minWidth: 220)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button("Stop") { session.stop() }.buttonStyle(GlassButtonStyle())
                }
                .padding(.top, Theme.Space.s)
                #endif
            }
            .padding(Theme.Space.xl)
        }
        #if os(tvOS)
        .allowsHitTesting(false)
        #endif
    }
}
