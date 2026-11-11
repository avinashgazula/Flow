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

    private var teamsNote: String {
        let count = model.settings.sports.followedTeams.count
        return count == 0 ? "Fixtures and results" : count == 1 ? "1 team" : "\(count) teams"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                BrowseHead("Sports", note: teamsNote)
                BrowseToolbar {
                    HStack {
                        Spacer(minLength: 0)
                        Button("Follow a Team") { showSearch = true }
                            .buttonStyle(FilterChipStyle())
                    }
                }
                if model.settings.sports.followedTeams.isEmpty {
                    BrowseEmpty(title: "No Teams", message: "Follow teams to see their upcoming fixtures and results here.") {
                        Button("Find Teams") { showSearch = true }.buttonStyle(PrimaryButtonStyle())
                    }
                }
                ForEach(model.settings.sports.followedTeams) { team in
                    teamSection(team)
                }
            }
            .padding(.bottom, Theme.Space.xl)
        }
        .scrollIndicators(.hidden)
        .browsePage("Sports")
        .sheet(isPresented: $showSearch) { TeamSearchView().environment(model) }
        .flowModal(item: $channelsFor) { event in
            GameChannelsView(event: event)
                .switchTint(model.settings.general.accent)
                .environment(model)
        }
        .liveChannelCover($playing, epg: live.epg, autoRotate: model.settings.playback.autoRotate)
        .task(id: model.settings.sports.followedTeams.map(\.id)) { await load() }
    }

    /// A team: its badge and name on a red label under a rule, then fixtures, then recent results.
    private func teamSection(_ team: SportsTeam) -> some View {
        let next = upcoming[team.id] ?? []
        let last = results[team.id] ?? []
        return VStack(alignment: .leading, spacing: Theme.Space.xs) {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                RuleLine()
                HStack(alignment: .center, spacing: Theme.Space.s) {
                    RemoteImage(url: team.badgeURL, contentMode: .fit)
                        .frame(width: 28 * Theme.scale, height: 28 * Theme.scale)
                        .accessibilityHidden(true)
                    SectionLabel(team.name)
                    if let league = team.league {
                        Text(league).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.muted).lineLimit(1)
                    }
                    Spacer(minLength: Theme.Space.s)
                    Button("Unfollow") {
                        model.settings.sports.followedTeams.removeAll { $0.id == team.id }
                    }
                    .buttonStyle(QuietButtonStyle())
                    .accessibilityLabel("Unfollow \(team.name)")
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            VStack(spacing: 0) {
                if next.isEmpty && last.isEmpty {
                    Text("No fixtures available")
                        .font(Theme.Typeface.caption)
                        .foregroundStyle(Theme.Palette.muted)
                        .ruledRowFrame()
                }
                ForEach(next.prefix(5)) { event in row(event) }
                if !last.isEmpty {
                    Text("Recent Results")
                        .font(Theme.Typeface.micro)
                        .textCase(.uppercase)
                        .tracking(0.12 * 11 * Theme.scale)
                        .foregroundStyle(Theme.Palette.muted)
                        .padding(.top, Theme.Space.s)
                        .padding(.bottom, Theme.Space.xxs)
                        .padding(.horizontal, Theme.Space.xs)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .ruledRow()
                    ForEach(last.prefix(3)) { event in row(event) }
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
        }
    }

    private func load() async {
        let client = self.client
        for team in model.settings.sports.followedTeams {
            async let next = try? client.nextEvents(teamID: team.id)
            async let last = try? client.lastEvents(teamID: team.id)
            // A failed (or cancelled) request keeps what was already showing instead of blanking the team.
            if let fixtures = await next { upcoming[team.id] = fixtures }
            if let recent = await last { results[team.id] = recent }
        }
        // A refresh is the moment to notice matches that have just finished.
        await model.announceResults(results.values.flatMap { $0 })
    }

    /// A game: tap and press-and-hold are the channel list and the best match, in the order the setting picks.
    private func row(_ event: SportsEvent) -> some View {
        let hidden = !model.settings.sports.showScoreSpoilers && !revealed.contains(event.id)
        return EventRow(event: event, scoreHidden: hidden) { revealed.insert(event.id) }
            .onTapGesture {
                // A finished game has nothing to watch: the tap uncovers its score.
                if hidden && event.isFinished { revealed.insert(event.id) } else { open(event, list: model.settings.sports.chooseChannelOnTap) }
            }
            .onLongPressGesture { open(event, list: !model.settings.sports.chooseChannelOnTap) }
            #if os(tvOS)
            .focusable()
            #endif
            .accessibilityAddTraits(.isButton)
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
                let matches = self.matches
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
                        VStack(alignment: .leading, spacing: Theme.Space.s) {
                            SectionHead("Channels", note: event.title)
                            VStack(spacing: 0) {
                                ForEach(matches, id: \.id) { match in
                                    Button { playing = match.channel } label: {
                                        ChannelRow(channel: match.channel, epg: live.epg,
                                                   isFavourite: model.settings.liveTV.favouriteChannelIDs.contains(match.channel.id))
                                    }
                                    .buttonStyle(BrowseRowStyle())
                                }
                            }
                            .padding(.horizontal, Theme.Space.gutter)
                        }
                        .padding(.top, Theme.Space.m)
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
            .liveChannelCover($playing, epg: live.epg, autoRotate: model.settings.playback.autoRotate)
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 420)
        #endif
    }
}

extension View {
    /// The live player over this screen: a sheet on the Mac, full screen elsewhere.
    @ViewBuilder
    func liveChannelCover(_ channel: Binding<Channel?>, epg: EPG, autoRotate: Bool = true) -> some View {
        #if os(macOS)
        sheet(item: channel) { LivePlayerView(channel: $0, epg: epg).darkScope().frame(minWidth: 800, minHeight: 450) }
        #elseif os(iOS)
        rotatingCover(item: channel, startsInLandscape: autoRotate) { LivePlayerView(channel: $0, epg: epg, onClose: $1).darkScope() }
        #else
        fullScreenCover(item: channel) { LivePlayerView(channel: $0, epg: epg).darkScope() }
        #endif
    }
}

/// A fixture as a ruled row: its day and time, the teams and league, and the score in red. It lights blue while
/// hovered or focused (the caller makes it focusable on Apple TV).
struct EventRow: View {
    let event: SportsEvent
    /// Blurs the score until `reveal` is called, so a result isn't spoiled by scrolling past it.
    var scoreHidden = false
    var reveal: () -> Void = {}
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    private var lit: Bool { focused || hovering }

    var body: some View {
        HStack(spacing: Theme.Space.m) {
            when
                .frame(width: 88 * Theme.scale, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(Theme.Typeface.heading)
                    .textCase(.uppercase)
                    .lineLimit(2)
                if let league = event.league {
                    Text(league).font(Theme.Typeface.caption).foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted).lineLimit(1)
                }
            }
            Spacer(minLength: Theme.Space.xs)
            score
        }
        .environment(\.rowLit, lit)
        .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.fg)
        .padding(.vertical, Theme.Space.s)
        .padding(.horizontal, Theme.Space.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(lit ? Theme.Palette.blue : Color.clear)
        .contentShape(Rectangle())
        .ruledRow()
        .animation(Theme.Motion.hover, value: lit)
        #if !os(tvOS)
        .onHover { hovering = $0 }
        #endif
    }

    /// The day over the time, in mono.
    @ViewBuilder
    private var when: some View {
        if let date = event.date {
            VStack(alignment: .leading, spacing: 2) {
                Text(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                    .textCase(.uppercase)
                Text(date.formatted(date: .omitted, time: .shortened))
            }
            .font(Theme.Typeface.caption)
            .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted)
        } else {
            Color.clear.frame(width: 0, height: 0)
        }
    }

    private var scoreFont: Font { Theme.Typeface.custom(Theme.Face.condensed, 28, .title2).monospacedDigit() }

    @ViewBuilder
    private var score: some View {
        if let h = event.homeScore, let a = event.awayScore {
            if scoreHidden {
                // The blur is of a stand-in, so even its width gives nothing away.
                Button(action: reveal) {
                    Text("0 – 0").font(scoreFont)
                        .blur(radius: 7 * Theme.scale)
                        .overlay { Image(systemName: "eye.slash").font(.caption).foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted) }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Score hidden")
                .accessibilityHint("Shows the score")
            } else {
                Text("\(h) – \(a)").font(scoreFont).foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.red)
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
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(teams) { team in
                        Button {
                            if !model.settings.sports.followedTeams.contains(where: { $0.id == team.id }) {
                                model.settings.sports.followedTeams.append(team)
                            }
                            dismiss()
                        } label: {
                            HStack(spacing: Theme.Space.m) {
                                RemoteImage(url: team.badgeURL, contentMode: .fit).frame(width: 36 * Theme.scale, height: 36 * Theme.scale)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(team.name).font(Theme.Typeface.heading).textCase(.uppercase).lineLimit(1)
                                    Text([team.sport, team.league, team.country].compactMap { $0 }.joined(separator: " · "))
                                        .font(Theme.Typeface.caption)
                                        .rowInk(Theme.Palette.muted)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: 0)
                            }
                        }
                        .buttonStyle(BrowseRowStyle())
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Theme.Space.m)
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
                let found = (try? await SportsClient(apiKey: model.settings.sports.apiKey, http: model.http).searchTeams(query)) ?? []
                // A newer keystroke owns the list and the spinner now.
                guard !Task.isCancelled else { return }
                teams = found
                searching = false
            }
        }
    }
}
