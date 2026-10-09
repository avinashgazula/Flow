import SwiftUI
import FlowKit

/// Followed teams with upcoming fixtures and recent results (TheSportsDB).
struct SportsView: View {
    @Environment(AppModel.self) private var model
    @State private var upcoming: [String: [SportsEvent]] = [:]
    @State private var results: [String: [SportsEvent]] = [:]
    @State private var showSearch = false

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
                    ForEach(next.prefix(5)) { event in EventRow(event: event) }
                    if !last.isEmpty {
                        Text("Recent Results").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(last.prefix(3)) { event in EventRow(event: event) }
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
    }
}

struct EventRow: View {
    let event: SportsEvent

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
            if let h = event.homeScore, let a = event.awayScore {
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
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
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
