#if os(iOS)
import SwiftUI
import AVFoundation
import FlowKit

/// Playback speeds on offer, in one place so the options panel and Advanced Options agree.
enum PlaybackSpeed {
    static let choices: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 2]

    static func label(_ rate: Double) -> String {
        rate == 1 ? "Normal" : String(format: "%gx", rate)
    }
}

/// The media-selection state the panel shows. It lives in `IOSPlayerControls`, which owns the
/// AVFoundation groups, so the panel only reads values and calls back.
struct PlayerMediaOptions {
    var audio: [AVMediaSelectionOption] = []
    var audioSelection: AVMediaSelectionOption?
    var legible: [AVMediaSelectionOption] = []
    var legibleSelection: AVMediaSelectionOption?
    var speed = 1.0
    let selectAudio: (AVMediaSelectionOption) -> Void
    let selectLegible: (AVMediaSelectionOption?) -> Void
    let setSpeed: (Double) -> Void

    /// "Off", or the picture, embedded or downloaded subtitle on screen.
    @MainActor func subtitleSummary(for session: PlaybackSession) -> String {
        if let id = session.selectedBitmapTrack, let track = session.bitmapTracks.first(where: { $0.id == id }) { return track.title }
        if let option = legibleSelection { return option.title }
        if let track = session.subtitleTrack { return track.languageName }
        return "Off"
    }
}

/// A row of player buttons on one glass capsule: close, picture in picture, info and AirPlay at the
/// top; episodes or chapters, X-Ray and options at the bottom.
///
/// The glass isn't interactive: interactive glass answers touches itself, and on iOS 26 it can take
/// the first tap meant for a button inside it, which is why options sometimes needed a second tap.
struct PlayerCluster<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 2) { content }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .flowGlass(Capsule(), tint: Theme.Palette.overPicture)
    }
}

struct ClusterButton: View {
    let systemImage: String
    let label: String
    /// Lit while its panel is open.
    var active = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background { if active { Circle().fill(.white.opacity(0.2)) } }
                .contentShape(Circle())
        }
        .buttonStyle(ClusterButtonStyle())
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

private struct ClusterButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background { if configuration.isPressed { Circle().fill(.white.opacity(0.18)) } }
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
    }
}

/// A film's chapters as a row of pictures above the scrubber, the current one marked, each a tap
/// from its start.
struct ChapterStrip: View {
    let session: PlaybackSession
    let close: () -> Void

    private var cardWidth: CGFloat { Platform.isPhone ? 168 : 220 }
    private var current: PlayerChapter? { session.chapters.last { $0.start <= session.displayTime + 0.5 } }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(Array(session.chapters.enumerated()), id: \.element.id) { index, chapter in
                        Button {
                            session.seek(toChapter: chapter)
                            close()
                        } label: {
                            card(chapter, number: index + 1, isCurrent: chapter == current)
                        }
                        .buttonStyle(CardButtonStyle())
                        .id(chapter.id)
                        .accessibilityLabel("Chapter \(index + 1), \(chapter.title), \(TimeFormat.clock(chapter.start))")
                    }
                }
                .padding(.horizontal, 2)
            }
            .scrollClipDisabled()
            .onAppear { if let current { proxy.scrollTo(current.id, anchor: .center) } }
        }
    }

    private func card(_ chapter: PlayerChapter, number: Int, isCurrent: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        return VStack(alignment: .leading, spacing: 6) {
            ChapterThumbnail(session: session, time: chapter.start)
                .frame(width: cardWidth, height: cardWidth * 9 / 16)
                .clipShape(shape)
                .overlay(shape.strokeBorder(isCurrent ? Color.white : Color.white.opacity(0.15), lineWidth: isCurrent ? 2.5 : 1))
                .overlay(alignment: .topLeading) {
                    if isCurrent {
                        Text("Now")
                            .font(.system(size: 12, weight: .bold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(.black.opacity(0.6), in: Capsule())
                            .padding(8)
                    }
                }
            HStack(spacing: 6) {
                Text("\(number)").foregroundStyle(Theme.Palette.textTertiary).monospacedDigit()
                Text(chapter.title.isEmpty ? "Chapter \(number)" : chapter.title).lineLimit(1)
            }
            .font(.system(size: 14, weight: .semibold))
            Text(TimeFormat.clock(chapter.start))
                .font(.system(size: 12, weight: .medium).monospacedDigit())
                .foregroundStyle(Theme.Palette.textSecondary)
        }
        .frame(width: cardWidth, alignment: .leading)
        .foregroundStyle(.white)
    }
}

/// The frame at a chapter's start, for MKVs Flow remuxes; a quiet plate otherwise.
private struct ChapterThumbnail: View {
    let session: PlaybackSession
    let time: Double
    @State private var image: CGImage?

    var body: some View {
        ZStack {
            Rectangle().fill(.white.opacity(0.08))
            if let image {
                Image(decorative: image, scale: 1).resizable().aspectRatio(contentMode: .fill)
                    .transition(.opacity)
            }
        }
        // A second in, past the black frame many chapters open on.
        .task(id: time) {
            guard let previewer = session.scrubPreviewer, let found = await previewer.image(at: time + 1) else { return }
            withAnimation(Theme.Motion.fade) { image = found }
        }
    }
}

/// The player's options as one glass card under the top bar. Each row shows its current value and
/// pushes a list inside the same card, so nothing covers the picture more than it has to.
struct PlayerOptionsPanel: View {
    let session: PlaybackSession
    let media: PlayerMediaOptions
    @Binding var isPresented: Bool
    @Binding var fill: Bool
    let showSearch: () -> Void
    let showAdvanced: () -> Void

    private enum Page: Hashable {
        case root, audio, subtitles, source, speed, sleep, chapters

        var title: String {
            switch self {
            case .root: return "Options"
            case .audio: return "Audio"
            case .subtitles: return "Subtitles"
            case .source: return "Source"
            case .speed: return "Speed"
            case .sleep: return "Sleep Timer"
            case .chapters: return "Chapters"
            }
        }
    }

    @State private var page = Page.root
    @State private var listHeight: CGFloat = 0

    /// Clear of the top buttons.
    private let topInset: CGFloat = 60
    /// Just above the bottom row (title, scrubber and the button that opened it).
    private var bottomInset: CGFloat { Platform.isPhone ? 118 : 120 }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottomTrailing) {
                if isPresented {
                    // Tapping anywhere outside the card closes it.
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { close() }
                        .accessibilityHidden(true)
                    card(maxHeight: max(160, proxy.size.height - topInset - bottomInset))
                        .frame(width: min(Platform.isPhone ? 360 : 400, proxy.size.width - 32))
                        .padding(.bottom, bottomInset)
                        .padding(.trailing, Platform.isPhone ? 16 : 28)
                        .transition(.scale(scale: 0.94, anchor: .bottomTrailing).combined(with: .opacity))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottomTrailing)
        }
        .allowsHitTesting(isPresented)
        .animation(Theme.Motion.snappy, value: isPresented)
        .onChange(of: isPresented) { _, open in
            if !open { page = .root }
        }
    }

    // MARK: Card

    private func card(maxHeight: CGFloat) -> some View {
        VStack(spacing: 0) {
            if page != .root {
                header
                Divider().overlay(Theme.Palette.hairline)
            }
            // Sized to its rows, so a short list doesn't leave an empty slab of glass; a long one scrolls.
            ScrollView {
                list.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { listHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: max(44, min(listHeight, maxHeight - (page == .root ? 12 : 60))))
        }
        .padding(.vertical, 6)
        .id(page)
        .transition(.opacity)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .flowGlass(RoundedRectangle(cornerRadius: 26, style: .continuous), tint: Theme.Palette.overPicture)
        .shadow(color: .black.opacity(0.28), radius: 24, y: 8)
        .animation(Theme.Motion.snappy, value: page)
        .accessibilityAction(.escape) { close() }
    }

    private var header: some View {
        Button { go(.root) } label: {
            HStack(spacing: 8) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 22)
                Text(page.title).font(Theme.Typeface.headline)
                Spacer()
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Back to options")
    }

    private var list: some View {
        let rows = items
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                if index > 0 {
                    Divider().overlay(Theme.Palette.hairline).padding(.leading, item.icon == nil ? 16 : 50)
                }
                PanelRow(item: item)
            }
        }
    }

    // MARK: Rows

    private var items: [PanelItem] {
        switch page {
        case .root: return rootItems
        case .audio:
            return media.audio.enumerated().map { index, option in
                PanelItem(id: "audio-\(index)", title: option.title, checked: media.audioSelection == option) {
                    media.selectAudio(option)
                    go(.root)
                }
            }
        case .subtitles: return subtitleItems
        case .source:
            return session.sources.map { source in
                PanelItem(id: source.id, title: source.providerName, detail: sourceDetail(source), checked: source.id == session.source.id) {
                    session.switchSource(to: source)
                    close()
                }
            }
        case .speed:
            return PlaybackSpeed.choices.map { rate in
                PanelItem(id: "speed-\(rate)", title: PlaybackSpeed.label(rate), checked: media.speed == rate) {
                    media.setSpeed(rate)
                    go(.root)
                }
            }
        case .sleep:
            let off = PanelItem(id: "sleep-off", title: "Off", checked: session.sleepTimer == nil) {
                session.sleepTimer = nil
                go(.root)
            }
            return [off] + SleepTimer.choices.map { choice in
                PanelItem(id: choice.id, title: choice.title, checked: session.sleepTimer == choice) {
                    session.sleepTimer = choice
                    go(.root)
                }
            }
        case .chapters:
            let current = session.chapters.last { $0.start <= session.currentTime + 0.5 }
            return session.chapters.enumerated().map { index, chapter in
                PanelItem(id: "chapter-\(index)", title: chapter.title.isEmpty ? "Chapter \(index + 1)" : chapter.title,
                          value: TimeFormat.clock(chapter.start), checked: chapter == current) {
                    session.seek(toChapter: chapter)
                    close()
                }
            }
        }
    }

    private var rootItems: [PanelItem] {
        var rows: [PanelItem] = []
        // Each row names what's chosen, so the panel reads as a summary of how the film is playing.
        if !media.audio.isEmpty {
            rows.append(PanelItem(id: "audio", icon: "music.note", title: media.audioSelection?.title ?? "Audio", chevron: true) { go(.audio) })
        }
        rows.append(PanelItem(id: "subtitles", icon: subtitlesAreOff ? "captions.bubble" : "captions.bubble.fill", title: subtitlesAreOff ? "Subtitles Off" : subtitleSummary, chevron: true) { go(.subtitles) })
        if session.sources.count > 1 {
            let resolution = session.source.traits.resolution
            let title = resolution == .unknown ? session.source.providerName : "\(session.source.providerName) · \(resolution.label)"
            rows.append(PanelItem(id: "source", icon: "square.stack.3d.up", title: title, chevron: true) { go(.source) })
        }
        rows.append(PanelItem(id: "speed", icon: "gauge.with.dots.needle.67percent", title: "Speed · \(PlaybackSpeed.label(media.speed))", chevron: true) { go(.speed) })
        rows.append(PanelItem(id: "sleep", icon: session.sleepTimer == nil ? "moon.zzz" : "moon.zzz.fill", title: "Sleep Timer · \(session.sleepTimer?.title ?? "Off")", chevron: true) { go(.sleep) })
        if !session.chapters.isEmpty {
            rows.append(PanelItem(id: "chapters", icon: "list.bullet", title: "Chapters · \(session.chapters.count)", chevron: true) { go(.chapters) })
        }
        rows.append(PanelItem(id: "zoom", icon: fill ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", title: "Zoom · \(fill ? "Fill" : "Fit")") {
            withAnimation(Theme.Motion.snappy) { fill.toggle() }
        })
        rows.append(PanelItem(id: "replay", icon: "captions.bubble", title: "What Did They Say?") {
            close()
            session.replayWithSubtitles()
        })
        rows.append(PanelItem(id: "song", icon: "shazam.logo", title: "Identify Song", value: session.songs.isListening ? "Listening…" : session.songs.found.first?.title) {
            close()
            session.songs.identify(session)
        })
        rows.append(PanelItem(id: "advanced", icon: "slider.horizontal.3", title: "Advanced Options", chevron: true) {
            close()
            showAdvanced()
        })
        return rows
    }

    private var subtitleItems: [PanelItem] {
        var rows = [PanelItem(id: "off", title: "Off", checked: subtitlesAreOff) {
            clearEmbedded(); clearBitmap()
            // Always, so a search for automatic subtitles still under way knows the viewer wants none.
            Task { await session.selectSubtitle(nil) }
            go(.root)
        }]
        if let track = session.subtitleTrack {
            rows.append(PanelItem(id: "downloaded", title: track.languageName, detail: track.release.isEmpty ? track.provider : track.release, checked: true) { go(.root) })
        }
        for (index, option) in media.legible.enumerated() {
            rows.append(PanelItem(id: "legible-\(index)", title: option.title, checked: media.legibleSelection == option) {
                clearBitmap(); clearDownloaded()
                media.selectLegible(option)
                go(.root)
            })
        }
        for track in session.bitmapTracks {
            rows.append(PanelItem(id: "bitmap-\(track.id)", title: track.title, checked: session.selectedBitmapTrack == track.id) {
                clearEmbedded(); clearDownloaded()
                session.selectBitmapSubtitle(track.id)
                go(.root)
            })
        }
        if session.canAutoSync {
            rows.append(PanelItem(id: "autosync", icon: "waveform", title: "Auto-sync", detail: "Beta", value: session.isAutoSyncing ? "Syncing…" : nil) {
                session.autoSyncSubtitles()
                close()
            })
        }
        rows.append(PanelItem(id: "search", icon: "magnifyingglass", title: "Search for More…") {
            close()
            showSearch()
        })
        return rows
    }

    // MARK: State

    private var subtitlesAreOff: Bool {
        session.subtitleTrack == nil && session.selectedBitmapTrack == nil && media.legibleSelection == nil
    }

    private var subtitleSummary: String { media.subtitleSummary(for: session) }

    private func sourceDetail(_ source: StreamSource) -> String {
        var parts: [String] = []
        if source.traits.resolution != .unknown { parts.append(source.traits.resolution.label) }
        if let bytes = source.traits.sizeBytes, bytes > 0 { parts.append(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)) }
        parts.append(contentsOf: source.traits.hdr)
        if let audio = source.traits.audioCodec { parts.append(audio) }
        return parts.joined(separator: " · ")
    }

    /// Only one kind of subtitle shows at a time, so picking one switches the others off.
    private func clearEmbedded() { if media.legibleSelection != nil { media.selectLegible(nil) } }
    private func clearBitmap() { if session.selectedBitmapTrack != nil { session.selectBitmapSubtitle(nil) } }
    private func clearDownloaded() { if session.subtitleTrack != nil { Task { await session.selectSubtitle(nil) } } }

    private func go(_ next: Page) {
        withAnimation(Theme.Motion.snappy) { page = next }
    }

    private func close() {
        withAnimation(Theme.Motion.snappy) { isPresented = false }
    }
}

/// One row of the panel: a menu entry with a value and chevron, or a choice with a checkmark.
private struct PanelItem: Identifiable {
    let id: String
    var icon: String?
    let title: String
    var detail: String?
    var value: String?
    var checked = false
    var chevron = false
    let action: () -> Void

    init(id: String, icon: String? = nil, title: String, detail: String? = nil, value: String? = nil,
         checked: Bool = false, chevron: Bool = false, action: @escaping () -> Void) {
        self.id = id
        self.icon = icon
        self.title = title
        self.detail = detail
        self.value = value
        self.checked = checked
        self.chevron = chevron
        self.action = action
    }
}

private struct PanelRow: View {
    let item: PanelItem

    var body: some View {
        Button(action: item.action) {
            HStack(spacing: 12) {
                if let icon = item.icon {
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .medium))
                        .frame(width: 22)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(Theme.Typeface.body)
                        .fontWeight(item.checked ? .semibold : .regular)
                        .lineLimit(2)
                    if let detail = item.detail, !detail.isEmpty {
                        Text(detail)
                            .font(Theme.Typeface.caption)
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                if let value = item.value {
                    Text(value)
                        .font(Theme.Typeface.body)
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                if item.checked {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .bold))
                }
                if item.chevron {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.Palette.textTertiary)
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowStyle())
    }
}

/// A soft highlight while pressed, like a native list row.
private struct PanelRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Theme.Palette.surfaceStrong : .clear)
    }
}
#endif
