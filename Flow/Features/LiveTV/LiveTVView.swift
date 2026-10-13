import SwiftUI
import AVKit
import Observation
import FlowKit

/// Loads channels and EPG from every enabled IPTV provider; caches the guide on disk.
@MainActor
@Observable
final class LiveTVStore {
    static let shared = LiveTVStore()

    var channels: [Channel] = []
    var epg = EPG()
    var loading = false
    var error: String?
    @ObservationIgnored private var loadedFor: [IPTVProviderConfig] = []
    @ObservationIgnored private let cache = JSONFileStore.caches("FlowLiveTV")

    var groups: [String] {
        var seen = Set<String>()
        return channels.map(\.group).filter { seen.insert($0).inserted }
    }

    func load(providers: [IPTVProviderConfig], refreshHours: Int, http: HTTPClient, force: Bool = false) async {
        let enabled = providers.filter(\.enabled)
        guard force || enabled != loadedFor || channels.isEmpty else { return }
        loading = true
        defer { loading = false }
        error = nil
        loadedFor = enabled
        let clients: [IPTVProvider] = enabled.map { config -> IPTVProvider in
            config.kind == .xtream ? XtreamClient(config: config, http: http) : M3UProvider(config: config, http: http)
        }

        var all: [Channel] = []
        var errors: [String] = []
        await withTaskGroup(of: Result<[Channel], Error>.self) { group in
            for client in clients { group.addTask { await resultOf { try await client.channels() } } }
            for await result in group {
                switch result {
                case .success(let c): all += c
                case .failure(let e): errors.append(e.localizedDescription)
                }
            }
        }
        // Leaving the tab cancels the load; every request then "fails", which isn't a channel list worth keeping.
        guard !Task.isCancelled else { loadedFor = []; return }
        channels = all.sorted { ($0.number ?? Int.max, $0.name) < ($1.number ?? Int.max, $1.name) }
        error = errors.first

        let cacheName = "epg-" + StableHash.hex(enabled.map { $0.id + $0.url.absoluteString }.joined())
        if !force, let date = cache.modificationDate(cacheName), Date().timeIntervalSince(date) < Double(refreshHours) * 3600,
           let cached = cache.load(EPG.self, cacheName) {
            epg = cached
            return
        }
        let window = Date().addingTimeInterval(-3 * 3600)...Date().addingTimeInterval(36 * 3600)
        var merged = EPG()
        await withTaskGroup(of: EPG?.self) { group in
            for client in clients { group.addTask { try? await client.epg(window: window) } }
            for await guide in group { if let guide { merged.merge(guide) } }
        }
        // A cancelled or failed download is empty; caching that would hide the guide until the next refresh.
        guard !Task.isCancelled else { loadedFor = []; return }
        guard !merged.programmes.isEmpty else { if !force { epg = merged }; return }
        epg = merged
        cache.save(merged, cacheName)
    }
}

struct LiveTVView: View {
    @Environment(AppModel.self) private var model
    @State private var store = LiveTVStore.shared
    @State private var group: String?
    @State private var search = ""
    @State private var playing: Channel?
    @State private var showGuide = !Platform.isPhone
    /// The Live TV tab itself, rather than a channel group pushed from it.
    var isTabRoot = true

    init(isTabRoot: Bool = true, group: String? = nil) {
        self.isTabRoot = isTabRoot
        _group = State(initialValue: group)
    }

    private var favourites: [Channel] {
        let ids = Set(model.settings.liveTV.favouriteChannelIDs)
        return store.channels.filter { ids.contains($0.id) }
    }

    private var visible: [Channel] {
        var list = store.channels
        // With the last favourite gone its chip is too, so the list falls back to everything rather than staying blank.
        if let group, !(group == "★ Favourites" && favourites.isEmpty) { list = group == "★ Favourites" ? favourites : list.filter { $0.group == group } }
        if !search.isEmpty { list = list.filter { $0.name.localizedCaseInsensitiveContains(search) } }
        return list
    }

    var body: some View {
        Group {
            if model.settings.liveTV.providers.isEmpty {
                ContentUnavailableView {
                    Label("No IPTV Providers", systemImage: "tv.and.mediabox")
                } description: {
                    Text("Add an M3U playlist or Xtream Codes login to watch live channels.")
                } actions: {
                    NavigationLink("Add Provider", value: Route.settings(.liveTV)).buttonStyle(PrimaryButtonStyle())
                }
            } else if store.loading && store.channels.isEmpty {
                ProgressView("Loading channels…")
            } else {
                content
            }
        }
        #if os(tvOS)
        .toolbar(isTabRoot ? .hidden : .automatic, for: .navigationBar)
        #else
        .navigationTitle("Live TV")
        // On TV a search field is a full on-screen keyboard parked above the content.
        .searchable(text: $search, prompt: "Channels")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { withAnimation(Theme.Motion.fade) { showGuide.toggle() } } label: {
                    Image(systemName: showGuide ? "list.bullet" : "calendar.day.timeline.left")
                }
                .accessibilityLabel(showGuide ? "Show List" : "Show Guide")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { refresh() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh")
            }
        }
        #endif
        .task(id: model.settings.liveTV.providers) {
            await store.load(providers: model.settings.liveTV.providers, refreshHours: model.settings.liveTV.epgRefreshHours, http: model.http)
        }
        #if os(macOS)
        .sheet(item: $playing) { channel in LivePlayerView(channel: channel, epg: store.epg, lineup: visible, onTune: recordRecent).frame(minWidth: 800, minHeight: 450) }
        #elseif os(iOS)
        // Turns to landscape like films and episodes do (Settings → Playback → Auto Rotate).
        .rotatingCover(item: $playing, startsInLandscape: model.settings.playback.autoRotate) { channel, close in
            LivePlayerView(channel: channel, epg: store.epg, lineup: visible, onTune: recordRecent, onClose: close)
        }
        #else
        .fullScreenCover(item: $playing) { channel in
            LivePlayerView(channel: channel, epg: store.epg, lineup: visible, onTune: recordRecent)
        }
        #endif
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            Group {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Space.xs) {
                        #if os(tvOS)
                        ActionChip(title: showGuide ? "List" : "Guide", systemImage: showGuide ? "list.bullet" : "calendar.day.timeline.left") {
                            withAnimation(Theme.Motion.fade) { showGuide.toggle() }
                        }
                        ActionChip(title: nil, systemImage: "arrow.clockwise") { refresh() }
                            .accessibilityLabel("Refresh")
                        #endif
                        chip("All", selected: group == nil) { group = nil }
                        if !favourites.isEmpty { chip("★ Favourites", selected: group == "★ Favourites") { group = "★ Favourites" } }
                        ForEach(store.groups, id: \.self) { g in chip(g, selected: group == g) { group = g } }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                }
                .scrollClipDisabled()
            }
            if let error = store.error {
                Label(error, systemImage: "exclamationmark.triangle").font(Theme.Typeface.caption).foregroundStyle(.orange)
                    .padding(.horizontal, Theme.Space.gutter)
            }
            if showGuide {
                GuideView(channels: visible, epg: store.epg) { play($0) }
                    .transition(.opacity)
            } else {
                ScrollView {
                    GroupedTable {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, channel in
                            Button { play(channel) } label: {
                                ChannelRow(channel: channel, epg: store.epg, isFavourite: model.settings.liveTV.favouriteChannelIDs.contains(channel.id),
                                           showsDivider: index > 0)
                            }
                            .buttonStyle(TableRowButtonStyle())
                            .contextMenu {
                                Button {
                                    toggleFavourite(channel)
                                } label: {
                                    let fav = model.settings.liveTV.favouriteChannelIDs.contains(channel.id)
                                    Label(fav ? "Remove Favourite" : "Favourite", systemImage: fav ? "star.slash" : "star")
                                }
                            }
                        }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.bottom, Theme.Space.xl)
                }
                .transition(.opacity)
            }
        }
        .padding(.top, Theme.Space.xs)
        .animation(Theme.Motion.fade, value: showGuide)
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(.subheadline, weight: .semibold))
                .padding(.horizontal, Theme.Space.m).padding(.vertical, Theme.Space.xs + 1)
                .background(selected ? Color.white : Theme.Palette.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.Palette.hairline, lineWidth: selected ? 0 : 1))
                .foregroundStyle(selected ? Color.black : Color.white)
        }
        .buttonStyle(CardButtonStyle())
    }

    private func refresh() {
        Task { await store.load(providers: model.settings.liveTV.providers, refreshHours: model.settings.liveTV.epgRefreshHours, http: model.http, force: true) }
    }

    private func play(_ channel: Channel) {
        recordRecent(channel)
        playing = channel
    }

    private func recordRecent(_ channel: Channel) {
        var recents = model.settings.liveTV.recentChannelIDs.filter { $0 != channel.id }
        recents.insert(channel.id, at: 0)
        model.settings.liveTV.recentChannelIDs = Array(recents.prefix(20))
    }

    private func toggleFavourite(_ channel: Channel) {
        if let i = model.settings.liveTV.favouriteChannelIDs.firstIndex(of: channel.id) {
            model.settings.liveTV.favouriteChannelIDs.remove(at: i)
        } else {
            model.settings.liveTV.favouriteChannelIDs.append(channel.id)
        }
    }
}

/// A channel as a row of a `GroupedTable`: its logo, number and name, what's on with the time left and a
/// hairline of progress, then what's next.
struct ChannelRow: View {
    let channel: Channel
    let epg: EPG
    let isFavourite: Bool
    /// A hairline above this row, when it follows another in the table.
    var showsDivider = false
    @Environment(\.isFocused) private var focused

    private var logoWidth: CGFloat { Platform.isTV ? 120 : 56 }
    private var primary: Color { focused ? .black : .white }
    private var secondary: Color { focused ? .black.opacity(0.62) : Theme.Palette.textSecondary }
    private var tertiary: Color { focused ? .black.opacity(0.45) : Theme.Palette.textTertiary }

    var body: some View {
        let (now, next) = epg.nowAndNext(for: channel.epgID)
        return HStack(alignment: .center, spacing: Theme.Space.m) {
            logo
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let number = channel.number {
                        Text("\(number)").font(.system(.caption).monospacedDigit()).foregroundStyle(tertiary)
                    }
                    Text(channel.name).font(Theme.Typeface.headline).foregroundStyle(primary).lineLimit(1)
                    if isFavourite {
                        Image(systemName: "star.fill").font(.caption2).foregroundStyle(focused ? .black : Theme.Palette.gold)
                            .accessibilityLabel("Favourite")
                    }
                }
                if let now {
                    // Only the time and the bar re-render on each tick; the row (and its nowAndNext lookup) doesn't.
                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                                Text(now.title).font(Theme.Typeface.body).foregroundStyle(primary.opacity(0.9)).lineLimit(1)
                                Spacer(minLength: Theme.Space.s)
                                Text(TimeFormat.remaining(max(0, now.end.timeIntervalSince(context.date))))
                                    .font(.system(.caption).monospacedDigit()).foregroundStyle(tertiary)
                            }
                            ProgressCapsule(value: now.progress(at: context.date), height: 2)
                                .opacity(focused ? 0.5 : 1)
                        }
                    }
                    if let next {
                        Text("Next \(next.start.formatted(date: .omitted, time: .shortened)) · \(next.title)")
                            .font(Theme.Typeface.caption).foregroundStyle(tertiary).lineLimit(1)
                    }
                } else {
                    Text(channel.group).font(Theme.Typeface.caption).foregroundStyle(tertiary)
                }
            }
        }
        .padding(.horizontal, Theme.Space.m)
        .padding(.vertical, 12 * Theme.scale)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tvRowSurface(focused: focused)
        .tableDivider(showsDivider, inset: Theme.Space.m * 2 + logoWidth)
    }

    private var logo: some View {
        let shape = RoundedRectangle(cornerRadius: 8 * Theme.scale, style: .continuous)
        let height = logoWidth * 0.62
        return Group {
            if channel.logoURL != nil {
                RemoteImage(url: channel.logoURL, contentMode: .fit, maxPixel: 300)
                    .padding(5)
                    .frame(width: logoWidth, height: height)
                    .background(Theme.Palette.surfaceStrong)
            } else {
                Monogram(name: channel.name, fontSize: 15 * Theme.scale, condensed: true)
                    .frame(width: logoWidth, height: height)
            }
        }
        .clipShape(shape)
        .overlay(shape.strokeBorder(Theme.Palette.hairline))
        .accessibilityHidden(true)
    }
}

struct ChannelGroupView: View {
    let group: String
    var body: some View {
        LiveTVView(isTabRoot: false, group: group).navigationTitle(group)
    }
}

/// Live player using the system controls on every platform. Tries the channel's HLS form when it
/// was given as raw MPEG-TS, shows progress while connecting and says so when nothing plays.
struct LivePlayerView: View {
    let channel: Channel
    let epg: EPG
    /// The channels around this one, for flipping up and down without leaving the player.
    var lineup: [Channel] = []
    /// Told about each channel tuned to, so Recents follow zapping too.
    var onTune: (Channel) -> Void = { _ in }
    /// How a cover presented by UIKit (`rotatingCover`) closes; SwiftUI's dismiss can't reach it.
    var onClose: (() -> Void)?
    @Environment(\.dismiss) private var dismissEnvironment
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var verticalSize
    private var compactHeight: Bool { verticalSize == .compact }
    #else
    private let compactHeight = false
    #endif
    @State private var player = AVPlayer()
    @State private var state: LoadState = .connecting
    @State private var attempt = 0
    @State private var tuned: Channel?
    @State private var showsInfo = true
    @State private var hideTask: Task<Void, Never>?

    enum LoadState: Equatable {
        case connecting, playing
        case failed(String)
    }

    private var current: Channel { tuned ?? channel }

    private func dismiss() {
        if let onClose { onClose() } else { dismissEnvironment() }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            #if os(tvOS)
            LiveTransportPlayer(player: player, lineup: lineup, current: current, tune: tune(_:), zap: zap(by:))
                .ignoresSafeArea()
            #else
            VideoPlayer(player: player)
                .ignoresSafeArea()
            #endif
            if state == .connecting {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                    .padding(22)
                    .flowGlass(Circle())
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
            }
            #if !os(tvOS)
            if showsInfo {
                // Clear of the system player's own controls: its AirPlay and volume along the top and its
                // scrubber along the bottom. Close sits under the top row, the card over the scrubber.
                VStack(alignment: .leading) {
                    CircleButton(systemImage: "xmark", label: "Close") { dismiss() }
                        .padding(.top, 52)
                    Spacer()
                    LiveInfoCard(channel: current, epg: epg, canZap: lineup.count > 1,
                                 previous: { zap(by: -1) }, next: { zap(by: 1) })
                        .padding(.bottom, 64)
                        // Landscape iPhone is short: smaller, so it ends above the scrubber and left of the play buttons.
                        .scaleEffect(compactHeight ? 0.82 : 1, anchor: .bottomLeading)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
                .transition(.opacity)
            }
            #endif
            if case .failed(let message) = state {
                PlaybackErrorView(message: message, canTryAnother: lineup.count > 1, tryAnotherTitle: "Next Channel", retry: { attempt += 1 },
                                  tryAnother: { zap(by: 1) }, close: { dismiss() })
            }
        }
        .animation(Theme.Motion.fade, value: showsInfo)
        #if os(iOS)
        // Swipe up for the next channel, down for the one before, like a remote's channel buttons.
        .gesture(DragGesture(minimumDistance: 40).onEnded { value in
            guard abs(value.translation.height) > abs(value.translation.width) * 1.5 else { return }
            zap(by: value.translation.height < 0 ? 1 : -1)
        })
        .simultaneousGesture(TapGesture().onEnded { showsInfo.toggle(); if showsInfo { scheduleHide() } })
        #endif
        #if os(macOS)
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.upArrow) { zap(by: -1); return .handled }
        .onKeyPress(.downArrow) { zap(by: 1); return .handled }
        .onKeyPress(.escape) { dismiss(); return .handled }
        #endif
        .task(id: "\(current.id)-\(attempt)") { await start() }
        .onAppear { scheduleHide() }
        .onDisappear { player.pause(); player.replaceCurrentItem(with: nil) }
    }

    /// Tunes to the channel `offset` places along the lineup, wrapping at either end.
    private func zap(by offset: Int) {
        guard lineup.count > 1, let index = lineup.firstIndex(where: { $0.id == current.id }) else { return }
        tune(lineup[(index + offset + lineup.count) % lineup.count])
    }

    private func tune(_ next: Channel) {
        guard next.id != current.id else { return }
        tuned = next
        attempt = 0
        onTune(next)
        showsInfo = true
        scheduleHide()
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if !Task.isCancelled, state == .playing { showsInfo = false }
        }
    }

    private func start() async {
        state = .connecting
        let channel = current
        var options: [String: Any] = [:]
        if let ua = channel.userAgent { options["AVURLAssetHTTPHeaderFieldsKey"] = ["User-Agent": ua] }
        for url in LiveStreamURL.candidates(for: channel.streamURL) {
            let item = AVPlayerItem(asset: AVURLAsset(url: url, options: options))
            #if os(tvOS)
            item.externalMetadata = LiveTransportPlayer.metadata(for: channel, epg: epg)
            #endif
            player.replaceCurrentItem(with: item)
            player.play()
            if await ready(item) {
                state = .playing
                scheduleHide()
                return
            }
            if Task.isCancelled { return }
        }
        player.replaceCurrentItem(with: nil)
        state = .failed("\(channel.name) isn't broadcasting right now, or its stream can't play on Apple devices.")
    }

    /// Waits up to 15 seconds for the stream to start.
    private func ready(_ item: AVPlayerItem) async -> Bool {
        for _ in 0..<60 {
            switch item.status {
            case .readyToPlay: return true
            case .failed: return false
            default: break
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return false }
        }
        return false
    }
}

/// What's on: the channel, the programme with how far through it is, and what's next.
struct LiveInfoCard: View {
    let channel: Channel
    let epg: EPG
    var canZap = false
    let previous: () -> Void
    let next: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let (now, upcoming) = epg.nowAndNext(for: channel.epgID, at: context.date)
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        if let number = channel.number {
                            Text("\(number)").font(.system(.subheadline, weight: .bold).monospacedDigit()).foregroundStyle(Theme.Palette.textSecondary)
                        }
                        Text(channel.name).font(Theme.Typeface.headline).lineLimit(1)
                        Text("LIVE")
                            .font(Theme.Typeface.micro).kerning(1)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(.red, in: Capsule())
                    }
                    if let now {
                        Text(now.title).font(.system(.title3, weight: .semibold)).lineLimit(1)
                        HStack(spacing: 8) {
                            Text(now.start, style: .time)
                            ProgressCapsule(value: min(1, max(0, context.date.timeIntervalSince(now.start) / max(1, now.end.timeIntervalSince(now.start)))), height: 3)
                                .frame(width: 140)
                            Text(now.end, style: .time)
                        }
                        .font(.system(.caption).monospacedDigit())
                        .foregroundStyle(Theme.Palette.textSecondary)
                    }
                    if let upcoming {
                        (Text("Next ") + Text(upcoming.start, style: .time) + Text(" · \(upcoming.title)"))
                            .font(.system(.caption))
                            .foregroundStyle(Theme.Palette.textTertiary)
                            .lineLimit(1)
                    }
                }
                if canZap {
                    VStack(spacing: 8) {
                        CircleButton(systemImage: "chevron.up", label: "Previous Channel", size: 36, action: previous)
                            .accessibilityLabel("Previous Channel")
                        CircleButton(systemImage: "chevron.down", label: "Next Channel", size: 36, action: next)
                            .accessibilityLabel("Next Channel")
                    }
                }
            }
            .padding(16)
            // As wide as what it says, up to a limit, so it doesn't spread over the system's play buttons.
            .frame(maxWidth: 440, alignment: .leading)
            .fixedSize(horizontal: true, vertical: false)
            .flowGlass(RoundedRectangle(cornerRadius: 22, style: .continuous), tint: Theme.Palette.overPicture)
        }
    }
}

/// FNV-1a — stable across launches, unlike `hashValue`.
enum StableHash {
    static func hex(_ string: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in string.utf8 { hash = (hash ^ UInt64(byte)) &* 0x100000001b3 }
        return String(hash, radix: 16)
    }
}

#if os(tvOS)
/// The system player with the remote's channel controls: Previous and Next Channel, and the whole
/// lineup, in the transport bar; the info panel names the channel and what's on.
private struct LiveTransportPlayer: UIViewControllerRepresentable {
    let player: AVPlayer
    let lineup: [Channel]
    let current: Channel
    let tune: (Channel) -> Void
    let zap: (Int) -> Void

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
        guard lineup.count > 1 else { controller.transportBarCustomMenuItems = []; return }
        let previous = UIAction(title: "Previous Channel", image: UIImage(systemName: "chevron.up")) { _ in zap(-1) }
        let next = UIAction(title: "Next Channel", image: UIImage(systemName: "chevron.down")) { _ in zap(1) }
        let channels = UIMenu(title: "Channels", image: UIImage(systemName: "list.bullet"), children: lineup.prefix(300).map { channel in
            UIAction(title: channel.name, state: channel.id == current.id ? .on : .off) { _ in tune(channel) }
        })
        controller.transportBarCustomMenuItems = [previous, next, channels]
    }

    /// Title and programme for the info panel and the transport bar.
    static func metadata(for channel: Channel, epg: EPG) -> [AVMetadataItem] {
        let (now, next) = epg.nowAndNext(for: channel.epgID)
        var items = [item(.commonIdentifierTitle, now?.title ?? channel.name)]
        if now != nil { items.append(item(.iTunesMetadataTrackSubTitle, channel.name)) }
        let about = [now?.description, next.map { "Next: \($0.title) at \($0.start.formatted(date: .omitted, time: .shortened))" }]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n\n")
        if !about.isEmpty { items.append(item(.commonIdentifierDescription, about)) }
        return items
    }

    private static func item(_ identifier: AVMetadataIdentifier, _ value: String) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = identifier
        item.value = value as NSString
        item.extendedLanguageTag = "und"
        return item
    }
}
#endif
