import SwiftUI
import FlowKit

/// Followed teams with upcoming fixtures and recent results (TheSportsDB).
struct SportsView: View {
    @Environment(AppModel.self) private var model
    @State private var upcoming: [String: [SportsEvent]] = [:]
    @State private var results: [String: [SportsEvent]] = [:]
    @State private var showSearch = false
    @State private var live = LiveTVStore.shared
    /// Games whose hidden score has been uncovered.
    @State private var revealed: Set<String> = []
    @State private var channelsFor: SportsEvent?
    @State private var playing: Channel?

    private var client: SportsClient { SportsClient(apiKey: model.settings.sports.apiKey, http: model.http) }

    var body: some View {
        List {
            if model.settings.sports.followedTeams.isEmpty {
                ContentUnavailableView {
                    Label("No Teams", systemImage: "sportscourt")
                } description: {
                    Text("Follow teams to see their upcoming fixtures and results here.")
                } actions: {
                    Button("Find Teams") { showSearch = true }.buttonStyle(.borderedProminent)
                }
            }
            ForEach(model.settings.sports.followedTeams) { team in
                Section {
                    let next = upcoming[team.id] ?? []
                    let last = results[team.id] ?? []
                    if next.isEmpty && last.isEmpty {
                        Text("No fixtures available").foregroundStyle(.secondary)
                    }
                    ForEach(next.prefix(5)) { event in row(event) }
                    if !last.isEmpty {
                        Text("Recent Results").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(last.prefix(3)) { event in row(event) }
                    }
                } header: {
                    HStack(spacing: 10) {
                        RemoteImage(url: team.badgeURL, contentMode: .fit).frame(width: 28, height: 28)
                        Text(team.name).font(.headline).textCase(nil)
                        if let league = team.league { Text(league).font(.caption).foregroundStyle(.secondary).textCase(nil) }
                        Spacer()
                        Button(role: .destructive) {
                            model.settings.sports.followedTeams.removeAll { $0.id == team.id }
                        } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
        .navigationTitle("Sports")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showSearch = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showSearch) { TeamSearchView().environment(model) }
        .flowModal(item: $channelsFor) { event in
            GameChannelsView(event: event)
                .switchTint(model.settings.general.accent)
                .environment(model)
        }
        .liveChannelCover($playing, epg: live.epg)
        .task(id: model.settings.sports.followedTeams.map(\.id)) { await load() }
    }

    private func load() async {
        let client = self.client
        for team in model.settings.sports.followedTeams {
            async let next = try? client.nextEvents(teamID: team.id)
            async let last = try? client.lastEvents(teamID: team.id)
            upcoming[team.id] = await next ?? []
            results[team.id] = await last ?? []
        }
        // A refresh is the moment to notice matches that have just finished.
        await model.announceResults(results.values.flatMap { $0 })
    }

    /// A game: tap and press-and-hold are the channel list and the best match, in the order the setting picks.
    private func row(_ event: SportsEvent) -> some View {
        let hidden = !model.settings.sports.showScoreSpoilers && !revealed.contains(event.id)
        return EventRow(event: event, scoreHidden: hidden) { revealed.insert(event.id) }
            .contentShape(Rectangle())
            .onTapGesture {
                // A finished game has nothing to watch: the tap uncovers its score.
                if hidden && event.isFinished { revealed.insert(event.id) } else { open(event, list: model.settings.sports.chooseChannelOnTap) }
            }
            .onLongPressGesture { open(event, list: !model.settings.sports.chooseChannelOnTap) }
            #if os(tvOS)
            .focusable()
            #endif
    }

    private func open(_ event: SportsEvent, list: Bool) {
        if list { channelsFor = event } else { Task { await playBest(event) } }
    }

    private func playBest(_ event: SportsEvent) async {
        guard !model.settings.liveTV.providers.isEmpty else {
            model.showToast("Add an IPTV provider in Settings → Live TV")
            return
        }
        await live.load(providers: model.settings.liveTV.providers, refreshHours: model.settings.liveTV.epgRefreshHours, http: model.http)
        if let best = SportsChannelMatcher.matches(for: event, channels: live.channels, epg: live.epg).first {
            playing = best.channel
        } else {
            model.showToast("No channel found for \(event.title)")
        }
    }
}

/// The channels carrying one game, best match first.
struct GameChannelsView: View {
    let event: SportsEvent
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var live = LiveTVStore.shared
    @State private var playing: Channel?

    private var matches: [ChannelMatch] { SportsChannelMatcher.matches(for: event, channels: live.channels, epg: live.epg) }

    var body: some View {
        NavigationStack {
            Group {
                if model.settings.liveTV.providers.isEmpty {
                    ContentUnavailableView {
                        Label("No IPTV Providers", systemImage: "tv.and.mediabox")
                    } description: {
                        Text("Add an M3U playlist or Xtream Codes login in Settings → Live TV to watch games.")
                    }
                } else if live.loading && live.channels.isEmpty {
                    ProgressView("Loading channels…")
                } else if matches.isEmpty {
                    ContentUnavailableView {
                        Label("No Channels Found", systemImage: "sportscourt")
                    } description: {
                        Text("Nothing in your guide is showing \(event.title) around kick-off.")
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: Platform.isTV ? 16 : 8) {
                            ForEach(matches) { match in
                                Button { playing = match.channel } label: {
                                    ChannelRow(channel: match.channel, epg: live.epg, isFavourite: model.settings.liveTV.favouriteChannelIDs.contains(match.channel.id))
                                }
                                .buttonStyle(CardButtonStyle())
                            }
                        }
                        .padding(.horizontal, Theme.Space.gutter)
                        .padding(.bottom, Theme.Space.xl)
                    }
                }
            }
            .navigationTitle(event.title)
            .inlineNavigationTitle()
            .toolbar {
                #if !os(tvOS)
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                #endif
            }
            .task(id: model.settings.liveTV.providers) {
                await live.load(providers: model.settings.liveTV.providers, refreshHours: model.settings.liveTV.epgRefreshHours, http: model.http)
            }
            .liveChannelCover($playing, epg: live.epg)
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 420)
        #endif
    }
}

extension View {
    /// The live player over this screen: a sheet on the Mac, full screen elsewhere.
    @ViewBuilder
    func liveChannelCover(_ channel: Binding<Channel?>, epg: EPG) -> some View {
        #if os(macOS)
        sheet(item: channel) { LivePlayerView(channel: $0, epg: epg).frame(minWidth: 800, minHeight: 450) }
        #else
        fullScreenCover(item: channel) { LivePlayerView(channel: $0, epg: epg) }
        #endif
    }
}

struct EventRow: View {
    let event: SportsEvent
    /// Blurs the score until `reveal` is called, so a result isn't spoiled by scrolling past it.
    var scoreHidden = false
    var reveal: () -> Void = {}

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(event.title).font(.subheadline.weight(.medium))
                HStack(spacing: 6) {
                    if let date = event.date { Text(date.formatted(date: .abbreviated, time: .shortened)) }
                    if let league = event.league { Text("· \(league)") }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            score
        }
    }

    @ViewBuilder
    private var score: some View {
        if let h = event.homeScore, let a = event.awayScore {
            if scoreHidden {
                // The blur is of a stand-in, so even its width gives nothing away.
                Button(action: reveal) {
                    Text("0 – 0").font(.headline.monospacedDigit())
                        .blur(radius: 7 * Theme.scale)
                        .overlay { Image(systemName: "eye.slash").font(.caption).foregroundStyle(.secondary) }
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Score hidden")
                .accessibilityHint("Shows the score")
            } else {
                Text("\(h) – \(a)").font(.headline.monospacedDigit())
            }
        }
    }
}

struct TeamSearchView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var teams: [SportsTeam] = []
    @State private var searching = false

    var body: some View {
        NavigationStack {
            List(teams) { team in
                Button {
                    if !model.settings.sports.followedTeams.contains(where: { $0.id == team.id }) {
                        model.settings.sports.followedTeams.append(team)
                    }
                    dismiss()
                } label: {
                    HStack(spacing: 12) {
                        RemoteImage(url: team.badgeURL, contentMode: .fit).frame(width: 36, height: 36)
                        VStack(alignment: .leading) {
                            Text(team.name).font(.headline)
                            Text([team.sport, team.league, team.country].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .overlay { if searching { ProgressView() } }
            .searchable(text: $query, prompt: "Team name")
            .navigationTitle("Follow a Team")
            .inlineNavigationTitle()
            .sheetDismissButton("Cancel") { dismiss() }
            .task(id: query) {
                guard query.count >= 3 else { teams = []; return }
                try? await Task.sleep(nanoseconds: 400_000_000)
                guard !Task.isCancelled else { return }
                searching = true
                teams = (try? await SportsClient(apiKey: model.settings.sports.apiKey, http: model.http).searchTeams(query)) ?? []
                searching = false
            }
        }
    }
}
