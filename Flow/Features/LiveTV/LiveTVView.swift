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

    private var favourites: [Channel] {
        let ids = model.settings.liveTV.favouriteChannelIDs
        return ids.compactMap { id in store.channels.first { $0.id == id } }
    }

    private var visible: [Channel] {
        var list = store.channels
        if let group { list = group == "★ Favourites" ? favourites : list.filter { $0.group == group } }
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
                    NavigationLink("Add Provider", value: Route.settings(.liveTV)).buttonStyle(.borderedProminent)
                }
            } else if store.loading && store.channels.isEmpty {
                ProgressView("Loading channels…")
            } else {
                content
            }
        }
        .navigationTitle("Live TV")
        .searchable(text: $search, prompt: "Channels")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await store.load(providers: model.settings.liveTV.providers, refreshHours: model.settings.liveTV.epgRefreshHours, http: model.http, force: true) }
                } label: { Image(systemName: "arrow.clockwise") }
            }
        }
        .task(id: model.settings.liveTV.providers) {
            await store.load(providers: model.settings.liveTV.providers, refreshHours: model.settings.liveTV.epgRefreshHours, http: model.http)
        }
        #if os(macOS)
        .sheet(item: $playing) { channel in LivePlayerView(channel: channel, epg: store.epg).frame(minWidth: 800, minHeight: 450) }
        #else
        .fullScreenCover(item: $playing) { channel in LivePlayerView(channel: channel, epg: store.epg) }
        #endif
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        chip("All", selected: group == nil) { group = nil }
                        if !favourites.isEmpty { chip("★ Favourites", selected: group == "★ Favourites") { group = "★ Favourites" } }
                        ForEach(store.groups, id: \.self) { g in chip(g, selected: group == g) { group = g } }
                    }
                    .padding(.horizontal, Platform.horizontalPadding)
                }
                if let error = store.error {
                    Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                        .padding(.horizontal, Platform.horizontalPadding)
                }
                LazyVStack(spacing: Platform.isTV ? 16 : 8) {
                    ForEach(visible) { channel in
                        Button { play(channel) } label: {
                            ChannelRow(channel: channel, epg: store.epg, isFavourite: model.settings.liveTV.favouriteChannelIDs.contains(channel.id))
                        }
                        .buttonStyle(CardButtonStyle())
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
                .padding(.horizontal, Platform.horizontalPadding)
            }
            .padding(.vertical)
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(selected ? Color.white : Color.white.opacity(0.1), in: Capsule())
                .foregroundStyle(selected ? Color.black : Color.white)
        }
        .buttonStyle(CardButtonStyle())
    }

    private func play(_ channel: Channel) {
        var recents = model.settings.liveTV.recentChannelIDs.filter { $0 != channel.id }
        recents.insert(channel.id, at: 0)
        model.settings.liveTV.recentChannelIDs = Array(recents.prefix(20))
        playing = channel
    }

    private func toggleFavourite(_ channel: Channel) {
        if let i = model.settings.liveTV.favouriteChannelIDs.firstIndex(of: channel.id) {
            model.settings.liveTV.favouriteChannelIDs.remove(at: i)
        } else {
            model.settings.liveTV.favouriteChannelIDs.append(channel.id)
        }
    }
}

struct ChannelRow: View {
    let channel: Channel
    let epg: EPG
    let isFavourite: Bool

    private var now: Programme? { epg.nowAndNext(for: channel.epgID).now }
    private var next: Programme? { epg.nowAndNext(for: channel.epgID).next }

    var body: some View {
        HStack(spacing: 14) {
            RemoteImage(url: channel.logoURL, contentMode: .fit)
                .frame(width: Platform.isTV ? 120 : 64, height: Platform.isTV ? 72 : 40)
                .padding(6)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if let number = channel.number { Text("\(number)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                    Text(channel.name).font(.headline).lineLimit(1)
                    if isFavourite { Image(systemName: "star.fill").font(.caption).foregroundStyle(.yellow) }
                }
                if let now {
                    Text(now.title).font(.subheadline).lineLimit(1)
                    ProgressView(value: now.progress(at: Date())).tint(.white.opacity(0.8))
                    if let next {
                        Text("Next: \(next.start.formatted(date: .omitted, time: .shortened)) \(next.title)")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                } else {
                    Text(channel.group).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct ChannelGroupView: View {
    let group: String
    var body: some View {
        LiveTVView().navigationTitle(group)
    }
}

/// Simple live player using the system controls on every platform.
struct LivePlayerView: View {
    let channel: Channel
    let epg: EPG
    @Environment(\.dismiss) private var dismiss
    @State private var player = AVPlayer()

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            VideoPlayer(player: player)
                .ignoresSafeArea()
            #if !os(tvOS)
            HStack(spacing: 12) {
                CircleButton(systemImage: "xmark") { dismiss() }
                VStack(alignment: .leading) {
                    Text(channel.name).font(.headline)
                    if let now = epg.nowAndNext(for: channel.epgID).now { Text(now.title).font(.caption).foregroundStyle(.secondary) }
                }
            }
            .padding(20)
            #endif
        }
        .onAppear {
            var options: [String: Any] = [:]
            if let ua = channel.userAgent { options["AVURLAssetHTTPHeaderFieldsKey"] = ["User-Agent": ua] }
            player.replaceCurrentItem(with: AVPlayerItem(asset: AVURLAsset(url: channel.streamURL, options: options)))
            player.play()
        }
        .onDisappear { player.pause(); player.replaceCurrentItem(with: nil) }
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
