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

/// Episodes and options joined in one glass capsule, so the two entry points read as a pair.
struct PlayerOptionsButtons: View {
    let showsEpisodes: Bool
    let episodes: () -> Void
    let options: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            if showsEpisodes { button("square.grid.2x2", label: "Episodes", action: episodes) }
            button("gearshape.fill", label: "Options", action: options)
        }
        .flowGlass(Capsule(), interactive: true)
    }

    private func button(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
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

    /// Below the top bar and its gap.
    private let topInset: CGFloat = 56

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                if isPresented {
                    // Tapping anywhere outside the card closes it.
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { close() }
                        .accessibilityHidden(true)
                    card(maxHeight: max(160, proxy.size.height - topInset - 8))
                        .frame(width: min(340, proxy.size.width - 40))
                        .padding(.top, topInset)
                        .padding(.trailing, 20)
                        .transition(.scale(scale: 0.94, anchor: .topTrailing).combined(with: .opacity))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topTrailing)
        }
        .allowsHitTesting(isPresented)
        .animation(Theme.Motion.snappy, value: isPresented)
        .onChange(of: isPresented) { _, open in
            if !open { page = .root }
        }
    }

    // MARK: Card

    private func card(maxHeight: CGFloat) -> some View {
        ZStack(alignment: .top) {
            // Short lists sit at their natural height; long ones scroll under the header.
            ViewThatFits(in: .vertical) {
                content(scrolls: false)
                content(scrolls: true)
            }
            .id(page)
            .transition(.opacity)
        }
        .frame(maxHeight: maxHeight, alignment: .top)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .flowGlass(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: .black.opacity(0.28), radius: 24, y: 8)
        .animation(Theme.Motion.snappy, value: page)
        .accessibilityAction(.escape) { close() }
    }

    private func content(scrolls: Bool) -> some View {
        VStack(spacing: 0) {
            if page != .root {
                header
                Divider().overlay(Theme.Palette.hairline)
            }
            if scrolls {
                ScrollView { list }
                    .scrollBounceBehavior(.basedOnSize)
            } else {
                list
            }
        }
        .padding(.vertical, 6)
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
        if !media.audio.isEmpty {
            rows.append(PanelItem(id: "audio", icon: "waveform", title: "Audio", value: media.audioSelection?.title ?? "Default", chevron: true) { go(.audio) })
        }
        rows.append(PanelItem(id: "subtitles", icon: subtitlesAreOff ? "captions.bubble" : "captions.bubble.fill", title: "Subtitles", value: subtitleSummary, chevron: true) { go(.subtitles) })
        if session.sources.count > 1 {
            let resolution = session.source.traits.resolution
            let value = resolution == .unknown ? session.source.providerName : "\(session.source.providerName) · \(resolution.label)"
            rows.append(PanelItem(id: "source", icon: "square.stack.3d.up", title: "Source", value: value, chevron: true) { go(.source) })
        }
        rows.append(PanelItem(id: "speed", icon: "speedometer", title: "Speed", value: PlaybackSpeed.label(media.speed), chevron: true) { go(.speed) })
        rows.append(PanelItem(id: "sleep", icon: session.sleepTimer == nil ? "moon.zzz" : "moon.zzz.fill", title: "Sleep Timer", value: session.sleepTimer?.title ?? "Off", chevron: true) { go(.sleep) })
        if !session.chapters.isEmpty {
            rows.append(PanelItem(id: "chapters", icon: "list.bullet", title: "Chapters", value: "\(session.chapters.count)", chevron: true) { go(.chapters) })
        }
        rows.append(PanelItem(id: "zoom", icon: fill ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", title: "Zoom", value: fill ? "Fill" : "Fit") {
            withAnimation(Theme.Motion.snappy) { fill.toggle() }
        })
        rows.append(PanelItem(id: "advanced", icon: "slider.horizontal.3", title: "Advanced Options", chevron: true) {
            close()
            showAdvanced()
        })
        return rows
    }

    private var subtitleItems: [PanelItem] {
        var rows = [PanelItem(id: "off", title: "Off", checked: subtitlesAreOff) {
            clearEmbedded(); clearBitmap(); clearDownloaded()
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
