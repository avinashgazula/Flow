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
    #if !os(tvOS)
    @FocusState private var searchFocused: Bool
    #endif
    /// The Live TV tab itself, rather than a channel group pushed from it.
    var isTabRoot = true
    /// The group a pushed page was opened for; it names the page.
    private let openedGroup: String?

    init(isTabRoot: Bool = true, group: String? = nil) {
        self.isTabRoot = isTabRoot
        self.openedGroup = group
        _group = State(initialValue: group)
    }

    private static let favouritesGroup = "★ Favourites"

    private var title: String { isTabRoot ? "Live TV" : (openedGroup ?? "Live TV") }

    private var favourites: [Channel] {
        let ids = Set(model.settings.liveTV.favouriteChannelIDs)
        return store.channels.filter { ids.contains($0.id) }
    }

    private var visible: [Channel] {
        var list = store.channels
        // With the last favourite gone its chip is too, so the list falls back to everything rather than staying blank.
        if let group, !(group == Self.favouritesGroup && favourites.isEmpty) {
            list = group == Self.favouritesGroup ? favourites : list.filter { $0.group == group }
        }
        if !search.isEmpty { list = list.filter { $0.name.localizedCaseInsensitiveContains(search) } }
        return list
    }

    var body: some View {
        Group {
            if model.settings.liveTV.providers.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    BrowseHead(title)
                    BrowseEmpty(title: "No IPTV Providers", message: "Add an M3U playlist or Xtream Codes login to watch live channels.") {
                        NavigationLink("Add Provider", value: Route.settings(.liveTV)).buttonStyle(PrimaryButtonStyle())
                    }
                    Spacer(minLength: 0)
                }
            } else if store.loading && store.channels.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    BrowseHead(title)
                    ProgressView("Loading channels…").frame(maxWidth: .infinity).padding(.top, 60)
                    Spacer(minLength: 0)
                }
            } else {
                content
            }
        }
        .browsePage(title, root: isTabRoot)
        .task(id: model.settings.liveTV.providers) {
            await store.load(providers: model.settings.liveTV.providers, refreshHours: model.settings.liveTV.epgRefreshHours, http: model.http)
        }
        #if os(macOS)
        .sheet(item: $playing) { channel in LivePlayerView(channel: channel, epg: store.epg, lineup: visible, onTune: recordRecent).darkScope().frame(minWidth: 800, minHeight: 450) }
        #elseif os(iOS)
        // Turns to landscape like films and episodes do (Settings → Playback → Auto Rotate).
        .rotatingCover(item: $playing, startsInLandscape: model.settings.playback.autoRotate) { channel, close in
            LivePlayerView(channel: channel, epg: store.epg, lineup: visible, onTune: recordRecent, onClose: close).darkScope()
        }
        #else
        .fullScreenCover(item: $playing) { channel in
            LivePlayerView(channel: channel, epg: store.epg, lineup: visible, onTune: recordRecent).darkScope()
        }
        #endif
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if showGuide {
            GuideView(channels: visible, epg: store.epg, onPlay: { play($0) }) { header }
                .transition(.opacity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    header
                    if visible.isEmpty {
                        BrowseEmpty(title: "No Channels", message: search.isEmpty ? "Nothing is in this group." : "No channel is called that. Try a shorter name.")
                    } else {
                        LazyVStack(spacing: 0) {
                            ForEach(visible) { channel in
                                Button { play(channel) } label: {
                                    ChannelRow(channel: channel, epg: store.epg,
                                               isFavourite: model.settings.liveTV.favouriteChannelIDs.contains(channel.id))
                                }
                                .buttonStyle(BrowseRowStyle())
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
                    }
                }
                .padding(.bottom, Theme.Space.xl)
            }
            .scrollIndicators(.hidden)
            .transition(.opacity)
        }
    }

    /// The page head, the List and Guide tabs, the channel search and the group chips: everything above the channels.
    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            BrowseHead(title, note: "\(visible.count.formatted()) \(visible.count == 1 ? "channel" : "channels")")
            BrowseToolbar {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    HStack(spacing: Theme.Space.s) {
                        SegmentedTabs(options: [(value: false, title: "List"), (value: true, title: "Guide")], selection: guideBinding)
                        Spacer(minLength: 0)
                        Button("Refresh") { refresh() }
                            .buttonStyle(FilterChipStyle())
                    }
                    // On TV a search field is a full on-screen keyboard parked above the content.
                    #if !os(tvOS)
                    searchField
                    #endif
                }
            }
            ChipRow {
                chip("All", selected: group == nil) { group = nil }
                if !favourites.isEmpty { chip("Favourites", selected: group == Self.favouritesGroup) { group = Self.favouritesGroup } }
                ForEach(store.groups, id: \.self) { g in chip(g, selected: group == g) { group = g } }
            }
            if let error = store.error {
                Text(error)
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.warn)
                    .padding(.horizontal, Theme.Space.gutter)
            }
        }
    }

    private var guideBinding: Binding<Bool> {
        Binding(get: { showGuide }, set: { value in withAnimation(Theme.Motion.state) { showGuide = value } })
    }

    #if !os(tvOS)
    /// A bordered mono field, blue while it has the cursor.
    private var searchField: some View {
        HStack(spacing: Theme.Space.xs) {
            TextField("Find a Channel", text: $search, prompt: Text("Find a channel").foregroundStyle(Theme.Palette.muted))
                .font(Theme.Typeface.body)
                .textFieldStyle(.plain)
                .focused($searchFocused)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
            if !search.isEmpty {
                Button { search = "" } label: { Image(systemName: "xmark") }
                    .buttonStyle(QuietButtonStyle(square: true))
                    .accessibilityLabel("Clear Search")
            }
        }
        .padding(.horizontal, Theme.Space.m)
        .frame(minHeight: 44)
        .background(Theme.Palette.bg)
        .ruleFrame(searchFocused ? Theme.Palette.blue : Theme.Palette.rule)
    }
    #endif

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(FilterChipStyle(current: selected))
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

/// A channel as a ruled row: its number in red, its logo, its name, then what's on with the time left and a thin
/// red bar of progress, then what's next. It sits in a `BrowseRowStyle` button, which lights it blue.
struct ChannelRow: View {
    let channel: Channel
    let epg: EPG
    let isFavourite: Bool

    private var logoSize: CGFloat { (Platform.isTV ? 120 : 56) / 1.6 }

    var body: some View {
        let (now, next) = epg.nowAndNext(for: channel.epgID)
        return HStack(alignment: .center, spacing: Theme.Space.m) {
            if let number = channel.number {
                Text("\(number)")
                    .font(Theme.Typeface.figure)
                    .rowInk(Theme.Palette.red)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: 48 * Theme.scale, alignment: .leading)
                    .accessibilityHidden(true)
            }
            ChannelBadge(channel: channel, size: logoSize)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                    Text(channel.name).font(Theme.Typeface.heading).textCase(.uppercase).lineLimit(1)
                    if isFavourite {
                        Image(systemName: "star.fill").font(.caption2).rowInk(Theme.Palette.red)
                            .accessibilityLabel("Favourite")
                    }
                }
                if let now {
                    // Only the time and the bar re-render on each tick; the row (and its nowAndNext lookup) doesn't.
                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                                Text(now.title).font(Theme.Typeface.body).lineLimit(1)
                                Spacer(minLength: Theme.Space.s)
                                Text(TimeFormat.remaining(max(0, now.end.timeIntervalSince(context.date))))
                                    .font(Theme.Typeface.caption).rowInk(Theme.Palette.muted)
                            }
                            RedBar(value: now.progress(at: context.date), height: 3 * Theme.scale)
                        }
                    }
                    if let next {
                        Text("Next \(next.start.formatted(date: .omitted, time: .shortened)) · \(next.title)")
                            .font(Theme.Typeface.caption).rowInk(Theme.Palette.muted).lineLimit(1)
                    }
                } else {
                    Text(channel.group).font(Theme.Typeface.caption).rowInk(Theme.Palette.muted).lineLimit(1)
                }
            }
        }
    }
}

struct ChannelGroupView: View {
    let group: String
    var body: some View {
        LiveTVView(isTabRoot: false, group: group)
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
                            .background(Theme.Palette.red, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                    if let now {
                        Text(now.title).font(.system(.title3, weight: .semibold)).lineLimit(1)
                        HStack(spacing: 8) {
                            Text(now.start, style: .time)
                            ProgressCapsule(value: min(1, max(0, context.date.timeIntervalSince(now.start) / max(1, now.end.timeIntervalSince(now.start)))), height: 3, tint: Theme.Palette.red)
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
