import SwiftUI
import FlowKit

/// Speeds the built-in player's panels offer (the Apple path's list lives with the iPhone panel).
enum UniversalSpeed {
    static let choices: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 2]
    static func label(_ rate: Double) -> String { rate == 1 ? "Normal" : String(format: "%gx", rate) }
}

#if os(macOS)
/// The Mac's transport for the built-in player. AVPlayerView draws the floating controls of Apple's
/// player; this is their counterpart: play and pause, skips, and the same scrubber the iPhone has,
/// over the picture. A click on the picture plays or pauses, and the bar fades while the pointer rests.
struct UniversalMacControls: View {
    let session: PlaybackSession
    @Environment(AppModel.self) private var model
    @State private var visible = true
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { session.togglePlay(); poke() }
            if visible || !session.isPlaying {
                VStack(spacing: 0) {
                    Spacer()
                    bar
                }
                .transition(.opacity)
            }
        }
        .onContinuousHover { phase in if case .active = phase { poke() } }
        .animation(.easeInOut(duration: 0.2), value: visible)
        .onAppear { poke() }
    }

    private var bar: some View {
        VStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(session.title)
                    .font(.custom(Theme.Face.condensed, size: 22, relativeTo: .title3))
                    .foregroundStyle(Theme.Palette.fg)
                    .lineLimit(1)
                if let line = session.subtitleLine {
                    Text(line).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.muted).lineLimit(1)
                }
                Spacer()
            }
            .shadow(color: .black.opacity(0.5), radius: 6)
            HStack(spacing: 14) {
                transport("gobackward.\(model.settings.playback.seekBackwardSeconds)", label: "Back \(model.settings.playback.seekBackwardSeconds) Seconds", size: 22) {
                    session.seek(by: -Double(model.settings.playback.seekBackwardSeconds)); poke()
                }
                transport(session.isPlaying ? "pause.fill" : "play.fill", label: session.isPlaying ? "Pause" : "Play", size: 28) {
                    session.togglePlay(); poke()
                }
                transport("goforward.\(model.settings.playback.seekForwardSeconds)", label: "Forward \(model.settings.playback.seekForwardSeconds) Seconds", size: 22) {
                    session.seek(by: Double(model.settings.playback.seekForwardSeconds)); poke()
                }
                Scrubber(current: session.displayTime, duration: session.duration, buffered: session.bufferedFraction,
                         segments: session.segments, chapters: session.chapters.map(\.start),
                         onScrub: { value in
                             if value != nil { hideTask?.cancel() } else { poke() }
                             if let value { session.previewSeek(to: value) }
                         },
                         onCommit: { session.seek(to: $0) })
            }
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 22)
        .padding(.top, 56)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom))
    }

    private func transport(_ symbol: String, label: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .medium))
                .frame(width: size + 18, height: size + 18)
        }
        .buttonStyle(PlayerButtonStyle())
        .accessibilityLabel(label)
    }

    private func poke() {
        visible = true
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled { visible = false }
        }
    }
}

/// Audio and subtitles for the built-in player, in the Mac bar: AVPlayerView has these menus built in, this one doesn't.
struct UniversalTrackMenu: View {
    let session: PlaybackSession
    let universal: UniversalPlayer

    var body: some View {
        Menu {
            if !universal.audioTracks.isEmpty {
                Picker("Audio", selection: Binding(get: { universal.selectedAudio }, set: { id in if let id { session.chooseUniversalAudio(id) } })) {
                    ForEach(universal.audioTracks) { Text($0.title).tag(Int?.some($0.id)) }
                }
                .pickerStyle(.inline)
            }
            Picker("Subtitles", selection: Binding(get: { session.subtitleTrack == nil ? universal.selectedSubtitle : nil }, set: { session.chooseUniversalSubtitle($0) })) {
                Text("Off").tag(Int?.none)
                ForEach(universal.subtitleTracks) { Text($0.title).tag(Int?.some($0.id)) }
            }
            .pickerStyle(.inline)
        } label: {
            Image(systemName: universal.selectedSubtitle == nil && session.subtitleTrack == nil ? "captions.bubble" : "captions.bubble.fill").macBarIcon()
        }
        .macBarMenu(label: "Audio and Subtitles")
    }
}
#endif

#if os(tvOS)
/// The Apple TV transport for the built-in player, in the style of the system player's. The Siri Remote does
/// what it does there: Select and Play/Pause toggle, left and right skip (held, they go faster), Down opens
/// a panel with Audio, Subtitles, Speed and Chapters, and Menu closes the panel and then the player.
/// Something always has focus: the transport (its scrubber lights while it does), a panel row, or the
/// button for Skip Intro, Up Next and Keep Watching.
struct UniversalTVPlayer: View {
    let session: PlaybackSession
    let universal: UniversalPlayer
    let model: AppModel
    var onSubtitleSearch: () -> Void

    enum Page: String, CaseIterable, Identifiable {
        case audio, subtitles, speed, chapters, details
        var id: String { rawValue }
        var title: String { self == .details ? "Details" : rawValue.capitalized }
    }

    private enum Focus: Hashable {
        case transport, action, chip(Page), row(String)
    }

    @State private var showsControls = true
    @State private var page: Page?
    @State private var scrubTarget: Double?
    @State private var streak = 0
    @State private var lastNudge = Date.distantPast
    @State private var lastDirection = 0.0
    @State private var hideTask: Task<Void, Never>?
    @State private var commitTask: Task<Void, Never>?
    @FocusState private var focus: Focus?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            UniversalSurface(player: universal).ignoresSafeArea()
            TVContentOverlay(session: session, settings: model.settings.subtitles)
            // Takes the remote while nothing else has it.
            Button { select() } label: { Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity) }
                .buttonStyle(TVCaptureStyle())
                .focused($focus, equals: .transport)
                .onMoveCommand(perform: move)
                .onPlayPauseCommand { select() }
            if controlsShown { transport.transition(.opacity) }
            if let action { actionButton(action).transition(.scale(scale: 0.94, anchor: .bottomTrailing).combined(with: .opacity)) }
            if let page {
                panel(page)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                    .padding(.trailing, 80)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(Theme.Motion.gentle, value: controlsShown)
        .animation(Theme.Motion.gentle, value: page)
        .animation(Theme.Motion.gentle, value: action?.title)
        .onExitCommand { back() }
        .defaultFocus($focus, .transport)
        .onAppear { reveal() }
        .onChange(of: session.isPlaying) { _, _ in reveal() }
        .onChange(of: action?.title) { _, title in
            // The question must be answered; the other buttons only appear and wait.
            if session.asksStillWatching { focus = .action } else if title == nil, focus == .action { focus = .transport }
        }
        .onChange(of: session.tourPanel) { _, panel in
            switch panel {
            case "universal-audio": open(.audio)
            case "universal-subtitles": open(.subtitles)
            default: if panel == "controls" { page = nil; focus = .transport; showsControls = true }
            }
        }
    }

    // MARK: Transport

    private var controlsShown: Bool { (showsControls || !session.isPlaying || scrubTarget != nil) && page == nil }

    private var transport: some View {
        VStack {
            Spacer()
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline, spacing: 20) {
                    Text(session.title)
                        .font(Theme.Typeface.title)
                        .foregroundStyle(Theme.Palette.fg)
                        .lineLimit(1)
                    if let line = session.subtitleLine {
                        Text(line).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.muted).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: session.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(Theme.Palette.fg)
                        .accessibilityHidden(true)
                }
                TVScrubBar(current: scrubTarget ?? session.displayTime, duration: session.duration, buffered: session.bufferedFraction,
                           lit: focus == .transport, segments: session.segments)
                HStack {
                    Text(TimeFormat.clock(scrubTarget ?? session.displayTime))
                    Spacer()
                    Text("Down for audio and subtitles")
                        .font(Theme.Typeface.caption)
                        .foregroundStyle(Theme.Palette.textTertiary)
                    Spacer()
                    Text("-" + TimeFormat.clock(max(0, session.duration - (scrubTarget ?? session.displayTime))))
                }
                .font(Theme.Typeface.time)
                .foregroundStyle(Theme.Palette.fg)
            }
            .padding(.horizontal, 90)
            .padding(.top, 90)
            .padding(.bottom, 56)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
        }
        .shadow(color: .black.opacity(0.5), radius: 6)
        .allowsHitTesting(false)
    }

    /// The button the system player would offer as a contextual action.
    private var action: (title: String, icon: String, run: () -> Void)? {
        if session.asksStillWatching {
            return ("Keep Watching", "play.fill", { session.confirmStillWatching() })
        } else if let segment = session.activeSegment {
            return (segment.kind.buttonTitle, "forward.end.fill", { session.skip(segment) })
        } else if session.showsSuggestions, session.phase == .playing {
            return ("More Like This", "rectangle.stack", { session.endWithSuggestions() })
        } else if let countdown = session.upNextCountdown {
            return ("Up Next in \(countdown)", "forward.fill", { Task { await session.playUpNext() } })
        }
        return nil
    }

    private func actionButton(_ action: (title: String, icon: String, run: () -> Void)) -> some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Button(action: action.run) {
                    Label(action.title, systemImage: action.icon).lineLimit(1)
                }
                .buttonStyle(PlayerActionStyle(prominent: true))
                .focused($focus, equals: .action)
            }
            .padding(.trailing, 90)
            .padding(.bottom, controlsShown ? 330 : 90)
        }
    }

    // MARK: Remote

    private func select() {
        session.togglePlay()
        reveal()
    }

    private func move(_ direction: MoveCommandDirection) {
        switch direction {
        case .left: nudge(-Double(model.settings.playback.seekBackwardSeconds))
        case .right: nudge(Double(model.settings.playback.seekForwardSeconds))
        case .up:
            if action != nil { focus = .action } else { reveal() }
        case .down:
            open(.audio)
        @unknown default:
            break
        }
    }

    /// Left and right skip by the usual step; pressed again in a row, the steps grow, so a long jump is a held press.
    private func nudge(_ seconds: Double) {
        session.noteInteraction()
        let direction = seconds < 0 ? -1.0 : 1.0
        if Date().timeIntervalSince(lastNudge) < 0.5, direction == lastDirection { streak += 1 } else { streak = 0 }
        lastNudge = Date()
        lastDirection = direction
        let growth = [1.0, 1.0, 2.0, 3.0, 6.0][min(streak, 4)]
        let base = scrubTarget ?? session.displayTime
        let target = max(0, min(session.duration > 0 ? session.duration : .greatestFiniteMagnitude, base + seconds * growth))
        scrubTarget = target
        showsControls = true
        hideTask?.cancel()
        commitTask?.cancel()
        commitTask = Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard !Task.isCancelled else { return }
            session.seek(to: target)
            scrubTarget = nil
            reveal()
        }
    }

    /// Menu closes a panel first, then the player.
    private func back() {
        if page != nil {
            page = nil
            focus = .transport
        } else {
            session.stop()
        }
    }

    private func reveal() {
        showsControls = true
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if !Task.isCancelled, session.isPlaying { showsControls = false }
        }
    }

    private func open(_ next: Page) {
        guard session.phase == .playing || session.phase == .finished || page != nil else { return }
        hideTask?.cancel()
        page = next
        DispatchQueue.main.async { focus = .chip(next) }
    }

    // MARK: Panel

    private func panel(_ current: Page) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 14) {
                ForEach(Page.allCases) { item in
                    Button(item.title) { page = item }
                        .buttonStyle(PlayerChipStyle(current: item == current))
                        .focused($focus, equals: .chip(item))
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 6) { rows(for: current) }
                    .padding(.vertical, 4)
            }
            .focusSection()
        }
        .padding(36)
        .frame(width: 1040, height: 700, alignment: .topLeading)
        .playerPanel()
        .focusSection()
    }

    @ViewBuilder
    private func rows(for page: Page) -> some View {
        switch page {
        case .audio:
            if universal.audioTracks.isEmpty { note("This video has no other audio.") }
            ForEach(universal.audioTracks) { track in
                row("audio-\(track.id)", track.title, checked: universal.selectedAudio == track.id) { session.chooseUniversalAudio(track.id) }
            }
        case .subtitles:
            row("sub-off", "Off", checked: universal.selectedSubtitle == nil && session.subtitleTrack == nil) {
                session.chooseUniversalSubtitle(nil)
                Task { await session.selectSubtitle(nil) }
            }
            if let track = session.subtitleTrack {
                row("sub-downloaded", track.languageName, detail: track.release.isEmpty ? track.provider : track.release, checked: true) {}
            }
            ForEach(universal.subtitleTracks) { track in
                row("sub-\(track.id)", track.title, checked: session.subtitleTrack == nil && universal.selectedSubtitle == track.id) { session.chooseUniversalSubtitle(track.id) }
            }
            row("sub-search", "Search for More…", checked: false) {
                self.page = nil
                focus = .transport
                onSubtitleSearch()
            }
        case .speed:
            ForEach(UniversalSpeed.choices, id: \.self) { rate in
                row("speed-\(rate)", UniversalSpeed.label(rate), checked: universal.speed == rate) { session.setPlaybackSpeed(rate) }
            }
        case .chapters:
            if session.chapters.isEmpty { note("This video has no chapters.") }
            ForEach(session.chapters) { chapter in
                row("chapter-\(chapter.id)", chapter.title.isEmpty ? TimeFormat.clock(chapter.start) : chapter.title, detail: TimeFormat.clock(chapter.start), checked: false) {
                    session.seek(toChapter: chapter)
                    self.page = nil
                    focus = .transport
                }
            }
        case .details:
            PlaybackInfoPanel(session: session, card: false)
        }
    }

    private func row(_ id: String, _ title: String, detail: String? = nil, checked: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Text(title).font(Theme.Typeface.control).lineLimit(1)
                Spacer(minLength: 16)
                if let detail { Text(detail).font(Theme.Typeface.caption).opacity(0.7).lineLimit(1) }
                Image(systemName: "checkmark").font(.system(size: 26, weight: .semibold)).opacity(checked ? 1 : 0)
            }
        }
        .buttonStyle(PlayerRowStyle())
        .focused($focus, equals: .row(id))
    }

    private func note(_ text: String) -> some View {
        Text(text).font(Theme.Typeface.body).foregroundStyle(Theme.Palette.textSecondary).padding(Theme.Space.xs)
    }
}

/// The scrubber of the Apple TV transport: a thin track, thicker with a knob while the transport has focus.
private struct TVScrubBar: View {
    let current: Double
    let duration: Double
    let buffered: Double
    let lit: Bool
    let segments: [SkipSegment]

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let fraction = duration > 0 ? min(1, max(0, current / duration)) : 0
            ZStack(alignment: .leading) {
                ZStack(alignment: .leading) {
                    Rectangle().fill(.white.opacity(0.28))
                    Rectangle().fill(.white.opacity(0.4)).frame(width: width * min(1, buffered))
                    Rectangle().fill(Theme.Palette.red).frame(width: width * fraction)
                    ForEach(segments.filter { $0.end > $0.start && duration > 0 && $0.end <= duration }, id: \.start) { segment in
                        Rectangle().fill(.black.opacity(0.7)).frame(width: 3).offset(x: width * segment.start / duration)
                    }
                }
                .clipShape(Capsule())
                .frame(height: lit ? 16 : 8)
                if lit {
                    Circle().fill(.white)
                        .frame(width: 30, height: 30)
                        .shadow(color: .black.opacity(0.4), radius: 6)
                        .offset(x: width * fraction - 15)
                }
            }
            .frame(maxHeight: .infinity)
            .animation(Theme.Motion.snappy, value: lit)
        }
        .frame(height: 34)
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue("\(TimeFormat.clock(current)) of \(TimeFormat.clock(duration))")
    }
}

/// The full-screen button that takes the remote: it draws nothing, not even a focus platter.
private struct TVCaptureStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label }
}
#endif
